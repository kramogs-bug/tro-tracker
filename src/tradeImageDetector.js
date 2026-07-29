const ITEM_DEFINITIONS = [
  {
    name: "Tro",
    aliases: [
      /\btrochus\b/i,
      /\brochus\b/i,
      /\btroch[a-z]*\b/i,
      /\btro\b/i,
    ],
  },
  {
    name: "Sand Dollar",
    aliases: [
      /\bsand\s*dollar\b/i,
      /\bsand\s*doll[a-z]*\b/i,
      /\bsand\s*dol+[a-z]*\b/i,
      /\bsand\b/i,
    ],
  },
  {
    name: "Starfish",
    aliases: [
      /\bstar\s*fish\b/i,
      /\bstarfish\b/i,
      /\btarfish\b/i,
      /\bstarfis[a-z]*\b/i,
      /\bsta[a-z]{0,3}(?:fish|tish)\b/i,
    ],
  },
  {
    name: "Aero",
    aliases: [
      /\baerolata\b/i,
      /\baero\s*lata\b/i,
      /\baerolat[a-z]*\b/i,
      /\baerola[a-z]*\b/i,
      /\b[rs]ororal[a-z]*\b/i,
      /\bsero[a-z]*\b/i,
    ],
  },
  {
    name: "Scallop",
    aliases: [
      /\bscallop\b/i,
      /\bscal+op\b/i,
      /\bscall[a-z]*\b/i,
    ],
  },
];

const FULL_SCAN_WINDOW = {
  left: 0.06,
  top: 0.02,
  width: 0.76,
  height: 0.86,
};
const FALLBACK_SCAN_WINDOWS = [0.28, 0.08, 0.48].map((left) => ({
  left,
  top: 0.02,
  width: 0.4,
  height: 0.86,
}));
const OCR_MODES = [
  {
    name: "balanced",
    filter: "contrast(135%) saturate(70%)",
  },
  {
    name: "monochrome",
    filter: "grayscale(100%) contrast(185%)",
  },
];
const SHOVEL_OCR_MODES = [
  { name: "clean", filter: "none" },
  { name: "monochrome", filter: "grayscale(100%) contrast(210%)" },
];
const RESULT_FIELDS = [...ITEM_DEFINITIONS.map((item) => item.name), "Shovels"];
const ICON_ONLY_FIELD_ORDER = [
  "Aero",
  "Starfish",
  "Sand Dollar",
  "Tro",
  "Scallop",
];
const CALIBRATION_STORAGE_KEY = "tro-trade-ocr-calibration-v1";
const OCR_WORKER_IDLE_MS = 120_000;
const EMPTY_QUANTITIES = Object.fromEntries(
  ITEM_DEFINITIONS.map((item) => [item.name, 0]),
);

let ocrWorkerPromise = null;
let ocrQueue = Promise.resolve();
let ocrIdleTimer = null;
let workerProgressTarget = null;

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/webp",
]);
const SUPPORTED_IMAGE_EXTENSION = /\.(?:jpe?g|png|webp)$/i;

