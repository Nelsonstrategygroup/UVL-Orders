// Invoices (SPEC 15, stage 2): a week's invoices with their lines, making and
// updating drafts from the box records (database functions, so the weights
// are summed exactly), and changes to a draft. Money goes to the database as
// decimal strings, never floats.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DiscountKind, InvoiceLineRow, InvoiceStatus } from "../calc/invoice";

export type InvoiceRow = {
  id: string;
  week_id: string;
  customer_id: string;
  number: string | null;
  reissue: number;
  status: InvoiceStatus;
  invoice_date: string;
  memo: string;
  fingerprint: string;
  created_at: string;
  invoice_lines: InvoiceLineRow[];
};

const COLS =
  "id, week_id, customer_id, number, reissue, status, invoice_date, memo, fingerprint, created_at, " +
  "invoice_lines (id, invoice_id, kind, product_id, description, ordered_qty, ordered_unit, boxes, quantity, price_unit, unit_price, discount_kind, discount, not_on_order, note, sort, detail)";

/** Database errors in plain words. */
function plain(e: { message: string; code?: string } | null): string | null {
  if (!e) return null;
  if (e.code === "23505" && /invoices_number_key/.test(e.message)) return "Another invoice already has that number.";
  if (e.code === "23505" && /invoices_one_per_week/.test(e.message)) return "This location already has an invoice this week.";
  if (e.code === "23514" && /invoice_lines_manual/.test(e.message)) return "A line you add needs a description, an amount, a price and a note.";
  if (e.code === "23514" && /discount_note/.test(e.message)) return "A discount needs a note.";
  if (e.code === "23514" && /invoice_lines_percent/.test(e.message)) return "A percent discount can't be over 100%.";
  if (e.code === "42501") return e.message.includes("finalized") ? "This invoice is finalized; its lines can't change." : "You can't change this.";
  return e.message;
}

export async function loadWeekInvoices(db: SupabaseClient, week: string): Promise<InvoiceRow[]> {
  const { data, error } = await db.from("invoices").select(COLS).eq("week_id", week).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as InvoiceRow[];
}

export async function loadInvoice(db: SupabaseClient, id: string): Promise<InvoiceRow | null> {
  const { data, error } = await db.from("invoices").select(COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as InvoiceRow | null) ?? null;
}

/** Each of the week's invoices with the fingerprint of its box records now. */
export async function loadFingerprints(db: SupabaseClient, week: string): Promise<Map<string, string>> {
  const { data, error } = await db.rpc("invoice_fingerprints", { p_week: week });
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as { invoice_id: string; fingerprint: string }[]).map((r) => [r.invoice_id, r.fingerprint]));
}

/** Make a draft for every location packed this week without one. The number made, or an error. */
export async function makeDrafts(db: SupabaseClient, week: string): Promise<{ made: number; error: string | null }> {
  const { data, error } = await db.rpc("make_invoice_drafts", { p_week: week });
  return { made: Number(data ?? 0), error: plain(error) };
}

/** Rebuild a draft's packing lines from the box records (manual lines and discounts kept). */
export async function updateDraft(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await db.rpc("update_invoice_draft", { p_invoice: id });
  return plain(error);
}

export async function deleteDraft(db: SupabaseClient, id: string): Promise<string | null> {
  const { data, error } = await db.from("invoices").delete().eq("id", id).eq("status", "draft").select("id");
  if (error) return plain(error);
  return data?.length ? null : "Only a draft can be deleted.";
}

export async function updateInvoice(
  db: SupabaseClient,
  id: string,
  patch: Partial<Pick<InvoiceRow, "invoice_date" | "number" | "memo">>,
): Promise<string | null> {
  const { error } = await db.from("invoices").update(patch).eq("id", id);
  return plain(error);
}

export async function addManualLine(
  db: SupabaseClient,
  invoiceId: string,
  l: { description: string; quantity: string; unitPrice: string; note: string; sort: number },
): Promise<string | null> {
  const { error } = await db.from("invoice_lines").insert({
    invoice_id: invoiceId,
    kind: "manual",
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    note: l.note,
    sort: l.sort,
  });
  return plain(error);
}

/** A line's discount (null clears it) and note. */
export async function setLineDiscount(
  db: SupabaseClient,
  id: string,
  d: { kind: DiscountKind; value: string } | null,
  note: string,
): Promise<string | null> {
  const { error } = await db
    .from("invoice_lines")
    .update({ discount_kind: d?.kind ?? null, discount: d?.value ?? null, note })
    .eq("id", id);
  return plain(error);
}

export async function deleteLine(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await db.from("invoice_lines").delete().eq("id", id);
  return plain(error);
}

/** A box on an invoice's detail page, from the box records as they are now. */
export type InvoiceBox = {
  id: string;
  customer_id: string;
  product_id: string;
  weight: number | string;
  lot: string | null;
  pack_date: string | null;
  serial: string | null;
  label_no: number | null;
  case_no: string | null;
  source: "weigh" | "scan" | "manual";
};

/** Every box packed for a customer this week, from the box records as they are now. */
export async function loadWeekBoxes(db: SupabaseClient, week: string): Promise<InvoiceBox[]> {
  const { data, error } = await db
    .from("packing_weights")
    .select("id, product_id, weight, lot, pack_date, serial, label_no, case_no, source, orders!inner (customer_id, week_id)")
    .eq("orders.week_id", week);
  if (error) throw new Error(error.message);
  type R = Omit<InvoiceBox, "customer_id"> & { orders: { customer_id: string } };
  return ((data ?? []) as unknown as R[]).map(({ orders, ...b }) => ({ ...b, customer_id: orders.customer_id }));
}

/** What the Invoices page warns about: boxes with no customer, and orders with nothing packed. */
export type WeekPacking = { unassigned: number; orders: { customer_id: string; status: string; lines: number; boxes: number }[] };

export async function loadWeekPacking(db: SupabaseClient, week: string): Promise<WeekPacking> {
  const [loose, orders] = await Promise.all([
    db.from("packing_weights").select("id", { count: "exact", head: true }).is("order_id", null).eq("week_id", week),
    db.from("orders").select("id, customer_id, status, order_lines (product_id), packing_weights (id)").eq("week_id", week),
  ]);
  if (loose.error) throw new Error(loose.error.message);
  if (orders.error) throw new Error(orders.error.message);
  type O = { customer_id: string; status: string; order_lines: unknown[]; packing_weights: unknown[] };
  return {
    unassigned: loose.count ?? 0,
    orders: ((orders.data ?? []) as unknown as O[]).map((o) => ({
      customer_id: o.customer_id,
      status: o.status,
      lines: o.order_lines.length,
      boxes: o.packing_weights.length,
    })),
  };
}
