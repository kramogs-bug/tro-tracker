import { SHELL_ITEMS } from "./sellablesData.js";
import {
  createId,
  ratiosForDate,
  summarize,
  toPhp,
} from "./tracker.js";

const EMPTY_SUMMARY = {
  gralats: 0,
  grossTro: 0,
  grossPhp: 0,
  shovels: 0,
  deduction: 0,
  deductionPhp: 0,
  netTro: 0,
  netPhp: 0,
};

const roundMoney = (value) =>
  Math.round((Number(value) || 0) * 100) / 100;

export function normalizeQuantities(value) {
  return Object.fromEntries(
    SHELL_ITEMS.map((item) => [
      item.name,
      Math.max(0, Math.floor(Number(value?.[item.name]) || 0)),
    ]),
  );
}

export function quantitySignature(quantities, shovels = 0) {
  const normalized = normalizeQuantities(quantities);
  return [
    ...SHELL_ITEMS.map((item) => normalized[item.name]),
    Math.max(0, Math.floor(Number(shovels) || 0)),
  ].join(":");
}

function shellSignature(quantities) {
  const normalized = normalizeQuantities(quantities);
  return SHELL_ITEMS.map((item) => normalized[item.name]).join(":");
}

export function batchQuantities(batch) {
  const quantities = Object.fromEntries(
    SHELL_ITEMS.map((item) => [item.name, 0]),
  );
  let shovels = 0;
  batch.forEach((entry) => {
    if (entry.type === "sellable" && entry.itemName in quantities) {
      quantities[entry.itemName] += Number(entry.quantity) || 0;
    } else if (entry.type === "shovel") {
      shovels += Number(entry.quantity) || 0;
    }
  });
  return { quantities, shovels };
}

export function findDuplicateBatch(
  transactions,
  playerId,
  quantities,
  shovels,
) {
  const normalized = normalizeQuantities(quantities);
  const normalizedShovels = Math.max(
    0,
    Math.floor(Number(shovels) || 0),
  );
  if (
    !Object.values(normalized).some((value) => value > 0) &&
    normalizedShovels === 0
  ) {
    return null;
  }

  const targetShells = shellSignature(normalized);
  const targetExact = quantitySignature(normalized, normalizedShovels);
  const batches = Array.from(
    transactions
      .filter((entry) => entry.playerId === playerId)
      .reduce((groups, entry) => {
        const batch = groups.get(entry.batchId) || [];
        batch.push(entry);
        groups.set(entry.batchId, batch);
        return groups;
      }, new Map())
      .values(),
  ).toSorted((a, b) =>
    String(b[0]?.createdAt || "").localeCompare(
      String(a[0]?.createdAt || ""),
    ),
  );

  let shellOnlyMatch = null;
  for (const batch of batches) {
    const values = batchQuantities(batch);
    const match = {
      batchId: batch[0]?.batchId,
      createdAt: batch[0]?.createdAt,
      date: batch[0]?.date,
      shovels: values.shovels,
    };
    if (quantitySignature(values.quantities, values.shovels) === targetExact) {
      return { ...match, kind: "exact" };
    }
    if (!shellOnlyMatch && shellSignature(values.quantities) === targetShells) {
      shellOnlyMatch = { ...match, kind: "shells" };
    }
  }
  return shellOnlyMatch;
}

export function estimateSubmission(quantities, shovels, ratios) {
  const normalized = normalizeQuantities(quantities);
  const shovelCount = Math.max(0, Math.floor(Number(shovels) || 0));
  const gralats = SHELL_ITEMS.reduce(
    (sum, item) => sum + normalized[item.name] * item.price,
    0,
  );
  const grossTro = gralats / ratios.gralatsPerTro;
  const deduction = shovelCount * ratios.shovelTro;
  return {
    gralats,
    grossTro,
    grossPhp: toPhp(grossTro, ratios),
    shovels: shovelCount,
    deduction,
    deductionPhp: toPhp(deduction, ratios),
    netTro: grossTro - deduction,
    netPhp: toPhp(grossTro - deduction, ratios),
  };
}

function safeRatios(value, fallback) {
  return {
    gralatsPerTro:
      Number(value?.gralatsPerTro) > 0
        ? Number(value.gralatsPerTro)
        : fallback.gralatsPerTro,
    shovelTro:
      Number(value?.shovelTro) > 0
        ? Number(value.shovelTro)
        : fallback.shovelTro,
    phpTro:
      Number(value?.phpTro) > 0 ? Number(value.phpTro) : fallback.phpTro,
    phpAmount:
      Number(value?.phpAmount) > 0
        ? Number(value.phpAmount)
        : fallback.phpAmount,
  };
}

export function snapshotRatiosForDate(snapshot, date) {
  const fallback = safeRatios(snapshot?.entryConfig?.defaultRatios, {
    gralatsPerTro: 3.8,
    shovelTro: 3,
    phpTro: 1600,
    phpAmount: 50,
  });
  const history = snapshot?.entryConfig?.ratioHistory || {};
  const previousDate = Object.keys(history)
    .filter((entryDate) => entryDate <= date)
    .toSorted()
    .at(-1);
  return safeRatios(
    previousDate ? history[previousDate] : fallback,
    fallback,
  );
}

