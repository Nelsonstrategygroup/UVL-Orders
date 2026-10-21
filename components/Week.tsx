"use client";

// The selected order week (SPEC 5): shared by Calls, This week, Orders, Cut
// sheet, and Packing. A week runs Thursday through Wednesday and is named by
// its packing Monday (lib/dates.ts). Starts on the current week; it stays put
// while moving between screens and resets to the current week on a fresh load.
// A screen left open on the current week moves to the new week when Thursday
// starts, so Thursday's orders never go into last week by accident.

import { createContext, useContext, useEffect, useState } from "react";
import { addDays, currentWeek, DAYS, longDate, niceDate, todayISO, WEEK_STARTS, weekDays, weekName } from "@/lib/dates";

type WeekValue = { week: string; setWeek: (w: string) => void };
const Ctx = createContext<WeekValue | null>(null);

export function WeekProvider({ children }: { children: React.ReactNode }) {
  // following: the person is on the current week, so it moves with the calendar.
  const [state, setState] = useState(() => ({ week: currentWeek(), following: true }));
  useEffect(() => {
    const check = () => {
      const now = currentWeek();
      setState((s) => (s.following && s.week !== now ? { week: now, following: true } : s));
    };
    const timer = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check); // a tablet waking up
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  const setWeek = (w: string) => setState({ week: w, following: w === currentWeek() });
  return <Ctx.Provider value={{ week: state.week, setWeek }}>{children}</Ctx.Provider>;
}

export function useWeek(): WeekValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWeek must be used inside WeekProvider");
  return v;
}

// What happens on each weekday (0 Sunday ... 6 Saturday).
const PLAN: Record<number, string> = { 4: "Orders", 1: "Mohawk, pack", 2: "Invoice, ship", 3: "Ship" };

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
      {days.map((d, i) => {
        const dow = (WEEK_STARTS + i) % 7;
        return (
          <li key={d} className={`${d === today ? "today" : ""} ${PLAN[dow] ? "busy" : ""}`} aria-current={d === today ? "date" : undefined}>
            <span className="dow">{DAYS[dow].slice(0, 3)}</span>
            <span className="dom">{niceDate(d)}</span>
            {PLAN[dow] && <span className="what">{PLAN[dow]}</span>}
          </li>
        );
      })}
    </ol>
    <p className="weekline noprint">
      Orders Thu {niceDate(days[0])} · Pack Mon {niceDate(week)} · Invoice Tue {niceDate(addDays(week, 1))} · Ships Tue or Wed
    </p>
    </>
  );
}
