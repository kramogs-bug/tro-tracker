import { createElement, useMemo, useState } from "react";
import {
  AtSign,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Download,
  MailPlus,
  Pencil,
  Search,
  ShieldAlert,
  Trash2,
  UserRoundCheck,
  X,
} from "lucide-react";
import {
  createId,
  exportGmailCsv,
  GMAIL_STATUSES,
  localDate,
} from "./tracker.js";

const GMAIL_PATTERN = /^[^\s@]+@gmail\.com$/i;
const EMPTY_ACCOUNTS = [];
const input =
  "w-full rounded-xl border border-[#B1D3B9] bg-white px-3 py-2.5 font-bold outline-none focus:border-[#527A70]";
const primary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#527A70] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#29453E]";
const soft =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[#B1D3B9] bg-white px-4 py-2.5 text-sm font-bold hover:bg-[#F2F8ED]";

const STATUS_META = {
  available: {
    label: "Available",
    badge: "bg-emerald-100 text-emerald-800",
    card: "border-emerald-200 bg-emerald-50",
    icon: CheckCircle2,
  },
  ready: {
    label: "Ready to Dig",
    badge: "bg-sky-100 text-sky-800",
    card: "border-sky-200 bg-sky-50",
    icon: ClipboardCheck,
  },
  in_use: {
    label: "In Use",
    badge: "bg-amber-100 text-amber-800",
    card: "border-amber-200 bg-amber-50",
    icon: UserRoundCheck,
  },
  jailed: {
    label: "Jailed",
    badge: "bg-red-100 text-red-800",
    card: "border-red-200 bg-red-50",
    icon: ShieldAlert,
  },
};

function displayTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function download(content, name) {
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function AccountModal({ account, accounts, players, onSave, onClose }) {
  const [email, setEmail] = useState(account?.email || "");
  const [status, setStatus] = useState(account?.status || "available");
  const [playerId, setPlayerId] = useState(account?.playerId || "");
  const [note, setNote] = useState(account?.note || "");
  const [feedback, setFeedback] = useState("");

  const submit = (event) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!GMAIL_PATTERN.test(normalizedEmail)) {
      setFeedback("Maglagay ng valid @gmail.com address.");
      return;
    }
    if (
      accounts.some(
        (entry) =>
          entry.id !== account?.id && entry.email.toLowerCase() === normalizedEmail,
      )
    ) {
      setFeedback("Nasa tracker na ang Gmail account na ito.");
      return;
    }
    if (status === "in_use" && !playerId) {
      setFeedback("Pumili ng player para sa account na In Use.");
      return;
    }
    onSave({
      email: normalizedEmail,
      status,
      playerId: ["available", "ready"].includes(status)
        ? null
        : playerId || null,
      note: note.trim(),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#29453E]/60 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gmail-account-modal-title"
    >
      <section className="max-h-[calc(100vh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-2xl bg-[#F8FBF5] p-5">
        <header className="flex items-center justify-between">
          <h2 id="gmail-account-modal-title" className="text-xl font-bold">
            {account ? "Edit Gmail account" : "Add Gmail account"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>
        <form className="mt-5" onSubmit={submit}>
          <label className="block text-sm font-bold">
            Gmail address
            <input
              autoFocus
              required
              type="email"
              inputMode="email"
              autoComplete="off"
              maxLength="254"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={`mt-2 ${input}`}
              placeholder="account@gmail.com"
            />
          </label>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-bold">
              Status
              <select
                value={status}
                onChange={(event) => {
                  const nextStatus = event.target.value;
                  setStatus(nextStatus);
                  if (["available", "ready"].includes(nextStatus))
                    setPlayerId("");
                }}
                className={`mt-2 ${input}`}
              >
                {GMAIL_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {STATUS_META[value].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-bold">
              Assigned player
              <select
                value={playerId}
                onChange={(event) => {
                  const nextPlayerId = event.target.value;
                  setPlayerId(nextPlayerId);
                  if (nextPlayerId) setStatus("in_use");
                  else if (status === "in_use") setStatus("available");
                }}
                className={`mt-2 ${input}`}
              >
                <option value="">No player</option>
                {players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-4 block text-sm font-bold">
            Note (optional)
            <textarea
              maxLength="200"
              rows="3"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className={`mt-2 ${input} resize-none font-normal`}
              placeholder="Example: Main digging account"
            />
          </label>
          <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
            Gmail address at tracking details lang ang ilagay. Huwag mag-save ng
            password, OTP, o recovery code.
          </p>
          {feedback ? (
            <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">
              {feedback}
            </p>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className={soft}>
              Cancel
            </button>
            <button className={primary}>
              {account ? "Save changes" : "Add account"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function SummaryCard({ label, value, icon, className }) {
  return (
    <article className={`rounded-2xl border p-4 ${className}`}>
      {icon}
      <p className="mt-3 text-xs font-bold uppercase opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </article>
  );
}

export default function GmailAccountsTab({ state, setState }) {
  const accounts = state.gmailAccounts || EMPTY_ACCOUNTS;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [playerFilter, setPlayerFilter] = useState("all");
  const [modalAccount, setModalAccount] = useState(undefined);
  const [copiedId, setCopiedId] = useState(null);
  const [message, setMessage] = useState("");
  const playerMap = useMemo(
    () => new Map(state.players.map((player) => [player.id, player])),
    [state.players],
  );
  const counts = useMemo(
    () =>
      accounts.reduce(
        (result, account) => {
          result[account.status] += 1;
          return result;
        },
        { available: 0, ready: 0, in_use: 0, jailed: 0 },
      ),
    [accounts],
  );
  const filteredAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return accounts
      .filter((account) => {
        const playerName = account.playerId
          ? playerMap.get(account.playerId)?.name || ""
          : "";
        const matchesSearch =
          !query ||
          account.email.includes(query) ||
          account.note.toLowerCase().includes(query) ||
          playerName.toLowerCase().includes(query);
        const matchesStatus =
          statusFilter === "all" || account.status === statusFilter;
        const matchesPlayer =
          playerFilter === "all" ||
          (playerFilter === "unassigned"
            ? !account.playerId
            : account.playerId === playerFilter);
        return matchesSearch && matchesStatus && matchesPlayer;
      })
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [accounts, playerFilter, playerMap, search, statusFilter]);

  const saveAccount = (values) => {
    const now = new Date().toISOString();
    const editingId = modalAccount?.id;
    setState((current) => ({
      ...current,
      gmailAccounts: editingId
        ? (current.gmailAccounts || []).map((account) => {
            if (account.id !== editingId) return account;
            const statusChanged = account.status !== values.status;
            const playerChanged = account.playerId !== values.playerId;
            return {
              ...account,
              ...values,
              updatedAt: now,
              statusUpdatedAt: statusChanged ? now : account.statusUpdatedAt,
              assignedAt: values.playerId
                ? playerChanged
                  ? now
                  : account.assignedAt || now
                : null,
            };
          })
        : [
            {
              id: createId(),
              ...values,
              createdAt: now,
              updatedAt: now,
              statusUpdatedAt: now,
              assignedAt: values.playerId ? now : null,
            },
            ...(current.gmailAccounts || []),
          ],
    }));
    setMessage(editingId ? "Gmail account updated." : "Gmail account added.");
    setModalAccount(undefined);
  };

  const changeStatus = (account, status) => {
    if (status === "in_use" && !account.playerId) {
      setMessage("Pumili muna ng player para ma-mark na In Use.");
      setModalAccount(account);
      return;
    }
    const now = new Date().toISOString();
    setState((current) => ({
      ...current,
      gmailAccounts: (current.gmailAccounts || []).map((entry) =>
        entry.id === account.id
          ? {
              ...entry,
              status,
              playerId: ["available", "ready"].includes(status)
                ? null
                : entry.playerId,
              assignedAt: ["available", "ready"].includes(status)
                ? null
                : entry.assignedAt,
              updatedAt: now,
              statusUpdatedAt: now,
            }
          : entry,
      ),
    }));
    setMessage(`Marked ${account.email} as ${STATUS_META[status].label}.`);
  };

  const changePlayer = (account, playerId) => {
    const now = new Date().toISOString();
    const nextStatus = playerId
      ? "in_use"
      : account.status === "in_use"
        ? "available"
        : account.status;
    setState((current) => ({
      ...current,
      gmailAccounts: (current.gmailAccounts || []).map((entry) =>
        entry.id === account.id
          ? {
              ...entry,
              playerId: playerId || null,
              status: nextStatus,
              assignedAt: playerId ? now : null,
              updatedAt: now,
              statusUpdatedAt:
                nextStatus !== entry.status ? now : entry.statusUpdatedAt,
            }
          : entry,
      ),
    }));
    setMessage(
      playerId
        ? `${account.email} assigned to ${playerMap.get(playerId)?.name}.`
        : `${account.email} is now unassigned.`,
    );
  };

  const copyEmail = async (account) => {
    try {
      await navigator.clipboard.writeText(account.email);
      setCopiedId(account.id);
      setMessage("Gmail address copied.");
      setTimeout(() => setCopiedId(null), 1600);
    } catch {
      setMessage("Hindi ma-copy automatically. Piliin at i-copy ang address.");
    }
  };

  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-bold uppercase text-[#659287]">Account inventory</p>
          <h1 className="mt-1 text-3xl font-bold">Gmail accounts</h1>
          <p className="mt-2 text-sm text-[#527A70]">
            Track availability, digging readiness, jailed accounts, and player
            assignments.
          </p>
        </div>
        <button onClick={() => setModalAccount(null)} className={primary}>
          <MailPlus size={17} /> Add Gmail
        </button>
      </header>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryCard
          label="Total accounts"
          value={accounts.length}
          icon={<AtSign size={19} />}
          className="border-[#B1D3B9] bg-white"
        />
        {GMAIL_STATUSES.map((status) => {
          const meta = STATUS_META[status];
          return (
            <SummaryCard
              key={status}
              label={meta.label}
              value={counts[status]}
              icon={createElement(meta.icon, { size: 19 })}
              className={meta.card}
            />
          );
        })}
      </div>

      <section className="mt-6 rounded-2xl border border-[#B1D3B9] bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px]">
          <label className="relative block">
            <span className="sr-only">Search Gmail accounts</span>
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#659287]"
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={`${input} pl-10 font-normal`}
              placeholder="Search Gmail, player, or note"
            />
          </label>
          <label>
            <span className="sr-only">Filter by status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className={input}
            >
              <option value="all">All statuses</option>
              {GMAIL_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_META[status].label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by player</span>
            <select
              value={playerFilter}
              onChange={(event) => setPlayerFilter(event.target.value)}
              className={input}
            >
              <option value="all">All players</option>
              <option value="unassigned">Unassigned</option>
              {state.players.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {message ? (
          <p
            className="mt-3 rounded-xl bg-[#E6F2DD] px-3 py-2 text-sm font-bold text-[#527A70]"
            aria-live="polite"
          >
            {message}
          </p>
        ) : null}
      </section>

      <section className="mt-4 space-y-3">
        {filteredAccounts.map((account) => {
          const meta = STATUS_META[account.status];
          const player = account.playerId
            ? playerMap.get(account.playerId)
            : null;
          return (
            <article
              key={account.id}
              className="rounded-2xl border border-[#B1D3B9] bg-white p-4 [content-visibility:auto] sm:p-5"
            >
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="break-all text-lg">{account.email}</strong>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-bold ${meta.badge}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-bold text-[#527A70]">
                    {player ? `Used by ${player.name}` : "No player assigned"}
                  </p>
                  {account.note ? (
                    <p className="mt-1 text-sm text-[#659287]">{account.note}</p>
                  ) : null}
                  <p className="mt-2 text-xs text-[#659287]">
                    Added {displayTimestamp(account.createdAt)} · Updated{" "}
                    {displayTimestamp(account.updatedAt)}
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-[170px_190px_auto] sm:items-center">
                  <label>
                    <span className="sr-only">Status for {account.email}</span>
                    <select
                      value={account.status}
                      onChange={(event) =>
                        changeStatus(account, event.target.value)
                      }
                      className={`${input} py-2 text-sm`}
                    >
                      {GMAIL_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {STATUS_META[status].label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">
                      Assigned player for {account.email}
                    </span>
                    <select
                      value={account.playerId || ""}
                      onChange={(event) =>
                        changePlayer(account, event.target.value)
                      }
                      className={`${input} py-2 text-sm`}
                    >
                      <option value="">No player</option>
                      {state.players.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void copyEmail(account)}
                      className="rounded-lg bg-[#E6F2DD] p-2.5 text-[#527A70]"
                      aria-label={`Copy ${account.email}`}
                      title="Copy Gmail"
                    >
                      {copiedId === account.id ? (
                        <CheckCircle2 size={16} />
                      ) : (
                        <Copy size={16} />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setModalAccount(account)}
                      className="rounded-lg bg-[#E6F2DD] p-2.5 text-[#527A70]"
                      aria-label={`Edit ${account.email}`}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!confirm(`Delete ${account.email}?`)) return;
                        setState((current) => ({
                          ...current,
                          gmailAccounts: (current.gmailAccounts || []).filter(
                            (entry) => entry.id !== account.id,
                          ),
                        }));
                        setMessage("Gmail account deleted.");
                      }}
                      className="rounded-lg bg-red-50 p-2.5 text-red-700"
                      aria-label={`Delete ${account.email}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
        {!filteredAccounts.length ? (
          <div className="rounded-2xl border border-dashed border-[#88BDA4] bg-white/60 p-10 text-center">
            <AtSign className="mx-auto text-[#659287]" />
            <p className="mt-3 font-bold">
              {accounts.length
                ? "No accounts match these filters."
                : "Add your first Gmail account."}
            </p>
          </div>
        ) : null}
      </section>

      <section className="mt-8 flex flex-col gap-4 rounded-2xl bg-[#527A70] p-5 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-bold">Gmail inventory backup</p>
          <p className="mt-1 text-sm text-[#E6F2DD]">
            Included in automatic local save, JSON backup, and cloud sync.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            download(exportGmailCsv(state), `gmail-accounts-${localDate()}.csv`)
          }
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#527A70]"
        >
          <Download size={17} /> Export Gmail CSV
        </button>
      </section>

      {modalAccount !== undefined ? (
        <AccountModal
          key={modalAccount?.id || "new"}
          account={modalAccount}
          accounts={accounts}
          players={state.players}
          onSave={saveAccount}
          onClose={() => setModalAccount(undefined)}
        />
      ) : null}
    </>
  );
}
