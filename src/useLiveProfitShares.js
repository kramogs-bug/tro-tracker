import { useCallback, useEffect, useRef } from "react";
import {
  buildPlayerProfitSnapshot,
  isProfitShareActive,
  syncLiveProfitShare,
} from "./profitAnalytics.js";
import { buildTeamDailyBoard } from "./teamBoardAnalytics.js";
import { buildAllPlayerPeriodRecaps } from "./periodRecaps.js";

export function useLiveProfitShares(state) {
  const stateRef = useRef(state);
  const syncInFlightRef = useRef(false);
  const syncQueuedRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const syncNow = useCallback(async () => {
    if (!navigator.onLine) return;
    if (syncInFlightRef.current) {
      syncQueuedRef.current = true;
      return;
    }

    syncInFlightRef.current = true;
    try {
      do {
        syncQueuedRef.current = false;
        const current = stateRef.current;
        const livePlayers = current.players.filter((player) =>
          isProfitShareActive(player.profitShare),
        );
        const now = new Date();
        const teamDailyBoard = buildTeamDailyBoard(current, now);
        const periodRecapsByPlayer = buildAllPlayerPeriodRecaps(
          current,
          now,
        );
        await Promise.allSettled(
          livePlayers.map((player) =>
            syncLiveProfitShare(
              buildPlayerProfitSnapshot(
                player,
                current,
                now,
                teamDailyBoard,
                periodRecapsByPlayer.get(player.id),
              ),
              player.profitShare,
            ),
          ),
        );
      } while (syncQueuedRef.current);
    } finally {
      syncInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (
      !state.players.some((player) =>
        isProfitShareActive(player.profitShare),
      )
    ) {
      return undefined;
    }
    const timer = setTimeout(() => void syncNow(), 900);
    return () => clearTimeout(timer);
  }, [
    state.cashouts,
    state.players,
    state.settings,
    state.transactions,
    syncNow,
  ]);

  useEffect(() => {
    const handleOnline = () => void syncNow();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [syncNow]);
}
