import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  Cloud,
  CloudOff,
  Download,
  FileDown,
  LogOut,
  Pickaxe,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import AccountModal from "./AccountModal.jsx";
import { SHELL_ITEMS } from "./sellablesData.js";
import {
  createId,
  exportBackup,
  exportCsv,
  format,
  importBackup,
  loadState,
  localDate,
  parseQuantityExpression,
  saveState,
  summarize,
  summarizePeriods,
  toPhp,
} from "./tracker.js";
import { useCloudTracker } from "./useCloudTracker.js";

const input =
  "w-full rounded-xl border border-[#B1D3B9] bg-white px-3 py-2.5 text-center font-bold outline-none focus:border-[#527A70]";
const primary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[#527A70] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#29453E]";
const soft =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[#B1D3B9] bg-white px-4 py-2.5 text-sm font-bold hover:bg-[#F2F8ED]";
const emptyQuantities = () =>
  Object.fromEntries(SHELL_ITEMS.map((item) => [item.name, ""]));
const cleanExpression = (value) =>
  String(value).replace(/[^\d+\-*/().\s]/g, "");

function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
function displayTimestamp(value) {
  return new Date(value).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function Modal({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#29453E]/60 p-3"
      role="dialog"
      aria-modal="true"
    >
      <section className="w-full max-w-lg rounded-2xl bg-[#F8FBF5] p-5">
        <header className="flex items-center justify-between">
          <h2 className="text-xl font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close">
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Stat({ label, value, icon }) {
  return (
    <article className="rounded-2xl border border-[#B1D3B9] bg-white p-4">
      {icon}
      <p className="mt-3 text-xs font-bold uppercase text-[#659287]">{label}</p>
      <p className="mt-1 truncate text-xl font-bold">{value}</p>
    </article>
  );
}

function CloudStatus({ cloud }) {
  const online =
    cloud.session &&
    cloud.syncStatus !== "offline" &&
    cloud.syncStatus !== "error";
  return (
    <span
      className={`hidden max-w-56 items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold sm:inline-flex ${online ? "bg-[#E6F2DD] text-[#527A70]" : "bg-white text-[#659287]"}`}
      title={cloud.syncMessage}
    >
      {online ? <Cloud size={15} /> : <CloudOff size={15} />}
      <span className="truncate">
        {cloud.session
          ? cloud.syncStatus === "saved"
            ? cloud.session.user.email
            : cloud.syncMessage || "Cloud account"
          : "Local only"}
      </span>
    </span>
  );
}
function PlayerForm({ onSave, onClose }) {
  const [name, setName] = useState("");
  return (
    <Modal title="Add player" onClose={onClose}>
      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onSave(name.trim());
        }}
      >
        <label className="font-bold">
          Player name
          <input
            autoFocus
            required
            maxLength="50"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={`mt-2 ${input} text-left`}
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={soft}>
            Cancel
          </button>
          <button className={primary}>Add player</button>
        </div>
      </form>
    </Modal>
  );
}
function RatioForm({ settings, onSave, onClose }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      Object.entries(settings).map(([key, value]) => [key, String(value)]),
    ),
  );
  const field = (key, label) => (
    <label className="text-sm font-bold">
      {label}
      <input
        required
        type="number"
        min=".01"
        step="any"
        value={values[key]}
        onChange={(event) =>
          setValues({ ...values, [key]: event.target.value })
        }
        className={`mt-2 ${input}`}
      />
    </label>
  );
  return (
    <Modal title="Conversion ratios" onClose={onClose}>
      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault();
          const next = Object.fromEntries(
            Object.entries(values).map(([key, value]) => [key, Number(value)]),
          );
          if (Object.values(next).every((value) => value > 0)) onSave(next);
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          {field("gralatsPerTro", "Gralats per TRO")}
          {field("shovelTro", "TRO per shovel")}
          {field("phpTro", "TRO amount")}
          {field("phpAmount", "PHP equivalent")}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={soft}>
            Cancel
          </button>
          <button className={primary}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function VisibleRatioEditor({ settings, onSave }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      Object.entries(settings).map(([key, value]) => [key, String(value)]),
    ),
  );
  useEffect(() => {
    setValues(
      Object.fromEntries(
        Object.entries(settings).map(([key, value]) => [key, String(value)]),
      ),
    );
  }, [settings]);
  const fields = [
    ["gralatsPerTro", "Gralats / TRO"],
    ["shovelTro", "TRO / shovel"],
    ["phpTro", "TRO amount"],
    ["phpAmount", "PHP value"],
  ];
  return (
    <form
      className="mt-5 rounded-2xl border-2 border-[#88BDA4] bg-white p-4 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        const next = Object.fromEntries(
          Object.entries(values).map(([key, value]) => [key, Number(value)]),
        );
        if (
          Object.values(next).every(
            (value) => Number.isFinite(value) && value > 0,
          )
        )
          onSave(next);
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-bold">
            <Settings size={17} /> {"Player conversion ratios"}
          </p>
          <p className="mt-1 text-xs text-[#659287]">
            These ratios apply only to this player's output.
          </p>
        </div>
        <button className={primary}>
          <Save size={15} /> Save ratios
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {fields.map(([key, label]) => (
          <label key={key} className="text-xs font-bold text-[#527A70]">
            {label}
            <input
              required
              type="number"
              min="0.01"
              step="any"
              value={values[key]}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
              className={`mt-1.5 ${input}`}
            />
          </label>
        ))}
      </div>
    </form>
  );
}

