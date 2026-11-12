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

/** Sent when a week is marked (or unmarked) "No processing this week", so every week bar on screen reads it again. */
export const WEEK_CHANGED = "uvl:week-changed";

type WeekInfo = { week: string; inv: string | null; off: boolean; note: string };

/**
 * The week's INV# (the same on the cut sheet and invoices) and whether it's
 * marked "No processing this week" (11/11/26). Read once per screen; blank
 * offline or before the week has a row.
 */
function useWeekInfo(week: string): WeekInfo | null {
  const [found, setFound] = useState<WeekInfo | null>(null);
  useEffect(() => {
    let live = true;
    const read = () =>
      getDb()
        .from("weeks")
        .select("*")
        .eq("id", week)
        .maybeSingle()
        .then(
          ({ data }) => {
            const r = data as { invoice_number?: number | null; no_processing?: boolean; no_processing_note?: string } | null;
            if (live) setFound({ week, inv: r?.invoice_number?.toString() ?? null, off: !!r?.no_processing, note: (r?.no_processing_note ?? "").trim() });
          },
          () => {},
        );
    void read();
    window.addEventListener(WEEK_CHANGED, read);
    return () => {
      live = false;
      window.removeEventListener(WEEK_CHANGED, read);
    };
  }, [week]);
  return found?.week === week ? found : null;
}

/** "No processing this week: Thanksgiving." for a week marked so, else null. For screens that change what they show. */
export function useNoProcessing(week: string): { note: string } | null {
  const info = useWeekInfo(week);
  return info?.off ? { note: info.note } : null;
}

/** The words every screen uses for a week with no processing. */
export const noProcessingWords = (note: string) => `No processing this week${note ? `: ${note}` : ""}. No orders, cutting or packing.`;

/**
 * One line: ‹ Week of Oct 19 · Inv 3000 › and, on another week, a small
 * "Back to this week" chip. `schedule` (This week only) adds the order
 * week's days and what happens on each.
 */
export function WeekBar({ processDate, inv, schedule = false }: { processDate?: string | null; inv?: string | null; schedule?: boolean }) {
  const { week, setWeek } = useWeek();
  const isCurrent = week === currentWeek();
  const info = useWeekInfo(week);
  // The screen's own INV# when it has one (it may be newer than what was read here).
  const invNumber = inv !== undefined ? inv?.trim() || null : (info?.inv ?? null);
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
      {/* A holiday week (11/11/26): said on every screen, so nobody wonders why it's empty. */}
      {info?.off && (
        <p className="note warn noprint" role="status">
          <b>{noProcessingWords(info.note)}</b>
        </p>
      )}
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
