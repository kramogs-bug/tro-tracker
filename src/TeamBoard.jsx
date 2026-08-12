import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Crown,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  TrendingUp,
  Trophy,
  UsersRound,
} from "lucide-react";
import {
  createClientTeamNoteId,
  deleteOwnerTeamNote,
  loadOwnerTeamNotes,
  loadPlayerTeamNotes,
  MAX_TEAM_NOTE_LENGTH,
  postPlayerTeamNote,
} from "./teamNotes.js";
import { format } from "./tracker.js";
import { RecapArchive } from "./PeriodRecap.jsx";

const softButton =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[#B1D3B9] bg-white px-3 py-2 text-xs font-bold text-[#527A70] hover:bg-[#F2F8ED] disabled:cursor-not-allowed disabled:opacity-60";

function displayDate(value) {
  if (!value) return "Today";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-PH", {
    dateStyle: "long",
  });
}

function displayTimestamp(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function rankIcon(rank) {
  if (rank === 1) return <Crown size={18} />;
  if (rank === 2) return <Trophy size={17} />;
  if (rank === 3) return <Sparkles size={17} />;
  return <span className="text-xs font-black">#{rank}</span>;
}

function PlayerDailyRows({ snapshot }) {
  const rows = useMemo(
    () =>
      (snapshot.teamDaily || []).toSorted(
        (a, b) =>
          b.netPhp - a.netPhp ||
          b.netTro - a.netTro ||
          a.name.localeCompare(b.name),
      ),
    [snapshot.teamDaily],
  );
  const combinedPhp = rows.reduce((sum, row) => sum + row.netPhp, 0);
  const activePlayers = rows.filter(
    (row) => Math.abs(row.netPhp) >= 0.005,
  ).length;

  return (
    <section className="rounded-3xl border border-[#B1D3B9] bg-white p-5 sm:p-7">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#E6F2DD] text-[#527A70]">
            <TrendingUp size={21} />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#659287]">
              {displayDate(snapshot.dates?.today)}
            </p>
            <h2 className="mt-1 text-2xl font-bold">Team Daily Board</h2>
            <p className="mt-1 text-sm text-[#659287]">
              Confirmed gains only. Pending entries are not counted yet.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:min-w-64">
          <div className="rounded-2xl bg-[#29453E] p-3 text-white">
            <p className="text-[11px] font-bold uppercase text-[#B1D3B9]">
              Team total
            </p>
            <strong className="mt-1 block text-lg">
              ₱{format(combinedPhp)}
            </strong>
          </div>
          <div className="rounded-2xl bg-[#E6F2DD] p-3 text-[#29453E]">
            <p className="text-[11px] font-bold uppercase text-[#659287]">
              Active today
            </p>
            <strong className="mt-1 block text-lg">
              {activePlayers}/{snapshot.teamPlayerCount || rows.length}
            </strong>
          </div>
        </div>
      </div>

      {rows.length ? (
        <div className="mt-5 grid gap-2">
          {rows.map((row, index) => {
            const rank = index + 1;
            return (
              <article
                key={`${row.name}-${index}`}
                className={`grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border p-3 sm:p-4 ${
                  row.isCurrent
                    ? "border-[#527A70] bg-[#F2F8ED] shadow-sm"
                    : "border-[#E6F2DD] bg-[#F8FBF5]"
                }`}
              >
                <span
                  className={`grid size-10 place-items-center rounded-xl ${
                    rank === 1
                      ? "bg-amber-100 text-amber-700"
                      : rank <= 3
                        ? "bg-white text-[#527A70]"
                        : "bg-[#E6F2DD] text-[#659287]"
                  }`}
                  aria-label={`Rank ${rank}`}
                >
                  {rankIcon(rank)}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-bold">
                    {row.name}
                    {row.isCurrent ? (
                      <span className="ml-2 rounded-full bg-[#527A70] px-2 py-0.5 text-[10px] uppercase text-white">
                        You
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-[#659287]">
                    {Math.abs(row.netPhp) >= 0.005
                      ? `${format(row.netTro)} TRO confirmed`
                      : "No confirmed gain yet"}
                  </p>
                </div>
                <strong
                  className={`text-right text-lg ${
                    row.netPhp > 0
                      ? "text-green-700"
                      : row.netPhp < 0
                        ? "text-red-700"
                        : "text-[#659287]"
                  }`}
                >
                  ₱{format(row.netPhp)}
                </strong>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-5 rounded-2xl bg-[#F8FBF5] p-5 text-center">
          <UsersRound size={26} className="mx-auto text-[#659287]" />
          <p className="mt-3 font-bold">Team totals are syncing</p>
          <p className="mt-1 text-sm text-[#659287]">
            Ask the tracker owner to open the app once, then refresh this
            page.
          </p>
        </div>
      )}
    </section>
  );
}

function TeamNotes({ shareId, submissionToken }) {
  const [notes, setNotes] = useState([]);
  const [status, setStatus] = useState("loading");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");

  const refresh = useCallback(async () => {
    if (!navigator.onLine) return false;
    try {
      const next = await loadPlayerTeamNotes(shareId, submissionToken);
      setNotes(next);
      setStatus("ready");
      setFeedback("");
      return true;
    } catch (loadError) {
      setStatus("error");
      setFeedback(loadError?.message || "Could not load team notes.");
      return false;
    }
  }, [shareId, submissionToken]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    const handleVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", handleVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [refresh]);

  const submit = async (event) => {
    event.preventDefault();
    const nextBody = body.trim();
    if (!nextBody || saving) return;
    setSaving(true);
    setFeedback("Posting note…");
    try {
      const note = await postPlayerTeamNote({
        shareId,
        submissionToken,
        clientNoteId: createClientTeamNoteId(),
        body: nextBody,
      });
      setNotes((current) => [...current, note].slice(-100));
      setBody("");
      setStatus("ready");
      setFeedback("Posted. Other players can see it now.");
    } catch (saveError) {
      setFeedback(saveError?.message || "Could not post team note.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-3xl border border-[#B1D3B9] bg-white p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#E6F2DD] text-[#527A70]">
            <MessageCircle size={21} />
          </span>
          <div>
            <h2 className="text-xl font-bold">Team notes</h2>
            <p className="mt-1 text-sm text-[#659287]">
              Shared with the other players. Notes disappear after 14 days.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={status === "loading"}
          className={softButton}
        >
          <RefreshCw
            size={14}
            className={status === "loading" ? "animate-spin" : ""}
          />
          Refresh
        </button>
      </div>

      <div
        className="mt-5 max-h-[28rem] min-h-52 space-y-3 overflow-y-auto rounded-2xl bg-[#F8FBF5] p-3 sm:p-4"
        aria-live="polite"
        aria-label="Shared team notes"
      >
        {status === "loading" && !notes.length ? (
          <p className="py-16 text-center text-sm font-bold text-[#659287]">
            Loading team notes…
          </p>
        ) : notes.length ? (
          notes.map((note) => (
            <article
              key={note.id}
              className={`flex ${
                note.isCurrentPlayer ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[88%] rounded-2xl px-4 py-3 sm:max-w-[75%] ${
                  note.isCurrentPlayer
                    ? "rounded-br-md bg-[#527A70] text-white"
                    : "rounded-bl-md border border-[#E6F2DD] bg-white"
                }`}
              >
                <p
                  className={`text-xs font-bold ${
                    note.isCurrentPlayer
                      ? "text-[#E6F2DD]"
                      : "text-[#527A70]"
                  }`}
                >
                  {note.playerName}
                  {note.isCurrentPlayer ? " · You" : ""}
                </p>
                <p className="mt-1 break-words text-sm">{note.body}</p>
                <p
                  className={`mt-1.5 text-[10px] ${
                    note.isCurrentPlayer
                      ? "text-[#D6E8D2]"
                      : "text-[#659287]"
                  }`}
                >
                  {displayTimestamp(note.createdAt)}
                </p>
              </div>
            </article>
          ))
        ) : (
          <div className="py-14 text-center text-[#659287]">
            <MessageCircle size={27} className="mx-auto" />
            <p className="mt-3 font-bold">No team notes yet</p>
            <p className="mt-1 text-sm">Start the friendly competition.</p>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="mt-4">
        <div className="flex gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Write a team note</span>
            <input
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={MAX_TEAM_NOTE_LENGTH}
              placeholder="Share an update or friendly challenge…"
              className="w-full rounded-xl border border-[#B1D3B9] bg-white px-4 py-3 outline-none focus:border-[#527A70]"
            />
          </label>
          <button
            type="submit"
            disabled={saving || !body.trim()}
            className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#527A70] text-white hover:bg-[#29453E] disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Post team note"
          >
            {saving ? (
              <LoaderCircle size={18} className="animate-spin" />
            ) : (
              <Send size={18} />
            )}
          </button>
        </div>
        <div className="mt-2 flex items-start justify-between gap-3 text-xs">
          <p className="font-bold text-[#527A70]">{feedback}</p>
          <span className="shrink-0 text-[#659287]">
            {body.length}/{MAX_TEAM_NOTE_LENGTH}
          </span>
        </div>
      </form>
    </section>
  );
}

export function PlayerTeamBoard({
  snapshot,
  shareId,
  submissionToken,
  onOpenRecap,
}) {
  return (
    <div className="mx-auto grid max-w-5xl gap-5 px-4 pb-8 pt-5">
      <RecapArchive recaps={snapshot.recaps} onOpen={onOpenRecap} />
      <PlayerDailyRows snapshot={snapshot} />
      <TeamNotes shareId={shareId} submissionToken={submissionToken} />
    </div>
  );
}

export function OwnerTeamNotesPanel({ players }) {
  const [notes, setNotes] = useState([]);
  const [status, setStatus] = useState("loading");
  const [feedback, setFeedback] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const playerNames = useMemo(
    () => new Map(players.map((player) => [player.id, player.name])),
    [players],
  );

  const refresh = useCallback(async () => {
    if (!navigator.onLine) return false;
    try {
      const next = await loadOwnerTeamNotes();
      setNotes(next);
      setStatus("ready");
      setFeedback("");
      return true;
    } catch (loadError) {
      setStatus("error");
      setFeedback(loadError?.message || "Could not load team notes.");
      return false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const remove = async (note) => {
    if (!confirm(`Delete ${note.playerName}'s team note?`)) return;
    setDeletingId(note.id);
    setFeedback("Deleting note…");
    try {
      await deleteOwnerTeamNote(note.id);
      setNotes((current) =>
        current.filter((entry) => entry.id !== note.id),
      );
      setFeedback("Team note deleted.");
    } catch (deleteError) {
      setFeedback(deleteError?.message || "Could not delete team note.");
    } finally {
      setDeletingId("");
    }
  };

  return (
    <section className="mt-8 rounded-3xl border border-[#B1D3B9] bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-bold uppercase text-[#659287]">Moderation</p>
          <h2 className="mt-1 text-2xl font-bold">Team notes</h2>
          <p className="mt-1 text-sm text-[#527A70]">
            Review or remove player messages. Notes expire automatically after
            14 days.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={status === "loading"}
          className={softButton}
        >
          <RefreshCw
            size={14}
            className={status === "loading" ? "animate-spin" : ""}
          />
          Refresh notes
        </button>
      </div>

      {feedback ? (
        <p className="mt-4 rounded-xl bg-[#F2F8ED] p-3 text-sm font-bold text-[#527A70]">
          {feedback}
        </p>
      ) : null}

      <div className="mt-4 divide-y divide-[#E6F2DD] overflow-hidden rounded-2xl border border-[#E6F2DD]">
        {notes.length ? (
          notes.map((note) => (
            <article
              key={note.id}
              className="flex flex-col justify-between gap-3 bg-[#F8FBF5] p-4 sm:flex-row sm:items-start"
            >
              <div className="min-w-0">
                <p className="font-bold">
                  {playerNames.get(note.playerKey) || note.playerName}
                </p>
                <p className="mt-1 break-words text-sm">{note.body}</p>
                <p className="mt-2 text-xs text-[#659287]">
                  {displayTimestamp(note.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void remove(note)}
                disabled={Boolean(deletingId)}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {deletingId === note.id ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                Delete
              </button>
            </article>
          ))
        ) : (
          <p className="bg-[#F8FBF5] p-6 text-center text-sm font-bold text-[#659287]">
            {status === "loading" ? "Loading team notes…" : "No team notes yet."}
          </p>
        )}
      </div>
    </section>
  );
}
