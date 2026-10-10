// Writes for the office screens. They run as the logged-in person, so Row
// Level Security applies. Each returns an error message for the screen, or null.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactRole, DeleteCheck } from "../calc/contacts";
import type { OrderStatus, Qty, Units, WeekRow } from "./types";

function msg(error: { message: string } | null): string | null {
  return error ? error.message : null;
}

/** Save a customer's order for the week in one step (see set_order in the migrations). */
export async function setOrder(
  db: SupabaseClient,
  o: { week: string; customerId: string; status?: OrderStatus; notes?: string; lines?: Qty; units?: Units },
): Promise<string | null> {
  // Without units, each line keeps the unit it already had (see set_order).
  const { error } = await db.rpc("set_order", {
    p_week: o.week,
    p_customer: o.customerId,
    p_status: o.status ?? null,
    p_notes: o.notes ?? null,
    p_lines: o.lines ?? null,
    p_units: o.units ?? null,
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
  bills_for_locations: boolean;
  notes?: string;
  contacts: { id?: string; name: string; roles: ContactRole[]; phone: string; email: string }[];
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
    bills_for_locations: c.bills_for_locations,
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

  const keep = c.contacts.filter((k) => k.name || k.phone || k.email || k.roles.length);
  const keepIds = keep.map((k) => k.id).filter((x): x is string => !!x);
  let del = db.from("customer_contacts").delete().eq("customer_id", id);
  if (keepIds.length) del = del.not("id", "in", `(${keepIds.join(",")})`);
  const { error: delErr } = await del;
  if (delErr) return { id, error: delErr.message };

  const rows = keep.map((k, sort) => ({
    ...(k.id ? { id: k.id } : {}),
    customer_id: id,
    name: k.name,
    roles: k.roles,
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

/** What ties a customer to the records (see deleteBlockers). */
export async function customerDeleteCheck(
  db: SupabaseClient,
  id: string,
): Promise<{ check: DeleteCheck | null; error: string | null }> {
  const { data, error } = await db.rpc("customer_delete_check", { p_id: id });
  return { check: (data as DeleteCheck | null) ?? null, error: error?.message ?? null };
}

/** Delete a customer that has nothing tied to it. The database checks again. */
export async function deleteCustomer(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await db.rpc("delete_customer", { p_id: id });
  return msg(error);
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
  alt_unit: string | null;
  group_name: string;
  lb_per_unit: number | null;
  pieces_per_pack: number | null;
  order_step: number;
  billed_by_weight: boolean;
  counts_toward_lambs: boolean;
  not_lamb: boolean;
  confirmed: boolean;
  fresh_only: boolean;
  active: boolean;
  note: string;
  uses: { part_id: string; qty: number }[];
  /** Mohawk lines: units_per_cut of this product's unit per line. */
  links: { cut_spec_id: string; units_per_cut: number }[];
};

/** Replace one product's child rows: write new and changed ones, then delete the rest. */
async function replaceChildren(
  db: SupabaseClient,
  table: "product_part_uses" | "product_cut_specs",
  productId: string,
  key: "part_id" | "cut_spec_id",
  rows: Record<string, unknown>[],
): Promise<string | null> {
  if (rows.length) {
    const { error } = await db.from(table).upsert(
      rows.map((r) => ({ ...r, product_id: productId })),
      { onConflict: `product_id,${key}` },
    );
    if (error) return error.message;
  }
  let del = db.from(table).delete().eq("product_id", productId);
  if (rows.length) del = del.not(key, "in", `(${rows.map((r) => r[key]).join(",")})`);
  const { error } = await del;
  return msg(error);
}

/**
 * Add or save a product, its part uses, and its Mohawk lines. A new product
 * goes at the end of the list.
 */
export async function saveProduct(db: SupabaseClient, p: ProductInput): Promise<string | null> {
  const row = {
    name: p.name,
    short_name: p.short_name,
    unit: p.unit,
    alt_unit: p.alt_unit,
    group_name: p.group_name,
    lb_per_unit: p.lb_per_unit,
    pieces_per_pack: p.pieces_per_pack,
    order_step: p.order_step,
    billed_by_weight: p.billed_by_weight,
    counts_toward_lambs: p.counts_toward_lambs,
    not_lamb: p.not_lamb,
    confirmed: p.confirmed,
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

  const uses = p.not_lamb ? [] : p.uses.filter((u) => u.part_id && u.qty > 0);
  const usesErr = await replaceChildren(db, "product_part_uses", id, "part_id", uses);
  if (usesErr) return usesErr;
  const links = p.links
    .filter((l) => l.cut_spec_id && l.units_per_cut > 0)
    .map((l, sort) => ({ cut_spec_id: l.cut_spec_id, units_per_cut: l.units_per_cut, sort }));
  return replaceChildren(db, "product_cut_specs", id, "cut_spec_id", links);
}

/** Add a part (for example a byproduct to track per lamb). */
export async function addPart(
  db: SupabaseClient,
  part: { name: string; unit: "each" | "lb"; per_lamb: number; drives_count: boolean },
): Promise<string | null> {
  const slug = part.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "part";
  const { data: last } = await db.from("parts").select("sort").order("sort", { ascending: false }).limit(1);
  const sort = ((last?.[0]?.sort as number | undefined) ?? -1) + 1;
  const { error } = await db.from("parts").insert({
    id: `${slug}-${Math.random().toString(36).slice(2, 6)}`,
    name: part.name,
    unit: part.unit,
    per_lamb: part.per_lamb,
    drives_count: part.drives_count,
    balance_check: false,
    confirmed: true,
    source_note: "Added in Setup.",
    sort,
  });
  return msg(error);
}

export async function saveCustomerNotes(db: SupabaseClient, id: string, notes: string): Promise<string | null> {
  const { error } = await db.from("customers").update({ notes }).eq("id", id);
  return msg(error);
}

// ----- Contact log (SPEC 4.3, Phase 5) -----

/** Change your own entry. RLS refuses anyone else's. */
export async function updateContact(
  db: SupabaseClient,
  id: string,
  patch: Partial<{ kind: string; summary: string; follow_up_date: string | null; follow_up_note: string; deleted_at: string | null }>,
): Promise<string | null> {
  const { data, error } = await db.from("contact_log").update(patch).eq("id", id).select("id");
  if (error) return error.message;
  return data && data.length ? null : "Only the person who wrote this can change it.";
}

/** Anyone in the office can mark a follow-up done. */
export async function setFollowUpDone(db: SupabaseClient, id: string, done: boolean): Promise<string | null> {
  const { error } = await db.rpc("set_follow_up_done", { p_id: id, p_done: done });
  return msg(error);
}

// ----- Cut sheet instructions in Setup -----

/** Swap the order of two instructions (the order they appear in the cut sheet's picker). */
export async function swapSpecSort(
  db: SupabaseClient,
  a: { id: string; sort: number },
  b: { id: string; sort: number },
): Promise<string | null> {
  // Equal sorts would swap to the same values; spread them first.
  const [sa, sb] = a.sort === b.sort ? [b.sort + 1, a.sort] : [b.sort, a.sort];
  const { error: e1 } = await db.from("cut_specs").update({ sort: sa }).eq("id", a.id);
  if (e1) return e1.message;
  const { error: e2 } = await db.from("cut_specs").update({ sort: sb }).eq("id", b.id);
  return msg(e2);
}

/**
 * Delete an instruction that has never been used: on no cut sheet line and
 * linked to no product. Otherwise say why, so it can be turned off instead.
 */
export async function deleteCutSpec(db: SupabaseClient, id: string): Promise<{ error: string | null; inUse: string | null }> {
  const [lines, links] = await Promise.all([
    db.from("cut_set_lines").select("id", { count: "exact", head: true }).eq("cut_spec_id", id),
    db.from("product_cut_specs").select("product_id", { count: "exact", head: true }).eq("cut_spec_id", id),
  ]);
  if (lines.error || links.error) return { error: (lines.error ?? links.error)!.message, inUse: null };
  const used = [
    lines.count ? `${lines.count} cut sheet line${lines.count === 1 ? "" : "s"}` : "",
    links.count ? `${links.count} product${links.count === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  if (used.length) return { error: null, inUse: `It's used on ${used.join(" and ")}. Untick "In use" to hide it instead.` };
  const { error } = await db.from("cut_specs").delete().eq("id", id);
  return { error: msg(error), inUse: null };
}

// ----- Pallet groups (Setup) -----

export type PalletGroup = { id: string; name: string; sort: number };

export async function loadPalletGroups(db: SupabaseClient): Promise<PalletGroup[]> {
  const { data, error } = await db.from("pallet_groups").select("id, name, sort").order("sort").order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as PalletGroup[];
}

export async function addPalletGroup(db: SupabaseClient, name: string, sort: number): Promise<string | null> {
  const { error } = await db.from("pallet_groups").insert({ name, sort });
  return msg(error);
}

export async function updatePalletGroup(db: SupabaseClient, id: string, patch: Partial<Omit<PalletGroup, "id">>): Promise<string | null> {
  const { error } = await db.from("pallet_groups").update(patch).eq("id", id);
  return msg(error);
}

/** Delete a group. Its customers stay, without a group. */
export async function deletePalletGroup(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await db.from("pallet_groups").delete().eq("id", id);
  return msg(error);
}

/** Put a customer in a group (or none), with their spot and order. */
export async function setCustomerPallet(
  db: SupabaseClient,
  customerId: string,
  patch: { pallet_group_id?: string | null; pallet_spot?: string; pallet_sort?: number },
): Promise<string | null> {
  const { error } = await db.from("customers").update(patch).eq("id", customerId);
  return msg(error);
}
