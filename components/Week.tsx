"use client";

// The selected week (SPEC 5): shared by Calls, This week, Orders, Cut sheet,
// and Packing. Starts on the current week; it stays put while moving between
// screens and resets to the current week on a fresh load.

import { createContext, useContext, useState } from "react";
import { addDays, currentWeek, longDate, niceDate } from "@/lib/dates";

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

/** Previous / "Week of Oct 19" / next, with the processing day under it. */
export function WeekBar({ processDate }: { processDate?: string | null }) {
  const { week, setWeek } = useWeek();
  const isCurrent = week === currentWeek();
  return (
    <div className="weekbar noprint">
      <button type="button" className="iconbtn text-xl" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">
        &#8249;
      </button>
      <div className="min-w-[11ch] text-center font-display text-[1.15rem]" aria-live="polite">
        Week of {niceDate(week)}
      </div>
      <button type="button" className="iconbtn text-xl" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">
        &#8250;
      </button>
      {!isCurrent && (
        <button type="button" className="linkbtn" onClick={() => setWeek(currentWeek())}>
          Back to this week
        </button>
      )}
      {processDate && <span className="muted small">Processing {longDate(processDate)}</span>}
    </div>
  );
}
