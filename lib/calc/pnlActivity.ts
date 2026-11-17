// P&L activity (stage D, Lucas 11/16/26): every change that affects the P&L,
// from the change log (audit_log): rates, prices, Mohawk charges, weigh
// sheets, expenses, other income and adjustments, plus closes and reopens.
// Each entry says what changed, the old and new values, who and when. Rates
// and prices say which weeks they apply to ("from Oct 8 on").

import { addDays, niceDate, weekDays, weekEnd } from "../dates";
import { factorText, rateText } from "./lambCost";
import { METHOD_LABEL, type CategoryMethod } from "./pnl";
import { priceText } from "./prices";

export type AuditRow = {
  id: number;
  table_name: string;
  row_id: string | null;
  action: "insert" | "update" | "delete";
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  user_id: string | null;
  at: string;
  source: string | null;
};

/** The change log tables the activity page reads. */
export const RATE_TABLES = ["prices", "carcass_charges", "expense_category_rates", "producer_rates", "lamb_cost_settings"] as const;
/** Rate tables that are gone (charges became expense categories, 11/16/26): their log rows still show. */
export const OLD_RATE_TABLES = ["pnl_lamb_charges", "pnl_percent_charges"] as const;
export const WEEK_TABLES = ["kill_sheets", "pnl_expenses", "pnl_income", "pnl_adjustments"] as const;
export const SHEET_TABLES = ["kill_lambs", "kill_adjustments"] as const;
export const ACTIVITY_TABLES = [...RATE_TABLES, ...OLD_RATE_TABLES, ...WEEK_TABLES, ...SHEET_TABLES, "pnl_expense_files", "expense_categories"] as const;

/** Names for the ids in the log. */
export type Names = {
  product: (id: string) => string;
  /** null: the default for everyone. */
  customer: (id: string | null) => string;
  producer: (id: string) => string;
  category: (id: string) => string;
  user: (id: string | null) => string;
  /** A weigh sheet by id: "Eric Freepons, kill Nov 13", and its week. */
  sheet: (id: string) => { label: string; week: string | null };
  /** An expense by id: its week. */
  expenseWeek: (id: string) => string | null;
};

export type Field = { label: string; old?: string; new?: string };
export type Entry = {
  id: string;
  at: string;
  who: string;
  source: string;
  /** "Added", "Changed", "Deleted", "Closed", ... */
  action: string;
  title: string;
  fields: Field[];
  /** The week it belongs to (packing Monday), if one. */
  week: string | null;
  /** For a rate or price: which weeks it applies to. */
  applies: string | null;
  /** What it groups with (same kind of change, same person, same place). */
  groupKey: string;
};

const s = (v: unknown) => (v == null ? "" : String(v));
const dollars = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (v: unknown) => (v == null || v === "" ? "" : dollars(Number(v)));
const signedMoney = (v: unknown) => {
  if (v == null || v === "") return "";
  const n = Number(v);
  return n < 0 ? `-${dollars(-n)}` : dollars(n);
};
const date = (v: unknown) => (v ? niceDate(String(v)) : "");
const ACTIONS = { insert: "Added", update: "Changed", delete: "Deleted" } as const;

type FieldSpec = [key: string, label: string, fmt?: (v: unknown, row: Record<string, unknown>) => string];

