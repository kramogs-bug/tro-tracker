import {
  cashoutRatios,
  localDate,
  summarize,
  summarizePeriods,
} from "./tracker.js";
import { supabase } from "./supabaseClient.js";

const SUMMARY_KEYS = [
  "gralats",
  "grossTro",
  "grossPhp",
  "shovels",
  "deduction",
  "deductionPhp",
  "netTro",
  "netPhp",
];

function transactionsForPlayer(state, playerId) {
  return state.transactions.filter((entry) => entry.playerId === playerId);
}

function compactSummary(summary) {
  return Object.fromEntries(
    SUMMARY_KEYS.map((key) => [key, Number(summary?.[key]) || 0]),
  );
}

function dateDaysAgo(now, daysAgo) {
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return localDate(date);
}

export function playerFirstInputAt(transactions, playerId) {
  let earliest = null;
  transactions.forEach((entry) => {
    if (entry.playerId !== playerId) return;
    const timestamp = new Date(entry.createdAt).getTime();
    if (!Number.isFinite(timestamp)) return;
    if (!earliest || timestamp < earliest.timestamp) {
      earliest = { timestamp, value: entry.createdAt };
    }
  });
  return earliest?.value || null;
}

export function gainChangeRatio(current, previous) {
  const currentValue = Number(current) || 0;
  const previousValue = Number(previous) || 0;
  if (Math.abs(previousValue) < 0.005) {
    return Math.abs(currentValue) < 0.005 ? 0 : null;
  }
  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}

export function buildOverallGainAnalytics(state, now = new Date()) {
  const today = localDate(now);
  const yesterday = dateDaysAgo(now, 1);
  const transactionsByPlayer = new Map(
    state.players.map((player) => [player.id, []]),
  );
  const firstInputByPlayer = new Map();
  state.transactions.forEach((entry) => {
    transactionsByPlayer.get(entry.playerId)?.push(entry);
    const timestamp = new Date(entry.createdAt).getTime();
    const earliest = firstInputByPlayer.get(entry.playerId);
    if (
      Number.isFinite(timestamp) &&
      (!earliest || timestamp < earliest.timestamp)
    ) {
      firstInputByPlayer.set(entry.playerId, {
        timestamp,
        value: entry.createdAt,
      });
    }
  });
  const rows = state.players.map((player) => {
    const transactions = transactionsByPlayer.get(player.id) || [];
    const settings = player.settings || state.settings;
    const allTime = summarize(transactions, settings);
    const todaySummary = summarize(
      transactions.filter((entry) => entry.date === today),
      settings,
    );
    const yesterdaySummary = summarize(
      transactions.filter((entry) => entry.date === yesterday),
      settings,
    );
    return {
      player,
      allTime,
      today: todaySummary,
      yesterday: yesterdaySummary,
      firstInputAt: firstInputByPlayer.get(player.id)?.value || null,
      changePhp: todaySummary.netPhp - yesterdaySummary.netPhp,
      changeRatio: gainChangeRatio(
        todaySummary.netPhp,
        yesterdaySummary.netPhp,
      ),
    };
  });
  const combinedTodayPhp = rows.reduce(
    (sum, row) => sum + row.today.netPhp,
    0,
  );
  const combinedAllTimePhp = rows.reduce(
    (sum, row) => sum + row.allTime.netPhp,
    0,
  );
  const withShares = rows.map((row) => ({
    ...row,
    todayShare:
      Math.abs(combinedTodayPhp) < 0.005
        ? 0
        : (row.today.netPhp / combinedTodayPhp) * 100,
    overallShare:
      Math.abs(combinedAllTimePhp) < 0.005
        ? 0
        : (row.allTime.netPhp / combinedAllTimePhp) * 100,
  }));
  const ranked = withShares.toSorted(
    (a, b) =>
      Number(Boolean(b.firstInputAt)) - Number(Boolean(a.firstInputAt)) ||
      b.allTime.netPhp - a.allTime.netPhp ||
      b.allTime.netTro - a.allTime.netTro ||
      a.player.name.localeCompare(b.player.name),
  );
  const daily = withShares.toSorted(
    (a, b) =>
      b.today.netPhp - a.today.netPhp ||
      b.allTime.netPhp - a.allTime.netPhp ||
      a.player.name.localeCompare(b.player.name),
  );
  return {
    today,
    yesterday,
    ranked,
    daily,
    highestGain: ranked[0]?.firstInputAt ? ranked[0] : null,
    combinedTodayPhp,
    combinedAllTimePhp,
  };
}

