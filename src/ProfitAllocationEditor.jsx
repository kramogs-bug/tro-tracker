import { useMemo, useState } from "react";
import { Plus, Split, Trash2, Users } from "lucide-react";
import {
  allocationTotal,
  normalizeAllocationPercent,
} from "./allocationUtils.js";
import { format } from "./tracker.js";

const PRESETS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

function normalizeRows(allocations, sourcePlayerId) {
  const recipients = [];
  const seen = new Set([sourcePlayerId]);
  (allocations || []).forEach((row) => {
    const playerId = String(row?.playerId || "");
    if (!playerId || seen.has(playerId)) return;
    seen.add(playerId);
    recipients.push({
      playerId,
      percent: normalizeAllocationPercent(row.percent, 0),
    });
  });
  const recipientTotal = recipients.reduce(
    (sum, row) => sum + row.percent,
    0,
  );
  return [
    {
      playerId: sourcePlayerId,
      percent: normalizeAllocationPercent(100 - recipientTotal, 0),
    },
    ...recipients,
  ];
}

export default function ProfitAllocationEditor({
  players,
  sourcePlayerId,
  allocations,
  onChange,
  netTro = 0,
  netPhp = 0,
  title = "Profit allocation",
  description = "Split the net profit after shovel. Combined allocations always stay at 100%.",
  compact = false,
}) {
  const rows = useMemo(
    () => normalizeRows(allocations, sourcePlayerId),
    [allocations, sourcePlayerId],
  );
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const playerById = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );
  const usedIds = new Set(rows.map((row) => row.playerId));
  const availablePlayers = players.filter(
    (player) => !usedIds.has(player.id),
  );
  const sourcePercent = rows[0]?.percent || 0;

  const publish = (nextRows) => {
    onChange(normalizeRows(nextRows, sourcePlayerId));
  };

  const addRecipient = () => {
    if (!selectedPlayerId || sourcePercent <= 0) return;
    const percent = Math.min(10, sourcePercent);
    publish([...rows, { playerId: selectedPlayerId, percent }]);
    setSelectedPlayerId("");
  };

  const updateRecipient = (playerId, value) => {
    const otherRecipientTotal = rows
      .slice(1)
      .filter((row) => row.playerId !== playerId)
      .reduce((sum, row) => sum + row.percent, 0);
    const max = Math.max(0, 100 - otherRecipientTotal);
    const percent = Math.min(max, normalizeAllocationPercent(value, 0));
    publish(
      rows.map((row) =>
        row.playerId === playerId ? { ...row, percent } : row,
      ),
    );
  };

  const removeRecipient = (playerId) => {
    publish(rows.filter((row) => row.playerId !== playerId));
  };

  return (
    <section
      className={`rounded-2xl border border-[#88BDA4] bg-[#F8FBF5] ${
        compact ? "p-3" : "p-4"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#E6F2DD] text-[#527A70]">
          <Split size={18} />
        </span>
        <div>
          <h3 className="font-bold">{title}</h3>
          <p className="mt-1 text-xs text-[#659287]">{description}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {rows.map((row, index) => {
          const player = playerById.get(row.playerId);
          const isSource = index === 0;
          return (
            <article
              key={row.playerId}
              className="rounded-xl border border-[#E6F2DD] bg-white p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">
                    {player?.name || "Unknown player"}
                    {isSource ? (
                      <span className="ml-2 rounded-full bg-[#E6F2DD] px-2 py-0.5 text-[10px] uppercase text-[#527A70]">
                        Source
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs text-[#659287]">
                    {format((Number(netTro) || 0) * (row.percent / 100))} TRO
                    {" · "}₱
                    {format((Number(netPhp) || 0) * (row.percent / 100))}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="relative">
                    <span className="sr-only">
                      Allocation percentage for {player?.name || "player"}
                    </span>
                    <input
                      type="number"
                      min={isSource ? 0 : 0.1}
                      max="100"
                      step="0.1"
                      readOnly={isSource}
                      value={row.percent}
                      onChange={(event) =>
                        updateRecipient(row.playerId, event.target.value)
                      }
                      className={`w-24 rounded-xl border px-3 py-2 pr-7 text-right font-bold outline-none ${
                        isSource
                          ? "border-[#E6F2DD] bg-[#F2F8ED] text-[#527A70]"
                          : "border-[#B1D3B9] bg-white focus:border-[#527A70]"
                      }`}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#659287]">
                      %
                    </span>
                  </label>
                  {!isSource ? (
                    <button
                      type="button"
                      onClick={() => removeRecipient(row.playerId)}
                      className="rounded-lg bg-red-50 p-2.5 text-red-700"
                      aria-label={`Remove ${player?.name || "player"} allocation`}
                    >
                      <Trash2 size={15} />
                    </button>
                  ) : null}
                </div>
              </div>
              {!isSource ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => updateRecipient(row.playerId, preset)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                        row.percent === preset
                          ? "bg-[#527A70] text-white"
                          : "bg-[#E6F2DD] text-[#527A70]"
                      }`}
                    >
                      {preset}%
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {availablePlayers.length ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Player to receive profit</span>
            <select
              value={selectedPlayerId}
              onChange={(event) => setSelectedPlayerId(event.target.value)}
              className="w-full rounded-xl border border-[#B1D3B9] bg-white px-3 py-2.5 text-sm font-bold outline-none focus:border-[#527A70]"
            >
              <option value="">Choose another player</option>
              {availablePlayers.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={addRecipient}
            disabled={!selectedPlayerId || sourcePercent <= 0}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#527A70] px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={15} /> Add split
          </button>
        </div>
      ) : null}

      <footer className="mt-3 flex items-center justify-between rounded-xl bg-[#29453E] px-3 py-2.5 text-xs font-bold text-white">
        <span className="inline-flex items-center gap-1.5">
          <Users size={14} /> {rows.filter((row) => row.percent > 0).length}{" "}
          credited player
          {rows.filter((row) => row.percent > 0).length === 1 ? "" : "s"}
        </span>
        <span>{allocationTotal(rows)}% total</span>
      </footer>
    </section>
  );
}