/** Which fields each table shows, and how. */
function spec(table: string, n: Names): FieldSpec[] {
  switch (table) {
    case "prices":
      return [
        ["price", "Price", (v) => priceText(Number(v))],
        ["effective_from", "From", date],
        ["note", "Note"],
      ];
    case "carcass_charges":
      return [
        ["amount", "Charge a carcass", money],
        ["name", "Line name"],
        ["effective_from", "From", date],
        ["note", "Note"],
      ];
    case "expense_category_rates":
      return [
        ["amount", "Amount", (v) => rateText(s(v))],
        ["percent", "Percent", (v) => `${factorText(s(v))}%`],
        [
          "parts",
          "Parts",
          (v) =>
            Array.isArray(v) && v.length
              ? (v as { label: string; amount: number; per: string }[]).map((q) => `${q.label} ${money(q.amount)}${q.per === "year" ? " a year" : " a week"}`).join(" + ")
              : "",
        ],
        ["effective_from", "From", date],
        ["note", "Note"],
      ];
    case "expense_categories":
      return [
        ["name", "Name"],
        ["group_name", "Group"],
        ["method", "Method", (v) => METHOD_LABEL[s(v) as CategoryMethod] ?? s(v)],
        ["income_base", "Percent of", (v, r) => (r.method === "percent_income" ? (v === "sales" ? "sales only" : "all income") : "")],
        ["active", "In use", (v) => (v === false ? "retired" : "yes")],
      ];
    case "pnl_lamb_charges":
      return [
        ["per_lamb", "Per lamb", (v) => rateText(s(v))],
        ["effective_from", "From", date],
        ["note", "Note"],
      ];
    case "pnl_percent_charges":
      return [
        ["percent", "Percent", (v) => `${factorText(s(v))}%`],
        ["effective_from", "From", date],
        ["note", "Note"],
      ];
    case "producer_rates":
      return [
        ["rate", "Rate per live lb", (v) => rateText(s(v))],
        ["effective_from", "From", date],
        ["note", "Note"],
      ];
    case "lamb_cost_settings":
      return [
        ["base_rate", "Base rate per live lb", (v) => rateText(s(v))],
        ["live_factor", "Live factor", (v) => factorText(s(v))],
        ["effective_from", "From", date],
        ["note", "Note"],
      ];
    case "kill_sheets":
      return [
        ["kill_date", "Kill date", date],
        ["base_rate", "Rate per live lb", (v) => rateText(s(v))],
        ["live_factor", "Live factor", (v) => factorText(s(v))],
        ["notes", "Notes"],
      ];
    case "kill_lambs":
      return [
        ["position", "Lamb #"],
        ["carcass_lb", "Carcass lb", (v) => Number(v).toFixed(2)],
      ];
    case "kill_adjustments":
      return [
        ["amount", "Amount", (v, r) => (r.kind === "per_live_lb" ? `${rateText(s(v))} per live lb` : signedMoney(v))],
        ["reason", "Reason"],
        ["note", "Note"],
      ];
    case "pnl_expenses":
      return [
        ["category_id", "Category", (v) => n.category(s(v))],
        ["entry_date", "Date", date],
        ["amount", "Amount", money],
        ["note", "Note"],
      ];
    case "pnl_income":
      return [
        ["customer_name", "Customer"],
        ["entry_date", "Date", date],
        ["amount", "Amount", money],
        ["note", "Note"],
      ];
    case "pnl_adjustments":
      return [
        ["amount", "Amount", signedMoney],
        ["reason", "Reason"],
        ["void_reason", "Voided because"],
      ];
    case "pnl_expense_files":
      return [["name", "File"]];
    default:
      return [];
  }
}

const LINE: Record<string, string> = { income: "Income", producer: "Producer cost" };

/** What the row is, in words. */
function title(table: string, d: Record<string, unknown>, n: Names): string {
  switch (table) {
    case "prices":
      return `Price: ${n.product(s(d.product_id))} · ${n.customer((d.customer_id as string | null) ?? null)}`;
    case "carcass_charges":
      return `Mohawk charge: ${n.product(s(d.product_id))} · ${n.customer((d.customer_id as string | null) ?? null)}`;
    case "expense_category_rates":
      return `Rate: ${n.category(s(d.category_id))}`;
    case "expense_categories":
      return `Expense category: ${s(d.name)}`;
    case "pnl_lamb_charges":
      return `Per-lamb charge: ${s(d.name)}`;
    case "pnl_percent_charges":
      return `Percent charge: ${s(d.name)}`;
    case "producer_rates":
      return `Producer rate: ${n.producer(s(d.producer_id))}`;
    case "lamb_cost_settings":
      return "Base rate and live factor";
    case "kill_sheets":
      return `Weigh sheet: ${n.producer(s(d.producer_id))}, kill ${date(d.kill_date)}`;
    case "kill_lambs":
      return `Lamb weight: ${n.sheet(s(d.sheet_id)).label}`;
    case "kill_adjustments":
      return `Weigh sheet adjustment: ${n.sheet(s(d.sheet_id)).label}`;
    case "pnl_expenses":
      return `Expense: ${n.category(s(d.category_id))}`;
    case "pnl_income":
      return `Other income: ${s(d.customer_name)}`;
    case "pnl_adjustments": {
      if (d.kind === "one_off") return `One-off ${d.side === "income" ? "income" : "expense"}: ${s(d.label)}`;
      const key = s(d.line_key);
      const line = LINE[key] ?? (key.startsWith("charge:") ? `Charge: ${key.slice(7)}` : key.startsWith("category:") ? `Expense: ${n.category(key.slice(9))}` : key);
      return `Adjustment: ${line}`;
    }
    case "pnl_expense_files":
      return "File on an expense";
    default:
      return table;
  }
}

