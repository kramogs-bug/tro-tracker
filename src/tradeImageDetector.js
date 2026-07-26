const ITEM_DEFINITIONS = [
  {
    name: "Tro",
    aliases: [/\btrochus\b/i, /\btroch[a-z]*\b/i, /\btro\b/i],
  },
  {
    name: "Sand Dollar",
    aliases: [
      /\bsand\s*dollar\b/i,
      /\bsand\s*doll[a-z]*\b/i,
      /\bsand\s*dol+[a-z]*\b/i,
    ],
  },
  {
    name: "Starfish",
    aliases: [
      /\bstar\s*fish\b/i,
      /\bstarfish\b/i,
      /\btarfish\b/i,
      /\bstarfis[a-z]*\b/i,
    ],
  },
  {
    name: "Aero",
    aliases: [
      /\baerolata\b/i,
      /\baero\s*lata\b/i,
      /\baerolat[a-z]*\b/i,
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

const SCAN_WINDOWS = [0, 0.14, 0.28, 0.42, 0.56, 0.7].map((left) => ({
  left,
  top: 0.02,
  width: 0.3,
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
const RESULT_FIELDS = [...ITEM_DEFINITIONS.map((item) => item.name), "Shovels"];
const CALIBRATION_STORAGE_KEY = "tro-trade-ocr-calibration-v1";

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
    windows: {},
    modes: {},
  };
}

function learnedScore(profile, group, key) {
  return clamp(Number(profile?.[group]?.[key]) || 0, -8, 8);
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

  if (selectedTokens.length === ITEM_DEFINITIONS.length) {
    ITEM_DEFINITIONS.forEach((definition, index) => {
      quantities[definition.name] = selectedTokens[index].value;
    });
  } else if (
    selectedTokens.length === ITEM_DEFINITIONS.length + 1 &&
    named.namedCount === ITEM_DEFINITIONS.length &&
    textTokens.length === ITEM_DEFINITIONS.length + 1
  ) {
    const unusedIndex = textTokens.findIndex(
      (_token, index) => !named.used.has(index),
    );
    shovels = unusedIndex >= 0 ? selectedTokens[unusedIndex]?.value || 0 : 0;
    const shellTokens = selectedTokens.filter(
      (_token, index) => index !== unusedIndex,
    );
    ITEM_DEFINITIONS.forEach((definition, index) => {
      quantities[definition.name] =
        shellTokens[index]?.value || quantities[definition.name];
    });
  } else {
    const unused = textTokens.filter(
      (_token, index) => !named.used.has(index),
    );
    if (named.namedCount >= 3 && unused.length === 1) {
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
      "Few item names were readable, so fixed top-to-bottom shell order was used.",
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

function scoreOcrText(text) {
  const source = String(text || "").toLowerCase();
  const namedCount = ITEM_DEFINITIONS.filter((definition) =>
    findAlias(source, definition),
  ).length;
  const quantityCount = extractQuantityTokens(source).length;
  return namedCount * 20 + Math.min(quantityCount, 7) * 5;
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

function createScanCanvas(image, window, mode = OCR_MODES[0]) {
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
  const scale = Math.min(2, 1500 / sourceWidth);
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

function resultFieldValue(result, field) {
  return field === "Shovels"
    ? Number(result.shovels) || 0
    : Number(result.quantities?.[field]) || 0;
}

function candidateRank(candidate) {
  return (
    candidate.parsed.confidence * 0.65 +
    candidate.engineConfidence * 0.3 +
    candidate.learnedModeScore
  );
}

function buildFieldConfidence(selected, candidates) {
  return Object.fromEntries(
    RESULT_FIELDS.map((field) => {
      const selectedValue = resultFieldValue(selected.parsed, field);
      const values = candidates.map((candidate) =>
        resultFieldValue(candidate.parsed, field),
      );
      const passesAgree = values.every((value) => value === selectedValue);
      if (
        field === "Shovels" &&
        selectedValue === 0 &&
        passesAgree &&
        selected.parsed.quantityTokenCount === ITEM_DEFINITIONS.length
      ) {
        return [field, 88];
      }
      if (!selectedValue) return [field, 28];
      let confidence = passesAgree
        ? 72 + selected.engineConfidence * 0.25
        : 38 + selected.engineConfidence * 0.2;
      if (
        selected.parsed.valueAgreement !== null &&
        selected.parsed.valueAgreement < 1
      ) {
        confidence = Math.min(confidence, 68);
      }
      return [field, Math.round(clamp(confidence, 0, 98))];
    }),
  );
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
  const reward = (accuracy - 0.5) * 16;
  const calibration = readCalibration();
  const profile = calibration.profiles[learning.layoutKey] || {
    windows: {},
    modes: {},
  };
  const updateScore = (current) =>
    clamp((Number(current) || 0) * 0.65 + reward * 0.35, -8, 8);
  profile.windows[learning.windowIndex] = updateScore(
    profile.windows[learning.windowIndex],
  );
  profile.modes[learning.mode] = updateScore(profile.modes[learning.mode]);
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
  const totalOcrJobs = SCAN_WINDOWS.length + OCR_MODES.length;
  let worker;
  let activeJob = -1;
  try {
    onProgress({ progress: 0.02, status: "Loading local OCR engine" });
    const { createWorker, PSM } = await import("tesseract.js");
    worker = await createWorker("eng", 1, {
      logger: (message) => {
        if (message.status !== "recognizing text") return;
        const completedJobs = Math.max(0, activeJob);
        onProgress({
          progress:
            0.15 +
            ((completedJobs + Number(message.progress || 0)) /
              totalOcrJobs) *
              0.8,
          status: "Reading trade quantities",
        });
      },
    });
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: "1",
    });

    let best = null;
    for (let index = 0; index < SCAN_WINDOWS.length; index += 1) {
      activeJob = index;
      const canvas = createScanCanvas(
        image,
        SCAN_WINDOWS[index],
        OCR_MODES[0],
      );
      const result = await worker.recognize(canvas);
      const learnedWindowScore = learnedScore(
        profile,
        "windows",
        String(index),
      );
      const candidate = {
        canvas,
        text: result.data.text,
        score: scoreOcrText(result.data.text) + learnedWindowScore,
        ocrConfidence: clamp(Number(result.data.confidence) || 0, 0, 100),
        index,
      };
      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }

    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      tessedit_char_whitelist: "xX0123456789,",
      preserve_interword_spaces: "1",
    });
    const numericCandidates = [];
    for (let index = 0; index < OCR_MODES.length; index += 1) {
      activeJob = SCAN_WINDOWS.length + index;
      const mode = OCR_MODES[index];
      const canvas =
        index === 0
          ? best.canvas
          : createScanCanvas(image, SCAN_WINDOWS[best.index], mode);
      const numericResult = await worker.recognize(canvas);
      const engineConfidence = clamp(
        (best.ocrConfidence +
          (Number(numericResult.data.confidence) || 0)) /
          2,
        0,
        100,
      );
      numericCandidates.push({
        mode: mode.name,
        parsed: parseTradeOcrText(best.text, numericResult.data.text),
        engineConfidence,
        learnedModeScore: learnedScore(profile, "modes", mode.name),
      });
    }
    const selected = numericCandidates.toSorted(
      (first, second) => candidateRank(second) - candidateRank(first),
    )[0];
    const parsed = selected.parsed;
    const fieldConfidence = buildFieldConfidence(
      selected,
      numericCandidates,
    );
    const confidenceFields = RESULT_FIELDS.filter(
      (field) => field !== "Shovels" || parsed.shovels > 0,
    ).map((field) => fieldConfidence[field]);
    const averageFieldConfidence =
      confidenceFields.reduce((total, value) => total + value, 0) /
      confidenceFields.length;
    const minimumFieldConfidence = Math.min(...confidenceFields);
    parsed.confidence = Math.min(
      parsed.confidence,
      Math.round(
        averageFieldConfidence * 0.6 + minimumFieldConfidence * 0.4,
      ),
    );
    parsed.fieldConfidence = fieldConfidence;
    const uncertainFields = RESULT_FIELDS.filter(
      (field) =>
        fieldConfidence[field] < 75 &&
        (field !== "Shovels" || parsed.shovels > 0),
    );
    if (uncertainFields.length) {
      parsed.warnings.push(
        `Low OCR agreement for: ${uncertainFields.join(", ")}. Review these values.`,
      );
    }
    if (aspectRatio < 1.9 || aspectRatio > 2.4) {
      parsed.warnings.push(
        "This screenshot is unusually narrow or tall; detection may be less accurate.",
      );
    }
    if (!parsed.detectedItemCount) {
      throw new Error(
        "No trade quantities were detected. Use a clear screenshot showing the trade table.",
      );
    }
    onProgress({ progress: 1, status: "Detection complete" });
    return {
      ...parsed,
      warnings: [...new Set(parsed.warnings)],
      capturedAt: capturedAtFromFilename(file.name),
      image: { width: image.width, height: image.height },
      learning: {
        layoutKey,
        windowIndex: best.index,
        mode: selected.mode,
      },
    };
  } finally {
    image.release();
    if (worker) await worker.terminate();
  }
}
