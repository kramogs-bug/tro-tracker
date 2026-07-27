import {
  Banknote,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Pickaxe,
  Printer,
  WalletCards,
} from "lucide-react";
import { PAYOUT_THRESHOLD_PHP } from "./profitAnalytics.js";
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

function payoutDetails(balancePhp, threshold = PAYOUT_THRESHOLD_PHP) {
  const balance = Math.round((Number(balancePhp) || 0) * 100) / 100;
  const payoutsReady = Math.max(0, Math.floor(balance / threshold));
  return {
    balance,
    payoutsReady,
    isReady: payoutsReady > 0,
    amountNeeded:
      Math.round(Math.max(0, threshold - balance) * 100) / 100,
    progress: Math.min(100, Math.max(0, (balance / threshold) * 100)),
  };
}

function BalanceProgress({
  balancePhp,
  threshold = PAYOUT_THRESHOLD_PHP,
  dark = false,
}) {
  const details = payoutDetails(balancePhp, threshold);
  const mutedText = dark ? "text-[#B1D3B9]" : "text-[#659287]";
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs font-bold">
        <span className={details.isReady ? "" : mutedText}>
          {details.isReady
            ? details.payoutsReady === 1
              ? "Ready for ₱500 payout"
              : `${details.payoutsReady} × ₱500 payouts ready`
            : `${peso(details.amountNeeded)} remaining`}
        </span>
        <span className={mutedText}>Target {peso(threshold)}</span>
      </div>
      <div
        role="progressbar"
        aria-label="Payout balance progress"
        aria-valuemin={0}
        aria-valuemax={threshold}
        aria-valuenow={Math.min(
          threshold,
          Math.max(0, Math.round(details.balance * 100) / 100),
        )}
        className={`mt-2 h-2 overflow-hidden rounded-full ${
          dark ? "bg-white/15" : "bg-[#E6F2DD]"
        }`}
      >
        <span
          className={`block h-full rounded-full ${
            details.isReady ? "bg-[#E7C96B]" : "bg-[#527A70]"
          }`}
          style={{ width: `${details.progress}%` }}
        />
      </div>
    </div>
  );
}

