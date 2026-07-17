const STORAGE_KEY = "troTrackerData:v1";
export const DEFAULT_SETTINGS = {
  gralatsPerTro: 3.8,
  shovelTro: 3,
  phpTro: 1600,
  phpAmount: 50,
};
export const emptyState = {
  players: [],
  transactions: [],
  cashouts: [],
  settings: DEFAULT_SETTINGS,
};

export function createId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
export function localDate(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}
export function localDateTimeInput(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
export function format(value, digits = 2) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: digits,
  });
}

export function parseQuantityExpression(value) {
  const source = String(value ?? "")
    .replaceAll(",", "")
    .trim();
  if (!source) return 0;
  if (!/^[\d+\-*/().\s]+$/.test(source)) return null;
  let index = 0;
  const spaces = () => {
    while (/\s/.test(source[index] || "")) index += 1;
  };
  const primary = () => {
    spaces();
    if (source[index] === "(") {
      index += 1;
      const result = sum();
      spaces();
      if (source[index] !== ")") throw new Error("Missing parenthesis");
      index += 1;
      return result;
    }
    const match = source.slice(index).match(/^\d+(?:\.\d+)?/);
    if (!match) throw new Error("Expected number");
    index += match[0].length;
    return Number(match[0]);
  };
  const product = () => {
    let result = primary();
    while (true) {
      spaces();
      const operator = source[index];
      if (operator !== "*" && operator !== "/") return result;
      index += 1;
      const right = primary();
      if (operator === "/" && right === 0) throw new Error("Division by zero");
      result = operator === "*" ? result * right : result / right;
    }
  };
  function sum() {
    let result = product();
    while (true) {
      spaces();
      const operator = source[index];
      if (operator !== "+" && operator !== "-") return result;
      index += 1;
      const right = product();
      result = operator === "+" ? result + right : result - right;
    }
  }
  try {
    const result = sum();
    spaces();
    if (index !== source.length || !Number.isFinite(result) || result < 0)
      return null;
    return Math.floor(result);
  } catch {
    return null;
  }
}
export function loadState() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return normalizeState(value);
  } catch {
    return emptyState;
  }
}
export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* Browser storage can be unavailable. */
  }
}

export function normalizeState(value) {
  if (!value || typeof value !== "object") return emptyState;
  const fallbackSettings = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => {
      const number = Number(value.settings?.[key]);
      return [key, number > 0 ? number : fallback];
    }),
  );
  const players = Array.isArray(value.players)
    ? value.players
        .filter((p) => p?.id && typeof p.name === "string")
        .map((p) => ({
          id: String(p.id),
          name: p.name.slice(0, 50),
          createdAt: p.createdAt || new Date().toISOString(),
          settings: Object.fromEntries(
            Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => {
              const number = Number(p.settings?.[key] ?? fallbackSettings[key]);
              return [key, number > 0 ? number : fallback];
            }),
          ),
        }))
    : [];
  const ids = new Set(players.map((p) => p.id));
  const transactions = Array.isArray(value.transactions)
    ? value.transactions
        .filter(
          (t) =>
            t?.id &&
            ids.has(t.playerId) &&
            ["sellable", "tro", "shovel"].includes(t.type) &&
            Number(t.quantity) > 0 &&
            /^\d{4}-\d{2}-\d{2}$/.test(t.date || ""),
        )
        .map((t) => {
          const createdAt = t.createdAt || new Date().toISOString();
          return {
            id: String(t.id),
            batchId: String(t.batchId || `${t.playerId}:${createdAt}`),
            playerId: t.playerId,
            type: t.type,
            quantity: Number(t.quantity),
            itemName: String(t.itemName || "").slice(0, 80),
            unitPrice: Math.max(0, Number(t.unitPrice) || 0),
            date: t.date,
            note: String(t.note || "").slice(0, 120),
            createdAt,
          };
        })
    : [];
  const cashouts = Array.isArray(value.cashouts)
    ? value.cashouts
        .filter(
          (cashout) =>
            cashout?.id &&
            ids.has(cashout.playerId) &&
            Number(cashout.amount) > 0 &&
            /^\d{4}-\d{2}-\d{2}$/.test(cashout.date || ""),
        )
        .map((cashout) => ({
          id: String(cashout.id),
          playerId: cashout.playerId,
          amount: Math.round(Number(cashout.amount) * 100) / 100,
          date: cashout.date,
          note: String(cashout.note || "").slice(0, 120),
          createdAt: cashout.createdAt || new Date().toISOString(),
        }))
    : [];
  const settings = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => {
      const number = Number(value.settings?.[key]);
      return [key, number > 0 ? number : fallback];
    }),
  );
  return { players, transactions, cashouts, settings };
}

