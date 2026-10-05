// Writes for the office screens. They run as the logged-in person, so Row
// Level Security applies. Each returns an error message for the screen, or null.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderStatus, Qty, WeekRow } from "./types";

function msg(error: { message: string } | null): string | null {
  return error ? error.message : null;
}

/** Save a customer's order for the week in one step (see set_order in the migrations). */
export async function setOrder(
  db: SupabaseClient,
  o: { week: string; customerId: string; status?: OrderStatus; notes?: string; lines?: Qty },
): Promise<string | null> {
  const { error } = await db.rpc("set_order", {
    p_week: o.week,
    p_customer: o.customerId,
    p_status: o.status ?? null,
    p_notes: o.notes ?? null,
    p_lines: o.lines ?? null,
  });
  return msg(error);
}

export async function saveWeek(
  db: SupabaseClient,
  week: string,
  patch: Partial<Omit<WeekRow, "id">>,
): Promise<string | null> {
  const { error } = await db.from("weeks").upsert({ id: week, ...patch }, { onConflict: "id" });
  return msg(error);
}

export async function logContact(
  db: SupabaseClient,
  c: { customerId: string; kind: string; summary: string; followUpDate: string | null; followUpNote: string },
): Promise<string | null> {
  const { error } = await db.from("contact_log").insert({
    customer_id: c.customerId,
    kind: c.kind,
    summary: c.summary,
    follow_up_date: c.followUpDate || null,
    follow_up_note: c.followUpNote,
  });
  return msg(error);
}

export type CustomerInput = {
  id: string | null;
  name: string;
  type: string;
  call_day: string | null;
  parent_customer_id: string | null;
  active: boolean;
  notes?: string;
  contacts: { id?: string; name: string; role: string; phone: string; email: string }[];
};

/** Add or update a customer and its contacts. Returns the customer id. */
export async function saveCustomer(
  db: SupabaseClient,
  c: CustomerInput,
): Promise<{ id: string | null; error: string | null }> {
  const row = {
    name: c.name,
    type: c.type,
    call_day: c.call_day,
    parent_customer_id: c.parent_customer_id,
    active: c.active,
    ...(c.notes !== undefined ? { notes: c.notes } : {}),
  };
  let id = c.id;
  if (id) {
    const { error } = await db.from("customers").update(row).eq("id", id);
    if (error) return { id, error: error.message };
  } else {
    const { data, error } = await db.from("customers").insert(row).select("id").single();
    if (error) return { id: null, error: error.message };
    id = data.id as string;
  }

  const keep = c.contacts.filter((k) => k.name || k.phone || k.email);
  const keepIds = keep.map((k) => k.id).filter((x): x is string => !!x);
  let del = db.from("customer_contacts").delete().eq("customer_id", id);
  if (keepIds.length) del = del.not("id", "in", `(${keepIds.join(",")})`);
  const { error: delErr } = await del;
  if (delErr) return { id, error: delErr.message };

  const rows = keep.map((k, sort) => ({
    ...(k.id ? { id: k.id } : {}),
    customer_id: id,
    name: k.name,
    role: k.role,
    phone: k.phone,
    email: k.email,
    sort,
  }));
  const existing = rows.filter((r) => "id" in r);
  const added = rows.filter((r) => !("id" in r));
  if (existing.length) {
    const { error } = await db.from("customer_contacts").upsert(existing, { onConflict: "id" });
    if (error) return { id, error: error.message };
  }
  if (added.length) {
    const { error } = await db.from("customer_contacts").insert(added);
    if (error) return { id, error: error.message };
  }
  return { id, error: null };
}

// ----- Setup (SPEC 5.10) -----

export async function updateRow(
  db: SupabaseClient,
  table: "parts" | "cut_specs" | "size_classes",
  id: string,
  patch: Record<string, unknown>,
): Promise<string | null> {
  const { error } = await db.from(table).update(patch).eq("id", id);
  return msg(error);
}

export async function updateSettings(
  db: SupabaseClient,
  patch: Partial<{ processor_name: string; processor_email: string; standing_instructions: string }>,
): Promise<string | null> {
  const { error } = await db.from("app_settings").update(patch).eq("id", true);
  return msg(error);
}

export type ProductInput = {
  /** null for a new product */
  id: string | null;
  name: string;
  short_name: string;
  unit: string;
  group_name: string;
  cut_spec_id: string | null;
  fresh_only: boolean;
  active: boolean;
  note: string;
  uses: { part_id: string; qty: number }[];
};

/**
 * Add or save a product and its part uses. New and changed uses are written
 * before removed ones are deleted. A new product goes at the end of the list.
 */
export async function saveProduct(db: SupabaseClient, p: ProductInput): Promise<string | null> {
  const row = {
    name: p.name,
    short_name: p.short_name,
    unit: p.unit,
    group_name: p.group_name,
    cut_spec_id: p.cut_spec_id,
    fresh_only: p.fresh_only,
    active: p.active,
    note: p.note,
  };
  let id = p.id;
  if (id) {
    const { error } = await db.from("products").update(row).eq("id", id);
    if (error) return error.message;
  } else {
    const { data: last } = await db.from("products").select("sort").order("sort", { ascending: false }).limit(1);
    const sort = ((last?.[0]?.sort as number | undefined) ?? -1) + 1;
    const { data, error } = await db.from("products").insert({ ...row, sort }).select("id").single();
    if (error) return error.message;
    id = data.id as string;
  }

  const uses = p.uses.filter((u) => u.part_id && u.qty > 0);
  if (uses.length) {
    const { error: upErr } = await db
      .from("product_part_uses")
      .upsert(
        uses.map((u) => ({ product_id: id, part_id: u.part_id, qty: u.qty })),
        { onConflict: "product_id,part_id" },
      );
    if (upErr) return upErr.message;
  }
  let del = db.from("product_part_uses").delete().eq("product_id", id);
  if (uses.length) del = del.not("part_id", "in", `(${uses.map((u) => u.part_id).join(",")})`);
  const { error: delErr } = await del;
  return msg(delErr);
}

export async function saveCustomerNotes(db: SupabaseClient, id: string, notes: string): Promise<string | null> {
  const { error } = await db.from("customers").update({ notes }).eq("id", id);
  return msg(error);
}