export function buildPlayerProfitSnapshot(player, state, now = new Date()) {
  const settings = player.settings || state.settings;
  const transactions = transactionsForPlayer(state, player.id);
  const cashouts = (state.cashouts || []).filter(
    (cashout) => cashout.playerId === player.id,
  );
  const periods = summarizePeriods(transactions, settings, now);
  const allTime = summarize(transactions, settings);
  const today = localDate(now);
  const yesterday = dateDaysAgo(now, 1);
  const yesterdaySummary = summarize(
    transactions.filter((entry) => entry.date === yesterday),
    settings,
  );
  const totalCashoutPhp = cashouts.reduce(
    (sum, cashout) => sum + cashout.amount,
    0,
  );
  const totalCashoutTro = cashouts.reduce((sum, cashout) => {
    const ratios = cashoutRatios(cashout, settings);
    return sum + (cashout.amount / ratios.phpAmount) * ratios.phpTro;
  }, 0);
  const dailyHistory = Array.from({ length: 8 }, (_, index) => {
    const date = dateDaysAgo(now, 7 - index);
    const summary = summarize(
      transactions.filter((entry) => entry.date === date),
      settings,
    );
    return { date, summary: compactSummary(summary) };
  })
    .map((day, index, days) => ({
      ...day,
      changeRatio:
        index === 0
          ? null
          : gainChangeRatio(day.summary.netPhp, days[index - 1].summary.netPhp),
    }))
    .slice(1);

  return {
    kind: "tro-profit-summary",
    version: 1,
    generatedAt: new Date(now).toISOString(),
    player: {
      name: player.name,
      firstInputAt: playerFirstInputAt(state.transactions, player.id),
    },
    dates: { today, yesterday },
    summaries: {
      today: compactSummary(periods.daily),
      yesterday: compactSummary(yesterdaySummary),
      week: compactSummary(periods.weekly),
      month: compactSummary(periods.monthly),
      allTime: compactSummary(allTime),
    },
    cashout: {
      php: totalCashoutPhp,
      tro: totalCashoutTro,
    },
    balance: {
      php: allTime.netPhp - totalCashoutPhp,
      tro: allTime.netTro - totalCashoutTro,
    },
    dailyChangeRatio: gainChangeRatio(
      periods.daily.netPhp,
      yesterdaySummary.netPhp,
    ),
    dailyHistory,
  };
}

function encodeUtf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeUtf8(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function safeSummary(value) {
  return Object.fromEntries(
    SUMMARY_KEYS.map((key) => {
      const number = Number(value?.[key]);
      return [key, Number.isFinite(number) ? number : 0];
    }),
  );
}

export function createProfitShareUrl(snapshot, location = window.location) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = `summary=${encodeUtf8(JSON.stringify(snapshot))}`;
  return url.toString();
}

function sanitizeProfitSnapshot(parsed) {
  if (
    parsed?.kind !== "tro-profit-summary" ||
    parsed.version !== 1 ||
    typeof parsed.player?.name !== "string"
  ) {
    return null;
  }
  return {
    ...parsed,
    player: {
      name: parsed.player.name.slice(0, 50),
      firstInputAt: parsed.player.firstInputAt || null,
    },
    summaries: Object.fromEntries(
      ["today", "yesterday", "week", "month", "allTime"].map((key) => [
        key,
        safeSummary(parsed.summaries?.[key]),
      ]),
    ),
    cashout: {
      php: Number(parsed.cashout?.php) || 0,
      tro: Number(parsed.cashout?.tro) || 0,
    },
    balance: {
      php: Number(parsed.balance?.php) || 0,
      tro: Number(parsed.balance?.tro) || 0,
    },
    dailyChangeRatio:
      parsed.dailyChangeRatio === null
        ? null
        : Number(parsed.dailyChangeRatio) || 0,
    dailyHistory: Array.isArray(parsed.dailyHistory)
      ? parsed.dailyHistory.slice(-7).map((day) => ({
          date: /^\d{4}-\d{2}-\d{2}$/.test(day?.date || "") ? day.date : "",
          summary: safeSummary(day?.summary),
          changeRatio:
            day?.changeRatio === null ? null : Number(day?.changeRatio) || 0,
        }))
      : [],
  };
}

function createShareId() {
  if (!globalThis.crypto?.getRandomValues) return null;
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function createShortShareUrl(id, location) {
  const url = new URL(location.href);
  url.pathname = `/s/${id}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function createProfitShareLink(
  snapshot,
  location = window.location,
) {
  if (supabase) {
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const id = createShareId();
        if (!id) break;
        const { data, error } = await supabase.rpc("create_profit_share", {
          p_id: id,
          p_snapshot: snapshot,
        });
        if (!error && data === id) {
          return {
            url: createShortShareUrl(id, location),
            short: true,
          };
        }
      }
    } catch {
      // Keep the existing self-contained link as an offline fallback.
    }
  }
  return {
    url: createProfitShareUrl(snapshot, location),
    short: false,
  };
}

export function readProfitShareId(pathname = window.location.pathname) {
  const match = String(pathname).match(
    /^\/s\/([A-Za-z0-9_-]{10,16})\/?$/,
  );
  return match?.[1] || null;
}

export async function loadProfitShareSnapshot(id) {
  if (!supabase || !/^[A-Za-z0-9_-]{10,16}$/.test(String(id || ""))) {
    return null;
  }
  const { data, error } = await supabase
    .from("profit_share_snapshots")
    .select("snapshot")
    .eq("id", id)
    .maybeSingle();
  if (error || !data?.snapshot) return null;
  return sanitizeProfitSnapshot(data.snapshot);
}

export function readProfitSnapshot(hash = window.location.hash) {
  try {
    if (!hash.startsWith("#summary=") || hash.length > 30000) return null;
    return sanitizeProfitSnapshot(
      JSON.parse(decodeUtf8(hash.slice("#summary=".length))),
    );
  } catch {
    return null;
  }
}
