import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Crown,
  ExternalLink,
  Pickaxe,
  Printer,
  Trophy,
} from "lucide-react";
import { format } from "./tracker.js";

function displayTimestamp(value) {
  if (!value) return "No saved input yet";
  return new Date(value).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function displayDate(value) {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-PH", {
    dateStyle: "medium",
  });
}

function peso(value, showPositive = false) {
  const amount = Number(value) || 0;
  const sign = amount < 0 ? "−" : showPositive && amount > 0 ? "+" : "";
  return `${sign}₱${format(Math.abs(amount))}`;
}

function ratioLabel(value, current) {
  if (value === null) {
    if (current > 0) return "New gain";
    if (current < 0) return "New loss";
    return "No baseline";
  }
  return `${value > 0 ? "+" : ""}${format(value, 1)}%`;
}

function RatioBadge({ value, current }) {
  const improved = value === null ? current >= 0 : value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${
        improved
          ? "bg-[#E6F2DD] text-[#527A70]"
          : "bg-red-50 text-red-700"
      }`}
    >
      {improved ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {ratioLabel(value, current)}
    </span>
  );
}

export function OverallProfitInsights({ analytics, onOpenPlayer }) {
  if (!analytics.ranked.length) return null;
  return (
    <section className="mt-8">
      <div>
        <p className="font-bold uppercase text-[#659287]">Player analytics</p>
        <h2 className="mt-1 text-2xl font-bold">
          Gain leaderboard &amp; daily ratio
        </h2>
        <p className="mt-2 text-sm text-[#527A70]">
          Ranked by all-time net PHP. Daily ratio compares today with yesterday,
          while today share shows each player&apos;s part of the combined gain.
        </p>
      </div>

      {analytics.highestGain ? (
        <article className="mt-5 overflow-hidden rounded-2xl bg-[#29453E] text-white">
          <div className="grid gap-4 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-[#E7C96B] text-[#29453E]">
              <Crown size={24} />
            </span>
            <div>
              <p className="text-xs font-bold uppercase text-[#B1D3B9]">
                Highest all-time gain
              </p>
              <h3 className="mt-1 text-2xl font-bold">
                {analytics.highestGain.player.name}
              </h3>
              <p className="mt-1 text-xs text-[#B1D3B9]">
                First input:{" "}
                {displayTimestamp(analytics.highestGain.firstInputAt)}
              </p>
            </div>
            <div className="sm:text-right">
              <p className="text-3xl font-bold">
                {peso(analytics.highestGain.allTime.netPhp)}
              </p>
              <p className="mt-1 text-sm text-[#B1D3B9]">
                {format(analytics.highestGain.allTime.netTro)} TRO ·{" "}
                {format(analytics.highestGain.overallShare, 1)}% overall share
              </p>
            </div>
          </div>
        </article>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <article className="overflow-hidden rounded-2xl border border-[#B1D3B9] bg-white">
          <header className="flex items-center gap-3 border-b border-[#E6F2DD] p-5">
            <Trophy size={20} className="text-[#527A70]" />
            <div>
              <h3 className="font-bold">All-player leaderboard</h3>
              <p className="text-xs text-[#659287]">Net gain after shovels</p>
            </div>
          </header>
          <div className="divide-y divide-[#E6F2DD]">
            {analytics.ranked.map((row, index) => (
              <button
                type="button"
                key={row.player.id}
                onClick={() => onOpenPlayer(row.player.id)}
                className="grid w-full grid-cols-[2rem_1fr_auto] items-center gap-3 p-4 text-left hover:bg-[#F8FBF5]"
              >
                <span
                  className={`grid size-8 place-items-center rounded-full text-sm font-bold ${
                    index === 0
                      ? "bg-[#E7C96B] text-[#29453E]"
                      : "bg-[#E6F2DD] text-[#527A70]"
                  }`}
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <strong className="block truncate">{row.player.name}</strong>
                  <small className="block truncate text-[#659287]">
                    First input: {displayTimestamp(row.firstInputAt)}
                  </small>
                </span>
                <span className="text-right">
                  <strong className="block">{peso(row.allTime.netPhp)}</strong>
                  <small className="text-[#659287]">
                    {format(row.allTime.netTro)} TRO
                  </small>
                </span>
              </button>
            ))}
          </div>
        </article>

        <article className="overflow-hidden rounded-2xl border border-[#B1D3B9] bg-white">
          <header className="flex items-center justify-between gap-3 border-b border-[#E6F2DD] p-5">
            <div className="flex items-center gap-3">
              <CalendarDays size={20} className="text-[#527A70]" />
              <div>
                <h3 className="font-bold">Daily gain ratio</h3>
                <p className="text-xs text-[#659287]">
                  {displayDate(analytics.today)} vs{" "}
                  {displayDate(analytics.yesterday)}
                </p>
              </div>
            </div>
            <strong>{peso(analytics.combinedTodayPhp)}</strong>
          </header>
          <div className="divide-y divide-[#E6F2DD]">
            {analytics.daily.map((row) => (
              <button
                type="button"
                key={row.player.id}
                onClick={() => onOpenPlayer(row.player.id)}
                className="grid w-full gap-3 p-4 text-left hover:bg-[#F8FBF5] sm:grid-cols-[1fr_auto_auto] sm:items-center"
              >
                <span>
                  <strong className="block">{row.player.name}</strong>
                  <small className="text-[#659287]">
                    {format(row.todayShare, 1)}% of today&apos;s combined gain
                  </small>
                </span>
                <span className="sm:text-right">
                  <strong className="block">{peso(row.today.netPhp)}</strong>
                  <small className="text-[#659287]">today</small>
                </span>
                <RatioBadge value={row.changeRatio} current={row.changePhp} />
              </button>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function SummaryCard({ label, summary }) {
  return (
    <article className="rounded-2xl border border-[#B1D3B9] bg-white p-5">
      <p className="text-xs font-bold uppercase text-[#659287]">{label}</p>
      <p className="mt-3 text-2xl font-bold">{peso(summary.netPhp)}</p>
      <p className="mt-1 font-bold text-[#527A70]">
        {format(summary.netTro)} TRO
      </p>
      <p className="mt-3 text-xs text-[#659287]">
        Before shovel: {peso(summary.grossPhp)} · {format(summary.shovels)}{" "}
        shovels
      </p>
    </article>
  );
}

export function SharedProfitSummary({ snapshot }) {
  const today = snapshot.summaries.today;
  return (
    <main className="min-h-screen bg-[#E6F2DD] px-4 py-7 text-[#29453E]">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-3xl bg-[#29453E] p-6 text-white sm:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold uppercase text-[#B1D3B9]">
                <Pickaxe size={17} /> TRO Tracker · Shared profit summary
              </p>
              <h1 className="mt-3 text-4xl font-bold">{snapshot.player.name}</h1>
              <p className="mt-2 text-sm text-[#B1D3B9]">
                First input: {displayTimestamp(snapshot.player.firstInputAt)}
              </p>
            </div>
            <div className="no-print flex items-start gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold hover:bg-white/20"
              >
                <Printer size={16} /> Print
              </button>
              <a
                href={window.location.pathname}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-[#29453E]"
              >
                <ExternalLink size={16} /> Open tracker
              </a>
            </div>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-bold uppercase text-[#B1D3B9]">
                Total net profit
              </p>
              <p className="mt-2 text-3xl font-bold">
                {peso(snapshot.summaries.allTime.netPhp)}
              </p>
              <p className="mt-1 text-sm text-[#B1D3B9]">
                {format(snapshot.summaries.allTime.netTro)} TRO
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-[#B1D3B9]">
                Total cashout
              </p>
              <p className="mt-2 text-3xl font-bold text-[#FFD6D6]">
                −{peso(snapshot.cashout.php)}
              </p>
              <p className="mt-1 text-sm text-[#B1D3B9]">
                {format(snapshot.cashout.tro)} TRO equivalent
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 p-4">
              <p className="text-xs font-bold uppercase text-[#B1D3B9]">
                Remaining balance
              </p>
              <p className="mt-2 text-3xl font-bold">
                {peso(snapshot.balance.php)}
              </p>
              <p className="mt-1 text-sm text-[#B1D3B9]">
                {format(snapshot.balance.tro)} TRO
              </p>
            </div>
          </div>
        </header>

        <section className="mt-5 grid gap-3 sm:grid-cols-3">
          <SummaryCard label="Today" summary={snapshot.summaries.today} />
          <SummaryCard label="This week" summary={snapshot.summaries.week} />
          <SummaryCard label="This month" summary={snapshot.summaries.month} />
        </section>

        <section className="mt-5 overflow-hidden rounded-2xl border border-[#B1D3B9] bg-white">
          <header className="flex flex-col justify-between gap-3 border-b border-[#E6F2DD] p-5 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-bold">7-day gain history</h2>
              <p className="mt-1 text-sm text-[#659287]">
                Net gain after shovel deductions
              </p>
            </div>
            <RatioBadge
              value={snapshot.dailyChangeRatio}
              current={today.netPhp - snapshot.summaries.yesterday.netPhp}
            />
          </header>
          <div className="divide-y divide-[#E6F2DD]">
            {snapshot.dailyHistory.map((day) => (
              <div
                key={day.date}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-5 py-4"
              >
                <span className="text-sm font-bold">
                  {displayDate(day.date)}
                </span>
                <span className="text-right">
                  <strong className="block">{peso(day.summary.netPhp)}</strong>
                  <small className="text-[#659287]">
                    {format(day.summary.netTro)} TRO
                  </small>
                </span>
                <RatioBadge
                  value={day.changeRatio}
                  current={day.summary.netPhp}
                />
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-5 rounded-2xl bg-white/70 p-4 text-center text-xs text-[#659287]">
          Read-only snapshot generated {displayTimestamp(snapshot.generatedAt)}.
          This link contains summary totals only and does not update automatically.
        </footer>
      </div>
    </main>
  );
}
