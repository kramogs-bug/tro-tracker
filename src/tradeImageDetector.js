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

const SCAN_WINDOWS = [0.17, 0.27, 0.38, 0.48, 0.58].map((left) => ({
  left,
  top: 0.18,
  width: 0.3,
  height: 0.61,
}));

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

export function parseTradeOcrText(text, numericText = text) {
  const source = String(text || "").toLowerCase();
  const textTokens = extractQuantityTokens(source);
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
  const confidence = Math.min(
    99,
    named.namedCount * 13 +
      detectedItemCount * 6 +
      (selectedTokens.length >= 5 ? 8 : 0),
  );
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

  return {
    quantities,
    shovels,
    confidence,
    namedItemCount: named.namedCount,
    detectedItemCount,
    quantityTokenCount: selectedTokens.length,
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
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  await image.decode();
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}

function createScanCanvas(image, window) {
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
  context.filter = "contrast(135%) saturate(70%)";
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
  if (!(file instanceof Blob) || !file.type.startsWith("image/")) {
    throw new Error("Choose a valid screenshot image.");
  }
  const image = await loadImage(file);
  const aspectRatio = image.width / image.height;
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
              (SCAN_WINDOWS.length + 1)) *
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
      const canvas = createScanCanvas(image, SCAN_WINDOWS[index]);
      const result = await worker.recognize(canvas);
      const candidate = {
        canvas,
        text: result.data.text,
        score: scoreOcrText(result.data.text),
        index,
      };
      if (!best || candidate.score > best.score) {
        best = candidate;
      }
    }

    activeJob = SCAN_WINDOWS.length;
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      tessedit_char_whitelist: "xX0123456789,",
      preserve_interword_spaces: "1",
    });
    const numericResult = await worker.recognize(best.canvas);
    const parsed = parseTradeOcrText(best.text, numericResult.data.text);
    if (aspectRatio < 1.9 || aspectRatio > 2.4) {
      parsed.warnings.push(
        "The screenshot aspect ratio differs from the samples; detection may be less accurate.",
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
      capturedAt: capturedAtFromFilename(file.name),
      image: { width: image.width, height: image.height },
    };
  } finally {
    image.release();
    if (worker) await worker.terminate();
  }
}