export function isSupportedTradeImage(file) {
  if (!(file instanceof Blob)) return false;
  const type = String(file.type || "").toLowerCase();
  const name = String(file.name || "");
  return SUPPORTED_IMAGE_TYPES.has(type) || SUPPORTED_IMAGE_EXTENSION.test(name);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function calibrationLayoutKey(image) {
  const aspectRatio = image.width / image.height;
  const orientation = image.width >= image.height ? "landscape" : "portrait";
  return `${orientation}:${aspectRatio.toFixed(1)}`;
}

function readCalibration() {
  try {
    const parsed = JSON.parse(
      globalThis.localStorage?.getItem(CALIBRATION_STORAGE_KEY) || "{}",
    );
    return parsed?.profiles && typeof parsed.profiles === "object"
      ? parsed
      : { version: 1, profiles: {} };
  } catch {
    return { version: 1, profiles: {} };
  }
}

function calibrationProfile(layoutKey) {
  return readCalibration().profiles[layoutKey] || {
    sources: {},
  };
}

function normalizeOcrDigit(character) {
  return (
    {
      o: "0",
      O: "0",
      i: "1",
      I: "1",
      l: "1",
      L: "1",
      s: "5",
      S: "5",
      b: "8",
      B: "8",
    }[character] || character
  );
}

function parseQuantity(value) {
  const digits = String(value)
    .split("")
    .map(normalizeOcrDigit)
    .join("")
    .replace(/[^\d]/g, "");
  const number = Number(digits);
  return Number.isSafeInteger(number) && number > 0 && number <= 100000000
    ? number
    : null;
}

function extractQuantityTokens(text) {
  const tokens = [];
  const pattern = /[x×][\t ]*([0-9oilsb][0-9oilsb,.]{0,8})/gi;
  for (const match of text.matchAll(pattern)) {
    const value = parseQuantity(match[1]);
    if (!value) continue;
    tokens.push({
      value,
      index: match.index,
      end: match.index + match[0].length,
      raw: match[0],
    });
  }
  return tokens;
}

function findAlias(text, definition) {
  let best = null;
  definition.aliases.forEach((pattern) => {
    const match = text.match(pattern);
    if (!match || (best && match.index >= best.index)) return;
    best = {
      index: match.index,
      end: match.index + match[0].length,
      raw: match[0],
    };
  });
  return best;
}

function tokenDistance(token, alias) {
  if (token.end <= alias.index) return alias.index - token.end;
  if (token.index >= alias.end) return token.index - alias.end;
  return 0;
}

function namedQuantities(text, tokens) {
  const values = {};
  const used = new Set();
  let namedCount = 0;
  ITEM_DEFINITIONS.forEach((definition) => {
    const alias = findAlias(text, definition);
    if (!alias) return;
    namedCount += 1;
    const lineStart = text.lastIndexOf("\n", alias.index) + 1;
    const nextLineBreak = text.indexOf("\n", alias.end);
    const lineEnd = nextLineBreak === -1 ? text.length : nextLineBreak;
    const sameLine = tokens.filter(
      (token) => token.index >= lineStart && token.end <= lineEnd,
    );
    const candidates = sameLine.length ? sameLine : tokens;
    const nearest = candidates
      .map((token) => ({
        token,
        index: tokens.indexOf(token),
        distance: tokenDistance(token, alias),
      }))
      .filter((entry) => entry.distance <= 45)
      .toSorted((a, b) => a.distance - b.distance)[0];
    if (!nearest) return;
    values[definition.name] = nearest.token.value;
    used.add(nearest.index);
  });
  return { values, used, namedCount };
}

function selectTokenSource(text, numericText) {
  const textTokens = extractQuantityTokens(text);
  const numericTokens = extractQuantityTokens(numericText || "");
  const distanceFromExpected = (tokens) =>
    Math.min(Math.abs(tokens.length - 5), Math.abs(tokens.length - 6));
  if (
    numericTokens.length >= 4 &&
    distanceFromExpected(numericTokens) <= distanceFromExpected(textTokens)
  ) {
    return numericTokens;
  }
  return textTokens;
}

function quantityTokenAgreement(first, second) {
  if (!first.length || !second.length) return null;
  if (first.length !== second.length) return 0;
  const matches = first.reduce(
    (total, token, index) =>
      total + (token.value === second[index]?.value ? 1 : 0),
    0,
  );
  return matches / first.length;
}

export function parseTradeOcrText(text, numericText = text) {
  const source = String(text || "").toLowerCase();
  const textTokens = extractQuantityTokens(source);
  const numericTokens = extractQuantityTokens(numericText || "");
  const selectedTokens = selectTokenSource(source, numericText);
  const named = namedQuantities(source, textTokens);
  const quantities = Object.fromEntries(
    ITEM_DEFINITIONS.map((item) => [item.name, named.values[item.name] || 0]),
  );
  let shovels = 0;

  if (
    selectedTokens.length === ITEM_DEFINITIONS.length + 1 &&
    named.namedCount === ITEM_DEFINITIONS.length &&
    textTokens.length === ITEM_DEFINITIONS.length + 1
  ) {
    const unusedIndex = textTokens.findIndex(
      (_token, index) => !named.used.has(index),
    );
    shovels = unusedIndex >= 0 ? selectedTokens[unusedIndex]?.value || 0 : 0;
  } else if (named.namedCount === ITEM_DEFINITIONS.length) {
    const unused = textTokens.filter(
      (_token, index) => !named.used.has(index),
    );
    if (unused.length === 1) {
      shovels = unused[0].value;
    }
  }

  const detectedItemCount = Object.values(quantities).filter(
    (value) => value > 0,
  ).length;
  const valueAgreement = quantityTokenAgreement(textTokens, numericTokens);
  const coverageRatio = detectedItemCount / ITEM_DEFINITIONS.length;
  const namedRatio = named.namedCount / ITEM_DEFINITIONS.length;
  const tokenShapeScore = [5, 6].includes(selectedTokens.length)
    ? 1
    : selectedTokens.length >= 4
      ? 0.5
      : 0;
  let confidence = Math.round(
    coverageRatio * 35 +
      namedRatio * 25 +
      tokenShapeScore * 10 +
      (valueAgreement ?? 0.5) * 30,
  );
  if (valueAgreement !== null && valueAgreement < 1) {
    confidence -= Math.round((1 - valueAgreement) * 60);
  }
  if (valueAgreement === null) {
    confidence = Math.min(confidence, 78);
  }
  confidence = clamp(confidence, 0, 98);
  const warnings = [];
  if (detectedItemCount < ITEM_DEFINITIONS.length) {
    warnings.push(
      `Detected ${detectedItemCount} of ${ITEM_DEFINITIONS.length} shell quantities. Review missing values.`,
    );
  }
  if (named.namedCount < 3) {
    warnings.push(
      "Few item names were readable. Values are no longer guessed by row order because the game can reorder items.",
    );
  }
  if (valueAgreement !== null && valueAgreement < 1) {
    warnings.push(
      "OCR passes disagreed on one or more quantities. Review the highlighted fields.",
    );
  }

  return {
    quantities,
    shovels,
    confidence,
    namedItemCount: named.namedCount,
    detectedItemCount,
    quantityTokenCount: selectedTokens.length,
    valueAgreement,
    warnings,
    rawText: String(text || "").trim(),
    numericText: String(numericText || "").trim(),
  };
}

function validBbox(value) {
  const x0 = Number(value?.x0);
  const y0 = Number(value?.y0);
  const x1 = Number(value?.x1);
  const y1 = Number(value?.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) {
    return null;
  }
  return { x0, y0, x1, y1 };
}

function bboxCenter(bbox) {
  return {
    x: (bbox.x0 + bbox.x1) / 2,
    y: (bbox.y0 + bbox.y1) / 2,
  };
}

function unionBboxes(values) {
  if (!values.length) return null;
  return values.reduce(
    (result, bbox) => ({
      x0: Math.min(result.x0, bbox.x0),
      y0: Math.min(result.y0, bbox.y0),
      x1: Math.max(result.x1, bbox.x1),
      y1: Math.max(result.y1, bbox.y1),
    }),
    { ...values[0] },
  );
}

function blockLines(blocks) {
  const lines = [];
  (blocks || []).forEach((block, blockIndex) => {
    (block.paragraphs || []).forEach((paragraph, paragraphIndex) => {
      (paragraph.lines || []).forEach((line, lineIndex) => {
        const bbox = validBbox(line.bbox);
        const text = String(line.text || "").trim();
        if (!bbox || !text) return;
        lines.push({
          id: `${blockIndex}:${paragraphIndex}:${lineIndex}`,
          text,
          confidence: clamp(Number(line.confidence) || 0, 0, 100),
          bbox,
          words: (line.words || [])
            .map((word) => ({
              text: String(word.text || "").trim(),
              confidence: clamp(Number(word.confidence) || 0, 0, 100),
              bbox: validBbox(word.bbox),
            }))
            .filter((word) => word.text && word.bbox),
        });
      });
    });
  });
  return lines;
}

function quantityObservations(lines, allowBare = false) {
  const observations = [];
  lines.forEach((line) => {
    let foundWordToken = false;
    line.words.forEach((word) => {
      const tokens = extractQuantityTokens(word.text);
      tokens.forEach((token) => {
        foundWordToken = true;
        observations.push({
          value: token.value,
          raw: token.raw,
          confidence: word.confidence || line.confidence,
          bbox: word.bbox,
          lineId: line.id,
          prefixed: true,
        });
      });
      if (
        allowBare &&
        !tokens.length &&
        /^[\s0-9oilsb,.]{1,10}$/i.test(word.text)
      ) {
        const value = parseQuantity(word.text);
        if (value) {
          foundWordToken = true;
          observations.push({
            value,
            raw: word.text,
            confidence: word.confidence || line.confidence,
            bbox: word.bbox,
            lineId: line.id,
            prefixed: false,
          });
        }
      }
    });
    if (foundWordToken) return;
    extractQuantityTokens(line.text).forEach((token) => {
      observations.push({
        value: token.value,
        raw: token.raw,
        confidence: line.confidence,
        bbox: line.bbox,
        lineId: line.id,
        prefixed: true,
      });
    });
  });
  return observations;
}

function namedLineObservations(lines) {
  const observations = [];
  lines.forEach((line) => {
    const lineCenter = bboxCenter(line.bbox);
    const fragments = lines
      .filter((candidate) => {
        if (candidate.id === line.id || extractQuantityTokens(candidate.text).length) {
          return false;
        }
        const candidateCenter = bboxCenter(candidate.bbox);
        const lineHeight = line.bbox.y1 - line.bbox.y0;
        const candidateHeight = candidate.bbox.y1 - candidate.bbox.y0;
        const verticalDistance = Math.abs(candidateCenter.y - lineCenter.y);
        const horizontalGap = Math.max(
          0,
          Math.max(line.bbox.x0, candidate.bbox.x0) -
            Math.min(line.bbox.x1, candidate.bbox.x1),
        );
        return (
          verticalDistance <= Math.max(lineHeight, candidateHeight) * 2.3 &&
          horizontalGap <= Math.max(lineHeight, candidateHeight) * 4
        );
      })
      .toSorted(
        (first, second) =>
          Math.abs(bboxCenter(first.bbox).y - lineCenter.y) -
          Math.abs(bboxCenter(second.bbox).y - lineCenter.y),
      )
      .slice(0, 2);
    const sourceVariants = [
      line.text.toLowerCase(),
      ...fragments.flatMap((fragment) => [
        `${line.text} ${fragment.text}`.toLowerCase(),
        `${line.text}${fragment.text}`.toLowerCase(),
        `${fragment.text} ${line.text}`.toLowerCase(),
        `${fragment.text}${line.text}`.toLowerCase(),
      ]),
    ];
    const source =
      sourceVariants.find((value) =>
        ITEM_DEFINITIONS.some((definition) => findAlias(value, definition)),
      ) || sourceVariants[0];
    const tokens = extractQuantityTokens(source);
    if (!tokens.length) return;
    ITEM_DEFINITIONS.forEach((definition) => {
      const alias = findAlias(source, definition);
      if (!alias) return;
      const nearest = tokens
        .map((token) => ({
          token,
          distance: tokenDistance(token, alias),
        }))
        .toSorted((first, second) => first.distance - second.distance)[0];
      if (!nearest || nearest.distance > 80) return;
      observations.push({
        name: definition.name,
        value: nearest.token.value,
        confidence: line.confidence,
        bbox: line.bbox,
        lineId: line.id,
        text: line.text,
      });
    });
  });
  return observations;
}

function selectTradeCluster(observations, width, height) {
  if (!observations.length) return null;
  let best = null;
  observations.forEach((seed) => {
    const seedCenter = bboxCenter(seed.bbox);
    const nearby = observations.filter((observation) => {
      const center = bboxCenter(observation.bbox);
      return (
        Math.abs(center.x - seedCenter.x) <= width * 0.27 &&
        Math.abs(center.y - seedCenter.y) <= height * 0.42
      );
    });
    const selected = new Map();
    nearby.forEach((observation) => {
      const current = selected.get(observation.name);
      if (!current || observation.confidence > current.confidence) {
        selected.set(observation.name, observation);
      }
    });
    const values = Array.from(selected.values());
    const bbox = unionBboxes(values.map((value) => value.bbox));
    const averageConfidence =
      values.reduce((sum, value) => sum + value.confidence, 0) /
      values.length;
    const score =
      values.length * 100 +
      averageConfidence -
      ((bbox.x1 - bbox.x0) / width) * 20 -
      ((bbox.y1 - bbox.y0) / height) * 10;
    if (!best || score > best.score) {
      best = { selected, bbox, score };
    }
  });
  return best;
}

function inferSingleMissingField(cluster, tokens, width, height) {
  if (!cluster || cluster.selected.size !== ITEM_DEFINITIONS.length - 1) {
    return cluster;
  }
  const missing = ITEM_DEFINITIONS.find(
    (definition) => !cluster.selected.has(definition.name),
  );
  if (!missing) return cluster;
  const usedLineIds = new Set(
    Array.from(cluster.selected.values(), (value) => value.lineId),
  );
  const rowHeights = Array.from(
    cluster.selected.values(),
    (value) => value.bbox.y1 - value.bbox.y0,
  ).toSorted((first, second) => first - second);
  const rowHeight = rowHeights[Math.floor(rowHeights.length / 2)] || height * 0.03;
  const candidates = tokens.filter((token) => {
    if (usedLineIds.has(token.lineId)) return false;
    const center = bboxCenter(token.bbox);
    return (
      center.x >= cluster.bbox.x0 - width * 0.12 &&
      center.x <= cluster.bbox.x1 + width * 0.12 &&
      center.y >= cluster.bbox.y0 - rowHeight * 2.2 &&
      center.y <= cluster.bbox.y1 + rowHeight * 2.2
    );
  });
  if (candidates.length !== 1) return cluster;
  const token = candidates[0];
  const selected = new Map(cluster.selected);
  selected.set(missing.name, {
    name: missing.name,
    value: token.value,
    confidence: Math.min(58, token.confidence),
    bbox: token.bbox,
    lineId: token.lineId,
    text: token.raw,
    inferred: true,
  });
  return {
    ...cluster,
    selected,
    bbox: unionBboxes(
      Array.from(selected.values(), (observation) => observation.bbox),
    ),
  };
}

function likelyShovelToken(cluster, tokens, width, height) {
  if (!cluster || cluster.selected.size !== ITEM_DEFINITIONS.length) {
    return null;
  }
  const usedLineIds = new Set(
    Array.from(cluster.selected.values(), (value) => value.lineId),
  );
  const rowHeights = Array.from(
    cluster.selected.values(),
    (value) => value.bbox.y1 - value.bbox.y0,
  ).toSorted((first, second) => first - second);
  const rowHeight = rowHeights[Math.floor(rowHeights.length / 2)] || height * 0.03;
  const candidates = tokens.filter((token) => {
    if (usedLineIds.has(token.lineId)) return false;
    const center = bboxCenter(token.bbox);
    const outsideShellRows =
      center.x <= cluster.bbox.x0 - width * 0.04 ||
      center.x >= cluster.bbox.x1 + width * 0.04;
    return (
      outsideShellRows &&
      center.x >= cluster.bbox.x0 - width * 0.24 &&
      center.x <= cluster.bbox.x1 + width * 0.24 &&
      center.y >= cluster.bbox.y0 - rowHeight * 2.2 &&
      center.y <= cluster.bbox.y0 + rowHeight * 1.7
    );
  });
  if (!candidates.length) return null;
  const chosen = candidates.toSorted((first, second) => {
    const firstCenter = bboxCenter(first.bbox);
    const secondCenter = bboxCenter(second.bbox);
    return (
      Number(second.prefixed) - Number(first.prefixed) ||
      Math.abs(firstCenter.y - cluster.bbox.y0) -
        Math.abs(secondCenter.y - cluster.bbox.y0) ||
      second.confidence - first.confidence
    );
  })[0];
  if (!chosen.prefixed && chosen.value > 0 && chosen.value <= 3) {
    return {
      ...chosen,
      value: 1,
      normalizedSingleDigit: true,
      confidence: Math.min(chosen.confidence, 54),
    };
  }
  return chosen;
}

export function parseTradeOcrBlocks(blocks, width, height) {
  const lines = blockLines(blocks);
  const named = namedLineObservations(lines);
  const tokens = quantityObservations(lines);
  const allNumericTokens = quantityObservations(lines, true);
  const namedCluster = selectTradeCluster(named, width, height);
  const cluster = inferSingleMissingField(
    namedCluster,
    tokens,
    width,
    height,
  );
  const quantities = { ...EMPTY_QUANTITIES };
  const fields = {};
  if (cluster) {
    cluster.selected.forEach((observation, name) => {
      quantities[name] = observation.value;
      fields[name] = observation;
    });
  }
  const shovel = likelyShovelToken(
    cluster,
    allNumericTokens,
    width,
    height,
  );
  return {
    quantities,
    shovels: shovel?.value || 0,
    fields,
    shovel,
    cluster,
    lines,
    tokens,
    namedItemCount: namedCluster?.selected.size || 0,
    locatedItemCount: cluster?.selected.size || 0,
    detectedItemCount: Object.values(quantities).filter(Boolean).length,
  };
}

function recoverIconOnlyLayout(spatial, width, height) {
  const prefixed = spatial.tokens
    .map((token) => {
      if (token.prefixed !== false) return token;
      const compact = String(token.raw || "").replace(/\s+/g, "");
      if (!/^[12][0-9oilsb][0-9oilsb,.]{2,8}$/i.test(compact)) {
        return null;
      }
      const value = parseQuantity(compact.slice(1));
      return value
        ? {
            ...token,
            value,
            raw: compact.slice(1),
            prefixed: "misread",
            confidence: Math.min(token.confidence, 68),
          }
        : null;
    })
    .filter(Boolean)
    .toSorted((first, second) => {
      const firstCenter = bboxCenter(first.bbox);
      const secondCenter = bboxCenter(second.bbox);
      return firstCenter.y - secondCenter.y || firstCenter.x - secondCenter.x;
    });
  if (prefixed.length !== ITEM_DEFINITIONS.length) return null;
  const bbox = unionBboxes(prefixed.map((token) => token.bbox));
  if (
    !bbox ||
    bbox.x1 - bbox.x0 > width * 0.42 ||
    bbox.y1 - bbox.y0 > height * 0.55
  ) {
    return null;
  }
  const selected = new Map();
  ICON_ONLY_FIELD_ORDER.forEach((name, index) => {
    const token = prefixed[index];
    selected.set(name, {
      name,
      value: token.value,
      confidence: Math.min(72, token.confidence),
      bbox: token.bbox,
      lineId: token.lineId,
      text: token.raw,
      inferred: true,
    });
  });
  return {
    ...spatial,
    quantities: Object.fromEntries(
      ITEM_DEFINITIONS.map((definition) => [
        definition.name,
        selected.get(definition.name)?.value || 0,
      ]),
    ),
    fields: Object.fromEntries(selected),
    cluster: { selected, bbox, score: 0 },
    locatedItemCount: ITEM_DEFINITIONS.length,
    detectedItemCount: ITEM_DEFINITIONS.length,
    iconOnly: true,
  };
}

async function loadImage(file) {
  if ("createImageBitmap" in globalThis) {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Some Android browsers expose createImageBitmap but cannot decode
      // gallery-backed JPG blobs with it. Fall through to HTMLImageElement.
    }
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () =>
        reject(new Error("The browser could not decode this image."));
    });
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(
      "Could not open this screenshot. Try saving or sharing it as a new JPG or PNG, then upload that copy.",
    );
  }
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = import("tesseract.js")
      .then(async ({ createWorker, PSM }) => {
        const worker = await createWorker("eng", 1, {
          logger: (message) => {
            const target = workerProgressTarget;
            if (!target) return;
            if (message.status === "recognizing text") {
              target.callback({
                progress:
                  target.start +
                  clamp(Number(message.progress) || 0, 0, 1) * target.span,
                status: target.status,
              });
            }
          },
        });
        return { worker, PSM };
      })
      .catch((error) => {
        ocrWorkerPromise = null;
        throw error;
      });
  }
  return ocrWorkerPromise;
}

