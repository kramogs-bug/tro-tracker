import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Expand,
  ImageIcon,
  Inbox,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import { SharedProfitSummary } from "./ProfitInsights.jsx";
import ReferenceImagePanel from "./ReferenceImagePanel.jsx";
import ProfitAllocationEditor from "./ProfitAllocationEditor.jsx";
import {
  allocateBatchRecords,
  defaultProfitAllocations,
} from "./allocationUtils.js";
import { PeriodRecapModal } from "./PeriodRecap.jsx";
import { markRecapSeen, wasRecapSeen } from "./recapStorage.js";
import {
  OwnerTeamNotesPanel,
  PlayerTeamBoard,
} from "./TeamBoard.jsx";
import {
  createSubmissionTransactions,
  estimateSubmission,
  findDuplicateBatch,
  normalizeQuantities,
  projectProfitSnapshot,
  quantitySignature,
  snapshotRatiosForDate,
  submissionAlreadyApplied,
} from "./entryUtils.js";
import {
  createClientSubmissionId,
  loadProfitSubmissionEvidence,
  loadPlayerProfitSubmissions,
  prepareSubmissionReference,
  reviewProfitSubmission,
  submitProfitEntry,
} from "./profitSubmissions.js";
import { SHELL_ITEMS } from "./sellablesData.js";
import {
  format,
  localDate,
  localDateTimeInput,
  ratiosForDate,
} from "./tracker.js";

const input =
  "w-full rounded-xl border border-[#B1D3B9] bg-white px-3 py-2.5 text-center font-bold outline-none focus:border-[#527A70]";
