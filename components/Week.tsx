"use client";

// The selected order week (SPEC 5): shared by Calls, This week, Orders, Cut
// sheet, and Packing. A week runs Thursday through Wednesday and is named by
// its packing Monday (lib/dates.ts). Starts on the current week; it stays put
// while moving between screens and resets to the current week on a fresh load.

import { createContext, useContext, useState } from "react";
import { addDays, currentWeek, DAYS, longDate, niceDate, todayISO, weekDays, weekName } from "@/lib/dates";

type WeekValue = { week: string; setWeek: (w: string) => void };
const Ctx = createContext<WeekValue | null>(null);

export function WeekProvider({ children }: { children: React.ReactNode }) {
  const [week, setWeek] = useState(() => currentWeek());
  return <Ctx.Provider value={{ week, setWeek }}>{children}</Ctx.Provider>;
}

export function useWeek(): WeekValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWeek must be used inside WeekProvider");
  return v;
}

// What happens on each day of the order week.
const PLAN: Record<number, string> = { 0: "Orders", 4: "Mohawk, pack", 5: "Invoice, ship" };

/** Previous / "Packing Mon Oct 26" / next, the week's days, and the processing day. */
export function WeekBar({ processDate }: { processDate?: string | null }) {
  const { week, setWeek } = useWeek();
  const isCurrent = week === currentWeek();
  const days = weekDays(week);
  const today = todayISO();
  return (
    <>
    <div className="weekbar noprint">
      <button type="button" className="iconbtn text-xl" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">
        &#8249;
      </button>
      <div className="min-w-[11ch] text-center font-display text-[1.15rem]" aria-live="polite">
        Packing {weekName(week)}
      </div>
      <button type="button" className="iconbtn text-xl" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">
        &#8250;
      </button>
      {!isCurrent && (
        <button type="button" className="linkbtn" onClick={() => setWeek(currentWeek())}>
          Back to this week
        </button>
      )}
      {processDate && processDate !== week && <span className="muted small">Processing {longDate(processDate)}</span>}
    </div>
    {/* The order week at a glance: a strip on wider screens, one line on phones. */}
    <ol className="weekstrip noprint" aria-label={`Order week ${niceDate(days[0])} to ${niceDate(days[6])}`}>
      {days.map((d, i) => (
        <li key={d} className={`${d === today ? "today" : ""} ${PLAN[i] ? "busy" : ""}`} aria-current={d === today ? "date" : undefined}>
          <span className="dow">{DAYS[(4 + i) % 7].slice(0, 3)}</span>
          <span className="dom">{niceDate(d)}</span>
          {PLAN[i] && <span className="what">{PLAN[i]}</span>}
        </li>
      ))}
    </ol>
    <p className="weekline noprint">
      Orders Thu {niceDate(days[0])} · Pack Mon {niceDate(days[4])} · Invoice Tue {niceDate(days[5])} · Ships Tue or Thu
    </p>
    </>
  );
}