function scheduleWorkerTermination() {
  if (ocrIdleTimer) globalThis.clearTimeout(ocrIdleTimer);
  ocrIdleTimer = globalThis.setTimeout(() => {
    const pending = ocrWorkerPromise;
    ocrWorkerPromise = null;
    ocrIdleTimer = null;
    if (pending) void pending.then(({ worker }) => worker.terminate());
  }, OCR_WORKER_IDLE_MS);
}

function withOcrWorker(onProgress, task) {
  const run = ocrQueue
    .catch(() => {})
    .then(async () => {
      if (ocrIdleTimer) {
        globalThis.clearTimeout(ocrIdleTimer);
        ocrIdleTimer = null;
      }
      onProgress({ progress: 0.03, status: "Loading local OCR engine" });
      const resources = await getOcrWorker();
      onProgress({ progress: 0.12, status: "Locating trade fields" });
      try {
        return await task(resources);
      } finally {
        workerProgressTarget = null;
        scheduleWorkerTermination();
      }
    });
  ocrQueue = run.catch(() => {});
  return run;
}

async function recognizeJob(
  worker,
  image,
  parameters,
  output,
  progress,
) {
  await worker.setParameters(parameters);
  workerProgressTarget = progress;
  return worker.recognize(image, {}, output);
}