const primary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#527A70] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#29453E] disabled:cursor-not-allowed disabled:opacity-60";
const soft =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[#B1D3B9] bg-white px-4 py-2.5 text-sm font-bold hover:bg-[#F2F8ED] disabled:cursor-not-allowed disabled:opacity-60";

const blankQuantities = () =>
  Object.fromEntries(SHELL_ITEMS.map((item) => [item.name, ""]));

function displayTimestamp(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function statusStyle(status) {
  if (status === "approved") return "bg-green-100 text-green-800";
  if (status === "rejected") return "bg-red-100 text-red-800";
  return "bg-amber-100 text-amber-800";
}

function SubmissionStatusList({ submissions }) {
  if (!submissions.length) return null;
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-[#B1D3B9] bg-white">
      <header className="border-b border-[#E6F2DD] p-4">
        <h3 className="font-bold">Your recent submissions</h3>
        <p className="mt-1 text-xs text-[#659287]">
          Pending entries remain outside the confirmed payout balance.
        </p>
      </header>
      <div className="divide-y divide-[#E6F2DD]">
        {submissions.map((submission) => (
          <article
            key={submission.id}
            className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"
          >
            <div>
              <p className="text-sm font-bold">
                Entry timestamp:{" "}
                {displayTimestamp(
                  submission.approvedEntryAt || submission.entryAt,
                )}
              </p>
              <p className="mt-1 text-xs text-[#659287]">
                Submitted {displayTimestamp(submission.createdAt)}
              </p>
              {submission.hasReferenceImage &&
              submission.status === "pending" ? (
                <p className="mt-1 text-xs font-bold text-[#527A70]">
                  Reference screenshot attached
                </p>
              ) : null}
              {submission.status === "approved" ? (
                <p className="mt-1 text-xs font-bold text-green-700">
                  Confirmed in your tracker summary
                </p>
              ) : null}
              {submission.reviewNote ? (
                <p className="mt-2 text-xs font-bold text-[#527A70]">
                  Note from reviewer: {submission.reviewNote}
                </p>
              ) : null}
            </div>
            <span
              className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ${statusStyle(submission.status)}`}
            >
              {submission.status === "pending"
                ? "Not confirmed"
                : submission.status}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

function PlayerSubmissionForm({
  snapshot,
  shareId,
  submissionToken,
  submissions,
  onSubmitted,
}) {
  const [quantities, setQuantities] = useState(blankQuantities);
  const [shovels, setShovels] = useState("");
  const [entryTimestamp, setEntryTimestamp] = useState(localDateTimeInput);
  const [note, setNote] = useState("");
  const [clientSubmissionId, setClientSubmissionId] = useState(
    createClientSubmissionId,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [confirmedSignature, setConfirmedSignature] = useState("");
  const [referenceResetKey, setReferenceResetKey] = useState(0);
  const [referenceFile, setReferenceFile] = useState(null);

  const parsedQuantities = normalizeQuantities(quantities);
  const parsedShovels = Math.max(0, Math.floor(Number(shovels) || 0));
  const entryDate = /^\d{4}-\d{2}-\d{2}/.test(entryTimestamp)
    ? entryTimestamp.slice(0, 10)
    : localDate();
  const ratios = snapshotRatiosForDate(snapshot, entryDate);
  const estimate = estimateSubmission(
    parsedQuantities,
    parsedShovels,
    ratios,
  );
  const signature = quantitySignature(parsedQuantities, parsedShovels);
  const duplicateSubmission = submissions.find(
    (submission) =>
      submission.status === "pending" &&
      quantitySignature(submission.quantities, submission.shovels) ===
        signature &&
      Object.values(parsedQuantities).some((value) => value > 0),
  );

  const save = async (event) => {
    event.preventDefault();
    if (
      !Object.values(parsedQuantities).some((value) => value > 0) &&
      parsedShovels === 0
    ) {
      setFeedback("Enter at least one shell or shovel quantity.");
      return;
    }
    const selectedTime = new Date(entryTimestamp);
    if (Number.isNaN(selectedTime.getTime())) {
      setFeedback("Choose a valid entry date and time.");
      return;
    }
    if (duplicateSubmission && confirmedSignature !== signature) {
      setConfirmedSignature(signature);
      setFeedback(
        "Possible duplicate of an existing pending entry. Review it, then press Submit anyway.",
      );
      return;
    }

    setIsSaving(true);
    setFeedback(
      referenceFile
        ? "Compressing and attaching reference screenshot…"
        : "Submitting for approval…",
    );
    try {
      const referenceImage = referenceFile
        ? await prepareSubmissionReference(referenceFile)
        : null;
      await submitProfitEntry({
        shareId,
        submissionToken,
        clientSubmissionId,
        quantities: parsedQuantities,
        shovels: parsedShovels,
        entryDate,
        entryAt: selectedTime.toISOString(),
        note,
        referenceImage,
      });
      setQuantities(blankQuantities());
      setShovels("");
      setEntryTimestamp(localDateTimeInput());
      setNote("");
      setClientSubmissionId(createClientSubmissionId());
      setConfirmedSignature("");
      setReferenceFile(null);
      setReferenceResetKey((current) => current + 1);
      setFeedback(
        "Submitted. It is visible in your projected summary but is not confirmed yet.",
      );
      await onSubmitted();
    } catch (saveError) {
      setFeedback(saveError?.message || "Could not submit this entry.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 pb-8">
      <section className="rounded-3xl border border-[#B1D3B9] bg-white p-5 sm:p-7">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#E6F2DD] text-[#527A70]">
            <Send size={20} />
          </span>
          <div>
            <h2 className="text-xl font-bold">Submit shell entry</h2>
            <p className="mt-1 text-sm text-[#659287]">
              Your entry will appear as Not confirmed until the tracker owner
              approves it.
            </p>
          </div>
        </div>

        <form onSubmit={save} className="mt-6">
          <ReferenceImagePanel
            resetKey={referenceResetKey}
            compact
            temporaryUpload
            onFileChange={setReferenceFile}
          />
          <label className="mt-4 block text-sm font-bold">
            Entry date and time
            <input
              required
              type="datetime-local"
              step="60"
              value={entryTimestamp}
              onChange={(event) => setEntryTimestamp(event.target.value)}
              className={`mt-2 ${input} text-left`}
            />
          </label>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {SHELL_ITEMS.map((item) => (
              <label
                key={item.name}
                className="grid grid-cols-[1fr_7rem] items-center gap-3 rounded-xl bg-[#F8FBF5] p-3 text-sm font-bold"
              >
                <span>
                  {item.name}
                  <small className="mt-0.5 block font-normal text-[#659287]">
                    {item.price} G each
                  </small>
                </span>
                <input
                  type="number"
                  min="0"
                  max="9999999"
                  step="1"
                  inputMode="numeric"
                  value={quantities[item.name]}
                  onChange={(event) =>
                    setQuantities((current) => ({
                      ...current,
                      [item.name]: event.target.value,
                    }))
                  }
                  className={input}
                  aria-label={`${item.name} quantity`}
                />
              </label>
            ))}
          </div>
          <label className="mt-3 grid grid-cols-[1fr_7rem] items-center gap-3 rounded-xl bg-[#F8FBF5] p-3 text-sm font-bold">
            Shovels
            <input
              type="number"
              min="0"
              max="9999999"
              step="1"
              inputMode="numeric"
              value={shovels}
              onChange={(event) => setShovels(event.target.value)}
              className={input}
            />
          </label>
          <label className="mt-4 block text-sm font-bold">
            Optional note
            <textarea
              maxLength={200}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-2 min-h-20 w-full rounded-xl border border-[#B1D3B9] bg-white p-3 outline-none focus:border-[#527A70]"
              placeholder="Anything the tracker owner should know"
            />
          </label>

          <aside className="mt-4 rounded-2xl bg-[#29453E] p-4 text-white">
            <p className="text-xs font-bold uppercase text-[#B1D3B9]">
              Estimated if approved
            </p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
              <div>
                <strong className="block text-2xl">
                  {format(estimate.netTro)} TRO
                </strong>
                <span className="text-[#E6F2DD]">
                  ₱{format(estimate.netPhp)} net
                </span>
              </div>
              <span className="text-right text-xs text-[#B1D3B9]">
                {format(estimate.gralats)} G
                <br />
                {format(estimate.shovels)} shovels
              </span>
            </div>
          </aside>

          {duplicateSubmission ? (
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">
              <AlertTriangle size={17} className="mt-0.5 shrink-0" />
              Same quantities already exist in a pending submission from{" "}
              {displayTimestamp(duplicateSubmission.createdAt)}.
            </p>
          ) : null}
          {feedback ? (
            <p className="mt-4 rounded-xl bg-[#E6F2DD] p-3 text-center text-sm font-bold text-[#527A70]">
              {feedback}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={isSaving}
            className={`mt-4 w-full ${primary}`}
          >
            {isSaving ? (
              <LoaderCircle size={17} className="animate-spin" />
            ) : (
              <Send size={17} />
            )}
            {duplicateSubmission && confirmedSignature === signature
              ? "Submit anyway"
              : "Submit for approval"}
          </button>
        </form>
      </section>
      <SubmissionStatusList submissions={submissions} />
    </div>
  );
}

export function SharedPlayerPortal({
  snapshot,
  share,
  shareId,
  submissionToken,
}) {
  const [activeTab, setActiveTab] = useState("summary");
  const [submissions, setSubmissions] = useState([]);
  const [status, setStatus] = useState("loading");
  const [activeRecap, setActiveRecap] = useState(null);
  const monthlyRecap = snapshot.recaps?.monthly || null;
  const weeklyRecap = snapshot.recaps?.weekly || null;

  useEffect(() => {
    const available = [monthlyRecap, weeklyRecap].filter(Boolean);
    const unseen = available
      .find((recap) => !wasRecapSeen(shareId, recap.key));
    if (unseen) {
      available
        .filter((recap) => recap.key !== unseen.key)
        .forEach((recap) => markRecapSeen(shareId, recap.key));
      setActiveRecap((current) => current || unseen);
    }
  }, [monthlyRecap, shareId, weeklyRecap]);

  const refresh = useCallback(async () => {
    if (!navigator.onLine) return false;
    try {
      const next = await loadPlayerProfitSubmissions(
        shareId,
        submissionToken,
      );
      setSubmissions(next);
      setStatus("ready");
      return true;
    } catch {
      setStatus("error");
      return false;
    }
  }, [shareId, submissionToken]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);

  const projection = useMemo(
    () => projectProfitSnapshot(snapshot, submissions),
    [snapshot, submissions],
  );

  return (
    <main className="min-h-screen bg-[#E6F2DD] text-[#29453E]">
      <div className="mx-auto max-w-5xl px-4 pt-5">
        <div
          className="grid grid-cols-3 gap-2 rounded-2xl border border-[#B1D3B9] bg-white p-2"
          role="tablist"
          aria-label="Player profit portal"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "summary"}
            onClick={() => setActiveTab("summary")}
            className={`rounded-xl px-4 py-3 text-sm font-bold ${
              activeTab === "summary"
                ? "bg-[#527A70] text-white"
                : "text-[#527A70]"
            }`}
          >
            Profit summary
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "team"}
            onClick={() => setActiveTab("team")}
            className={`rounded-xl px-2 py-3 text-sm font-bold sm:px-4 ${
              activeTab === "team"
                ? "bg-[#527A70] text-white"
                : "text-[#527A70]"
            }`}
          >
            Team board
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "submit"}
            onClick={() => setActiveTab("submit")}
            className={`rounded-xl px-4 py-3 text-sm font-bold ${
              activeTab === "submit"
                ? "bg-[#527A70] text-white"
                : "text-[#527A70]"
            }`}
          >
            Submit entry
          </button>
        </div>
        {status === "error" ? (
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800"
          >
            <RefreshCw size={14} /> Retry submission status
          </button>
        ) : null}
      </div>

      {activeTab === "summary" ? (
        <SharedProfitSummary
          snapshot={snapshot}
          share={share}
          projectedSnapshot={projection.projectedSnapshot}
          pendingSummary={projection.pendingSummary}
          pendingCount={projection.pendingCount}
          embedded
        />
      ) : activeTab === "team" ? (
        <PlayerTeamBoard
          snapshot={snapshot}
          shareId={shareId}
          submissionToken={submissionToken}
          onOpenRecap={setActiveRecap}
        />
      ) : (
        <PlayerSubmissionForm
          snapshot={snapshot}
          shareId={shareId}
          submissionToken={submissionToken}
          submissions={submissions}
          onSubmitted={refresh}
        />
      )}
      {activeRecap ? (
        <PeriodRecapModal
          recap={activeRecap}
          playerName={snapshot.player.name}
          onClose={() => {
            markRecapSeen(shareId, activeRecap.key);
            setActiveRecap(null);
          }}
        />
      ) : null}
    </main>
  );
}

function SubmissionEvidencePreview({ submission }) {
  const [evidence, setEvidence] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (evidence || loading) return;
    setLoading(true);
    setError("");
    try {
      const next = await loadProfitSubmissionEvidence(submission.id);
      if (!next) {
        setError("Reference screenshot is no longer available.");
        return;
      }
      setEvidence(next);
    } catch (loadError) {
      setError(loadError?.message || "Could not load reference screenshot.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mt-4 rounded-2xl border border-dashed border-[#88BDA4] bg-[#F8FBF5] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ImageIcon size={17} className="text-[#527A70]" />
          <div>
            <p className="text-sm font-bold">Player reference screenshot</p>
            <p className="text-xs text-[#659287]">
              Loaded only when requested; deleted after review.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className={soft}
        >
          {loading ? (
            <LoaderCircle size={15} className="animate-spin" />
          ) : (
            <ImageIcon size={15} />
          )}
          {evidence ? "Screenshot loaded" : "View screenshot"}
        </button>
      </div>
      {error ? (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">
          {error}
        </p>
      ) : null}
      {evidence ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="group relative block w-full overflow-hidden rounded-xl border border-[#E6F2DD] bg-[#29453E]/5"
            aria-label="Open player reference screenshot"
          >
            <img
              src={evidence.dataUrl}
              alt="Player-submitted trade reference"
              className="max-h-72 w-full object-contain"
            />
            <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-lg bg-white/95 px-2 py-1 text-xs font-bold text-[#527A70] shadow">
              <Expand size={14} /> Full size
            </span>
          </button>
          <p className="mt-2 text-right text-[11px] text-[#659287]">
            Temporary compressed copy ·{" "}
            {Math.max(1, Math.round(evidence.size / 1024))} KB
          </p>
        </div>
      ) : null}
      {expanded && evidence ? (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-[#29453E]/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Full-size player reference screenshot"
        >
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="absolute right-4 top-4 rounded-xl bg-white p-3 text-[#29453E]"
            aria-label="Close player reference screenshot"
          >
            <X size={20} />
          </button>
          <img
            src={evidence.dataUrl}
            alt="Full-size player-submitted trade reference"
            className="max-h-full max-w-full object-contain"
          />
        </div>
      ) : null}
    </section>
  );
}

function SubmissionReviewCard({
  submission,
  player,
  state,
  cloud,
  onReviewed,
}) {
  const [quantities, setQuantities] = useState(() =>
    Object.fromEntries(
      SHELL_ITEMS.map((item) => [
        item.name,
        String(
          (submission.approvedQuantities || submission.quantities)[
            item.name
          ] || "",
        ),
      ]),
    ),
  );
  const [shovels, setShovels] = useState(
    String(
      (submission.approvedShovels === null
        ? submission.shovels
        : submission.approvedShovels) || "",
    ),
  );
  const [entryTimestamp, setEntryTimestamp] = useState(() =>
    localDateTimeInput(submission.entryAt),
  );
  const [reviewNote, setReviewNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [allocations, setAllocations] = useState(() =>
    defaultProfitAllocations(player.id),
  );

  const parsedQuantities = normalizeQuantities(quantities);
  const parsedShovels = Math.max(0, Math.floor(Number(shovels) || 0));
  const entryDate = /^\d{4}-\d{2}-\d{2}/.test(entryTimestamp)
    ? entryTimestamp.slice(0, 10)
    : submission.entryDate;
  const ratios = ratiosForDate(player, entryDate, state.settings);
  const estimate = estimateSubmission(
    parsedQuantities,
    parsedShovels,
    ratios,
  );
  const alreadyApplied = submissionAlreadyApplied(
    state.transactions,
    submission.id,
  );
  const duplicate = findDuplicateBatch(
    state.transactions,
    player.id,
    parsedQuantities,
    parsedShovels,
    { excludeSourceSubmissionId: submission.id },
  );

  const approve = async () => {
    const transactions = createSubmissionTransactions(
      submission,
      state,
      {
        quantities: parsedQuantities,
        shovels: parsedShovels,
        entryTimestamp,
        entryDate,
      },
    );
    if (!transactions.length) {
      setFeedback("Approved entry cannot be empty.");
      return;
    }
    const allocatedTransactions = allocateBatchRecords(
      transactions,
      allocations,
      { originPlayerId: player.id },
    );
    const creditedRows = allocations.filter(
      (allocation) => Number(allocation.percent) > 0,
    );
    const allocationReviewNote =
      creditedRows.length === 1 &&
      creditedRows[0].playerId === player.id &&
      Number(creditedRows[0].percent) === 100
        ? ""
        : `Profit allocation: ${creditedRows
            .map((allocation) => {
              const creditedPlayer = state.players.find(
                (entry) => entry.id === allocation.playerId,
              );
              return `${creditedPlayer?.name || "Player"} ${allocation.percent}%`;
            })
            .join(", ")}`;
    const finalReviewNote = [reviewNote.trim(), allocationReviewNote]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 200);
    setBusy("approve");
    setFeedback("Saving approved entry to your cloud tracker…");
    try {
      const committed = await cloud.commitState((current) => {
        if (submissionAlreadyApplied(current.transactions, submission.id)) {
          return current;
        }
        return {
          ...current,
          transactions: [
            ...allocatedTransactions,
            ...current.transactions,
          ],
        };
      });
      if (!committed) {
        throw new Error(
          "Could not save to the cloud tracker. Check your connection and retry.",
        );
      }
      await reviewProfitSubmission({
        submissionId: submission.id,
        status: "approved",
        reviewNote: finalReviewNote,
        quantities: parsedQuantities,
        shovels: parsedShovels,
        entryDate,
        entryAt: transactions[0].createdAt,
      });
      setFeedback("Approved and added to the confirmed tracker.");
      await onReviewed();
    } catch (reviewError) {
      setFeedback(
        reviewError?.message ||
          "The entry was saved locally; retry to finalize approval.",
      );
    } finally {
      setBusy("");
    }
  };

  const reject = async () => {
    setBusy("reject");
    setFeedback("Rejecting submission…");
    try {
      await reviewProfitSubmission({
        submissionId: submission.id,
        status: "rejected",
        reviewNote,
      });
      setFeedback("Submission rejected.");
      await onReviewed();
    } catch (reviewError) {
      setFeedback(reviewError?.message || "Could not reject submission.");
    } finally {
      setBusy("");
    }
  };

  return (
    <article className="rounded-2xl border border-[#B1D3B9] bg-white p-4 sm:p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold">{player.name}</h3>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusStyle(submission.status)}`}
            >
              {submission.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-[#659287]">
            Submitted {displayTimestamp(submission.createdAt)} · Entry{" "}
            {displayTimestamp(
              submission.approvedEntryAt || submission.entryAt,
            )}
          </p>
          {submission.note ? (
            <p className="mt-2 text-sm text-[#527A70]">
              Player note: {submission.note}
            </p>
          ) : null}
        </div>
        {submission.status === "pending" ? (
          <button
            type="button"
            onClick={() => setEditing((current) => !current)}
            className={soft}
          >
            <Pencil size={15} /> {editing ? "Done editing" : "Edit before approval"}
          </button>
        ) : null}
      </div>

      {submission.hasReferenceImage ? (
        <SubmissionEvidencePreview submission={submission} />
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {SHELL_ITEMS.map((item) => (
          <label
            key={item.name}
            className="rounded-xl bg-[#F8FBF5] p-2 text-xs font-bold"
          >
            {item.name}
            <input
              type="number"
              min="0"
              max="9999999"
              step="1"
              disabled={!editing || submission.status !== "pending"}
              value={quantities[item.name]}
              onChange={(event) =>
                setQuantities((current) => ({
                  ...current,
                  [item.name]: event.target.value,
                }))
              }
              className={`mt-1 ${input}`}
            />
          </label>
        ))}
        <label className="rounded-xl bg-[#F8FBF5] p-2 text-xs font-bold">
          Shovels
          <input
            type="number"
            min="0"
            max="9999999"
            step="1"
            disabled={!editing || submission.status !== "pending"}
            value={shovels}
            onChange={(event) => setShovels(event.target.value)}
            className={`mt-1 ${input}`}
          />
        </label>
      </div>

      {editing && submission.status === "pending" ? (
        <label className="mt-3 block max-w-sm text-xs font-bold">
          Approved entry date and time
          <input
            type="datetime-local"
            step="60"
            value={entryTimestamp}
            onChange={(event) => setEntryTimestamp(event.target.value)}
            className={`mt-1 ${input} text-left`}
          />
        </label>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-[#E6F2DD] p-3">
          <p className="text-xs font-bold uppercase text-[#659287]">
            Net if approved
          </p>
          <strong className="mt-1 block">
            {format(estimate.netTro)} TRO · ₱{format(estimate.netPhp)}
          </strong>
        </div>
        <div className="rounded-xl bg-[#F8FBF5] p-3">
          <p className="text-xs font-bold uppercase text-[#659287]">
            Gralats
          </p>
          <strong className="mt-1 block">{format(estimate.gralats)} G</strong>
        </div>
        <div className="rounded-xl bg-[#F8FBF5] p-3">
          <p className="text-xs font-bold uppercase text-[#659287]">
            Shovel deduction
          </p>
          <strong className="mt-1 block">
            −{format(estimate.deduction)} TRO
          </strong>
        </div>
      </div>

      {submission.status === "pending" && !alreadyApplied ? (
        <div className="mt-4">
          <ProfitAllocationEditor
            players={state.players}
            sourcePlayerId={player.id}
            allocations={allocations}
            onChange={setAllocations}
            netTro={estimate.netTro}
            netPhp={estimate.netPhp}
            title="Allocation when approved"
            description="Keep 100% for this player, or move/split the confirmed profit before approval."
            compact
          />
        </div>
      ) : null}

      {duplicate ? (
        <p
          className={`mt-4 flex items-start gap-2 rounded-xl p-3 text-sm font-bold ${
            duplicate.kind === "exact"
              ? "bg-red-50 text-red-700"
              : "bg-amber-50 text-amber-800"
          }`}
        >
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          {duplicate.kind === "exact"
            ? "Exact shell and shovel quantities already exist"
            : "The same shell quantities already exist with a different shovel count"}
          {" — "}
          {displayTimestamp(duplicate.createdAt)}.
        </p>
      ) : null}
      {alreadyApplied && submission.status === "pending" ? (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">
          This entry is already in the tracker. Finalize its approval status
          instead of adding it again.
        </p>
      ) : null}

      {submission.status === "pending" ? (
        <>
          <label className="mt-4 block text-xs font-bold">
            Optional note to player
            <input
              maxLength={200}
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              className={`mt-1 ${input} text-left`}
              placeholder="Reason for an edit or rejection"
            />
          </label>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => void reject()}
              disabled={Boolean(busy) || alreadyApplied}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-bold text-red-700 disabled:opacity-60"
            >
              {busy === "reject" ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <XCircle size={16} />
              )}
              Reject
            </button>
            <button
              type="button"
              onClick={() => void approve()}
              disabled={Boolean(busy)}
              className={primary}
            >
              {busy === "approve" ? (
                <LoaderCircle size={16} className="animate-spin" />
              ) : (
                <CheckCircle2 size={16} />
              )}
              {alreadyApplied ? "Finalize approval" : "Approve entry"}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-4 text-xs font-bold text-[#659287]">
          Reviewed {displayTimestamp(submission.reviewedAt)}
          {submission.reviewNote ? ` · ${submission.reviewNote}` : ""}
        </p>
      )}
      {feedback ? (
        <p className="mt-3 rounded-xl bg-[#E6F2DD] p-3 text-center text-sm font-bold text-[#527A70]">
          {feedback}
        </p>
      ) : null}
    </article>
  );
}

export function PlayerSubmissionsTab({
  state,
  cloud,
  submissionsController,
}) {
  if (!cloud.session) {
    return (
      <section className="rounded-3xl border border-[#B1D3B9] bg-white p-8 text-center">
        <ShieldCheck size={34} className="mx-auto text-[#527A70]" />
        <h2 className="mt-4 text-xl font-bold">Cloud account required</h2>
        <p className="mt-2 text-sm text-[#659287]">
          Sign in to receive and approve entries submitted through player
          links.
        </p>
      </section>
    );
  }

  const submissions = submissionsController.submissions.filter(
    (submission) =>
      state.players.some((player) => player.id === submission.playerKey),
  );
  const pending = submissions.filter(
    (submission) => submission.status === "pending",
  );
  const reviewed = submissions.filter(
    (submission) => submission.status !== "pending",
  );

  return (
    <section>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="font-bold uppercase text-[#659287]">Player inputs</p>
          <h1 className="mt-1 text-3xl font-bold">Approval inbox</h1>
          <p className="mt-2 text-sm text-[#527A70]">
            Player entries stay outside confirmed balances until you approve
            them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void submissionsController.refresh()}
          className={soft}
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-[#29453E] p-4 text-white">
          <Inbox size={20} />
          <p className="mt-3 text-xs font-bold uppercase text-[#B1D3B9]">
            Pending
          </p>
          <strong className="mt-1 block text-2xl">{pending.length}</strong>
        </div>
        <div className="rounded-2xl border border-[#B1D3B9] bg-white p-4">
          <CheckCircle2 size={20} className="text-[#527A70]" />
          <p className="mt-3 text-xs font-bold uppercase text-[#659287]">
            Recently approved
          </p>
          <strong className="mt-1 block text-2xl">
            {
              reviewed.filter(
                (submission) => submission.status === "approved",
              ).length
            }
          </strong>
        </div>
        <div className="rounded-2xl border border-[#B1D3B9] bg-white p-4">
          <XCircle size={20} className="text-red-700" />
          <p className="mt-3 text-xs font-bold uppercase text-[#659287]">
            Recently rejected
          </p>
          <strong className="mt-1 block text-2xl">
            {
              reviewed.filter(
                (submission) => submission.status === "rejected",
              ).length
            }
          </strong>
        </div>
      </div>

      {submissionsController.status === "loading" ? (
        <p className="mt-5 flex items-center gap-2 rounded-xl bg-white p-4 text-sm font-bold">
          <LoaderCircle size={17} className="animate-spin" /> Loading player
          inputs…
        </p>
      ) : null}
      {submissionsController.error ? (
        <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">
          {submissionsController.error}
        </p>
      ) : null}

      <div className="mt-5 space-y-4">
        {pending.map((submission) => (
          <SubmissionReviewCard
            key={submission.id}
            submission={submission}
            player={state.players.find(
              (player) => player.id === submission.playerKey,
            )}
            state={state}
            cloud={cloud}
            onReviewed={submissionsController.refresh}
          />
        ))}
        {!pending.length && submissionsController.status !== "loading" ? (
          <p className="rounded-2xl border border-dashed border-[#B1D3B9] p-8 text-center text-sm text-[#659287]">
            No pending player inputs.
          </p>
        ) : null}
      </div>

      {reviewed.length ? (
        <section className="mt-8">
          <h2 className="text-xl font-bold">Recently reviewed</h2>
          <div className="mt-4 space-y-3">
            {reviewed.map((submission) => (
              <SubmissionReviewCard
                key={submission.id}
                submission={submission}
                player={state.players.find(
                  (player) => player.id === submission.playerKey,
                )}
                state={state}
                cloud={cloud}
                onReviewed={submissionsController.refresh}
              />
            ))}
          </div>
        </section>
      ) : null}
      <OwnerTeamNotesPanel players={state.players} />
    </section>
  );
}