export function transactionValues(t, settings) {
  const gralats = t.type === "sellable" ? t.quantity * t.unitPrice : 0;
  const grossTro =
    t.type === "sellable"
      ? gralats / settings.gralatsPerTro
      : t.type === "tro"
        ? t.quantity
        : 0;
  const deduction = t.type === "shovel" ? t.quantity * settings.shovelTro : 0;
  return { gralats, grossTro, deduction, netTro: grossTro - deduction };
}

export function summarize(transactions, settings) {
  return transactions.reduce(
    (sum, t) => {
      const value = transactionValues(t, settings);
      sum.gralats += value.gralats;
      sum.grossTro += value.grossTro;
      sum.shovels += t.type === "shovel" ? t.quantity : 0;
      sum.deduction += value.deduction;
      sum.netTro += value.netTro;
      return sum;
    },
    { gralats: 0, grossTro: 0, shovels: 0, deduction: 0, netTro: 0 },
  );
}

export function summarizePeriods(transactions, settings, now = new Date()) {
  const today = localDate(now);
  const monday = new Date(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekStart = localDate(monday);
  const monthStart = `${today.slice(0, 7)}-01`;
  return {
    daily: summarize(
      transactions.filter((entry) => entry.date === today),
      settings,
    ),
    weekly: summarize(
      transactions.filter(
        (entry) => entry.date >= weekStart && entry.date <= today,
      ),
      settings,
    ),
    monthly: summarize(
      transactions.filter(
        (entry) => entry.date >= monthStart && entry.date <= today,
      ),
      settings,
    ),
  };
}

export function toPhp(tro, settings) {
  return (tro / settings.phpTro) * settings.phpAmount;
}
export function exportBackup(state) {
  return JSON.stringify(
    {
      type: "tro-tracker-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: state,
    },
    null,
    2,
  );
}
export function importBackup(text) {
  const parsed = JSON.parse(text);
  return normalizeState(
    parsed?.type === "tro-tracker-backup" ? parsed.data : parsed,
  );
}
function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function exportCsv(state) {
  const players = new Map(state.players.map((p) => [p.id, p]));
  const rows = [
    [
      "Timestamp",
      "Date",
      "Player",
      "Type",
      "Shell",
      "Quantity",
      "Unit price",
      "Gralats",
      "Gross TRO",
      "TRO deduction",
      "Net TRO",
      "PHP",
    ],
  ];
  state.transactions.forEach((t) => {
    const player = players.get(t.playerId);
    const settings = player?.settings || state.settings;
    const v = transactionValues(t, settings);
    rows.push([
      t.createdAt,
      t.date,
      player?.name,
      t.type,
      t.itemName,
      t.quantity,
      t.unitPrice,
      v.gralats,
      v.grossTro,
      v.deduction,
      v.netTro,
      toPhp(v.netTro, settings),
    ]);
  });
  (state.cashouts || []).forEach((cashout) => {
    const player = players.get(cashout.playerId);
    rows.push([
      cashout.createdAt,
      cashout.date,
      player?.name,
      "cashout",
      cashout.note,
      "",
      "",
      "",
      "",
      "",
      "",
      -cashout.amount,
    ]);
  });
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
