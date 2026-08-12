import { createId } from "./tracker.js";

const LOG_PREFIX = "TRO-TRACKER-LOG-V1\n";
const COPIED_LOG_STORAGE_KEY = "troTrackerCopiedLog:v1";
const MAX_LOG_LENGTH = 30000;
const RATIO_KEYS = [
  "gralatsPerTro",
  "shovelTro",
  "phpTro",
  "phpAmount",
];

export function normalizeAllocationPercent(value, fallback = 100) {
  const number = Number(value);
  const safe = Number.isFinite(number) ? number : fallback;
  return Math.min(100, Math.max(0, Math.round(safe * 10) / 10));
}

export function allocationPercentForEntry(entry) {
  return normalizeAllocationPercent(entry?.allocationPercent, 100);
}

export function allocationRateForEntry(entry) {
  return allocationPercentForEntry(entry) / 100;
}

export function allocationTotal(rows) {
  return (
    Math.round(
      rows.reduce(
        (sum, row) => sum + normalizeAllocationPercent(row.percent, 0),
        0,
      ) * 10,
    ) / 10
  );
}

export function defaultProfitAllocations(sourcePlayerId) {
  return [{ playerId: sourcePlayerId, percent: 100 }];
}

function cleanAllocationRows(rows, originPlayerId) {
  const byPlayer = new Map();
  rows.forEach((row) => {
    const playerId = String(row?.playerId || "");
    if (!playerId || byPlayer.has(playerId)) return;
    byPlayer.set(playerId, {
      playerId,
      percent: normalizeAllocationPercent(row.percent, 0),
    });
  });
  if (originPlayerId && !byPlayer.has(originPlayerId)) {
    byPlayer.set(originPlayerId, { playerId: originPlayerId, percent: 0 });
  }
  return Array.from(byPlayer.values());
}

function recordKey(record) {
  return `${record.playerId}:${record.type}:${record.itemName || ""}`;
}

export function allocationsForBatch(transactions, batch) {
  if (!batch?.length) return [];
  const first = batch[0];
  const originPlayerId = first.allocationOriginPlayerId || first.playerId;
  const groupRows = first.allocationGroupId
    ? transactions.filter(
        (entry) => entry.allocationGroupId === first.allocationGroupId,
      )
    : batch;
  const byPlayer = new Map();
  groupRows.forEach((entry) => {
    if (!byPlayer.has(entry.playerId)) {
      byPlayer.set(entry.playerId, {
        playerId: entry.playerId,
        percent: allocationPercentForEntry(entry),
      });
    }
  });
  if (!byPlayer.has(originPlayerId)) {
    byPlayer.set(originPlayerId, { playerId: originPlayerId, percent: 0 });
  }
  return Array.from(byPlayer.values()).toSorted(
    (a, b) =>
      Number(b.playerId === originPlayerId) -
        Number(a.playerId === originPlayerId) ||
      b.percent - a.percent,
  );
}

export function allocateBatchRecords(
  templateBatch,
  allocations,
  { originPlayerId, existingRecords = [] } = {},
) {
  if (!templateBatch?.length || !originPlayerId) return [];
  const rows = cleanAllocationRows(allocations, originPlayerId);
  if (Math.abs(allocationTotal(rows) - 100) > 0.05) {
    throw new Error("Profit allocation must total exactly 100%.");
  }

  const includedRows = rows.filter(
    (row) => row.percent > 0 || row.playerId === originPlayerId,
  );
  const linked =
    includedRows.length > 1 ||
    includedRows[0]?.playerId !== originPlayerId ||
    includedRows[0]?.percent !== 100;
  const previousFirst = existingRecords[0] || templateBatch[0];
  const allocationGroupId = linked
    ? previousFirst.allocationGroupId || createId()
    : null;
  const existingBatchByPlayer = new Map();
  const existingByKey = new Map();
  existingRecords.forEach((entry) => {
    if (!existingBatchByPlayer.has(entry.playerId)) {
      existingBatchByPlayer.set(entry.playerId, entry.batchId);
    }
    existingByKey.set(recordKey(entry), entry);
  });

  return includedRows.flatMap((row) => {
    const batchId =
      existingBatchByPlayer.get(row.playerId) ||
      (row.playerId === originPlayerId && !linked
        ? templateBatch[0].batchId
        : createId());
    return templateBatch.map((template) => {
      const previous = existingByKey.get(
        `${row.playerId}:${template.type}:${template.itemName || ""}`,
      );
      return {
        ...template,
        id: previous?.id || createId(),
        batchId,
        playerId: row.playerId,
        allocationPercent: row.percent,
        allocationGroupId,
        allocationOriginPlayerId: linked ? originPlayerId : null,
      };
    });
  });
}

export function applyBatchAllocations(
  transactions,
  batch,
  allocations,
) {
  if (!batch?.length) return transactions;
  const first = batch[0];
  const originPlayerId = first.allocationOriginPlayerId || first.playerId;
  const existingRecords = first.allocationGroupId
    ? transactions.filter(
        (entry) => entry.allocationGroupId === first.allocationGroupId,
      )
    : batch;
  const replacement = allocateBatchRecords(batch, allocations, {
    originPlayerId,
    existingRecords,
  });
  const removedIds = new Set(existingRecords.map((entry) => entry.id));
  return [
    ...replacement,
    ...transactions.filter((entry) => !removedIds.has(entry.id)),
  ];
}

