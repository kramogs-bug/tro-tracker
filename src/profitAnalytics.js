import {
  cashoutRatios,
  localDate,
  summarize,
  summarizePeriods,
} from "./tracker.js";
import { SHELL_ITEMS } from "./sellablesData.js";
import {
  createPlayerInputUrl,
  createSubmissionToken,
  enableProfitSubmissions,
} from "./profitSubmissions.js";
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

export const PAYOUT_THRESHOLD_PHP = 500;
const PROFIT_SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{10,16}$/;
const PROFIT_SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function transactionsForPlayer(state, playerId) {
  return state.transactions.filter((entry) => entry.playerId === playerId);
}

function compactSummary(summary) {
  return Object.fromEntries(
    SUMMARY_KEYS.map((key) => [key, Number(summary?.[key]) || 0]),
  );
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
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

function gainChangeRatio(current, previous) {
  const currentValue = Number(current) || 0;
  const previousValue = Number(previous) || 0;
  if (Math.abs(previousValue) < 0.005) {
    return Math.abs(currentValue) < 0.005 ? 0 : null;
  }
  return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
}

export function buildPlayerBalanceAnalytics(
  state,
  payoutThreshold = PAYOUT_THRESHOLD_PHP,
) {
  const safeThreshold =
    Number.isFinite(Number(payoutThreshold)) && Number(payoutThreshold) > 0
      ? Number(payoutThreshold)
      : PAYOUT_THRESHOLD_PHP;
  const transactionsByPlayer = new Map(
    state.players.map((player) => [player.id, []]),
  );
  const cashoutsByPlayer = new Map(
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
  (state.cashouts || []).forEach((cashout) => {
    cashoutsByPlayer.get(cashout.playerId)?.push(cashout);
  });
  const rows = state.players.map((player) => {
    const transactions = transactionsByPlayer.get(player.id) || [];
    const cashouts = cashoutsByPlayer.get(player.id) || [];
    const settings = player.settings || state.settings;
    const allTime = summarize(transactions, settings);
    const totalCashoutPhp = roundMoney(
      cashouts.reduce(
        (sum, cashout) => sum + (Number(cashout.amount) || 0),
        0,
      ),
    );
    const totalCashoutTro = cashouts.reduce((sum, cashout) => {
      const ratios = cashoutRatios(cashout, settings);
      return (
        sum +
        ((Number(cashout.amount) || 0) / ratios.phpAmount) * ratios.phpTro
      );
    }, 0);
    const balancePhp = roundMoney(allTime.netPhp - totalCashoutPhp);
    const balanceTro = allTime.netTro - totalCashoutTro;
    const payoutsReady = Math.max(0, Math.floor(balancePhp / safeThreshold));
    return {
      player,
      allTime,
      totalCashoutPhp,
      totalCashoutTro,
      balancePhp,
      balanceTro,
      payoutsReady,
      isReady: payoutsReady > 0,
      amountNeededPhp: roundMoney(
        Math.max(0, safeThreshold - balancePhp),
      ),
      progressPercent: Math.min(
        100,
        Math.max(0, (balancePhp / safeThreshold) * 100),
      ),
      firstInputAt: firstInputByPlayer.get(player.id)?.value || null,
    };
  });
  const sortedRows = rows.toSorted(
    (a, b) =>
      Number(b.isReady) - Number(a.isReady) ||
      b.payoutsReady - a.payoutsReady ||
      b.balancePhp - a.balancePhp ||
      a.player.name.localeCompare(b.player.name),
  );
  return {
    payoutThreshold: safeThreshold,
    rows: sortedRows,
    readyCount: rows.filter((row) => row.isReady).length,
    readyPayoutCount: rows.reduce(
      (sum, row) => sum + row.payoutsReady,
      0,
    ),
    totalBalancePhp: roundMoney(
      rows.reduce((sum, row) => sum + row.balancePhp, 0),
    ),
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
  const ratioHistory = Object.fromEntries(
    Object.entries(player.ratioHistory || {})
      .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .toSorted(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .slice(-40),
  );
  const confirmedSubmissionIds = Array.from(
    new Set(
      transactions
        .map((entry) => entry.sourceSubmissionId)
        .filter(Boolean),
    ),
  ).slice(0, 50);

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
      php: roundMoney(allTime.netPhp - totalCashoutPhp),
      tro: allTime.netTro - totalCashoutTro,
    },
    dailyChangeRatio: gainChangeRatio(
      periods.daily.netPhp,
      yesterdaySummary.netPhp,
    ),
    dailyHistory,
    entryConfig: {
      items: SHELL_ITEMS.map((item) => ({
        name: item.name,
        price: item.price,
      })),
      defaultRatios: settings,
      ratioHistory,
    },
    confirmedSubmissionIds,
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

function safeShareRatios(value, fallback = null) {
  const defaults = fallback || {
    gralatsPerTro: 3.8,
    shovelTro: 3,
    phpTro: 1600,
    phpAmount: 50,
  };
  return Object.fromEntries(
    ["gralatsPerTro", "shovelTro", "phpTro", "phpAmount"].map((key) => {
      const number = Number(value?.[key]);
      return [key, number > 0 ? number : defaults[key]];
    }),
  );
}

function safeEntryConfig(value) {
  const defaultRatios = safeShareRatios(value?.defaultRatios);
  const ratioHistory = Object.fromEntries(
    Object.entries(
      value?.ratioHistory && typeof value.ratioHistory === "object"
        ? value.ratioHistory
        : {},
    )
      .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .toSorted(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .slice(-40)
      .map(([date, ratios]) => [
        date,
        safeShareRatios(ratios, defaultRatios),
      ]),
  );
  return {
    items: SHELL_ITEMS.map((item) => ({
      name: item.name,
      price: item.price,
    })),
    defaultRatios,
    ratioHistory,
  };
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
    entryConfig: safeEntryConfig(parsed.entryConfig),
    confirmedSubmissionIds: Array.isArray(parsed.confirmedSubmissionIds)
      ? parsed.confirmedSubmissionIds
          .filter((id) => typeof id === "string")
          .slice(-50)
      : [],
  };
}

function createRandomToken(byteLength) {
  if (!globalThis.crypto?.getRandomValues) return null;
  const bytes = new Uint8Array(byteLength);
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

function rpcRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

function createShortShareUrl(id, location) {
  const url = new URL(location.href);
  url.pathname = `/s/${id}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function isProfitShareActive(profitShare, now = new Date()) {
  return Boolean(
    PROFIT_SHARE_ID_PATTERN.test(String(profitShare?.id || "")) &&
      PROFIT_SHARE_TOKEN_PATTERN.test(
        String(profitShare?.editorToken || ""),
      ) &&
      new Date(profitShare.expiresAt).getTime() > new Date(now).getTime(),
  );
}

export async function syncLiveProfitShare(snapshot, profitShare) {
  if (!supabase || !isProfitShareActive(profitShare)) {
    return { success: false };
  }
  try {
    const { data, error } = await supabase.rpc("update_live_profit_share", {
      p_id: profitShare.id,
      p_editor_token: profitShare.editorToken,
      p_snapshot: snapshot,
    });
    const row = rpcRow(data);
    if (error || row?.share_id !== profitShare.id) {
      return { success: false };
    }
    return {
      success: true,
      updatedAt: row.share_updated_at,
      profitShare: {
        ...profitShare,
        expiresAt: row.share_expires_at || profitShare.expiresAt,
      },
    };
  } catch {
    return { success: false };
  }
}

export async function createProfitShareLink(
  snapshot,
  playerKey,
  existingProfitShare = null,
  location = window.location,
) {
  if (isProfitShareActive(existingProfitShare)) {
    const synced = await syncLiveProfitShare(snapshot, existingProfitShare);
    return {
      url: createShortShareUrl(existingProfitShare.id, location),
      short: true,
      live: true,
      syncPending: !synced.success,
      profitShare: synced.profitShare || existingProfitShare,
    };
  }

  if (supabase) {
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const id = createRandomToken(8);
        const editorToken = createRandomToken(32);
        const submissionToken = createSubmissionToken();
        if (!id || !editorToken || !submissionToken) break;
        const { data, error } = await supabase.rpc(
          "create_live_profit_share",
          {
            p_id: id,
            p_player_key: playerKey,
            p_editor_token: editorToken,
            p_submission_token: submissionToken,
            p_snapshot: snapshot,
          },
        );
        const row = rpcRow(data);
        if (!error && row?.share_id === id) {
          return {
            url: createShortShareUrl(id, location),
            short: true,
            live: true,
            syncPending: false,
            profitShare: {
              id,
              editorToken,
              submissionToken,
              expiresAt: row.share_expires_at,
            },
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
    live: false,
    syncPending: false,
    profitShare: null,
  };
}

export async function createPlayerProfitInputLink(
  snapshot,
  playerKey,
  existingProfitShare = null,
  location = window.location,
) {
  const share = await createProfitShareLink(
    snapshot,
    playerKey,
    existingProfitShare,
    location,
  );
  if (!share.live || !share.profitShare) {
    return { ...share, inputEnabled: false };
  }

  let profitShare = share.profitShare;
  if (!profitShare.submissionToken) {
    const submissionToken = createSubmissionToken();
    if (!submissionToken) {
      return { ...share, inputEnabled: false };
    }
    try {
      const enabled = await enableProfitSubmissions(
        profitShare,
        submissionToken,
      );
      if (!enabled) return { ...share, inputEnabled: false };
      profitShare = enabled;
    } catch {
      return { ...share, inputEnabled: false };
    }
  }

  return {
    ...share,
    url: createPlayerInputUrl(
      profitShare.id,
      profitShare.submissionToken,
      location,
    ),
    inputEnabled: true,
    profitShare,
  };
}

export function readProfitShareId(pathname = window.location.pathname) {
  const match = String(pathname).match(
    /^\/s\/([A-Za-z0-9_-]{10,16})\/?$/,
  );
  return match?.[1] || null;
}

export async function loadProfitShare(id) {
  if (!supabase || !PROFIT_SHARE_ID_PATTERN.test(String(id || ""))) {
    return null;
  }
  const { data, error } = await supabase.rpc("get_profit_share", {
    p_id: id,
  });
  if (error) throw error;
  const row = rpcRow(data);
  if (!row?.share_snapshot) return null;
  const snapshot = sanitizeProfitSnapshot(row.share_snapshot);
  if (!snapshot) return null;
  return {
    snapshot,
    live: row.share_kind === "live",
    updatedAt: row.share_updated_at,
    expiresAt: row.share_expires_at,
  };
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
