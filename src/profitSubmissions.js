import { normalizeQuantities } from "./entryUtils.js";
import { supabase } from "./supabaseClient.js";

const SUBMISSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const EVIDENCE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_EVIDENCE_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 400 * 1024;
const EVIDENCE_MAX_DIMENSION = 1600;

function evidenceMimeType(file) {
  if (["image/jpeg", "image/jpg", "image/pjpeg"].includes(file?.type)) {
    return "image/jpeg";
  }
  if (EVIDENCE_IMAGE_TYPES.has(file?.type)) return file.type;
  const name = String(file?.name || "");
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  return null;
}

function randomToken(byteLength) {
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

export function createSubmissionToken() {
  return randomToken(24);
}

export function createClientSubmissionId() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${randomToken(12)}`
  );
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

async function loadEvidenceImage(file) {
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
      // Fall through for gallery-backed images that some mobile browsers
      // cannot decode with createImageBitmap.
    }
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Could not decode image."));
    });
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(
      "Could not open the reference screenshot. Save it as a new JPG or PNG and try again.",
    );
  }
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Could not compress reference screenshot.")),
      "image/jpeg",
      quality,
    );
  });
}

export async function prepareSubmissionReference(file) {
  const mimeType = evidenceMimeType(file);
  if (!(file instanceof Blob) || !mimeType) {
    throw new Error("Choose a JPG, PNG, or WebP reference screenshot.");
  }
  if (file.size > MAX_EVIDENCE_SOURCE_BYTES) {
    throw new Error("Reference screenshot must be 20 MB or smaller.");
  }
  if (file.size <= MAX_EVIDENCE_BYTES) {
    return {
      mimeType,
      base64: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
      size: file.size,
    };
  }

  const image = await loadEvidenceImage(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Image compression is unavailable.");
    const dimensionSteps = [1600, 1400, 1200, 1000];
    const qualitySteps = [0.82, 0.72, 0.62, 0.52];
    let best = null;
    for (let index = 0; index < dimensionSteps.length; index += 1) {
      const limit = Math.min(EVIDENCE_MAX_DIMENSION, dimensionSteps[index]);
      const scale = Math.min(1, limit / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      const compressed = await canvasToBlob(canvas, qualitySteps[index]);
      if (!best || compressed.size < best.size) best = compressed;
      if (compressed.size <= MAX_EVIDENCE_BYTES) {
        best = compressed;
        break;
      }
    }
    if (!best || best.size > MAX_EVIDENCE_BYTES) {
      throw new Error(
        "Reference screenshot is still too large after compression. Crop it and try again.",
      );
    }
    return {
      mimeType: "image/jpeg",
      base64: bytesToBase64(new Uint8Array(await best.arrayBuffer())),
      size: best.size,
    };
  } finally {
    image.release();
  }
}

export function createPlayerInputUrl(id, submissionToken, location) {
  const url = new URL(location.href);
  url.pathname = `/s/${id}`;
  url.search = "";
  url.hash = `entry=${submissionToken}`;
  return url.toString();
}

export function readPlayerSubmissionToken(hash = window.location.hash) {
  if (!hash.startsWith("#entry=")) return null;
  const token = hash.slice("#entry=".length);
  return SUBMISSION_TOKEN_PATTERN.test(token) ? token : null;
}

export async function enableProfitSubmissions(
  profitShare,
  submissionToken,
) {
  if (
    !supabase ||
    !profitShare?.id ||
    !profitShare?.editorToken ||
    !SUBMISSION_TOKEN_PATTERN.test(String(submissionToken || ""))
  ) {
    return null;
  }
  const { data, error } = await supabase.rpc("enable_profit_submissions", {
    p_id: profitShare.id,
    p_editor_token: profitShare.editorToken,
    p_submission_token: submissionToken,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.share_id !== profitShare.id) return null;
  return {
    ...profitShare,
    submissionToken,
    expiresAt: row.share_expires_at || profitShare.expiresAt,
  };
}

function mapSubmission(row, ownerView = false) {
  return {
    id: String(row.submission_id),
    shareId: ownerView
      ? String(row.submission_share_id || "")
      : null,
    playerKey: ownerView
      ? String(row.submission_player_key || "")
      : null,
    quantities: normalizeQuantities(row.submission_quantities),
    shovels: Math.max(
      0,
      Math.floor(Number(row.submission_shovels) || 0),
    ),
    entryDate: String(row.submission_entry_date || ""),
    entryAt: row.submission_entry_at,
    note: String(row.submission_note || ""),
    status: String(row.submission_status || "pending"),
    reviewNote: String(row.submission_review_note || ""),
    approvedQuantities: row.submission_approved_quantities
      ? normalizeQuantities(row.submission_approved_quantities)
      : null,
    approvedShovels:
      row.submission_approved_shovels === null
        ? null
        : Math.max(
            0,
            Math.floor(Number(row.submission_approved_shovels) || 0),
          ),
    approvedEntryDate: row.submission_approved_entry_date
      ? String(row.submission_approved_entry_date)
      : null,
    approvedEntryAt: row.submission_approved_entry_at || null,
    hasReferenceImage: Boolean(row.submission_has_reference_image),
    createdAt: row.submission_created_at,
    reviewedAt: row.submission_reviewed_at,
  };
}

export async function submitProfitEntry({
  shareId,
  submissionToken,
  clientSubmissionId,
  quantities,
  shovels,
  entryDate,
  entryAt,
  note,
  referenceImage = null,
}) {
  if (!supabase) throw new Error("Cloud submissions are unavailable.");
  const parameters = {
    p_share_id: shareId,
    p_submission_token: submissionToken,
    p_client_submission_id: clientSubmissionId,
    p_quantities: normalizeQuantities(quantities),
    p_shovels: Math.max(0, Math.floor(Number(shovels) || 0)),
    p_entry_date: entryDate,
    p_entry_at: entryAt,
    p_note: String(note || "").slice(0, 200),
  };
  if (referenceImage) {
    parameters.p_reference_mime_type = referenceImage.mimeType;
    parameters.p_reference_base64 = referenceImage.base64;
  }
  const { data, error } = await supabase.rpc(
    referenceImage
      ? "submit_profit_entry_with_evidence"
      : "submit_profit_entry",
    parameters,
  );
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.submission_id) throw new Error("Submission was not saved.");
  return {
    id: String(row.submission_id),
    status: row.submission_status,
    createdAt: row.submission_created_at,
  };
}

export async function loadPlayerProfitSubmissions(
  shareId,
  submissionToken,
) {
  if (
    !supabase ||
    !shareId ||
    !SUBMISSION_TOKEN_PATTERN.test(String(submissionToken || ""))
  ) {
    return [];
  }
  const { data, error } = await supabase.rpc(
    "get_player_profit_submissions",
    {
      p_share_id: shareId,
      p_submission_token: submissionToken,
    },
  );
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((row) =>
    mapSubmission(row),
  );
}

export async function loadOwnerProfitSubmissions() {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc(
    "list_profit_entry_submissions",
  );
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((row) =>
    mapSubmission(row, true),
  );
}

export async function loadProfitSubmissionEvidence(submissionId) {
  if (!supabase) throw new Error("Cloud submissions are unavailable.");
  const { data, error } = await supabase.rpc(
    "get_profit_submission_evidence",
    { p_submission_id: submissionId },
  );
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.reference_base64 || !row?.reference_mime_type) return null;
  return {
    dataUrl: `data:${row.reference_mime_type};base64,${row.reference_base64}`,
    mimeType: row.reference_mime_type,
    size: Math.max(0, Number(row.reference_size) || 0),
  };
}

export async function reviewProfitSubmission({
  submissionId,
  status,
  reviewNote = "",
  quantities = null,
  shovels = null,
  entryDate = null,
  entryAt = null,
}) {
  if (!supabase) throw new Error("Cloud submissions are unavailable.");
  const { data, error } = await supabase.rpc(
    "review_profit_entry_submission",
    {
      p_submission_id: submissionId,
      p_status: status,
      p_review_note: String(reviewNote || "").slice(0, 200),
      p_approved_quantities:
        status === "approved" ? normalizeQuantities(quantities) : null,
      p_approved_shovels:
        status === "approved"
          ? Math.max(0, Math.floor(Number(shovels) || 0))
          : null,
      p_approved_entry_date: status === "approved" ? entryDate : null,
      p_approved_entry_at: status === "approved" ? entryAt : null,
    },
  );
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.submission_id !== submissionId) {
    throw new Error("Submission review was not saved.");
  }
  return row;
}
