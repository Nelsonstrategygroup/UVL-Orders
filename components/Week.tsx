"use client";

// The selected order week (SPEC 5): shared by Calls, This week, Orders, Cut
// sheet, and Packing. A week runs Thursday through Wednesday and is named by
// its packing Monday (lib/dates.ts). Starts on the current week; it stays put
// while moving between screens and resets to the current week on a fresh load.
// A screen left open on the current week moves to the new week when Thursday
// starts, so Thursday's orders never go into last week by accident.

import { createContext, useContext, useEffect, useState } from "react";
import { getDb } from "@/components/data/db";
import { addDays, currentWeek, DAYS, longDate, niceDate, todayISO, WEEK_STARTS, weekDays } from "@/lib/dates";

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

/** The week's INV# (its invoice number, the same on the cut sheet and invoices), unless the screen already has it; null offline. */
function useInvNumber(week: string, given: string | null | undefined): string | null {
  const [found, setFound] = useState<{ week: string; inv: string | null } | null>(null);
  useEffect(() => {
    if (given !== undefined) return;
    let live = true;
    getDb()
      .from("weeks")
      .select("invoice_number")
      .eq("id", week)
      .maybeSingle()
      .then(
        ({ data }) => live && setFound({ week, inv: (data as { invoice_number: number | null } | null)?.invoice_number?.toString() ?? null }),
        () => {},
      );
    return () => {
      live = false;
    };
  }, [week, given]);
  if (given !== undefined) return given?.trim() || null;
  return found?.week === week ? found.inv : null;
}

/**
 * One line: ‹ Week of Oct 19 · Inv 3000 › and, on another week, a small
 * "Back to this week" chip. `schedule` (This week only) adds the order
 * week's days and what happens on each.
 */
export function WeekBar({ processDate, inv, schedule = false }: { processDate?: string | null; inv?: string | null; schedule?: boolean }) {
  const { week, setWeek } = useWeek();
  const isCurrent = week === currentWeek();
  const invNumber = useInvNumber(week, inv);
  const days = weekDays(week);
  const today = todayISO();
  return (
    <>
      <div className="weekbar noprint">
        <button type="button" className="iconbtn text-xl" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">
          &#8249;
        </button>
        <div className="weekname" aria-live="polite">
          Week of {niceDate(week)}
          {invNumber && <span className="muted"> · Inv {invNumber}</span>}
        </div>
        <button type="button" className="iconbtn text-xl" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">
          &#8250;
        </button>
        {!isCurrent && (
          <button type="button" className="chip weekchip" onClick={() => setWeek(currentWeek())}>
            Back to this week
          </button>
        )}
      </div>
      {schedule && (
        <>
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
            {processDate && processDate !== week && <> · Processing {longDate(processDate)}</>}
          </p>
        </>
      )}
    </>
  );
}