function addSummary(base, addition) {
  return Object.fromEntries(
    Object.keys(EMPTY_SUMMARY).map((key) => [
      key,
      (Number(base?.[key]) || 0) + (Number(addition?.[key]) || 0),
    ]),
  );
}

function mondayFor(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function projectionValues(submission) {
  if (submission.status === "approved" && submission.approvedQuantities) {
    return {
      quantities: submission.approvedQuantities,
      shovels: submission.approvedShovels,
      date: submission.approvedEntryDate || submission.entryDate,
    };
  }
  return {
    quantities: submission.quantities,
    shovels: submission.shovels,
    date: submission.entryDate,
  };
}

export function projectProfitSnapshot(snapshot, submissions) {
  const confirmedIds = new Set(snapshot?.confirmedSubmissionIds || []);
  const provisional = submissions.filter(
    (submission) =>
      submission.status === "pending" ||
      (submission.status === "approved" &&
        !confirmedIds.has(submission.id)),
  );
  if (!provisional.length) {
    return {
      projectedSnapshot: snapshot,
      pendingSummary: { ...EMPTY_SUMMARY },
      pendingCount: 0,
    };
  }

  const today = snapshot.dates.today;
  const weekStart = mondayFor(today);
  const monthStart = `${today.slice(0, 7)}-01`;
  const additions = {
    today: { ...EMPTY_SUMMARY },
    week: { ...EMPTY_SUMMARY },
    month: { ...EMPTY_SUMMARY },
    allTime: { ...EMPTY_SUMMARY },
  };
  const dailyAdditions = new Map();

  provisional.forEach((submission) => {
    const values = projectionValues(submission);
    const estimate = estimateSubmission(
      values.quantities,
      values.shovels,
      snapshotRatiosForDate(snapshot, values.date),
    );
    additions.allTime = addSummary(additions.allTime, estimate);
    if (values.date === today) {
      additions.today = addSummary(additions.today, estimate);
    }
    if (values.date >= weekStart && values.date <= today) {
      additions.week = addSummary(additions.week, estimate);
    }
    if (values.date >= monthStart && values.date <= today) {
      additions.month = addSummary(additions.month, estimate);
    }
    dailyAdditions.set(
      values.date,
      addSummary(dailyAdditions.get(values.date), estimate),
    );
  });

  return {
    pendingCount: provisional.length,
    pendingSummary: additions.allTime,
    projectedSnapshot: {
      ...snapshot,
      summaries: {
        ...snapshot.summaries,
        today: addSummary(snapshot.summaries.today, additions.today),
        week: addSummary(snapshot.summaries.week, additions.week),
        month: addSummary(snapshot.summaries.month, additions.month),
        allTime: addSummary(
          snapshot.summaries.allTime,
          additions.allTime,
        ),
      },
      balance: {
        php: roundMoney(snapshot.balance.php + additions.allTime.netPhp),
        tro: snapshot.balance.tro + additions.allTime.netTro,
      },
      dailyHistory: snapshot.dailyHistory.map((day) => ({
        ...day,
        summary: addSummary(day.summary, dailyAdditions.get(day.date)),
      })),
    },
  };
}

export function createSubmissionTransactions(
  submission,
  state,
  approvedValues = null,
) {
  const player = state.players.find(
    (entry) => entry.id === submission.playerKey,
  );
  if (!player) return [];
  const quantities = normalizeQuantities(
    approvedValues?.quantities || submission.quantities,
  );
  const shovels = Math.max(
    0,
    Math.floor(
      Number(
        approvedValues?.shovels === undefined
          ? submission.shovels
          : approvedValues.shovels,
      ) || 0,
    ),
  );
  const timestampValue =
    approvedValues?.entryTimestamp || submission.entryAt;
  const selectedTime = new Date(timestampValue);
  if (Number.isNaN(selectedTime.getTime())) return [];
  const timestamp = selectedTime.toISOString();
  const date =
    approvedValues?.entryDate ||
    submission.entryDate ||
    timestamp.slice(0, 10);
  const ratios = ratiosForDate(player, date, state.settings);
  const batchId = createId();
  const sourceSubmissionId = submission.id;
  const shellRecords = SHELL_ITEMS.flatMap((item) =>
    quantities[item.name] > 0
      ? [
          {
            id: createId(),
            batchId,
            playerId: player.id,
            type: "sellable",
            itemName: item.name,
            quantity: quantities[item.name],
            unitPrice: item.price,
            date,
            note: String(submission.note || "").slice(0, 120),
            createdAt: timestamp,
            ratios,
            sourceSubmissionId,
          },
        ]
      : [],
  );
  const shovelRecords =
    shovels > 0
      ? [
          {
            id: createId(),
            batchId,
            playerId: player.id,
            type: "shovel",
            itemName: "",
            quantity: shovels,
            unitPrice: 0,
            date,
            note: String(submission.note || "").slice(0, 120),
            createdAt: timestamp,
            ratios,
            sourceSubmissionId,
          },
        ]
      : [];
  return [...shellRecords, ...shovelRecords];
}

export function submissionAlreadyApplied(transactions, submissionId) {
  return transactions.some(
    (entry) => entry.sourceSubmissionId === submissionId,
  );
}

export function summarizeSubmissionTransactions(transactions, settings) {
  return transactions.length
    ? summarize(transactions, settings)
    : { ...EMPTY_SUMMARY };
}
