import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronRight,
  Crown,
  Flame,
  Medal,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import { format } from "./tracker.js";

const CONFETTI = [
  [8, 8, "#E7C96B"],
  [18, 18, "#88BDA4"],
  [30, 7, "#ffffff"],
  [43, 22, "#E7C96B"],
  [58, 9, "#ffffff"],
  [71, 20, "#88BDA4"],
  [83, 6, "#E7C96B"],
  [92, 17, "#ffffff"],
];

function periodLabel(recap) {
  return recap.kind === "monthly" ? "Monthly" : "Weekly";
}

function displayRange(recap) {
  const start = new Date(`${recap.start}T12:00:00`);
  const end = new Date(`${recap.end}T12:00:00`);
  return `${start.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
  })} – ${end.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

function friendlyRoast(recap) {
  if (recap.rank === 1 && recap.netPhp > 0) {
    return "Main character ka nitong season—kulang na lang boss music.";
  }
  if (recap.netPhp <= 0) {
    return "Defensive build muna tayo. Next mission, dapat gumalaw na ang scoreboard.";
  }
  if (recap.netPhp < 100) {
    return "Warm-up round pa lang ba 'yan? May next mission ka pang babawi.";
  }
  if (recap.changeRatio !== null && recap.changeRatio >= 25) {
    return "Comeback arc unlocked. Mukhang nagbasa ka na ng patch notes.";
  }
  if (recap.rank <= 3) {
    return "Podium secured. Hindi na ito tsamba—may resibo na.";
  }
  return "Solid grind. Tahimik ang laro pero maingay ang profit.";
}

function spicyRoast(recap) {
  if (recap.rank === 1 && recap.netPhp > 0) {
    return "Ikaw na ang final boss. Yung iba, naglo-loading screen pa.";
  }
  if (recap.netPhp <= 0) {
    return "Naglaro ka ba o nag-tour lang sa trading room? Reset, grind, repeat.";
  }
  if (recap.netPhp < 100) {
    return `₱${format(recap.netPhp)}? Side quest reward yata 'yan, hindi weekly loot.`;
  }
  if (recap.rank > Math.ceil(recap.playerCount / 2)) {
    return "Nasa lower bracket ka, pero at least may bracket. Climb na next round.";
  }
  return "Okay ang profit—pero huwag munang mag-champion pose, may hahabol pa.";
}

