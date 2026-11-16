// Weekly P&L data (SPEC 16.6, Lamb cost stage 3): per-lamb and percent
// charges, expense categories, and the week's expense and income entries.
// Admins only (Row Level Security). Nothing else in the app reads these.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExpenseCategory, ExpenseEntry, IncomeEntry, LambCharge, PackedLine, PercentCharge, PnlAdjustment, WeekInvoice } from "../calc/pnl";
import { loadWeekInvoices } from "./invoices";
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

/**
 * What the week's income is worked out from (Lucas, 11/15/26): the locations
 * with an order or an invoice, their live invoices, and for each location
 * what's packed, as the invoice would bill it (invoice_lines_from_packing(),
 * the same lines a draft is made from). Only reads; makes no drafts.
 */
export type WeekInvoiceData = { locationIds: string[]; invoices: WeekInvoice[]; packed: PackedLine[] };

export async function loadWeekInvoiceData(db: SupabaseClient, week: string): Promise<WeekInvoiceData> {
  const [o, inv] = await Promise.all([
    db.from("orders").select("customer_id, order_lines (product_id)").eq("week_id", week),
    loadWeekInvoices(db, week),
  ]);
  if (o.error) throw new Error(o.error.message);
  const orders = (o.data ?? []) as unknown as { customer_id: string; order_lines: { product_id: string }[] }[];
  const invoices: WeekInvoice[] = inv.filter((i) => i.status !== "void");
  const locationIds = [
    ...new Set([...orders.filter((x) => x.order_lines.length > 0).map((x) => x.customer_id), ...invoices.map((i) => i.customer_id)]),
  ];
  const final = new Set(invoices.filter((i) => i.status === "finalized" || i.status === "sent").map((i) => i.customer_id));
  const lines = await Promise.all(
    locationIds
      .filter((id) => !final.has(id))
      .map(async (id) => {
        const { data, error } = await db.rpc("invoice_lines_from_packing", { p_week: week, p_customer: id });
        if (error) throw new Error(error.message);
        return ((data ?? []) as Omit<PackedLine, "customer_id">[]).map((l) => ({ ...l, customer_id: id }));
      }),
  );
  return { locationIds, invoices, packed: lines.flat() };
}

export type WeekEntries = { expenses: ExpenseEntry[]; income: IncomeEntry[] };

/** The week's expense and income entries (by packing Monday). */
export async function loadWeekEntries(db: SupabaseClient, week: string): Promise<WeekEntries> {
  const [e, i] = await Promise.all([
    db.from("pnl_expenses").select("id, entry_date, week_id, category_id, amount, note, created_by, created_at").eq("week_id", week).order("entry_date").order("created_at"),
    db.from("pnl_income").select("id, entry_date, week_id, customer_id, customer_name, amount, note, created_by, created_at").eq("week_id", week).order("entry_date").order("created_at"),
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
  // An expense's files go with it.
  const files = table === "pnl_expenses" ? ((await db.from("pnl_expense_files").select("path").eq("expense_id", id)).data ?? []) : [];
  const { error } = await withSource(db.from(table).delete().eq("id", id), SRC);
  if (!error && files.length) await db.storage.from("pnl-files").remove(files.map((f) => (f as { path: string }).path));
  return plain(error);
}

// ---------------------------------------------------------------------------
// Adjustments, one-off lines and files (P&L stage B, Lucas 11/15/26)
// ---------------------------------------------------------------------------

const BUCKET = "pnl-files";
const ADJ_COLS =
  "id, week_id, kind, line_key, side, label, amount, reason, attachment_path, attachment_name, created_by_name, created_at, voided_at, voided_by_name, void_reason";

/** The week's adjustments and one-off lines, voided ones too, oldest first. */
export async function loadWeekAdjustments(db: SupabaseClient, week: string): Promise<PnlAdjustment[]> {
  const { data, error } = await db.from("pnl_adjustments").select(ADJ_COLS).eq("week_id", week).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as PnlAdjustment[];
}

/** Files on the week's expense entries. */
export async function loadWeekExpenseFiles(db: SupabaseClient, week: string): Promise<{ id: string; expense_id: string; path: string; name: string }[]> {
  const { data, error } = await db.from("pnl_expense_files").select("id, expense_id, path, name, pnl_expenses!inner (week_id)").eq("pnl_expenses.week_id", week);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as { id: string; expense_id: string; path: string; name: string }[]).map(({ id, expense_id, path, name }) => ({ id, expense_id, path, name }));
}

/** Put a file (a photo, already shrunk, or a PDF) in the private bucket; returns its path. */
async function upload(db: SupabaseClient, folder: string, file: Blob): Promise<{ path: string } | { error: string }> {
  const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const up = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
  if (up.error) return { error: /mime|type/i.test(up.error.message) ? "Attach a photo or a PDF." : /size|large/i.test(up.error.message) ? "That file is too big (10 MB at most)." : up.error.message };
  return { path };
}

export async function addAdjustment(
  db: SupabaseClient,
  x: {
    week: string;
    kind: "adjustment" | "one_off";
    lineKey: string | null;
    side: "income" | "expense";
    label: string;
    amount: string;
    reason: string;
    file?: { blob: Blob; name: string } | null;
  },
): Promise<string | null> {
  let path: string | null = null;
  if (x.file) {
    const up = await upload(db, `${x.week}/adjustments`, x.file.blob);
    if ("error" in up) return up.error;
    path = up.path;
  }
  const { error } = await withSource(
    db.from("pnl_adjustments").insert({
      week_id: x.week,
      kind: x.kind,
      line_key: x.lineKey,
      side: x.side,
      label: x.label.trim(),
      amount: x.amount,
      reason: x.reason.trim(),
      attachment_path: path,
      attachment_name: x.file?.name ?? "",
    }),
    SRC,
  );
  if (error && path) await db.storage.from(BUCKET).remove([path]);
  if (error?.code === "23514" && /reason/.test(error.message)) return "Type a reason.";
  if (error?.code === "23514" && /label/.test(error.message)) return "Type a name for the line.";
  return plain(error);
}

export async function voidAdjustment(db: SupabaseClient, id: string, reason: string): Promise<string | null> {
  const { error } = await withSource(
    db.from("pnl_adjustments").update({ voided_at: new Date().toISOString(), void_reason: reason.trim() }).eq("id", id),
    SRC,
  );
  if (error?.code === "23514") return "Type why it's being voided.";
  return plain(error);
}

export async function addExpenseFile(db: SupabaseClient, week: string, expenseId: string, file: { blob: Blob; name: string }): Promise<string | null> {
  const up = await upload(db, `${week}/expenses`, file.blob);
  if ("error" in up) return up.error;
  const { error } = await withSource(db.from("pnl_expense_files").insert({ expense_id: expenseId, path: up.path, name: file.name }), SRC);
  if (error) await db.storage.from(BUCKET).remove([up.path]);
  return plain(error);
}

/** A link to look at a file (good for an hour). */
export async function fileLink(db: SupabaseClient, path: string): Promise<string | null> {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
  return error ? null : data.signedUrl;
}
