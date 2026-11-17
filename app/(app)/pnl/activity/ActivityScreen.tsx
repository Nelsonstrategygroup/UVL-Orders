"use client";

// P&L activity (stage D, Lucas 11/16/26): every change that affects the P&L,
// from the change log, newest first: rates, prices, Mohawk charges, weigh
// sheets, expenses, other income, adjustments, and closes and reopens. For
// one week (the week bar) or every week. Runs of the same change (a weigh
// sheet's lambs, a price list) are one line you can open.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useWeek, WeekBar } from "@/components/Week";
import { displayName } from "@/lib/calc/customers";
import { ACTIVITY_TABLES, describe, describeEvent, groupEntries, type Entry, type Names } from "@/lib/calc/pnlActivity";
import { stamp } from "@/lib/calc/pnlDetail";
import { isISODate, niceDate, weekName } from "@/lib/dates";
import { loadLambCostSetup } from "@/lib/db/lambCost";
import { loadPnlSetup } from "@/lib/db/pnl";
import { loadActivity, type Activity } from "@/lib/db/pnlActivity";

const TABLES = [...ACTIVITY_TABLES, "pnl_week_events"];

async function loadNames(db: SupabaseClient) {
  const [lc, setup, people] = await Promise.all([loadLambCostSetup(db), loadPnlSetup(db), db.from("profiles").select("id, display_name")]);
  return {
    producers: new Map(lc.producers.map((p) => [p.id, p.name])),
    categories: new Map(setup.categories.map((c) => [c.id, c.name])),
    people: new Map(((people.data ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name])),
  };
}

