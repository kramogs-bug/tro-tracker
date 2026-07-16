import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeState } from "./tracker.js";
import { isCloudConfigured, supabase } from "./supabaseClient.js";

const GUEST_STATE_KEY = "troTrackerGuestData:v1";
const ACTIVE_CLOUD_USER_KEY = "troTrackerActiveCloudUser:v1";

export function useCloudTracker(state, setState) {
  const stateRef = useRef(state);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(!isCloudConfigured);
  const [cloudReady, setCloudReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState(
    isCloudConfigured ? "local" : "unavailable",
  );
  const [syncMessage, setSyncMessage] = useState("");

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

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session || null);
      setAuthReady(true);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!active) return;
        setSession(nextSession);
        setAuthReady(true);
        if (!nextSession) {
          if (localStorage.getItem(ACTIVE_CLOUD_USER_KEY)) restoreGuestState();
          setCloudReady(false);
          setSyncStatus("local");
          setSyncMessage("Guest mode · saved on this device");
        }
      },
    );
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [restoreGuestState]);

  useEffect(() => {
    if (!supabase || !session?.user?.id) return undefined;
    let active = true;
    setCloudReady(false);
    setSyncStatus("syncing");
    setSyncMessage("Loading cloud data…");
    const load = async () => {
      const activeUserId = localStorage.getItem(ACTIVE_CLOUD_USER_KEY);
      if (!activeUserId) {
        localStorage.setItem(GUEST_STATE_KEY, JSON.stringify(stateRef.current));
      } else if (activeUserId !== session.user.id) {
        restoreGuestState();
      }
      const { data, error } = await supabase
        .from("tracker_states")
        .select("data")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (!active) return;
      if (error) {
        setSyncStatus("error");
        setSyncMessage(error.message);
        return;
      }
      if (data?.data) {
        const cloudState = normalizeState(data.data);
        stateRef.current = cloudState;
        setState(cloudState);
      } else {
        const { error: createError } = await supabase
          .from("tracker_states")
          .upsert({
            user_id: session.user.id,
            data: stateRef.current,
            updated_at: new Date().toISOString(),
          });
        if (createError) {
          setSyncStatus("error");
          setSyncMessage(createError.message);
          return;
        }
      }
      setCloudReady(true);
      localStorage.setItem(ACTIVE_CLOUD_USER_KEY, session.user.id);
      setSyncStatus("saved");
      setSyncMessage("Saved to cloud");
    };
    load();
    return () => {
      active = false;
    };
  }, [session?.user?.id, setState, restoreGuestState]);

  const syncNow = useCallback(async () => {
    if (!supabase || !session?.user?.id || !cloudReady) return false;
    if (!navigator.onLine) {
      setSyncStatus("offline");
      setSyncMessage("Offline · changes saved locally");
      return false;
    }
    setSyncStatus("syncing");
    setSyncMessage("Syncing…");
    const { error } = await supabase.from("tracker_states").upsert({
      user_id: session.user.id,
      data: stateRef.current,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      setSyncStatus("error");
      setSyncMessage(error.message);
      return false;
    }
    setSyncStatus("saved");
    setSyncMessage("Saved to cloud");
    return true;
  }, [cloudReady, session?.user?.id]);

  useEffect(() => {
    if (!cloudReady || !session?.user?.id) return undefined;
    const timer = setTimeout(syncNow, 700);
    return () => clearTimeout(timer);
  }, [state, cloudReady, session?.user?.id, syncNow]);

  useEffect(() => {
    if (!session?.user?.id) return undefined;
    const handleOnline = () => syncNow();
    const handleOffline = () => {
      setSyncStatus("offline");
      setSyncMessage("Offline · changes saved locally");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [session?.user?.id, syncNow]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

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