export function PlayerBalanceOverview({ analytics, onOpenPlayer }) {
  if (!analytics.rows.length) return null;
  return (
    <section className="mt-8">
      <div>
        <p className="font-bold uppercase text-[#659287]">Payout tracker</p>
        <h2 className="mt-1 text-2xl font-bold">Player remaining balances</h2>
        <p className="mt-2 text-sm text-[#527A70]">
          Balance is each player&apos;s net profit minus saved payouts. A player
          is ready again every time the balance reaches ₱500.
        </p>
      </div>

      <article className="mt-5 overflow-hidden rounded-2xl bg-[#29453E] text-white">
        <div className="grid gap-5 p-5 sm:grid-cols-3 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/10">
              <Banknote size={21} />
            </span>
            <div>
              <p className="text-xs font-bold uppercase text-[#B1D3B9]">
                Total remaining balance
              </p>
              <p className="mt-1 text-2xl font-bold">
                {peso(analytics.totalBalancePhp)}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#E7C96B] text-[#29453E]">
              <CheckCircle2 size={21} />
            </span>
            <div>
              <p className="text-xs font-bold uppercase text-[#B1D3B9]">
                Players ready
              </p>
              <p className="mt-1 text-2xl font-bold">
                {analytics.readyCount} / {analytics.rows.length}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/10">
              <WalletCards size={21} />
            </span>
            <div>
              <p className="text-xs font-bold uppercase text-[#B1D3B9]">
                ₱500 payout batches
              </p>
              <p className="mt-1 text-2xl font-bold">
                {analytics.readyPayoutCount}
              </p>
            </div>
          </div>
        </div>
      </article>

      <article className="mt-4 overflow-hidden rounded-2xl border border-[#B1D3B9] bg-white">
        <header className="flex items-center gap-3 border-b border-[#E6F2DD] p-5">
          <WalletCards size={20} className="text-[#527A70]" />
          <div>
            <h3 className="font-bold">All player balances</h3>
            <p className="text-xs text-[#659287]">
              Ready players appear first. Open a player to record the payout.
            </p>
          </div>
        </header>
        <div className="divide-y divide-[#E6F2DD]">
          {analytics.rows.map((row) => (
            <button
              type="button"
              key={row.player.id}
              onClick={() => onOpenPlayer(row.player.id)}
              className={`grid w-full gap-4 p-4 text-left hover:bg-[#F8FBF5] sm:grid-cols-[auto_1fr_minmax(13rem,18rem)] sm:items-center ${
                row.isReady ? "bg-[#FFFBEA]" : ""
              }`}
            >
              <span
                className={`grid size-10 place-items-center rounded-xl ${
                  row.isReady
                    ? "bg-[#E7C96B] text-[#29453E]"
                    : "bg-[#E6F2DD] text-[#527A70]"
                }`}
              >
                {row.isReady ? (
                  <CheckCircle2 size={20} />
                ) : (
                  <Clock3 size={20} />
                )}
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <strong className="truncate">{row.player.name}</strong>
                  {row.isReady ? (
                    <small className="rounded-full bg-[#E7C96B] px-2 py-1 font-bold text-[#29453E]">
                      Ready for payout
                    </small>
                  ) : null}
                </span>
                <small className="mt-1 block truncate text-[#659287]">
                  First input: {displayTimestamp(row.firstInputAt)}
                </small>
                <strong className="mt-2 block text-xl">
                  {peso(row.balancePhp)}
                </strong>
                <small className="text-[#659287]">
                  Remaining after {peso(row.totalCashoutPhp)} paid
                </small>
              </span>
              <BalanceProgress
                balancePhp={row.balancePhp}
                threshold={analytics.payoutThreshold}
              />
            </button>
          ))}
        </div>
      </article>
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

export function SharedProfitSummary({ snapshot, share = null }) {
  const payout = payoutDetails(snapshot.balance.php);
  return (
    <main className="min-h-screen bg-[#E6F2DD] px-4 py-7 text-[#29453E]">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-3xl bg-[#29453E] p-6 text-white sm:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row">
            <div>
              <p className="flex items-center gap-2 text-sm font-bold uppercase text-[#B1D3B9]">
                <Pickaxe size={17} /> TRO Tracker · Shared profit summary
              </p>
              {share?.live ? (
                <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#E7C96B] px-3 py-1.5 text-xs font-bold text-[#29453E]">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#527A70] opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-[#527A70]" />
                  </span>
                  Live summary · updates automatically
                </p>
              ) : null}
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
                href="/"
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
                Total payout
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
              <div className="mt-4">
                <BalanceProgress balancePhp={snapshot.balance.php} dark />
              </div>
            </div>
          </div>
          {payout.isReady ? (
            <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#E7C96B] px-3 py-1.5 text-sm font-bold text-[#29453E]">
              <CheckCircle2 size={16} />
              {payout.payoutsReady === 1
                ? "Ready for ₱500 payout"
                : `${payout.payoutsReady} × ₱500 payouts ready`}
            </p>
          ) : null}
        </header>

        <section className="mt-5 grid gap-3 sm:grid-cols-3">
          <SummaryCard label="Today" summary={snapshot.summaries.today} />
          <SummaryCard label="This week" summary={snapshot.summaries.week} />
          <SummaryCard label="This month" summary={snapshot.summaries.month} />
        </section>

        <section className="mt-5 overflow-hidden rounded-2xl border border-[#B1D3B9] bg-white">
          <header className="border-b border-[#E6F2DD] p-5">
            <h2 className="text-xl font-bold">7-day gain history</h2>
            <p className="mt-1 text-sm text-[#659287]">
              Daily net gain after shovel deductions
            </p>
          </header>
          <div className="divide-y divide-[#E6F2DD]">
            {snapshot.dailyHistory.map((day) => (
              <div
                key={day.date}
                className="grid grid-cols-[1fr_auto] items-center gap-3 px-5 py-4"
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
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-5 rounded-2xl bg-white/70 p-4 text-center text-xs text-[#659287]">
          {share?.live ? (
            <>
              Live read-only summary updated{" "}
              {displayTimestamp(share.updatedAt || snapshot.generatedAt)}.
              Link expires {displayTimestamp(share.expiresAt)}. New saved
              changes appear automatically.
            </>
          ) : (
            <>
              Read-only snapshot generated{" "}
              {displayTimestamp(snapshot.generatedAt)}. This link contains
              summary totals only and does not update automatically.
            </>
          )}
        </footer>
      </div>
    </main>
  );
}