export default function ActivityScreen() {
  const { week, setWeek } = useWeek();
  const asked = useSearchParams().get("week");
  const [all, setAll] = useState(asked === "all");
  useEffect(() => {
    if (asked && isISODate(asked) && asked !== week) setWeek(asked);
    // Only when opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  const which = all ? null : week;
  const load = useCallback((d: SupabaseClient) => loadActivity(d, which), [which]);
  const { data, error } = useLive(`pnl-activity:${which ?? "all"}`, load, TABLES);
  const loadN = useCallback((d: SupabaseClient) => loadNames(d), []);
  const { data: nm } = useLive("pnl-activity-names", loadN, ["producers", "expense_categories", "profiles"]);
  const { customers, catalog } = useStaffData();
  // Every week: older pages, added on "Show older".
  const [olderBy, setOlder] = useState<{ which: string | null; pages: Activity[] }>({ which: null, pages: [] });
  const [busy, setBusy] = useState(false);

  const head = (
    <div className="noprint">
      {!all && <WeekBar />}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link href="/pnl" className="btn ghost">
          &larr; Weekly P&amp;L
        </Link>
        <h2 className="m-0 mr-auto">P&amp;L activity{all ? ": every week" : ` · ${weekName(week)}`}</h2>
        <button type="button" className={all ? "btn ghost" : "btn"} onClick={() => setAll(false)}>
          This week
        </button>
        <button type="button" className={all ? "btn" : "btn ghost"} onClick={() => setAll(true)}>
          Every week
        </button>
      </div>
    </div>
  );
  if (error) return <>{head}<p className="note bad">Couldn&apos;t load the activity: {error}</p></>;
  if (!data || !nm || !customers || !catalog) return <>{head}<p className="small muted">Loading...</p></>;

  const older = olderBy.which === which ? olderBy.pages : [];
  const pages = [data, ...older];
  const sheets = new Map(pages.flatMap((p) => [...p.sheets]));
  const expenseWeeks = new Map(pages.flatMap((p) => [...p.expenseWeeks]));
  const runs = new Map(pages.flatMap((p) => [...p.runs]));
  const drivers = new Map(pages.flatMap((p) => [...p.drivers]));
  const names: Names = {
    product: (id) => catalog.productById.get(id)?.name ?? id,
    customer: (id) => {
      if (!id) return "Everyone (default)";
      const c = customers.byId.get(id);
      return c ? displayName(c, customers.byId) : "a customer no longer listed";
    },
    producer: (id) => nm.producers.get(id) ?? "a producer no longer listed",
    category: (id) => nm.categories.get(id) ?? "a category no longer listed",
    user: (id) => (id ? (nm.people.get(id) ?? "someone no longer listed") : "the system"),
    sheet: (id) => {
      const s = sheets.get(id);
      return s
        ? { label: `${names.producer(s.producer_id)}, kill ${niceDate(s.kill_date)}`, week: s.week_id }
        : { label: "a weigh sheet no longer listed", week: null };
    },
    expenseWeek: (id) => expenseWeeks.get(id) ?? null,
    driver: (id) => drivers.get(id) ?? "a driver no longer listed",
    run: (id) => {
      const r = runs.get(id);
      return r ? { label: `${niceDate(r.run_date)}, ${drivers.get(r.driver_id) ?? "a driver"}`, week: r.week_id } : { label: "a run no longer listed", week: null };
    },
  };
  const entries: Entry[] = [
    ...pages.flatMap((p) => p.rows.map((r) => describe(r, names, data.rates)).filter((e): e is Entry => !!e)),
    ...pages.flatMap((p) => p.events.map(describeEvent)),
  ];
  const groups = groupEntries(entries);
  const more = pages[pages.length - 1].more;

  const showOlder = async () => {
    if (!more) return;
    setBusy(true);
    try {
      const next = await loadActivity(getDb(), null, more);
      setOlder({ which, pages: [...older, next] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[900px]">
      {head}
      <p className="small muted mt-2">
        Every change that affects the P&amp;L: rates, prices, Mohawk charges, weigh sheets, expenses, other income, adjustments,
        and when a week was reviewed, closed or reopened. Newest first, with who made it and when.
        {!all && " A rate or price shows here when it applies to this week."}
      </p>
      {groups.length === 0 ? (
        <p className="note">No changes {all ? "yet" : "for this week"}.</p>
      ) : (
        <ul className="panel m-0 mt-2 list-none">
          {groups.map((g) =>
            g.entries.length === 1 ? (
              <EntryRow key={g.key} e={g.entries[0]} showWeek={all} />
            ) : (
              <li key={g.key} className="border-t border-line py-2 first:border-t-0">
                <details>
                  <summary className="cursor-pointer">
                    <b>{g.entries[0].action}</b> {g.entries.length} × {groupTitle(g.entries)}
                    {all && g.entries[0].week && <span className="tag ml-2">Week of {weekText(g.entries[0].week)}</span>}
                    <span className="small muted block">
                      {g.entries[0].who}, {stamp(g.entries[g.entries.length - 1].at)}
                      {stamp(g.entries[0].at) !== stamp(g.entries[g.entries.length - 1].at) && ` to ${stamp(g.entries[0].at)}`}
                      {g.entries[0].source && ` · ${g.entries[0].source}`}
                    </span>
                  </summary>
                  <ul className="m-0 mt-1 list-none pl-4">
                    {g.entries.map((e) => (
                      <EntryRow key={e.id} e={e} showWeek={false} />
                    ))}
                  </ul>
                </details>
              </li>
            ),
          )}
        </ul>
      )}
      {all && more && (
        <div className="mt-2">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void showOlder()}>
            {busy ? "Loading..." : "Show older"}
          </button>
        </div>
      )}
    </div>
  );
}

/** A run's name: the shared title, or what kind of change they are. */
function groupTitle(entries: Entry[]): string {
  const t = entries[0].title;
  if (entries.every((e) => e.title === t)) return t;
  const kind = t.split(":")[0];
  return { Price: "prices", "Mohawk charge": "Mohawk charges" }[kind] ?? kind;
}

function EntryRow({ e, showWeek }: { e: Entry; showWeek: boolean }) {
  return (
    <li className="border-t border-line py-2 first:border-t-0">
      <div>
        <b>{e.action}</b> {e.title}
        {showWeek && e.week && <span className="tag ml-2">Week of {weekText(e.week)}</span>}
      </div>
      {e.fields.length > 0 && (
        <div className="small">
          {e.fields.map((f) => (
            <div key={f.label}>
              {f.label}:{" "}
              {f.old !== undefined && f.new !== undefined ? (
                <>
                  <span className="num">{f.old || "(blank)"}</span> &rarr; <b className="num">{f.new || "(blank)"}</b>
                </>
              ) : f.old !== undefined ? (
                <span className="num line-through">{f.old}</span>
              ) : (
                <b className="num">{f.new}</b>
              )}
            </div>
          ))}
        </div>
      )}
      {e.applies && <div className="small">{e.applies}</div>}
      <div className="small muted">
        {e.who}, {stamp(e.at)}
        {e.source && ` · ${e.source}`}
      </div>
    </li>
  );
}

/** "Nov 16", with the year when it isn't this year. */
function weekText(week: string): string {
  return week.slice(0, 4) === new Date().toISOString().slice(0, 4) ? niceDate(week) : `${niceDate(week)}, ${week.slice(0, 4)}`;
}
