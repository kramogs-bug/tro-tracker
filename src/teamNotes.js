import { supabase } from "./supabaseClient.js";

const MAX_TEAM_NOTE_LENGTH = 240;

function mapPlayerNote(row) {
  return {
    id: String(row.note_id || ""),
    playerKey: row.note_player_key
      ? String(row.note_player_key)
      : null,
    playerName: String(row.note_player_name || "Player").slice(0, 50),
    body: String(row.note_body || "").slice(0, MAX_TEAM_NOTE_LENGTH),
    createdAt: row.note_created_at,
    isCurrentPlayer: Boolean(row.note_is_current_player),
  };
}

export function createClientTeamNoteId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) {
    return `${Date.now()}-team-note`;
  }
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${Date.now()}-${suffix}`;
}

export async function loadPlayerTeamNotes(shareId, submissionToken) {
  if (!supabase) throw new Error("Team notes are unavailable.");
  const { data, error } = await supabase.rpc("get_player_team_notes", {
    p_share_id: shareId,
    p_submission_token: submissionToken,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(mapPlayerNote);
}

export async function postPlayerTeamNote({
  shareId,
  submissionToken,
  clientNoteId,
  body,
}) {
  if (!supabase) throw new Error("Team notes are unavailable.");
  const normalizedBody = String(body || "").trim();
  if (!normalizedBody || normalizedBody.length > MAX_TEAM_NOTE_LENGTH) {
    throw new Error("Note must be between 1 and 240 characters.");
  }
  const { data, error } = await supabase.rpc("post_player_team_note", {
    p_share_id: shareId,
    p_submission_token: submissionToken,
    p_client_note_id: clientNoteId,
    p_body: normalizedBody,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.note_id) throw new Error("Team note was not saved.");
  return mapPlayerNote(row);
}

export async function loadOwnerTeamNotes() {
  if (!supabase) throw new Error("Team notes are unavailable.");
  const { data, error } = await supabase.rpc("list_player_team_notes");
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(mapPlayerNote);
}

export async function deleteOwnerTeamNote(noteId) {
  if (!supabase) throw new Error("Team notes are unavailable.");
  const { data, error } = await supabase.rpc("delete_player_team_note", {
    p_note_id: noteId,
  });
  if (error) throw error;
  if (data !== true) throw new Error("Team note was not found.");
  return true;
}

export { MAX_TEAM_NOTE_LENGTH };