export function replaceAllocationGroupTemplate(
  transactions,
  previousBatch,
  nextBatch,
) {
  if (!previousBatch?.length) return transactions;
  const first = previousBatch[0];
  if (!first.allocationGroupId) {
    const removedIds = new Set(previousBatch.map((entry) => entry.id));
    return [
      ...nextBatch,
      ...transactions.filter((entry) => !removedIds.has(entry.id)),
    ];
  }
  const existingRecords = transactions.filter(
    (entry) => entry.allocationGroupId === first.allocationGroupId,
  );
  const allocations = allocationsForBatch(transactions, previousBatch);
  const replacement = allocateBatchRecords(nextBatch, allocations, {
    originPlayerId: first.allocationOriginPlayerId || first.playerId,
    existingRecords,
  });
  const removedIds = new Set(existingRecords.map((entry) => entry.id));
  return [
    ...replacement,
    ...transactions.filter((entry) => !removedIds.has(entry.id)),
  ];
}

function validRatios(value) {
  return RATIO_KEYS.every(
    (key) => Number.isFinite(Number(value?.[key])) && Number(value[key]) > 0,
  );
}

function safeLogRecord(record) {
  const type = String(record?.type || "");
  const quantity = Number(record?.quantity);
  const unitPrice = Number(record?.unitPrice);
  const createdAt = String(record?.createdAt || "");
  const date = String(record?.date || "");
  if (
    !["sellable", "tro", "shovel"].includes(type) ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    quantity > 9999999 ||
    !Number.isFinite(unitPrice) ||
    unitPrice < 0 ||
    unitPrice > 1000000 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(new Date(createdAt).getTime()) ||
    !validRatios(record?.ratios)
  ) {
    return null;
  }
  return {
    type,
    itemName: String(record.itemName || "").slice(0, 80),
    quantity,
    unitPrice,
    date,
    note: String(record.note || "").slice(0, 120),
    createdAt,
    ratios: Object.fromEntries(
      RATIO_KEYS.map((key) => [key, Number(record.ratios[key])]),
    ),
  };
}

export function serializeBatchLog(batch, player) {
  if (!batch?.length) throw new Error("Saved log is empty.");
  const records = batch.map(safeLogRecord);
  if (records.some((record) => !record)) {
    throw new Error("Saved log contains invalid values.");
  }
  return `${LOG_PREFIX}${JSON.stringify({
    kind: "tro-saved-log",
    version: 1,
    copiedAt: new Date().toISOString(),
    sourceBatchId: String(batch[0].batchId),
    sourcePlayerId: String(batch[0].playerId),
    sourcePlayerName: String(player?.name || "Player").slice(0, 50),
    sourceAllocationPercent: allocationPercentForEntry(batch[0]),
    records,
  })}`;
}

export function rememberCopiedBatchLog(value) {
  try {
    localStorage.setItem(COPIED_LOG_STORAGE_KEY, String(value));
  } catch {
    // System clipboard can still be used when localStorage is unavailable.
  }
}

export function loadRememberedBatchLog() {
  try {
    return localStorage.getItem(COPIED_LOG_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function parseBatchLog(value) {
  const source = String(value || "").trim();
  if (!source.startsWith(LOG_PREFIX.trim()) || source.length > MAX_LOG_LENGTH) {
    throw new Error("Paste a valid TRO saved log.");
  }
  let parsed;
  try {
    parsed = JSON.parse(source.slice(source.indexOf("\n") + 1));
  } catch {
    throw new Error("The copied TRO log could not be read.");
  }
  if (
    parsed?.kind !== "tro-saved-log" ||
    parsed.version !== 1 ||
    typeof parsed.sourceBatchId !== "string" ||
    !Array.isArray(parsed.records) ||
    !parsed.records.length ||
    parsed.records.length > 20
  ) {
    throw new Error("The copied TRO log is invalid.");
  }
  const records = parsed.records.map(safeLogRecord);
  if (records.some((record) => !record)) {
    throw new Error("The copied TRO log contains invalid values.");
  }
  return {
    sourceBatchId: parsed.sourceBatchId.slice(0, 160),
    sourcePlayerId: String(parsed.sourcePlayerId || "").slice(0, 128),
    sourcePlayerName: String(parsed.sourcePlayerName || "Player").slice(0, 50),
    sourceAllocationPercent: normalizeAllocationPercent(
      parsed.sourceAllocationPercent,
      100,
    ),
    records,
  };
}

export function createPastedBatchRecords(payload, targetPlayerId) {
  const batchId = createId();
  return payload.records.map((record) => ({
    ...record,
    id: createId(),
    batchId,
    playerId: targetPlayerId,
    allocationPercent: 100,
    allocationGroupId: null,
    allocationOriginPlayerId: null,
    copiedFromBatchId: payload.sourceBatchId,
  }));
}

export function isBatchLogAlreadyPasted(
  transactions,
  targetPlayerId,
  sourceBatchId,
) {
  return transactions.some(
    (entry) =>
      entry.playerId === targetPlayerId &&
      entry.copiedFromBatchId === sourceBatchId,
  );
}

export { LOG_PREFIX };