function integralImage(values, width, height) {
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowTotal = 0;
    for (let x = 0; x < width; x += 1) {
      rowTotal += values[y * width + x];
      integral[(y + 1) * stride + x + 1] =
        integral[y * stride + x + 1] + rowTotal;
    }
  }
  return integral;
}

function integralSum(integral, width, left, top, right, bottom) {
  const stride = width + 1;
  return (
    integral[bottom * stride + right] -
    integral[top * stride + right] -
    integral[bottom * stride + left] +
    integral[top * stride + left]
  );
}

function locateTradeWindow(image) {
  const width = 480;
  const height = Math.max(1, Math.round((image.height / image.width) * width));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image.source, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const green = new Uint8Array(width * height);
  const white = new Uint8Array(width * height);
  for (let index = 0; index < green.length; index += 1) {
    const offset = index * 4;
    const red = pixels[offset];
    const greenValue = pixels[offset + 1];
    const blue = pixels[offset + 2];
    green[index] =
      greenValue > 65 &&
      greenValue > red * 1.22 &&
      greenValue > blue * 1.12
        ? 1
        : 0;
    const minimum = Math.min(red, greenValue, blue);
    const maximum = Math.max(red, greenValue, blue);
    white[index] = minimum > 155 && maximum - minimum < 85 ? 1 : 0;
  }
  const greenIntegral = integralImage(green, width, height);
  const whiteNearGreen = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!white[index]) continue;
      const radius = 5;
      const nearbyGreen = integralSum(
        greenIntegral,
        width,
        Math.max(0, x - radius),
        Math.max(0, y - radius),
        Math.min(width, x + radius + 1),
        Math.min(height, y + radius + 1),
      );
      if (nearbyGreen >= 3) whiteNearGreen[index] = 1;
    }
  }
  const whiteIntegral = integralImage(whiteNearGreen, width, height);
  const windowWidth = Math.round(width * 0.34);
  const windowHeight = Math.round(height * 0.7);
  const xStart = Math.round(width * 0.05);
  const xEnd = Math.round(width * 0.76) - windowWidth;
  const yEnd = Math.max(0, Math.round(height * 0.3));
  const xStep = Math.max(4, Math.round(width * 0.025));
  const yStep = Math.max(3, Math.round(height * 0.025));
  let best = null;
  for (let top = 0; top <= yEnd; top += yStep) {
    for (let left = xStart; left <= xEnd; left += xStep) {
      const right = left + windowWidth;
      const bottom = Math.min(height, top + windowHeight);
      const whiteScore = integralSum(
        whiteIntegral,
        width,
        left,
        top,
        right,
        bottom,
      );
      const greenScore = integralSum(
        greenIntegral,
        width,
        left,
        top,
        right,
        bottom,
      );
      const score = whiteScore * 18 + greenScore * 0.025;
      if (!best || score > best.score) {
        best = { left, top, right, bottom, score, whiteScore };
      }
    }
  }
  if (!best || best.whiteScore < 18) return FULL_SCAN_WINDOW;
  const horizontalPadding = Math.round(width * 0.035);
  const verticalPadding = Math.round(height * 0.04);
  const left = Math.max(0, best.left - horizontalPadding);
  const top = Math.max(0, best.top - verticalPadding);
  const right = Math.min(width, best.right + horizontalPadding);
  const bottom = Math.min(height, best.bottom + verticalPadding);
  return {
    left: left / width,
    top: top / height,
    width: (right - left) / width,
    height: (bottom - top) / height,
  };
}

