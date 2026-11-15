// Weekly P&L data (SPEC 16.6, Lamb cost stage 3): per-lamb and percent
// charges, expense categories, and the week's expense and income entries.
// Admins only (Row Level Security). Nothing else in the app reads these.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExpenseCategory, ExpenseEntry, IncomeEntry, LambCharge, PercentCharge } from "../calc/pnl";
import { withSource } from "./source";

const SRC = "weekly P&L";

function plain(e: { message: string; code?: string } | null): string | null {
  if (!e) return null;
  if (e.code === "23505" && /pnl_lamb_charges|pnl_percent_charges/.test(e.message)) return "That charge already has a rate starting that day.";
  if (e.code === "23505" && /expense_categories/.test(e.message)) return "There's already a category with that name.";
  if (e.code === "23503" && /expense_categories/.test(e.message)) return "This category has expenses, so it can only be turned off.";
  if (e.code === "23514" && /percent/.test(e.message)) return "A percent is from 0 to 100.";
  if (e.code === "23514" && /amount/.test(e.message)) return "Type an amount other than 0.";
  if (e.code === "23514" && /name/.test(e.message)) return "Type a name.";
  if (e.code === "42501") return "Only an admin can change this.";
  return e.message;
}

export type PnlSetup = { lambCharges: LambCharge[]; percentCharges: PercentCharge[]; categories: ExpenseCategory[] };

export async function loadPnlSetup(db: SupabaseClient): Promise<PnlSetup> {
  const [l, p, c] = await Promise.all([
    db.from("pnl_lamb_charges").select("id, name, effective_from, per_lamb, note").order("name").order("effective_from", { ascending: false }),
    db.from("pnl_percent_charges").select("id, name, effective_from, percent, note").order("name").order("effective_from", { ascending: false }),
    db.from("expense_categories").select("id, name, active, sort").order("sort").order("name"),
  ]);
  const err = l.error ?? p.error ?? c.error;
  if (err) throw new Error(err.message);
  return {
    lambCharges: (l.data ?? []) as LambCharge[],
    percentCharges: (p.data ?? []) as PercentCharge[],
    categories: (c.data ?? []) as ExpenseCategory[],
  };
}

/** Add a per-lamb charge rate from a date on (a new name starts a new charge). */
export async function addLambCharge(db: SupabaseClient, c: { name: string; from: string; perLamb: string; note: string }) {
  const { error } = await withSource(
    db.from("pnl_lamb_charges").insert({ name: c.name.trim(), effective_from: c.from, per_lamb: c.perLamb, note: c.note.trim() }),
    "P&L Setup",
  );
  return plain(error);
}

export async function addPercentCharge(db: SupabaseClient, c: { name: string; from: string; percent: string; note: string }) {
  const { error } = await withSource(
    db.from("pnl_percent_charges").insert({ name: c.name.trim(), effective_from: c.from, percent: c.percent, note: c.note.trim() }),
    "P&L Setup",
  );
  return plain(error);
}

export async function deleteCharge(db: SupabaseClient, table: "pnl_lamb_charges" | "pnl_percent_charges", id: string) {
  const { error } = await withSource(db.from(table).delete().eq("id", id), "P&L Setup");
  return plain(error);
}

export async function saveCategory(db: SupabaseClient, c: { id?: string; name: string; active: boolean; sort?: number }) {
  const row = { name: c.name.trim(), active: c.active, ...(c.sort != null ? { sort: c.sort } : {}) };
  const { error } = c.id
    ? await withSource(db.from("expense_categories").update(row).eq("id", c.id), "P&L Setup")
    : await withSource(db.from("expense_categories").insert(row), "P&L Setup");
  return plain(error);
}

export type WeekEntries = { expenses: ExpenseEntry[]; income: IncomeEntry[] };

/** The week's expense and income entries (by packing Monday). */
export async function loadWeekEntries(db: SupabaseClient, week: string): Promise<WeekEntries> {
  const [e, i] = await Promise.all([
    db.from("pnl_expenses").select("id, entry_date, week_id, category_id, amount, note").eq("week_id", week).order("entry_date").order("created_at"),
    db.from("pnl_income").select("id, entry_date, week_id, customer_id, customer_name, amount, note").eq("week_id", week).order("entry_date").order("created_at"),
  ]);
  const err = e.error ?? i.error;
  if (err) throw new Error(err.message);
  return { expenses: (e.data ?? []) as ExpenseEntry[], income: (i.data ?? []) as IncomeEntry[] };
}

export async function addExpense(db: SupabaseClient, x: { date: string; categoryId: string; amount: string; note: string }) {
  const { error } = await withSource(
    db.from("pnl_expenses").insert({ entry_date: x.date, category_id: x.categoryId, amount: x.amount, note: x.note.trim() }),
    SRC,
  );
  return plain(error);
}

export async function addIncome(db: SupabaseClient, x: { date: string; customerId: string; customerName: string; amount: string; note: string }) {
  const { error } = await withSource(
    db.from("pnl_income").insert({
      entry_date: x.date,
      customer_id: x.customerId,
      customer_name: x.customerName,
      amount: x.amount,
      note: x.note.trim(),
    }),
    SRC,
  );
  return plain(error);
}

export async function deleteEntry(db: SupabaseClient, table: "pnl_expenses" | "pnl_income", id: string) {
  const { error } = await withSource(db.from(table).delete().eq("id", id), SRC);
  return plain(error);
}