/** The week a row belongs to, if it belongs to one. */
export function rowWeek(table: string, d: Record<string, unknown>, n: Names): string | null {
  if ((WEEK_TABLES as readonly string[]).includes(table)) return (d.week_id as string | null) ?? null;
  if ((SHEET_TABLES as readonly string[]).includes(table)) return n.sheet(s(d.sheet_id)).week;
  if (table === "pnl_expense_files") return n.expenseWeek(s(d.expense_id));
  return null;
}

/** Which rows of a rate table follow one another (the same price, charge or rate). */
export function rateKey(table: string, d: Record<string, unknown>): string {
  switch (table) {
    case "prices":
      return `${s(d.product_id)}|${s(d.customer_id)}`;
    case "carcass_charges":
      return `${s(d.product_id)}|${s(d.customer_id)}`;
    case "pnl_lamb_charges":
    case "pnl_percent_charges":
      return s(d.name);
    case "producer_rates":
      return s(d.producer_id);
    case "expense_category_rates":
      return s(d.category_id);
    default:
      return "";
  }
}

export type RateRow = { table: string; key: string; effective_from: string };

/**
 * The days a rate row applies to: from its start until the day before the
 * next one of the same kind starts (rows as they are now), or on.
 */
export function rateRange(table: string, d: Record<string, unknown>, current: RateRow[]): { from: string; to: string | null } {
  const from = s(d.effective_from);
  const key = rateKey(table, d);
  const next = current
    .filter((r) => r.table === table && r.key === key && r.effective_from > from)
    .map((r) => r.effective_from)
    .sort()[0];
  return { from, to: next ? addDays(next, -1) : null };
}

/** "From Oct 8 on", "Oct 8 to Nov 1". */
export function rangeText({ from, to }: { from: string; to: string | null }): string {
  return to ? `${niceDate(from)} to ${niceDate(to)}` : `From ${niceDate(from)} on`;
}

/** The days in a week a rate is looked up on (prices: the invoice date; weigh sheets: the kill days; charges: the Monday). */
export function weekRateDays(table: string, week: string): { from: string; to: string } {
  if (table === "prices" || table === "carcass_charges") return { from: addDays(week, 1), to: addDays(week, 1) };
  if (table === "producer_rates" || table === "lamb_cost_settings") return { from: weekDays(week)[0], to: weekEnd(week) };
  return { from: week, to: week };
}

/** Does this rate row (as it was, or is) apply to the week? */
export function rateAppliesTo(table: string, d: Record<string, unknown>, current: RateRow[], week: string): boolean {
  const r = rateRange(table, d, current);
  const w = weekRateDays(table, week);
  return r.from <= w.to && (r.to == null || r.to >= w.from);
}

const APPLIES_NOTE: Record<string, string> = {
  prices: "invoices dated",
  carcass_charges: "invoices dated",
  producer_rates: "new weigh sheets killed",
  lamb_cost_settings: "new weigh sheets killed",
  pnl_lamb_charges: "weeks",
  pnl_percent_charges: "weeks",
  expense_category_rates: "weeks",
};

