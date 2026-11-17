// P&L activity (stage D, Lucas 11/16/26): the change log rows that affect the
// P&L, for one week or for every week (newest first, a page at a time).
// Admins only (the change log is admin-read).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACTIVITY_TABLES,
  RATE_TABLES,
  SHEET_TABLES,
  WEEK_TABLES,
  rateAppliesTo,
  rateKey,
  type AuditRow,
  type RateRow,
  type WeekEventRow,
} from "../calc/pnlActivity";

const COLS = "id, table_name, row_id, action, old_data, new_data, user_id, at, source";
export const PAGE = 300;

type Sheet = { id: string; producer_id: string; kill_date: string; week_id: string };

export type Activity = {
  rows: AuditRow[];
  events: WeekEventRow[];
  rates: RateRow[];
  sheets: Map<string, Sheet>;
  expenseWeeks: Map<string, string>;
  /** Every week: more older rows to show (the id to show them before). */
  more: number | null;
};

const ok = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? ([] as unknown)) as T;
};
const d = (r: AuditRow) => (r.new_data ?? r.old_data ?? {}) as Record<string, unknown>;
const both = (r: AuditRow, key: string) => [r.old_data?.[key], r.new_data?.[key]].filter((v): v is string => typeof v === "string");
const inList = (key: string, ids: string[]) => `new_data->>${key}.in.(${ids.join(",")}),old_data->>${key}.in.(${ids.join(",")})`;

/** The rates and prices as they are now, so each change can say which weeks it applies to. */
async function currentRates(db: SupabaseClient): Promise<RateRow[]> {
  const res = await Promise.all(RATE_TABLES.map((t) => db.from(t).select("*")));
  return res.flatMap((r, i) =>
    ok(r as { data: Record<string, unknown>[] | null; error: { message: string } | null }).map((x) => ({
      table: RATE_TABLES[i],
      key: rateKey(RATE_TABLES[i], x),
      effective_from: String(x.effective_from),
    })),
  );
}

export async function loadActivity(db: SupabaseClient, week: string | null, before: number | null = null): Promise<Activity> {
  const [rates, sheetRes, expRes] = await Promise.all([
    currentRates(db),
    db.from("kill_sheets").select("id, producer_id, kill_date, week_id"),
    db.from("pnl_expenses").select("id, week_id"),
  ]);
  const sheets = new Map(ok(sheetRes as { data: Sheet[] | null; error: { message: string } | null }).map((s) => [s.id, s]));
  const expenseWeeks = new Map(
    ok(expRes as { data: { id: string; week_id: string }[] | null; error: { message: string } | null }).map((e) => [e.id, e.week_id]),
  );
  // Sheets deleted since, from the log, so their lambs still have a name.
  const remember = (rows: AuditRow[]) => {
    for (const r of rows) {
      const x = d(r);
      if (r.table_name === "kill_sheets" && !sheets.has(String(x.id))) sheets.set(String(x.id), x as unknown as Sheet);
      if (r.table_name === "pnl_expenses" && !expenseWeeks.has(String(x.id))) expenseWeeks.set(String(x.id), String(x.week_id));
    }
  };

  if (!week) {
    let q = db.from("audit_log").select(COLS).in("table_name", [...ACTIVITY_TABLES]).order("id", { ascending: false }).limit(PAGE);
    if (before) q = q.lt("id", before);
    const [rowsRes, evRes, sheetLog] = await Promise.all([
      q,
      db.from("pnl_week_events").select("id, week_id, action, reason, missing, by_name, at").order("at", { ascending: false }).limit(PAGE),
      db.from("audit_log").select(COLS).eq("table_name", "kill_sheets").eq("action", "delete"),
    ]);
    const rows = ok(rowsRes as { data: AuditRow[] | null; error: { message: string } | null });
    remember(ok(sheetLog as { data: AuditRow[] | null; error: { message: string } | null }));
    remember(rows);
    return {
      rows,
      events: before ? [] : ok(evRes as { data: WeekEventRow[] | null; error: { message: string } | null }),
      rates,
      sheets,
      expenseWeeks,
      more: rows.length === PAGE ? rows[rows.length - 1].id : null,
    };
  }

  // One week: rows dated in it, its weigh sheets' lambs and adjustments,
  // files on its expenses, and the rates and prices that apply to it.
  const [weekRes, rateRes, evRes] = await Promise.all([
    db.from("audit_log").select(COLS).in("table_name", [...WEEK_TABLES]).or(`new_data->>week_id.eq.${week},old_data->>week_id.eq.${week}`),
    db.from("audit_log").select(COLS).in("table_name", [...RATE_TABLES]),
    db.from("pnl_week_events").select("id, week_id, action, reason, missing, by_name, at").eq("week_id", week),
  ]);
  const weekRows = ok(weekRes as { data: AuditRow[] | null; error: { message: string } | null });
  remember(weekRows);
  const sheetIds = [
    ...new Set([
      ...weekRows.filter((r) => r.table_name === "kill_sheets").flatMap((r) => both(r, "id")),
      ...[...sheets.values()].filter((s) => s.week_id === week).map((s) => s.id),
    ]),
  ];
  const expenseIds = [
    ...new Set([
      ...weekRows.filter((r) => r.table_name === "pnl_expenses").flatMap((r) => both(r, "id")),
      ...[...expenseWeeks].filter(([, w]) => w === week).map(([id]) => id),
    ]),
  ];
  const [sheetRows, fileRows] = await Promise.all([
    sheetIds.length
      ? db.from("audit_log").select(COLS).in("table_name", [...SHEET_TABLES]).or(inList("sheet_id", sheetIds))
      : Promise.resolve({ data: [], error: null }),
    expenseIds.length
      ? db.from("audit_log").select(COLS).eq("table_name", "pnl_expense_files").or(inList("expense_id", expenseIds))
      : Promise.resolve({ data: [], error: null }),
  ]);
  const rateRows = ok(rateRes as { data: AuditRow[] | null; error: { message: string } | null }).filter((r) =>
    // A change counts for the week if the rate as it was, or as it is, applies to it.
    [r.old_data, r.new_data].some((x) => x && rateAppliesTo(r.table_name, x, rates, week)),
  );
  return {
    rows: [
      ...weekRows,
      ...ok(sheetRows as { data: AuditRow[] | null; error: { message: string } | null }),
      ...ok(fileRows as { data: AuditRow[] | null; error: { message: string } | null }),
      ...rateRows,
    ],
    events: ok(evRes as { data: WeekEventRow[] | null; error: { message: string } | null }),
    rates,
    sheets,
    expenseWeeks,
    more: null,
  };
}
