import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeState } from "./tracker.js";
import { isCloudConfigured, supabase } from "./supabaseClient.js";

const GUEST_STATE_KEY = "troTrackerGuestData:v1";
const ACTIVE_CLOUD_USER_KEY = "troTrackerActiveCloudUser:v1";
const serializeState = (value) => JSON.stringify(normalizeState(value));
const createWriterId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function useCloudTracker(state, setState) {
  const stateRef = useRef(state);
  const writerIdRef = useRef(createWriterId());
  const revisionRef = useRef(0);
  const lastSyncedHashRef = useRef("");
  const writeQueuedRef = useRef(false);
  const writePromiseRef = useRef(null);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!isCloudConfigured);
  const [cloudReady, setCloudReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState(
    isCloudConfigured ? "local" : "unavailable",
  );
  const [syncMessage, setSyncMessage] = useState("");
  const userId = session?.user?.id;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const restoreGuestState = useCallback(() => {
    try {
      const stored = localStorage.getItem(GUEST_STATE_KEY);
      if (stored) {
        const guestState = normalizeState(JSON.parse(stored));
        stateRef.current = guestState;
        setState(guestState);
      }
    } catch {
      // Keep the current local state if the guest snapshot is unavailable.
    }
    localStorage.removeItem(ACTIVE_CLOUD_USER_KEY);
  }, [setState]);

  const applyCloudRow = useCallback(
    (row, message = "Saved to cloud · live sync active") => {
      if (!row?.data) return;
      const cloudState = normalizeState(row.data);
      const cloudHash = serializeState(cloudState);
      revisionRef.current = Math.max(
        revisionRef.current,
        Number(row.revision) || 0,
      );
      lastSyncedHashRef.current = cloudHash;
      if (cloudHash !== serializeState(stateRef.current)) {
        stateRef.current = cloudState;
        setState(cloudState);
      }
      setSyncStatus("saved");
      setSyncMessage(message);
    },
    [setState],
  );

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;

      if (nextSession) {
        setSession(nextSession);
        setAuthReady(true);
        return;
      }

      if (event === "SIGNED_OUT") {
        setSession(null);
        restoreGuestState();
        setCloudReady(false);
        setSyncStatus("local");
        setSyncMessage("Guest mode · saved on this device");
        setAuthReady(true);
        return;
      }

      if (event === "INITIAL_SESSION") {
        setSession(null);
        setCloudReady(false);
        setSyncStatus("local");
        setSyncMessage("Guest mode · saved on this device");
        setAuthReady(true);
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [restoreGuestState]);

  useEffect(() => {
    if (!supabase || !userId) return undefined;
    let active = true;
    revisionRef.current = 0;
    lastSyncedHashRef.current = "";
    writeQueuedRef.current = false;
    setCloudReady(false);
    setSyncStatus("syncing");
    setSyncMessage("Loading cloud data…");

    const load = async () => {
      const activeUserId = localStorage.getItem(ACTIVE_CLOUD_USER_KEY);
      if (!activeUserId) {
        localStorage.setItem(GUEST_STATE_KEY, JSON.stringify(stateRef.current));
      }

      let { data: row, error } = await supabase
        .from("tracker_states")
        .select("data, revision, writer_id, updated_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (!active) return;

      if (!error && !row) {
        const snapshot = normalizeState(stateRef.current);
        const created = await supabase
          .from("tracker_states")
          .insert({
            user_id: userId,
            data: snapshot,
            writer_id: writerIdRef.current,
          })
          .select("data, revision, writer_id, updated_at")
          .single();
        if (created.error?.code === "23505") {
          const existing = await supabase
            .from("tracker_states")
            .select("data, revision, writer_id, updated_at")
            .eq("user_id", userId)
            .single();
          row = existing.data;
          error = existing.error;
        } else {
          row = created.data;
          error = created.error;
        }
      }

      if (!active) return;
      if (error) {
        setSyncStatus("error");
        setSyncMessage(error.message);
        return;
      }

      applyCloudRow(row);
      localStorage.setItem(ACTIVE_CLOUD_USER_KEY, userId);
      setCloudReady(true);
    };

    void load();
    return () => {
      active = false;
    };
  }, [applyCloudRow, userId]);

  const pullLatest = useCallback(
    async (message = "Saved to cloud · live sync active") => {
      if (!supabase || !userId) return false;
      const { data, error } = await supabase
        .from("tracker_states")
        .select("data, revision, writer_id, updated_at")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        setSyncStatus("error");
        setSyncMessage(error.message);
        return false;
      }
      if (data && Number(data.revision) > revisionRef.current) {
        applyCloudRow(data, message);
      }
      return true;
    },
    [applyCloudRow, userId],
  );

  const syncNow = useCallback(async () => {
    if (!supabase || !userId || !cloudReady) return false;
    if (!navigator.onLine) {
      setSyncStatus("offline");
      setSyncMessage("Offline · changes saved locally");
      return false;
    }

    writeQueuedRef.current = true;
    if (writePromiseRef.current) return writePromiseRef.current;

    const flush = async () => {
      let saved = true;
      while (writeQueuedRef.current) {
        writeQueuedRef.current = false;
        const snapshot = normalizeState(stateRef.current);
        const snapshotHash = serializeState(snapshot);
        if (snapshotHash === lastSyncedHashRef.current) continue;

        setSyncStatus("syncing");
        setSyncMessage("Syncing automatically…");
        const expectedRevision = revisionRef.current;
        const { data, error } = await supabase.rpc("save_tracker_state", {
          p_data: snapshot,
          p_expected_revision: expectedRevision,
          p_writer_id: writerIdRef.current,
        });

        if (error) {
          setSyncStatus("error");
          setSyncMessage(error.message);
          saved = false;
          break;
        }

        const savedRow = Array.isArray(data) ? data[0] : data;
        if (!savedRow) {
          saved = false;
          await pullLatest(
            "Newer data from another device was loaded automatically",
          );
          break;
        }

        revisionRef.current = Math.max(
          revisionRef.current,
          Number(savedRow.state_revision) || expectedRevision + 1,
        );
        lastSyncedHashRef.current = snapshotHash;
        if (serializeState(stateRef.current) !== snapshotHash) {
          writeQueuedRef.current = true;
        }
      }

      if (saved) {
        setSyncStatus("saved");
        setSyncMessage("Saved to cloud · live sync active");
      }
      return saved;
    };

    const request = flush();
    writePromiseRef.current = request;
    try {
      return await request;
    } finally {
      writePromiseRef.current = null;
    }
  }, [cloudReady, pullLatest, userId]);

  useEffect(() => {
    if (!supabase || !userId || !cloudReady) return undefined;
    const channel = supabase
      .channel(`tracker-state-${userId}-${writerIdRef.current}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tracker_states",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new;
          if (!row?.data) return;
          const revision = Number(row.revision) || 0;
          if (revision <= revisionRef.current) return;

          if (row.writer_id === writerIdRef.current) {
            revisionRef.current = revision;
            lastSyncedHashRef.current = serializeState(row.data);
            if (
              serializeState(stateRef.current) === lastSyncedHashRef.current
            ) {
              setSyncStatus("saved");
              setSyncMessage("Saved to cloud · live sync active");
            }
            return;
          }

          applyCloudRow(row, "Live synced from another device");
        },
      )
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setSyncStatus("error");
          setSyncMessage(error?.message || "Live sync connection failed");
        } else if (
          status === "SUBSCRIBED" &&
          serializeState(stateRef.current) === lastSyncedHashRef.current
        ) {
          setSyncStatus("saved");
          setSyncMessage("Saved to cloud · live sync active");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [applyCloudRow, cloudReady, userId]);

  useEffect(() => {
    if (!cloudReady || !userId) return undefined;
    const currentHash = serializeState(state);
    if (currentHash === lastSyncedHashRef.current) return undefined;
    const timer = setTimeout(() => void syncNow(), 700);
    return () => clearTimeout(timer);
  }, [state, cloudReady, syncNow, userId]);

  useEffect(() => {
    if (!cloudReady || !userId) return undefined;
    const refresh = () => {
      if (!navigator.onLine) return;
      if (serializeState(stateRef.current) !== lastSyncedHashRef.current) {
        void syncNow();
      } else {
        void pullLatest();
      }
    };
    const handleOnline = () => refresh();
    const handleOffline = () => {
      setSyncStatus("offline");
      setSyncMessage("Offline · changes saved locally");
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [cloudReady, pullLatest, syncNow, userId]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    if (navigator.onLine) await syncNow();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      setSyncStatus("error");
      setSyncMessage(error.message);
    }
  }, [syncNow]);

  return {
    session,
    authReady,
    syncStatus,
    syncMessage,
    syncNow,
    signOut,
    cloudConfigured: isCloudConfigured,
  };
}