/** One change log row in words. null: nothing the P&L shows changed. */
export function describe(row: AuditRow, n: Names, current: RateRow[]): Entry | null {
  const d = (row.new_data ?? row.old_data ?? {}) as Record<string, unknown>;
  const o = (row.old_data ?? {}) as Record<string, unknown>;
  const nw = (row.new_data ?? {}) as Record<string, unknown>;
  const fields: Field[] = [];
  let action: string = ACTIONS[row.action];
  for (const [key, label, fmt] of spec(row.table_name, n)) {
    const f = (v: unknown, r: Record<string, unknown>) => (v == null || v === "" ? "" : fmt ? fmt(v, r) : s(v));
    if (row.action === "update") {
      const a = f(o[key], o);
      const b = f(nw[key], nw);
      if (a !== b) fields.push({ label, old: a, new: b });
    } else if (row.action === "insert") {
      const b = f(nw[key], nw);
      if (b) fields.push({ label, new: b });
    } else {
      const a = f(o[key], o);
      if (a) fields.push({ label, old: a });
    }
  }
  if (row.table_name === "pnl_adjustments" && row.action === "update" && !o.voided_at && nw.voided_at) action = "Voided";
  if (row.action === "update" && fields.length === 0) return null;

  const isRate = [...RATE_TABLES, ...OLD_RATE_TABLES].includes(row.table_name as (typeof RATE_TABLES)[number]);
  const range = isRate ? rateRange(row.table_name, d, current) : null;
  const applies = range ? `${APPLIES_NOTE[row.table_name] ?? ""} ${rangeText(range).replace(/^From/, "from")}`.trim() : null;
  const parent = (SHEET_TABLES as readonly string[]).includes(row.table_name) ? s(d.sheet_id) : "";
  return {
    id: `a${row.id}`,
    at: row.at,
    who: n.user(row.user_id),
    source: row.source ?? "",
    action,
    title: title(row.table_name, d, n),
    fields,
    week: rowWeek(row.table_name, d, n),
    applies: applies ? applies[0].toUpperCase() + applies.slice(1) : null,
    groupKey: [row.table_name, row.action, row.user_id ?? "", row.source ?? "", parent].join("|"),
  };
}

export type WeekEventRow = {
  id: string;
  week_id: string;
  action: "reviewed" | "review_removed" | "closed" | "reopened";
  reason: string;
  missing: string[];
  by_name: string;
  at: string;
};
const EVENT: Record<WeekEventRow["action"], string> = {
  reviewed: "Reviewed",
  review_removed: "Review taken back",
  closed: "Closed",
  reopened: "Reopened",
};

/** A review, close or reopen of a week. */
export function describeEvent(e: WeekEventRow): Entry {
  const fields: Field[] = [];
  if (e.reason) fields.push({ label: "Reason", new: e.reason });
  if (e.missing.length) fields.push({ label: "Still missing", new: e.missing.join(" ") });
  return {
    id: `e${e.id}`,
    at: e.at,
    who: e.by_name || "someone",
    source: "",
    action: EVENT[e.action],
    title: `Week of ${niceDate(e.week_id)}`,
    fields,
    week: e.week_id,
    applies: null,
    groupKey: `event|${e.id}`,
  };
}

export type Group = { key: string; entries: Entry[] };

/**
 * Newest first, with runs of the same kind of change by the same person from
 * the same place, within 15 minutes of each other, as one group (a weigh
 * sheet's lambs, a price list loaded at once).
 */
export function groupEntries(entries: Entry[], minutes = 15): Group[] {
  const sorted = [...entries].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const out: Group[] = [];
  for (const e of sorted) {
    const last = out[out.length - 1];
    const prev = last?.entries[last.entries.length - 1];
    if (last && prev && prev.groupKey === e.groupKey && Date.parse(prev.at) - Date.parse(e.at) <= minutes * 60_000) last.entries.push(e);
    else out.push({ key: e.id, entries: [e] });
  }
  return out;
}