function createScanCanvas(
  image,
  window,
  mode = OCR_MODES[0],
  targetWidth = 2400,
) {
  const sourceLeft = Math.round(image.width * window.left);
  const sourceTop = Math.round(image.height * window.top);
  const sourceWidth = Math.min(
    Math.round(image.width * window.width),
    image.width - sourceLeft,
  );
  const sourceHeight = Math.min(
    Math.round(image.height * window.height),
    image.height - sourceTop,
  );
  const scale = clamp(targetWidth / sourceWidth, 1, 2.2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);
  const context = canvas.getContext("2d", { willReadFrequently: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = mode.filter;
  context.drawImage(
    image.source,
    sourceLeft,
    sourceTop,
    sourceWidth,
    sourceHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

function createDarkTextCanvas(image, window) {
  const canvas = createScanCanvas(
    image,
    window,
    { name: "original", filter: "none" },
    2200,
  );
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  const green = new Uint8Array(canvas.width * canvas.height);
  for (let index = 0; index < green.length; index += 1) {
    const offset = index * 4;
    const red = pixels[offset];
    const greenValue = pixels[offset + 1];
    const blue = pixels[offset + 2];
    green[index] =
      greenValue > 60 &&
      greenValue > red * 1.2 &&
      greenValue > blue * 1.08
        ? 1
        : 0;
  }
  const greenIntegral = integralImage(green, canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const index = y * canvas.width + x;
      const offset = index * 4;
      const red = pixels[offset];
      const greenValue = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const maximum = Math.max(red, greenValue, blue);
      const minimum = Math.min(red, greenValue, blue);
      const radius = 4;
      const nearbyGreen = integralSum(
        greenIntegral,
        canvas.width,
        Math.max(0, x - radius),
        Math.max(0, y - radius),
        Math.min(canvas.width, x + radius + 1),
        Math.min(canvas.height, y + radius + 1),
      );
      const isDarkText =
        maximum < 145 && maximum - minimum < 75 && nearbyGreen >= 10;
      const value = isDarkText ? 0 : 255;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function focusRectangle(spatial, canvas) {
  const bbox = spatial?.cluster?.bbox;
  if (!bbox) {
    return {
      left: 0,
      top: 0,
      width: canvas.width,
      height: canvas.height,
    };
  }
  const left = Math.max(0, Math.floor(bbox.x0 - canvas.width * 0.18));
  const top = Math.max(0, Math.floor(bbox.y0 - canvas.height * 0.2));
  const right = Math.min(
    canvas.width,
    Math.ceil(bbox.x1 + canvas.width * 0.18),
  );
  const bottom = Math.min(
    canvas.height,
    Math.ceil(bbox.y1 + canvas.height * 0.12),
  );
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function createFocusCanvas(source, rectangle, mode = OCR_MODES[0]) {
  const scale = clamp(1500 / rectangle.width, 1, 2.4);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(rectangle.width * scale);
  canvas.height = Math.round(rectangle.height * scale);
  const context = canvas.getContext("2d", { willReadFrequently: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.filter = mode.filter;
  context.drawImage(
    source,
    rectangle.left,
    rectangle.top,
    rectangle.width,
    rectangle.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

function focusedPoint(point, rectangle, canvas) {
  return {
    x: ((point.x - rectangle.left) / rectangle.width) * canvas.width,
    y: ((point.y - rectangle.top) / rectangle.height) * canvas.height,
  };
}

function sourceRectangleForToken(token, focusRectangleValue, focusCanvas, source) {
  const tokenWidth =
    (token.bbox.x1 - token.bbox.x0) *
    (focusRectangleValue.width / focusCanvas.width);
  const tokenHeight =
    (token.bbox.y1 - token.bbox.y0) *
    (focusRectangleValue.height / focusCanvas.height);
  const centerX =
    focusRectangleValue.left +
    ((token.bbox.x0 + token.bbox.x1) / 2 / focusCanvas.width) *
      focusRectangleValue.width;
  const centerY =
    focusRectangleValue.top +
    ((token.bbox.y0 + token.bbox.y1) / 2 / focusCanvas.height) *
      focusRectangleValue.height;
  const width = Math.max(30, tokenWidth * 2.1);
  const height = Math.max(24, tokenHeight * 2.3);
  const left = Math.max(0, Math.floor(centerX - width / 2));
  const top = Math.max(0, Math.floor(centerY - height / 2));
  const right = Math.min(source.width, Math.ceil(centerX + width / 2));
  const bottom = Math.min(source.height, Math.ceil(centerY + height / 2));
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function isolatedQuantity(text) {
  const token = extractQuantityTokens(String(text || ""))[0];
  return token?.value || parseQuantity(text) || 0;
}

function matchNumericFields(spatial, blocks, rectangle, canvas) {
  const tokens = quantityObservations(blockLines(blocks), true);
  const available = new Set(tokens.map((_token, index) => index));
  const matches = {};
  ITEM_DEFINITIONS.forEach((definition) => {
    const field = spatial.fields[definition.name];
    if (!field) return;
    const target = focusedPoint(bboxCenter(field.bbox), rectangle, canvas);
    const targetHeight =
      ((field.bbox.y1 - field.bbox.y0) / rectangle.height) * canvas.height;
    let best = null;
    available.forEach((index) => {
      const token = tokens[index];
      const center = bboxCenter(token.bbox);
      const verticalDistance = Math.abs(center.y - target.y);
      const horizontalDistance = Math.abs(center.x - target.x);
      const score =
        verticalDistance +
        horizontalDistance * 0.12 +
        (token.prefixed ? 0 : 12);
      if (
        verticalDistance <= Math.max(24, targetHeight * 1.4) &&
        (!best || score < best.score)
      ) {
        best = { index, token, score };
      }
    });
    if (!best) return;
    available.delete(best.index);
    matches[definition.name] = best.token;
  });

  const values = Object.fromEntries(
    ITEM_DEFINITIONS.map((definition) => [
      definition.name,
      matches[definition.name]?.value || 0,
    ]),
  );
  let shovel = null;
  if (Object.keys(spatial.fields).length === ITEM_DEFINITIONS.length) {
    const topFieldY = Math.min(
      ...Object.values(spatial.fields).map(
        (field) => focusedPoint(bboxCenter(field.bbox), rectangle, canvas).y,
      ),
    );
    const leftFieldX = Math.min(
      ...Object.values(spatial.fields).map((field) =>
        focusedPoint(
          {
            x: field.bbox.x0,
            y: (field.bbox.y0 + field.bbox.y1) / 2,
          },
          rectangle,
          canvas,
        ).x,
      ),
    );
    const rightFieldX = Math.max(
      ...Object.values(spatial.fields).map((field) =>
        focusedPoint(
          {
            x: field.bbox.x1,
            y: (field.bbox.y0 + field.bbox.y1) / 2,
          },
          rectangle,
          canvas,
        ).x,
      ),
    );
    const candidates = Array.from(available, (index) => tokens[index]).filter(
      (token) => {
        const center = bboxCenter(token.bbox);
        const outsideShellRows =
          center.x <= leftFieldX - canvas.width * 0.04 ||
          center.x >= rightFieldX + canvas.width * 0.04;
        return (
          outsideShellRows &&
          center.y >= topFieldY - canvas.height * 0.12 &&
          center.y <= topFieldY + canvas.height * 0.08
        );
      },
    );
    const prefixed = candidates.filter((token) => token.prefixed);
    if (prefixed.length === 1) shovel = prefixed[0];
    else if (!prefixed.length && candidates.length === 1) shovel = candidates[0];
  }
  return {
    quantities: values,
    shovels: shovel?.value || 0,
    matches,
    shovel,
    tokens,
  };
}

function resultFieldValue(result, field) {
  return field === "Shovels"
    ? Number(result.shovels) || 0
    : Number(result.quantities?.[field]) || 0;
}

function learnedFieldSourceScore(profile, field, source) {
  return clamp(Number(profile?.sources?.[field]?.[source]) || 0, -12, 12);
}

function sourceReliability(field, source) {
  if (field === "Shovels") {
    if (source === "shovel-clean") return 28;
    if (source === "shovel-monochrome") return 8;
    if (source === "labels") return 30;
    if (source === "digits-balanced") return 3;
  }
  if (source === "labels") return 2;
  if (source === "digits-balanced") return 1;
  return 0;
}

function chooseDetectedValue(field, candidates, profile, allowZero = false) {
  const positive = candidates.filter((candidate) => candidate.value > 0);
  const hasIsolatedPositive =
    allowZero &&
    positive.some((candidate) => candidate.source === "shovel-clean");
  const usable =
    allowZero && hasIsolatedPositive
      ? positive
      : candidates.filter((candidate) =>
          allowZero ? candidate.value >= 0 : candidate.value > 0,
        );
  if (!usable.length) {
    return { value: 0, confidence: allowZero ? 72 : 22, agreeingSources: [] };
  }
  const groups = new Map();
  usable.forEach((candidate) => {
    const group = groups.get(candidate.value) || [];
    group.push(candidate);
    groups.set(candidate.value, group);
  });
  const rankedGroups = Array.from(groups.entries()).toSorted(
    ([firstValue, first], [secondValue, second]) =>
      second.length - first.length ||
      Math.max(
        ...second.map(
          (candidate) =>
            candidate.confidence +
            sourceReliability(field, candidate.source) +
            learnedFieldSourceScore(profile, field, candidate.source),
        ),
      ) -
        Math.max(
          ...first.map(
          (candidate) =>
            candidate.confidence +
            sourceReliability(field, candidate.source) +
            learnedFieldSourceScore(profile, field, candidate.source),
          ),
        ) ||
      firstValue - secondValue,
  );
  const [value, agreeing] = rankedGroups[0];
  const disagreement = rankedGroups.length > 1;
  let confidence;
  if (agreeing.length >= 3) confidence = 97;
  else if (agreeing.length === 2) confidence = disagreement ? 90 : 94;
  else {
    const best = agreeing.toSorted(
      (first, second) =>
        second.confidence +
        sourceReliability(field, second.source) +
        learnedFieldSourceScore(profile, field, second.source) -
        (first.confidence +
          sourceReliability(field, first.source) +
          learnedFieldSourceScore(profile, field, first.source)),
    )[0];
    confidence = disagreement
      ? Math.min(54, best.confidence)
      : Math.min(68, best.confidence);
  }
  return {
    value,
    confidence: Math.round(clamp(confidence, 0, 98)),
    agreeingSources: agreeing.map((candidate) => candidate.source),
  };
}

function candidateSet(source, spatialOrNumeric, engineConfidence) {
  return Object.fromEntries(
    RESULT_FIELDS.map((field) => [
      field,
      {
        source,
        value: resultFieldValue(spatialOrNumeric, field),
        confidence: clamp(Number(engineConfidence) || 0, 0, 100),
      },
    ]),
  );
}

function combineCandidates(candidateSets, profile) {
  const selected = {};
  const fieldConfidence = {};
  const learningCandidates = {};
  RESULT_FIELDS.forEach((field) => {
    const candidates = candidateSets.map((set) => set[field]);
    const choice = chooseDetectedValue(
      field,
      candidates,
      profile,
      field === "Shovels",
    );
    selected[field] = choice.value;
    fieldConfidence[field] = choice.confidence;
    learningCandidates[field] = Object.fromEntries(
      candidates.map((candidate) => [candidate.source, candidate.value]),
    );
  });
  return { selected, fieldConfidence, learningCandidates };
}

export function recordTradeScanFeedback(result, corrected) {
  const learning = result?.learning;
  if (!learning?.layoutKey) return null;
  const fields = RESULT_FIELDS.filter(
    (field) =>
      field !== "Shovels" ||
      resultFieldValue(result, field) > 0 ||
      resultFieldValue(corrected, field) > 0,
  );
  const matches = fields.filter(
    (field) =>
      resultFieldValue(result, field) === resultFieldValue(corrected, field),
  ).length;
  const accuracy = fields.length ? matches / fields.length : 0;
  const calibration = readCalibration();
  const profile = calibration.profiles[learning.layoutKey] || {
    sources: {},
  };
  profile.sources ||= {};
  fields.forEach((field) => {
    const correctValue = resultFieldValue(corrected, field);
    const candidates = learning.candidates?.[field] || {};
    profile.sources[field] ||= {};
    Object.entries(candidates).forEach(([source, value]) => {
      const reward = Number(value) === correctValue ? 8 : -8;
      const current = Number(profile.sources[field][source]) || 0;
      profile.sources[field][source] = clamp(
        current * 0.72 + reward * 0.28,
        -12,
        12,
      );
    });
  });
  profile.updatedAt = Date.now();
  calibration.profiles[learning.layoutKey] = profile;
  calibration.version = 1;
  calibration.profiles = Object.fromEntries(
    Object.entries(calibration.profiles)
      .toSorted(
        (first, second) =>
          Number(second[1].updatedAt || 0) - Number(first[1].updatedAt || 0),
      )
      .slice(0, 12),
  );
  try {
    globalThis.localStorage?.setItem(
      CALIBRATION_STORAGE_KEY,
      JSON.stringify(calibration),
    );
  } catch {
    // Local learning is optional when browser storage is unavailable.
  }
  return { accuracy, learned: true };
}

function capturedAtFromFilename(filename) {
  const match = String(filename).match(
    /(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const value = `${year}-${month}-${day}T${hour}:${minute}`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

export async function scanTradeScreenshot(file, onProgress = () => {}) {
  if (!isSupportedTradeImage(file)) {
    throw new Error("Choose a JPG, JPEG, PNG, or WebP screenshot.");
  }
  const image = await loadImage(file);
  const aspectRatio = image.width / image.height;
  const layoutKey = calibrationLayoutKey(image);
  const profile = calibrationProfile(layoutKey);
  try {
    return await withOcrWorker(onProgress, async ({ worker, PSM }) => {
      const textParameters = {
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        tessedit_char_whitelist: "",
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      };
      const numericParameters = {
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        tessedit_char_whitelist: "xX0123456789,",
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      };
      const tradeWindow = locateTradeWindow(image);
      const fullCanvas = createScanCanvas(
        image,
        tradeWindow,
        OCR_MODES[0],
      );
      let textResult = await recognizeJob(
        worker,
        fullCanvas,
        textParameters,
        { text: true, blocks: true },
        {
          callback: onProgress,
          start: 0.12,
          span: 0.28,
          status: "Locating labeled trade rows",
        },
      );
      const locatedTextResult = textResult;
      let textCanvas = fullCanvas;
      let spatial = parseTradeOcrBlocks(
        textResult.data.blocks,
        textCanvas.width,
        textCanvas.height,
      );
      let didUseFallback = false;
      let iconOnlyNumericResult = null;

      if (spatial.namedItemCount < 4) {
        const monochromeCanvas = createScanCanvas(
          image,
          tradeWindow,
          OCR_MODES[1],
        );
        const monochromeResult = await recognizeJob(
          worker,
          monochromeCanvas,
          textParameters,
          { text: true, blocks: true },
          {
            callback: onProgress,
            start: 0.4,
            span: 0.18,
            status: "Retrying obscured item labels",
          },
        );
        const monochromeSpatial = parseTradeOcrBlocks(
          monochromeResult.data.blocks,
          monochromeCanvas.width,
          monochromeCanvas.height,
        );
        if (
          monochromeSpatial.namedItemCount > spatial.namedItemCount ||
          (monochromeSpatial.namedItemCount === spatial.namedItemCount &&
            Number(monochromeResult.data.confidence) >
              Number(textResult.data.confidence))
        ) {
          textResult = monochromeResult;
          textCanvas = monochromeCanvas;
          spatial = monochromeSpatial;
        }
      }

      if (spatial.namedItemCount < 4) {
        didUseFallback = true;
        for (let index = 0; index < FALLBACK_SCAN_WINDOWS.length; index += 1) {
          const fallbackCanvas = createScanCanvas(
            image,
            FALLBACK_SCAN_WINDOWS[index],
            OCR_MODES[0],
            2200,
          );
          const fallbackResult = await recognizeJob(
            worker,
            fallbackCanvas,
            textParameters,
            { text: true, blocks: true },
            {
              callback: onProgress,
              start: 0.56 + index * 0.08,
              span: 0.08,
              status: "Checking another trade-table position",
            },
          );
          const fallbackSpatial = parseTradeOcrBlocks(
            fallbackResult.data.blocks,
            fallbackCanvas.width,
            fallbackCanvas.height,
          );
          if (
            fallbackSpatial.namedItemCount > spatial.namedItemCount ||
            (fallbackSpatial.namedItemCount === spatial.namedItemCount &&
              Number(fallbackResult.data.confidence) >
                Number(textResult.data.confidence))
          ) {
            textResult = fallbackResult;
            textCanvas = fallbackCanvas;
            spatial = fallbackSpatial;
          }
          if (spatial.namedItemCount === ITEM_DEFINITIONS.length) break;
        }
      }

      if (spatial.namedItemCount < 3) {
        const iconOnlyCanvas = createDarkTextCanvas(image, tradeWindow);
        iconOnlyNumericResult = await recognizeJob(
          worker,
          iconOnlyCanvas,
          numericParameters,
          { text: true, blocks: true },
          {
            callback: onProgress,
            start: 0.82,
            span: 0.1,
            status: "Reading icon-only quantities",
          },
        );
        const numericTokens = quantityObservations(
          blockLines(iconOnlyNumericResult.data.blocks),
          true,
        );
        const iconOnly = recoverIconOnlyLayout(
          { ...spatial, tokens: numericTokens },
          iconOnlyCanvas.width,
          iconOnlyCanvas.height,
        );
        if (iconOnly) {
          spatial = iconOnly;
          textCanvas = iconOnlyCanvas;
          textResult = locatedTextResult;
        }
      }

      if (spatial.namedItemCount < 3 && !spatial.iconOnly) {
        const error = new Error(
          "Could not locate enough labeled shell rows. Use a screenshot where the active trade table and item names are visible.",
        );
        error.diagnostic = {
          text: textResult.data.text,
          numericText: iconOnlyNumericResult?.data.text,
        };
        throw error;
      }

      const rectangle = focusRectangle(spatial, textCanvas);
      let balancedCanvas = textCanvas;
      let balancedResult = iconOnlyNumericResult;
      let balanced = spatial;
      if (!spatial.iconOnly) {
        balancedCanvas = createFocusCanvas(
          textCanvas,
          rectangle,
          OCR_MODES[0],
        );
        balancedResult = await recognizeJob(
          worker,
          balancedCanvas,
          numericParameters,
          { text: true, blocks: true },
          {
            callback: onProgress,
            start: didUseFallback
              ? 0.82
              : spatial.namedItemCount < 4
                ? 0.58
                : 0.4,
            span: didUseFallback
              ? 0.1
              : spatial.namedItemCount < 4
                ? 0.2
                : 0.3,
            status: "Verifying each quantity",
          },
        );
        balanced = matchNumericFields(
          spatial,
          balancedResult.data.blocks,
          rectangle,
          balancedCanvas,
        );
      }
      const candidateSets = [
        candidateSet(
          "labels",
          spatial,
          Number(textResult.data.confidence) || 0,
        ),
        candidateSet(
          "digits-balanced",
          balanced,
          Number(balancedResult.data.confidence) || 0,
        ),
      ];
      let combined = combineCandidates(candidateSets, profile);
      const needsThirdPass =
        !spatial.iconOnly &&
        RESULT_FIELDS.some((field) => combined.fieldConfidence[field] < 85);
      let monochromeNumericResult = null;
      let monochrome = null;
      let monochromeCanvas = null;
      if (needsThirdPass) {
        monochromeCanvas = createFocusCanvas(
          textCanvas,
          rectangle,
          OCR_MODES[1],
        );
        monochromeNumericResult = await recognizeJob(
          worker,
          monochromeCanvas,
          numericParameters,
          { text: true, blocks: true },
          {
            callback: onProgress,
            start: didUseFallback ? 0.92 : 0.7,
            span: didUseFallback ? 0.06 : 0.24,
            status: "Resolving uncertain digits",
          },
        );
        monochrome = matchNumericFields(
          spatial,
          monochromeNumericResult.data.blocks,
          rectangle,
          monochromeCanvas,
        );
        candidateSets.push(
          candidateSet(
            "digits-monochrome",
            monochrome,
            Number(monochromeNumericResult.data.confidence) || 0,
          ),
        );
        combined = combineCandidates(candidateSets, profile);
      }

      const shovelSeed = balanced.shovel
        ? {
            token: balanced.shovel,
            canvas: balancedCanvas,
            rectangle,
          }
        : spatial.shovel
          ? {
              token: spatial.shovel,
              canvas: textCanvas,
              rectangle: {
                left: 0,
                top: 0,
                width: textCanvas.width,
                height: textCanvas.height,
              },
            }
          : monochrome?.shovel
            ? {
                token: monochrome.shovel,
                canvas: monochromeCanvas,
                rectangle,
              }
            : null;
      const isolatedNumericTexts = [];
      if (shovelSeed) {
        const shovelRectangle = sourceRectangleForToken(
          shovelSeed.token,
          shovelSeed.rectangle,
          shovelSeed.canvas,
          textCanvas,
        );
        for (let index = 0; index < SHOVEL_OCR_MODES.length; index += 1) {
          const mode = SHOVEL_OCR_MODES[index];
          const shovelCanvas = createFocusCanvas(
            textCanvas,
            shovelRectangle,
            mode,
          );
          const shovelResult = await recognizeJob(
            worker,
            shovelCanvas,
            {
              ...numericParameters,
              tessedit_pageseg_mode: PSM.SINGLE_WORD,
            },
            { text: true },
            {
              callback: onProgress,
              start: 0.94 + index * 0.025,
              span: 0.02,
              status: "Confirming separated shovel count",
            },
          );
          isolatedNumericTexts.push(shovelResult.data.text);
          const isolatedValue = isolatedQuantity(shovelResult.data.text);
          if (isolatedValue) {
            candidateSets.push(
              candidateSet(
                `shovel-${mode.name}`,
                {
                  quantities: EMPTY_QUANTITIES,
                  shovels: isolatedValue,
                },
                Number(shovelResult.data.confidence) || 0,
              ),
            );
          }
        }
        combined = combineCandidates(candidateSets, profile);
      }

      if (spatial.iconOnly) {
        ITEM_DEFINITIONS.forEach((definition) => {
          combined.fieldConfidence[definition.name] = Math.min(
            78,
            combined.fieldConfidence[definition.name],
          );
        });
      }

      const quantities = Object.fromEntries(
        ITEM_DEFINITIONS.map((definition) => [
          definition.name,
          combined.selected[definition.name] || 0,
        ]),
      );
      const shovels = combined.selected.Shovels || 0;
      const detectedItemCount = Object.values(quantities).filter(Boolean).length;
      if (!detectedItemCount) {
        throw new Error(
          "No trade quantities were detected. Use a clear screenshot showing the active trade table.",
        );
      }
      const confidenceValues = RESULT_FIELDS.map(
        (field) => combined.fieldConfidence[field],
      );
      const averageConfidence =
        confidenceValues.reduce((sum, value) => sum + value, 0) /
        confidenceValues.length;
      const minimumConfidence = Math.min(...confidenceValues);
      const confidence = Math.round(
        averageConfidence * 0.35 + minimumConfidence * 0.65,
      );
      const uncertainFields = RESULT_FIELDS.filter(
        (field) => combined.fieldConfidence[field] < 85,
      );
      const warnings = [];
      if (spatial.iconOnly) {
        warnings.push(
          "Item names were hidden, so quantities were recovered from the game’s icon-only layout. Review all shell fields before applying.",
        );
      }
      if (
        spatial.namedItemCount < ITEM_DEFINITIONS.length &&
        detectedItemCount < ITEM_DEFINITIONS.length
      ) {
        warnings.push(
          `Only ${spatial.namedItemCount} of ${ITEM_DEFINITIONS.length} labeled shell rows were located. Missing rows were left blank instead of guessed.`,
        );
      }
      if (uncertainFields.length) {
        warnings.push(
          `Needs review: ${uncertainFields.join(", ")}. Confidence now requires exact agreement between independent OCR passes.`,
        );
      }
      if (aspectRatio < 1.9 || aspectRatio > 2.4) {
        warnings.push(
          "This screenshot is unusually narrow or tall; detection may be less accurate.",
        );
      }

      onProgress({ progress: 1, status: "Detection complete" });
      return {
        quantities,
        shovels,
        confidence,
        fieldConfidence: combined.fieldConfidence,
        namedItemCount: spatial.namedItemCount,
        detectedItemCount,
        quantityTokenCount: balanced.tokens.length,
        valueAgreement:
          RESULT_FIELDS.filter(
            (field) => combined.fieldConfidence[field] >= 85,
          ).length / RESULT_FIELDS.length,
        warnings: [...new Set(warnings)],
        rawText: String(textResult.data.text || "").trim(),
        numericText: [
          iconOnlyNumericResult?.data.text,
          balancedResult.data.text,
          monochromeNumericResult?.data.text,
          ...isolatedNumericTexts,
        ]
          .filter(Boolean)
          .join("\n")
          .trim(),
        capturedAt: capturedAtFromFilename(file.name),
        image: { width: image.width, height: image.height },
        learning: {
          layoutKey,
          candidates: combined.learningCandidates,
          window: tradeWindow,
          shovelCandidates: {
            balanced: balanced.shovel
              ? {
                  value: balanced.shovel.value,
                  raw: balanced.shovel.raw,
                  prefixed: balanced.shovel.prefixed,
                }
              : null,
            monochrome: monochrome?.shovel
              ? {
                  value: monochrome.shovel.value,
                  raw: monochrome.shovel.raw,
                  prefixed: monochrome.shovel.prefixed,
                }
              : null,
            isolated: isolatedNumericTexts,
          },
        },
      };
    });
  } finally {
    image.release();
  }
}
