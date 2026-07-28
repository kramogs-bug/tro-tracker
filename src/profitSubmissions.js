import { normalizeQuantities } from "./entryUtils.js";
import { supabase } from "./supabaseClient.js";

const SUBMISSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

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
}) {
  if (!supabase) throw new Error("Cloud submissions are unavailable.");
  const { data, error } = await supabase.rpc("submit_profit_entry", {
    p_share_id: shareId,
    p_submission_token: submissionToken,
    p_client_submission_id: clientSubmissionId,
    p_quantities: normalizeQuantities(quantities),
    p_shovels: Math.max(0, Math.floor(Number(shovels) || 0)),
    p_entry_date: entryDate,
    p_entry_at: entryAt,
    p_note: String(note || "").slice(0, 200),
  });
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

export async function reviewProfitSubmission({
  submissionId,
  status,
  reviewNote = "",
  quantities = null,
  shovels = null,
  entryDate = null,
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
    },
  );
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.submission_id !== submissionId) {
    throw new Error("Submission review was not saved.");
  }
  return row;
}
