// Invoicing data (SPEC 15, stage 1): prices, each location's invoice code
// and terms, the business and remit-to details, and the week invoice
// numbers. Money goes to the database as decimal strings, never floats.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FreightChargeRow, FreightMethod } from "../calc/invoice";
import type { ChargeRow, PriceRow } from "../calc/prices";
import { withSource } from "./source";

const msg = (e: { message: string } | null) => (e ? e.message : null);

/** Database errors in plain words. */
function plain(e: { message: string; code?: string } | null): string | null {
  if (!e) return null;
  if (e.code === "23505" && /invoice_code/.test(e.message)) return "Another location already has that code.";
  if (e.code === "23505" && /invoice_number|already used/.test(e.message)) return "Another week already has that invoice number.";
  if (e.code === "23505" && /prices_one_per_day/.test(e.message)) return "There's already a price starting that day.";
  if (e.code === "23514" && /invoice_code/.test(e.message)) return "A code is 3 to 5 capital letters or digits.";
  if (e.code === "42501") return "You can't change this.";
  return e.message;
}

export async function loadPrices(db: SupabaseClient): Promise<PriceRow[]> {
  const { data, error } = await db
    .from("prices")
    .select("id, product_id, customer_id, price, effective_from, note")
    .order("effective_from", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PriceRow[];
}

/**
 * Set a price from a date on: the default (customerId null) or one
 * customer's. A price already starting that day is replaced.
 */
export async function setPrice(
  db: SupabaseClient,
  p: { productId: string; customerId: string | null; price: string; from: string; note?: string },
): Promise<string | null> {
  let q = db.from("prices").select("id").eq("product_id", p.productId).eq("effective_from", p.from);
  q = p.customerId ? q.eq("customer_id", p.customerId) : q.is("customer_id", null);
  const { data: same, error: findErr } = await q.maybeSingle();
  if (findErr) return plain(findErr);
  const row = { price: p.price, note: p.note ?? "" };
  const { error } = same
    ? await db.from("prices").update(row).eq("id", (same as { id: string }).id)
    : await db.from("prices").insert({ ...row, product_id: p.productId, customer_id: p.customerId, effective_from: p.from });
  return plain(error);
}

export async function deletePrice(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await db.from("prices").delete().eq("id", id);
  return msg(error);
}

/** Per-carcass charges (Mohawk), as ChargeRow: amount is in `price` so they look up like prices. */
export async function loadCharges(db: SupabaseClient): Promise<ChargeRow[]> {
  const { data, error } = await db
    .from("carcass_charges")
    .select("id, product_id, customer_id, name, amount, effective_from, note")
    .order("effective_from", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as (Omit<ChargeRow, "price"> & { amount: number | string })[]).map(({ amount, ...r }) => ({ ...r, price: amount }));
}

/** Set a charge from a date on: everyone's (customerId null) or a customer's or chain's. One starting that day is replaced. */
export async function setCharge(
  db: SupabaseClient,
  c: { productId: string; customerId: string | null; name: string; amount: string; from: string },
): Promise<string | null> {
  let q = db.from("carcass_charges").select("id").eq("product_id", c.productId).eq("effective_from", c.from);
  q = c.customerId ? q.eq("customer_id", c.customerId) : q.is("customer_id", null);
  const { data: same, error: findErr } = await q.maybeSingle();
  if (findErr) return plain(findErr);
  const row = { name: c.name, amount: c.amount };
  const { error } = same
    ? await db.from("carcass_charges").update(row).eq("id", (same as { id: string }).id)
    : await db.from("carcass_charges").insert({ ...row, product_id: c.productId, customer_id: c.customerId, effective_from: c.from });
  return plain(error);
}

export async function deleteCharge(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await db.from("carcass_charges").delete().eq("id", id);
  return msg(error);
}

/** Freight charged to locations or chains (Setup > Invoicing; Lucas, 11/16/26). No row: no freight. */
export async function loadFreight(db: SupabaseClient): Promise<FreightChargeRow[]> {
  const { data, error } = await db
    .from("freight_charges")
    .select("id, customer_id, method, amount, effective_from, note")
    .order("effective_from", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as FreightChargeRow[];
}

/** A location's or chain's freight from a date on (one starting that day is replaced). */
export async function setFreight(
  db: SupabaseClient,
  f: { customerId: string; method: FreightMethod; amount: string; from: string; note: string },
): Promise<string | null> {
  const { error } = await withSource(
    db
      .from("freight_charges")
      .upsert(
        { customer_id: f.customerId, method: f.method, amount: f.method === "none" ? 0 : f.amount, effective_from: f.from, note: f.note.trim() },
        { onConflict: "customer_id,effective_from" },
      ),
    "Setup > Invoicing",
  );
  return plain(error);
}

export async function deleteFreight(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await withSource(db.from("freight_charges").delete().eq("id", id), "Setup > Invoicing");
  return msg(error);
}

/** Prices confirmed for a location (Setup > Prices; Lucas, 11/14/26). No row: not confirmed. */
export type PriceCheck = {
  customer_id: string;
  confirmed: boolean;
  changed_by_name: string;
  changed_at: string;
};

export async function loadPriceChecks(db: SupabaseClient): Promise<Map<string, PriceCheck>> {
  const { data, error } = await db.from("customer_price_checks").select("customer_id, confirmed, changed_by_name, changed_at");
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as PriceCheck[]).map((r) => [r.customer_id, r]));
}

