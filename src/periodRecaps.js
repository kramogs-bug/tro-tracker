import { localDate, summarize } from "./tracker.js";

function dateAtNoon(value) {
  return new Date(`${value}T12:00:00`);
}

function addDays(value, days) {
  const date = value instanceof Date ? new Date(value) : dateAtNoon(value);
  date.setDate(date.getDate() + days);
  return date;
}

function gainChangeRatio(current, previous) {
  const currentValue = Number(current) || 0;
  const previousValue = Number(previous) || 0;
  if (Math.abs(previousValue) < 0.005) {
    return Math.abs(currentValue) < 0.005 ? 0 : null;
  }
  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function transactionsInRange(transactions, playerId, start, end) {
  return transactions.filter(
    (entry) =>
      entry.playerId === playerId &&
      entry.date >= start &&
      entry.date <= end,
  );
}

function recapBadge({ rank, netPhp, changeRatio, activeDays }) {
  if (rank === 1 && netPhp > 0) return "Top Grinder";
  if (changeRatio !== null && changeRatio >= 25) return "Comeback Player";
  if (activeDays >= 5) return "Consistency Streak";
  if (netPhp >= 500) return "Payout Hunter";
  if (netPhp > 0) return "Mission Complete";
  return "Warm-up Run";
}

function buildPeriodRecaps(state, period) {
  const rows = state.players
    .map((player) => {
      const currentTransactions = transactionsInRange(
        state.transactions,
        player.id,
        period.start,
        period.end,
      );
      const settings = player.settings || state.settings;
      const summary = summarize(currentTransactions, settings);
      const previousSummary = summarize(
        transactionsInRange(
          state.transactions,
          player.id,
          period.comparisonStart,
          period.comparisonEnd,
        ),
        settings,
      );
      return {
        playerId: player.id,
        name: player.name,
        netPhp: roundMoney(summary.netPhp),
        netTro: Number(summary.netTro) || 0,
        previousNetPhp: roundMoney(previousSummary.netPhp),
        activeDays: new Set(
          currentTransactions
            .filter(
              (entry) =>
                entry.allocationPercent === undefined ||
                Number(entry.allocationPercent) > 0,
            )
            .map((entry) => entry.date),
        ).size,
      };
    })
    .toSorted(
      (a, b) =>
        b.netPhp - a.netPhp ||
        b.netTro - a.netTro ||
        a.name.localeCompare(b.name),
    );
  const teamNetPhp = roundMoney(
    rows.reduce((sum, row) => sum + row.netPhp, 0),
  );
  return new Map(
    rows.map((current, currentIndex) => {
      if (current.activeDays === 0 && Math.abs(current.netPhp) < 0.005) {
        return [current.playerId, null];
      }
      const changeRatio = gainChangeRatio(
        current.netPhp,
        current.previousNetPhp,
      );
      const rank = currentIndex + 1;
      const nextRank = rank > 1 ? rows[currentIndex - 1] : null;
      return [
        current.playerId,
        {
          kind: period.kind,
          key: `${period.kind}:${period.start}:${period.end}`,
          start: period.start,
          end: period.end,
          netPhp: current.netPhp,
          netTro: current.netTro,
          rank,
          playerCount: rows.length,
          activeDays: current.activeDays,
          changeRatio,
          previousNetPhp: current.previousNetPhp,
          teamNetPhp,
          nextRankGapPhp: nextRank
            ? roundMoney(Math.max(0, nextRank.netPhp - current.netPhp))
            : 0,
          badge: recapBadge({
            rank,
            netPhp: current.netPhp,
            changeRatio,
            activeDays: current.activeDays,
          }),
        },
      ];
    }),
  );
}

export function completedPeriodRanges(now = new Date()) {
  const today = dateAtNoon(localDate(now));
  const currentWeekStart = addDays(today, -((today.getDay() + 6) % 7));
  const weekEnd = addDays(currentWeekStart, -1);
  const weekStart = addDays(weekEnd, -6);
  const comparisonWeekEnd = addDays(weekStart, -1);
  const comparisonWeekStart = addDays(comparisonWeekEnd, -6);

  const monthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1, 12);
  const monthEnd = new Date(today.getFullYear(), today.getMonth(), 0, 12);
  const comparisonMonthStart = new Date(
    today.getFullYear(),
    today.getMonth() - 2,
    1,
    12,
  );
  const comparisonMonthEnd = new Date(
    today.getFullYear(),
    today.getMonth() - 1,
    0,
    12,
  );

  return {
    weekly: {
      kind: "weekly",
      start: localDate(weekStart),
      end: localDate(weekEnd),
      comparisonStart: localDate(comparisonWeekStart),
      comparisonEnd: localDate(comparisonWeekEnd),
    },
    monthly: {
      kind: "monthly",
      start: localDate(monthStart),
      end: localDate(monthEnd),
      comparisonStart: localDate(comparisonMonthStart),
      comparisonEnd: localDate(comparisonMonthEnd),
    },
  };
}

export function buildPlayerPeriodRecaps(state, playerId, now = new Date()) {
  return (
    buildAllPlayerPeriodRecaps(state, now).get(playerId) || {
      weekly: null,
      monthly: null,
    }
  );
}

export function buildAllPlayerPeriodRecaps(state, now = new Date()) {
  const periods = completedPeriodRanges(now);
  const weekly = buildPeriodRecaps(state, periods.weekly);
  const monthly = buildPeriodRecaps(state, periods.monthly);
  return new Map(
    state.players.map((player) => [
      player.id,
      {
        weekly: weekly.get(player.id) || null,
        monthly: monthly.get(player.id) || null,
      },
    ]),
  );
}
