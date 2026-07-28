import { useCallback, useEffect, useState } from "react";
import { loadOwnerProfitSubmissions } from "./profitSubmissions.js";

export function useProfitSubmissions(enabled) {
  const [submissions, setSubmissions] = useState([]);
  const [status, setStatus] = useState(enabled ? "loading" : "signed-out");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!enabled || !navigator.onLine) return false;
    setStatus((current) => (current === "ready" ? current : "loading"));
    try {
      const next = await loadOwnerProfitSubmissions();
      setSubmissions(next);
      setStatus("ready");
      setError("");
      return true;
    } catch (loadError) {
      setStatus("error");
      setError(loadError?.message || "Could not load player inputs.");
      return false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setSubmissions([]);
      setStatus("signed-out");
      setError("");
      return undefined;
    }
    void refresh();
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    const handleOnline = () => void refresh();
    const handleVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      window.clearInterval(refreshTimer);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [enabled, refresh]);

  return {
    submissions,
    pendingCount: submissions.filter(
      (submission) => submission.status === "pending",
    ).length,
    status,
    error,
    refresh,
  };
}
