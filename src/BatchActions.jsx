import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ClipboardPaste,
  LoaderCircle,
  Split,
  X,
} from "lucide-react";
import {
  allocationsForBatch,
  createPastedBatchRecords,
  isBatchLogAlreadyPasted,
  loadRememberedBatchLog,
  parseBatchLog,
} from "./allocationUtils.js";
import ProfitAllocationEditor from "./ProfitAllocationEditor.jsx";
import { format, summarize } from "./tracker.js";

const primary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#527A70] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#29453E] disabled:cursor-not-allowed disabled:opacity-60";
const soft =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[#B1D3B9] bg-white px-4 py-2.5 text-sm font-bold hover:bg-[#F2F8ED]";

function DialogShell({ title, children, onClose }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-[#29453E]/70 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-action-dialog-title"
    >
      <section className="my-auto max-h-[calc(100vh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-3xl bg-[#F8FBF5] p-5 shadow-xl sm:p-6">
        <header className="flex items-center justify-between gap-3">
          <h2 id="batch-action-dialog-title" className="text-xl font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[#527A70] hover:bg-[#E6F2DD]"
            aria-label={`Close ${title}`}
          >
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function BatchAllocationModal({
  batch,
  transactions,
  players,
  settings,
  onSave,
  onClose,
}) {
  const originPlayerId =
    batch[0].allocationOriginPlayerId || batch[0].playerId;
  const [allocations, setAllocations] = useState(() =>
    allocationsForBatch(transactions, batch),
  );
  const rawSummary = useMemo(
    () =>
      summarize(
        batch.map((entry) => ({ ...entry, allocationPercent: 100 })),
        settings,
      ),
    [batch, settings],
  );

  return (
    <DialogShell title="Move or split saved profit" onClose={onClose}>
      <p className="mt-2 text-sm text-[#659287]">
        Raw quantities and timestamp stay linked. Only each player&apos;s net
        profit share changes, so the combined total remains exact.
      </p>
      <div className="mt-4 rounded-2xl bg-[#29453E] p-4 text-white">
        <p className="text-xs font-bold uppercase text-[#B1D3B9]">
          Full batch value
        </p>
        <strong className="mt-1 block text-2xl">
          ₱{format(rawSummary.netPhp)}
        </strong>
        <span className="text-sm text-[#E6F2DD]">
          {format(rawSummary.netTro)} TRO after shovel
        </span>
      </div>
      <div className="mt-4">
        <ProfitAllocationEditor
          players={players}
          sourcePlayerId={originPlayerId}
          allocations={allocations}
          onChange={setAllocations}
          netTro={rawSummary.netTro}
          netPhp={rawSummary.netPhp}
          title="Linked player shares"
        />
      </div>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className={soft}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(allocations)}
          className={primary}
        >
          <Split size={16} /> Save allocation
        </button>
      </div>
    </DialogShell>
  );
}

export function PasteBatchModal({
  player,
  transactions,
  settings,
  onSave,
  onClose,
}) {
  const [value, setValue] = useState(loadRememberedBatchLog);
  const [reading, setReading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const parsed = useMemo(() => {
    if (!value.trim()) return { payload: null, error: "" };
    try {
      return { payload: parseBatchLog(value), error: "" };
    } catch (error) {
      return { payload: null, error: error.message };
    }
  }, [value]);
  const preview = useMemo(
    () =>
      parsed.payload
        ? summarize(
            createPastedBatchRecords(parsed.payload, player.id),
            settings,
          )
        : null,
    [parsed.payload, player.id, settings],
  );
  const alreadyPasted = parsed.payload
    ? isBatchLogAlreadyPasted(
        transactions,
        player.id,
        parsed.payload.sourceBatchId,
      )
    : false;

  const readClipboard = async () => {
    setReading(true);
    setFeedback("");
    try {
      const text = await navigator.clipboard.readText();
      setValue(text);
    } catch {
      setFeedback("Clipboard access was blocked. Paste the TRO log below.");
    } finally {
      setReading(false);
    }
  };

  const save = () => {
    if (!parsed.payload) return;
    if (
      alreadyPasted &&
      !confirm(
        "This exact copied log is already saved for this player. Paste another independent copy anyway?",
      )
    ) {
      return;
    }
    onSave(createPastedBatchRecords(parsed.payload, player.id));
  };

  return (
    <DialogShell title={`Paste saved log to ${player.name}`} onClose={onClose}>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#B1D3B9] bg-white p-4">
        <div>
          <p className="font-bold">TRO structured log</p>
          <p className="mt-1 text-xs text-[#659287]">
            Values are validated and previewed before anything is saved.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void readClipboard()}
          disabled={reading}
          className={soft}
        >
          {reading ? (
            <LoaderCircle size={15} className="animate-spin" />
          ) : (
            <ClipboardPaste size={15} />
          )}
          Read clipboard
        </button>
      </div>
      <label className="mt-4 block text-sm font-bold">
        Paste log
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          rows="6"
          spellCheck="false"
          className="mt-2 w-full resize-y rounded-xl border border-[#B1D3B9] bg-white p-3 font-mono text-xs outline-none focus:border-[#527A70]"
          placeholder="TRO-TRACKER-LOG-V1"
        />
      </label>
      {parsed.error ? (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">
          {parsed.error}
        </p>
      ) : null}
      {feedback ? (
        <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">
          {feedback}
        </p>
      ) : null}
      {parsed.payload && preview ? (
        <section className="mt-4 rounded-2xl bg-[#E6F2DD] p-4">
          <p className="text-xs font-bold uppercase text-[#659287]">
            Preview from {parsed.payload.sourcePlayerName}
          </p>
          <strong className="mt-1 block text-2xl">
            ₱{format(preview.netPhp)} · {format(preview.netTro)} TRO
          </strong>
          <p className="mt-2 text-xs text-[#527A70]">
            {parsed.payload.records.length} line item
            {parsed.payload.records.length === 1 ? "" : "s"} · Original{" "}
            allocation {parsed.payload.sourceAllocationPercent}%
          </p>
        </section>
      ) : null}
      <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-900">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        Paste creates a new independent 100% entry and can increase the tracker
        total. To share one real batch without doubling it, use Move/Split on
        the original Saved timestamp.
      </p>
      {alreadyPasted ? (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">
          This copied log already exists for {player.name}.
        </p>
      ) : null}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className={soft}>
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!parsed.payload}
          className={primary}
        >
          <ClipboardPaste size={16} /> Paste as new entry
        </button>
      </div>
    </DialogShell>
  );
}