/** Check or uncheck Prices confirmed for these locations (a chain's stores at once). The database records who and when. */
export async function setPriceChecks(db: SupabaseClient, customerIds: string[], confirmed: boolean): Promise<string | null> {
  if (!customerIds.length) return null;
  const { error } = await db
    .from("customer_price_checks")
    .upsert(customerIds.map((customer_id) => ({ customer_id, confirmed })), { onConflict: "customer_id" });
  return plain(error);
}

/** A location's billing details. */
export type CustomerBilling = {
  customer_id: string;
  invoice_code: string | null;
  bill_to_address: string;
  terms_days: number | null;
  box_detail: boolean;
};

export async function loadCustomerBilling(db: SupabaseClient): Promise<Map<string, CustomerBilling>> {
  const { data, error } = await db.from("customer_billing").select("customer_id, invoice_code, bill_to_address, terms_days, box_detail");
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as CustomerBilling[]).map((r) => [r.customer_id, r]));
}

export async function saveCustomerBilling(
  db: SupabaseClient,
  customerId: string,
  patch: Partial<Omit<CustomerBilling, "customer_id">>,
): Promise<string | null> {
  const { error } = await db.from("customer_billing").upsert({ customer_id: customerId, ...patch }, { onConflict: "customer_id" });
  return plain(error);
}

export type InvoiceSettings = {
  business_name: string;
  business_address: string;
  business_phone: string;
  business_email: string;
  remit_to: string;
  default_terms_days: number;
  invoice_note: string;
};

export async function loadInvoiceSettings(db: SupabaseClient): Promise<InvoiceSettings | null> {
  const { data, error } = await db
    .from("invoice_settings")
    .select("business_name, business_address, business_phone, business_email, remit_to, default_terms_days, invoice_note")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as InvoiceSettings | null) ?? null;
}

export async function updateInvoiceSettings(db: SupabaseClient, patch: Partial<InvoiceSettings>): Promise<string | null> {
  const { error } = await db.from("invoice_settings").update(patch).eq("id", true);
  return plain(error);
}

/** Weeks with their invoice numbers, newest first. */
export async function loadWeekNumbers(db: SupabaseClient): Promise<{ id: string; invoice_number: number | null }[]> {
  const { data, error } = await db.from("weeks").select("id, invoice_number").order("id", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as { id: string; invoice_number: number | null }[];
}

/** Set (or clear, with null) a week's invoice number. */
export async function setWeekInvoiceNumber(db: SupabaseClient, week: string, n: number | null): Promise<string | null> {
  const { error } = await db.rpc("set_week_invoice_number", { p_week: week, p_number: n });
  return plain(error);
}
