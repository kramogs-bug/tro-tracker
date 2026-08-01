import { localDate, summarize } from "./tracker.js";

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function buildTeamDailyBoard(state, now = new Date()) {
  const today = localDate(now);
  const dailyTransactionsByPlayer = new Map(
    state.players.map((player) => [player.id, []]),
  );
  state.transactions.forEach((entry) => {
    if (entry.date === today) {
      dailyTransactionsByPlayer.get(entry.playerId)?.push(entry);
    }
  });
  return state.players
    .map((player) => {
      const summary = summarize(
        dailyTransactionsByPlayer.get(player.id) || [],
        player.settings || state.settings,
      );
      return {
        playerKey: player.id,
        name: player.name,
        netPhp: roundMoney(summary.netPhp),
        netTro: Number(summary.netTro) || 0,
      };
    })
    .toSorted(
      (a, b) =>
        b.netPhp - a.netPhp ||
        b.netTro - a.netTro ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 100);
}