function PlayerCalculator({ player, state: rawState, setState, onBack }) {
  const playerSettings = player.settings || rawState.settings;
  const state = { ...rawState, settings: playerSettings };
  const [quantities, setQuantities] = useState(emptyQuantities);
  const [shovels, setShovels] = useState("");
  const [feedback, setFeedback] = useState("");
  const records = state.transactions
    .filter((entry) => entry.playerId === player.id)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  const total = summarize(records, playerSettings);
  const periodProfits = summarizePeriods(records, playerSettings);
  const parsedQuantities = Object.fromEntries(
    SHELL_ITEMS.map((item) => [
      item.name,
      parseQuantityExpression(quantities[item.name]),
    ]),
  );
  const parsedShovels = parseQuantityExpression(shovels);
  const hasInvalidExpression =
    Object.entries(quantities).some(
      ([name, value]) => value.trim() && parsedQuantities[name] === null,
    ) ||
    (shovels.trim() && parsedShovels === null);
  const previewGralats = SHELL_ITEMS.reduce(
    (sum, item) => sum + (parsedQuantities[item.name] || 0) * item.price,
    0,
  );
  const previewTro = previewGralats / playerSettings.gralatsPerTro;
  const previewDeduction = (parsedShovels || 0) * playerSettings.shovelTro;
  const saveBatch = () => {
    if (hasInvalidExpression) {
      setFeedback("May invalid o incomplete expression. Example: 100+200");
      return;
    }
    const timestamp = new Date().toISOString();
    const date = localDate();
    const shellRecords = SHELL_ITEMS.flatMap((item) =>
      parsedQuantities[item.name] > 0
        ? [
            {
              id: createId(),
              playerId: player.id,
              type: "sellable",
              itemName: item.name,
              quantity: parsedQuantities[item.name],
              unitPrice: item.price,
              date,
              note: "",
              createdAt: timestamp,
            },
          ]
        : [],
    );
    const shovelRecord =
      parsedShovels > 0
        ? [
            {
              id: createId(),
              playerId: player.id,
              type: "shovel",
              itemName: "",
              quantity: parsedShovels,
              unitPrice: 0,
              date,
              note: "",
              createdAt: timestamp,
            },
          ]
        : [];
    if (!shellRecords.length && !shovelRecord.length) {
      setFeedback("Maglagay muna ng shell quantity o shovel.");
      return;
    }
    setState((current) => ({
      ...current,
      transactions: [...shellRecords, ...shovelRecord, ...current.transactions],
    }));
    setQuantities(emptyQuantities());
    setShovels("");
    setFeedback(`Saved: ${displayTimestamp(timestamp)}`);
  };
  const batches = Object.values(
    records.reduce((groups, record) => {
      (groups[record.createdAt] ||= []).push(record);
      return groups;
    }, {}),
  );
  return (
    <>
      <button
        onClick={onBack}
        className="mb-4 text-sm font-bold text-[#527A70]"
      >
        ← All players
      </button>
      <header>
        <p className="text-sm font-bold uppercase text-[#659287]">
          Calculator tab
        </p>
        <h1 className="text-3xl font-bold">{player.name}</h1>
        <p className="mt-1 text-xs text-[#659287]">
          Player added: {displayTimestamp(player.createdAt)}
        </p>
      </header>
      <VisibleRatioEditor
        settings={playerSettings}
        onSave={(settings) => {
          setState((current) => ({
            ...current,
            players: current.players.map((currentPlayer) =>
              currentPlayer.id === player.id
                ? { ...currentPlayer, settings }
                : currentPlayer,
            ),
          }));
          setFeedback("Player ratios updated.");
        }}
      />
      <section className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-[#B1D3B9] bg-white p-4 sm:p-6">
          <h2 className="text-lg font-bold">Shell quantities</h2>
          <p className="mt-1 text-sm text-[#659287]">
            Enter a number or expression such as 100+200.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {SHELL_ITEMS.map((item) => (
              <label
                key={item.name}
                className="grid grid-cols-[3rem_1fr_7rem] items-center gap-3 rounded-xl border border-[#E6F2DD] p-3"
              >
                <img
                  src={item.image}
                  alt=""
                  className="size-12 object-contain"
                />
                <span>
                  <strong className="block text-sm">{item.name}</strong>
                  <small className="text-[#659287]">{item.price} G each</small>
                </span>
                <input
                  type="text"
                  inputMode="text"
                  placeholder="0 or 100+200"
                  value={quantities[item.name]}
                  onChange={(event) =>
                    setQuantities((current) => ({
                      ...current,
                      [item.name]: cleanExpression(event.target.value),
                    }))
                  }
                  className={input}
                  aria-label={`${item.name} quantity`}
                />
              </label>
            ))}
          </div>
          <label className="mt-4 grid grid-cols-[3rem_1fr_7rem] items-center gap-3 rounded-xl border border-[#E6F2DD] bg-[#F8FBF5] p-3">
            <span className="grid size-12 place-items-center rounded-xl bg-[#E6F2DD]">
              <Pickaxe />
            </span>
            <span>
              <strong className="block text-sm">Shovels</strong>
              <small className="text-[#659287]">
                −{state.settings.shovelTro} TRO each
              </small>
            </span>
            <input
              type="text"
              inputMode="text"
              placeholder="0 or 100+200"
              value={shovels}
              onChange={(event) =>
                setShovels(cleanExpression(event.target.value))
              }
              className={input}
              aria-label="Shovel quantity"
            />
          </label>
          <button onClick={saveBatch} className={`mt-5 w-full ${primary}`}>
            <Save size={17} /> Save daily entry
          </button>
          {feedback ? (
            <p className="mt-3 text-center text-sm font-bold text-[#527A70]">
              {feedback}
            </p>
          ) : null}
        </div>
        <aside className="h-fit rounded-2xl bg-[#527A70] p-5 text-white lg:sticky lg:top-24">
          <p className="text-sm text-[#E6F2DD]">Live calculator</p>
          <p className="mt-2 text-3xl font-bold">{format(previewGralats)} G</p>
          <div className="my-4 border-t border-white/20" />
          <p className="font-bold">{format(previewTro)} gross TRO</p>
          <p className="text-sm text-[#E6F2DD]">
            ₱{format(toPhp(previewTro, playerSettings))} before shovel
          </p>
          <p className="text-red-100">−{format(previewDeduction)} shovel TRO</p>
          <p className="mt-3 text-2xl font-bold">
            {format(previewTro - previewDeduction)} net TRO
          </p>
          <p className="mt-1">
            ₱{format(toPhp(previewTro - previewDeduction, state.settings))}
          </p>
        </aside>
      </section>
      <section className="mt-6">
        <h2 className="text-xl font-bold">Profit summary</h2>
        <p className="mt-1 text-sm text-[#659287]">
          Gross profit before shovel and net profit after shovel for{" "}
          {player.name} only.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {[
            ["Today", periodProfits.daily],
            ["This week", periodProfits.weekly],
            ["This month", periodProfits.monthly],
          ].map(([label, profit]) => (
            <article
              key={label}
              className="rounded-2xl bg-[#29453E] p-5 text-white"
            >
              <p className="text-sm font-bold text-[#B1D3B9]">{label}</p>
              <p className="mt-3 text-xs uppercase text-[#B1D3B9]">
                Before shovel
              </p>
              <p className="mt-1 text-lg font-bold">
                {format(profit.grossTro)} TRO · ₱
                {format(toPhp(profit.grossTro, playerSettings))}
              </p>
              <p className="mt-3 text-xs uppercase text-[#B1D3B9]">
                After shovel
              </p>
              <p className="mt-1 text-2xl font-bold">
                {format(profit.netTro)} TRO
              </p>
              <p className="mt-1 text-lg">
                ₱{format(toPhp(profit.netTro, playerSettings))}
              </p>
              <p className="mt-3 text-xs text-[#B1D3B9]">
                {format(profit.gralats)} G · {format(profit.shovels)} shovels
              </p>
            </article>
          ))}
        </div>
      </section>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Total Gralats"
          value={format(total.gralats)}
          icon={<Plus size={19} />}
        />
        <Stat
          label="Gross TRO"
          value={format(total.grossTro)}
          icon={<Pickaxe size={19} />}
        />
        <Stat
          label="Gross PHP before shovel"
          value={`₱${format(toPhp(total.grossTro, playerSettings))}`}
          icon={<Banknote size={19} />}
        />
        <Stat
          label="Shovels used"
          value={format(total.shovels)}
          icon={<Pickaxe size={19} />}
        />
        <Stat
          label="Shovel value"
          value={`${format(total.deduction)} TRO`}
          icon={<Pickaxe size={19} />}
        />
        <Stat
          label="Shovel PHP"
          value={`₱${format(toPhp(total.deduction, state.settings))}`}
          icon={<Banknote size={19} />}
        />
        <Stat
          label="Net TRO"
          value={format(total.netTro)}
          icon={<Banknote size={19} />}
        />
        <Stat
          label="PHP value"
          value={`₱${format(toPhp(total.netTro, state.settings))}`}
          icon={<Banknote size={19} />}
        />
      </div>
      <section className="mt-8">
        <h2 className="text-xl font-bold">Saved timestamps</h2>
        <div className="mt-4 space-y-3">
          {batches.map((batch) => {
            const summary = summarize(batch, state.settings);
            return (
              <article
                key={batch[0].createdAt}
                className="flex items-center justify-between gap-4 rounded-2xl border border-[#B1D3B9] bg-white p-4"
              >
                <div>
                  <strong className="text-sm">
                    {displayTimestamp(batch[0].createdAt)}
                  </strong>
                  <p className="mt-1 text-xs text-[#659287]">
                    {batch
                      .filter((entry) => entry.type === "sellable")
                      .map(
                        (entry) =>
                          `${entry.itemName} × ${format(entry.quantity)}`,
                      )
                      .join(" · ") || "Shovels only"}
                  </p>
                  {summary.shovels > 0 ? (
                    <p className="mt-1 text-xs font-bold text-red-700">
                      {format(summary.shovels)} shovels ={" "}
                      {format(summary.deduction)} TRO = ₱
                      {format(toPhp(summary.deduction, state.settings))}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <strong>{format(summary.netTro)} TRO</strong>
                  <button
                    onClick={() =>
                      confirm("Delete this saved entry?") &&
                      setState((current) => ({
                        ...current,
                        transactions: current.transactions.filter(
                          (entry) =>
                            entry.createdAt !== batch[0].createdAt ||
                            entry.playerId !== player.id,
                        ),
                      }))
                    }
                    className="rounded-lg bg-red-50 p-2 text-red-700"
                    aria-label="Delete timestamp"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            );
          })}
          {!batches.length ? (
            <p className="rounded-2xl border border-dashed p-8 text-center text-sm">
              No saved entries yet.
            </p>
          ) : null}
        </div>
      </section>
    </>
  );
}

export default function App() {
  const [state, setState] = useState(loadState);
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const importRef = useRef(null);
  const cloud = useCloudTracker(state, setState);
  useEffect(() => saveState(state), [state]);
  const playerSummaries = useMemo(
    () =>
      state.players.map((player) => ({
        player,
        summary: summarize(
          state.transactions.filter((entry) => entry.playerId === player.id),
          player.settings || state.settings,
        ),
      })),
    [state],
  );
  const total = useMemo(
    () =>
      playerSummaries.reduce(
        (sum, row) => ({
          gralats: sum.gralats + row.summary.gralats,
          grossTro: sum.grossTro + row.summary.grossTro,
          shovels: sum.shovels + row.summary.shovels,
          deduction: sum.deduction + row.summary.deduction,
          netTro: sum.netTro + row.summary.netTro,
          shovelPhp:
            sum.shovelPhp +
            toPhp(row.summary.deduction, row.player.settings || state.settings),
          php:
            sum.php +
            toPhp(row.summary.netTro, row.player.settings || state.settings),
        }),
        {
          gralats: 0,
          grossTro: 0,
          shovels: 0,
          deduction: 0,
          netTro: 0,
          php: 0,
          shovelPhp: 0,
        },
      ),
    [playerSummaries, state.settings],
  );
  const selected = state.players.find((player) => player.id === selectedId);
  const addPlayer = (name) => {
    const player = {
      id: createId(),
      name,
      createdAt: new Date().toISOString(),
      settings: { ...state.settings },
    };
    setState((current) => ({
      ...current,
      players: [...current.players, player],
    }));
    setSelectedId(player.id);
    setModal(null);
  };
  const restore = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const next = importBackup(await file.text());
      if (confirm("Replace current data with this backup?")) {
        setState(next);
        setSelectedId(null);
      }
    } catch {
      alert("Invalid backup.");
    }
  };
  return (
    <main className="min-h-screen bg-[#E6F2DD] text-[#29453E]">
      <nav className="sticky top-0 z-30 border-b border-[#B1D3B9] bg-[#F8FBF5]/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <button
            onClick={() => setSelectedId(null)}
            className="flex items-center gap-3"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-[#527A70] text-white">
              <Pickaxe />
            </span>
            <strong>TRO Tracker</strong>
          </button>
          <div className="flex items-center gap-2">
            <CloudStatus cloud={cloud} />
            {cloud.session ? (
              <>
                <button
                  type="button"
                  onClick={cloud.syncNow}
                  className={soft}
                  title={cloud.session.user.email}
                >
                  <RefreshCw size={16} />
                  <span className="hidden md:inline">Sync</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    confirm(
                      "Sign out? Your current data will remain saved locally on this device.",
                    ) && cloud.signOut()
                  }
                  className={soft}
                >
                  <LogOut size={16} />
                  <span className="hidden md:inline">Sign out</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setAccountOpen(true)}
                className={primary}
              >
                <Cloud size={16} />
                <span className="hidden sm:inline">Cloud account</span>
              </button>
            )}
            {!selected ? (
              <button onClick={() => setModal("ratios")} className={soft}>
                <Settings size={17} />
                <span className="hidden md:inline">Default ratios</span>
              </button>
            ) : null}
          </div>
        </div>
      </nav>
      <div className="mx-auto max-w-7xl px-4 py-7">
        {selected ? (
          <PlayerCalculator
            player={selected}
            state={state}
            setState={setState}
            onBack={() => setSelectedId(null)}
          />
        ) : (
          <>
            <header className="flex items-end justify-between gap-4">
              <div>
                <p className="font-bold uppercase text-[#659287]">
                  Shell calculator
                </p>
                <h1 className="mt-1 text-3xl font-bold">Player calculators</h1>
                <p className="mt-2 text-sm text-[#527A70]">
                  Add a player, then input their shell quantities immediately.
                </p>
              </div>
              <button onClick={() => setModal("player")} className={primary}>
                <UserPlus size={17} /> Add player
              </button>
            </header>
            <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
              <Stat
                label="Players"
                value={state.players.length}
                icon={<Users size={19} />}
              />
              <Stat
                label="Gralats"
                value={format(total.gralats)}
                icon={<Plus size={19} />}
              />
              <Stat
                label="Shovels used"
                value={format(total.shovels)}
                icon={<Pickaxe size={19} />}
              />
              <Stat
                label="Shovel TRO"
                value={format(total.deduction)}
                icon={<Pickaxe size={19} />}
              />
              <Stat
                label="Shovel PHP"
                value={`₱${format(total.shovelPhp)}`}
                icon={<Banknote size={19} />}
              />
              <Stat
                label="Net TRO"
                value={format(total.netTro)}
                icon={<Pickaxe size={19} />}
              />
              <Stat
                label="PHP value"
                value={`₱${format(total.php)}`}
                icon={<Banknote size={19} />}
              />
            </div>
            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {state.players.map((player) => {
                const playerTotal = summarize(
                  state.transactions.filter(
                    (entry) => entry.playerId === player.id,
                  ),
                  player.settings || state.settings,
                );
                return (
                  <article
                    key={player.id}
                    className="rounded-2xl border border-[#B1D3B9] bg-white p-5"
                  >
                    <button
                      onClick={() => setSelectedId(player.id)}
                      className="w-full text-left"
                    >
                      <div className="flex justify-between">
                        <span className="grid size-11 place-items-center rounded-xl bg-[#E6F2DD] text-lg font-bold">
                          {player.name[0].toUpperCase()}
                        </span>
                        <span className="text-right">
                          <strong className="block text-xl">
                            {format(playerTotal.netTro)} TRO
                          </strong>
                          <small>
                            ₱
                            {format(
                              toPhp(
                                playerTotal.netTro,
                                player.settings || state.settings,
                              ),
                            )}
                          </small>
                        </span>
                      </div>
                      <h2 className="mt-4 font-bold">{player.name}</h2>
                      <p className="mt-1 text-xs text-[#659287]">
                        Added {displayTimestamp(player.createdAt)}
                      </p>
                      <p className="mt-4 rounded-xl bg-[#E6F2DD] py-2 text-center text-sm font-bold">
                        Open calculator
                      </p>
                    </button>
                    <button
                      onClick={() =>
                        confirm(`Delete ${player.name}?`) &&
                        setState((current) => ({
                          ...current,
                          players: current.players.filter(
                            (entry) => entry.id !== player.id,
                          ),
                          transactions: current.transactions.filter(
                            (entry) => entry.playerId !== player.id,
                          ),
                        }))
                      }
                      className="mt-2 w-full rounded-xl bg-red-50 py-2 text-xs font-bold text-red-700"
                    >
                      Delete player
                    </button>
                  </article>
                );
              })}
              {!state.players.length ? (
                <p className="col-span-full rounded-2xl border border-dashed p-10 text-center">
                  Add your first player.
                </p>
              ) : null}
            </div>
            <section className="mt-8 flex items-center justify-between rounded-2xl bg-[#527A70] p-5 text-white">
              <p className="text-sm">
                Automatic local save · JSON backup · CSV export
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    download(
                      exportBackup(state),
                      `tro-tracker-${localDate()}.json`,
                      "application/json",
                    )
                  }
                  className="rounded-xl bg-white/15 p-3"
                  aria-label="Download backup"
                >
                  <Download />
                </button>
                <button
                  onClick={() => importRef.current.click()}
                  className="rounded-xl bg-white/15 p-3"
                  aria-label="Restore backup"
                >
                  <Upload />
                </button>
                <button
                  onClick={() =>
                    download(
                      "\uFEFF" + exportCsv(state),
                      `tro-history-${localDate()}.csv`,
                      "text/csv",
                    )
                  }
                  className="rounded-xl bg-white/15 p-3"
                  aria-label="Export CSV"
                >
                  <FileDown />
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept=".json"
                  onChange={restore}
                  className="hidden"
                />
              </div>
            </section>
          </>
        )}
      </div>
      {modal === "player" ? (
        <PlayerForm onSave={addPlayer} onClose={() => setModal(null)} />
      ) : null}
      {modal === "ratios" ? (
        <RatioForm
          settings={selected?.settings || state.settings}
          onSave={(settings) => {
            setState((current) =>
              selected
                ? {
                    ...current,
                    players: current.players.map((player) =>
                      player.id === selected.id
                        ? { ...player, settings }
                        : player,
                    ),
                  }
                : { ...current, settings },
            );
            setModal(null);
          }}
          onClose={() => setModal(null)}
        />
      ) : null}
      {accountOpen ? (
        <AccountModal onClose={() => setAccountOpen(false)} />
      ) : null}
    </main>
  );
}