export function PeriodRecapModal({ recap, playerName, onClose }) {
  const [spicy, setSpicy] = useState(false);
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
  const changeLabel =
    recap.changeRatio === null
      ? "New personal baseline"
      : `${recap.changeRatio >= 0 ? "+" : ""}${format(recap.changeRatio, 1)}% vs previous`;

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-[#18332C]/90 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="period-recap-title"
    >
      <section className="relative my-auto w-full max-w-xl overflow-hidden rounded-[2rem] border-2 border-[#E7C96B] bg-[#F8FBF5] shadow-2xl">
        <header className="relative overflow-hidden bg-[#29453E] px-5 pb-8 pt-10 text-center text-white sm:px-8">
          {CONFETTI.map(([left, top, color], index) => (
            <span
              key={`${left}-${top}`}
              className="absolute size-2 rotate-45 animate-pulse motion-reduce:animate-none"
              style={{
                left: `${left}%`,
                top: `${top}%`,
                backgroundColor: color,
                animationDelay: `${index * 120}ms`,
              }}
            />
          ))}
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-xl bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="Close profit recap"
          >
            <X size={19} />
          </button>
          <span className="mx-auto grid size-20 place-items-center rounded-3xl bg-[#E7C96B] text-[#29453E] shadow-lg">
            {recap.rank === 1 ? <Crown size={40} /> : <Trophy size={38} />}
          </span>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.25em] text-[#B1D3B9]">
            {periodLabel(recap)} mission complete
          </p>
          <h2 id="period-recap-title" className="mt-2 text-3xl font-black">
            Congratulations, {playerName}!
          </h2>
          <p className="mt-2 text-sm text-[#DCEADB]">{displayRange(recap)}</p>
        </header>

        <div className="p-5 sm:p-7">
          <div className="rounded-3xl bg-[#E6F2DD] p-5 text-center">
            <p className="text-xs font-black uppercase tracking-wide text-[#659287]">
              Confirmed net profit
            </p>
            <p className="mt-2 text-4xl font-black text-[#29453E]">
              ₱{format(recap.netPhp)}
            </p>
            <p className="mt-1 font-bold text-[#527A70]">
              {format(recap.netTro)} TRO
            </p>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-[#E6F2DD] bg-white p-3 text-center">
              <Medal size={18} className="mx-auto text-[#527A70]" />
              <p className="mt-2 text-[10px] font-bold uppercase text-[#659287]">
                Team rank
              </p>
              <strong className="mt-1 block">#{recap.rank}/{recap.playerCount}</strong>
            </div>
            <div className="rounded-2xl border border-[#E6F2DD] bg-white p-3 text-center">
              <CalendarDays size={18} className="mx-auto text-[#527A70]" />
              <p className="mt-2 text-[10px] font-bold uppercase text-[#659287]">
                Active days
              </p>
              <strong className="mt-1 block">{recap.activeDays}</strong>
            </div>
            <div className="rounded-2xl border border-[#E6F2DD] bg-white p-3 text-center">
              <Flame size={18} className="mx-auto text-[#527A70]" />
              <p className="mt-2 text-[10px] font-bold uppercase text-[#659287]">
                Progress
              </p>
              <strong className="mt-1 block text-xs">{changeLabel}</strong>
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-[#29453E] p-4 text-white">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-[#E7C96B] px-3 py-1 text-xs font-black text-[#29453E]">
                <Sparkles size={14} /> {recap.badge}
              </span>
              <button
                type="button"
                onClick={() => setSpicy((current) => !current)}
                className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-bold hover:bg-white/20"
              >
                {spicy ? "Friendly roast" : "Roast me harder"}
              </button>
            </div>
            <p className="mt-3 text-sm font-bold leading-relaxed text-[#E6F2DD]">
              “{spicy ? spicyRoast(recap) : friendlyRoast(recap)}”
            </p>
          </div>

          {recap.nextRankGapPhp > 0 ? (
            <p className="mt-3 text-center text-xs font-bold text-[#527A70]">
              ₱{format(recap.nextRankGapPhp)} more would reach the next rank.
            </p>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#527A70] px-4 py-3 font-bold text-white hover:bg-[#29453E]"
          >
            Continue grinding <ChevronRight size={17} />
          </button>
        </div>
      </section>
    </div>
  );
}

export function RecapArchive({ recaps, onOpen }) {
  const available = useMemo(
    () => [recaps?.monthly, recaps?.weekly].filter(Boolean),
    [recaps],
  );
  if (!available.length) return null;
  return (
    <section className="rounded-3xl border border-[#B1D3B9] bg-white p-5 sm:p-7">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#E7C96B] text-[#29453E]">
          <Trophy size={21} />
        </span>
        <div>
          <h2 className="text-xl font-bold">Completed mission recaps</h2>
          <p className="mt-1 text-sm text-[#659287]">
            Replay your latest weekly and monthly result screens.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {available.map((recap) => (
          <button
            key={recap.key}
            type="button"
            onClick={() => onOpen(recap)}
            className="rounded-2xl border border-[#E6F2DD] bg-[#F8FBF5] p-4 text-left hover:border-[#88BDA4]"
          >
            <p className="text-xs font-bold uppercase text-[#659287]">
              {periodLabel(recap)} · {displayRange(recap)}
            </p>
            <p className="mt-2 text-2xl font-black">₱{format(recap.netPhp)}</p>
            <p className="mt-1 text-xs font-bold text-[#527A70]">
              Rank #{recap.rank} · {recap.badge}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}
