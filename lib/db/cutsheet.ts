// Reads and writes for the Cut sheet screen (SPEC 4.5, 5.5). Office and
// admin only; RLS keeps packing out.

import type { SupabaseClient } from "@supabase/supabase-js";
import { num } from "../calc/num";
import type { CutLine } from "../calc/cutsheet";
import type { Qty, Units } from "../calc/types";

export type SheetLine = CutLine & { id: string; sort: number };

export type SheetSet = {
  id: string;
  name: string;
  lambs: number;
  size_class_id: string | null;
  headline: string;
  sort: number;
  filled_week: string | null;
  lines: SheetLine[];
  customers: string[];
};

export type CutSheetData = {
  week: string;
  processDate: string | null;
  /** null when this week has no cut sheet yet */
  sheet: {
    inv_number: string;
    notes: string;
    pulled_large: number | null;
    pulled_medium: number | null;
    pulled_small: number | null;
    sent_at: string | null;
    sent_hash: string | null;
    sent_by_name: string | null;
  } | null;
  banners: { id: string; text: string; sort: number }[];
  goals: { id: string; text: string }[];
  sets: SheetSet[];
  /** customer id -> this week's order lines */
  /** Each customer's order this week, with the units of lines taken in another unit. */
  orders: Map<string, { lines: Qty; units: Units }>;
  /** The most recent earlier week with a cut sheet, for "Copy the week of ..." */
  lastWeekWithSheet: string | null;
};

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

function err(e: { message: string } | null): string | null {
  return e ? e.message : null;
}

export async function loadCutSheet(db: SupabaseClient, week: string): Promise<CutSheetData> {
  const [weekRow, sheet, banners, goals, sets, orders, last] = await Promise.all([
    db.from("weeks").select("process_date").eq("id", week).maybeSingle(),
    db
      .from("cut_sheets")
      .select("inv_number, notes, pulled_large, pulled_medium, pulled_small, sent_at, sent_hash, sent_by, profiles(display_name)")
      .eq("week_id", week)
      .maybeSingle(),
    db.from("cut_sheet_banners").select("id, text, sort").eq("week_id", week).order("sort"),
    db.from("saving_goals").select("id, text").eq("active", true).order("created_at"),
    db
      .from("cut_sets")
      .select(
        "id, name, lambs, size_class_id, headline, sort, filled_week, cut_set_lines(id, kind, cut_spec_id, use_type, qty, text, side_note, highlight, shank_on, sort), cut_set_customers(customer_id)",
      )
      .eq("week_id", week)
      .order("sort"),
    db.from("orders").select("customer_id, order_lines(product_id, qty, unit)").eq("week_id", week),
    db.from("cut_sheets").select("week_id").lt("week_id", week).order("week_id", { ascending: false }).limit(1),
  ]);

  type SheetRow = NonNullable<CutSheetData["sheet"]> & {
    sent_by: string | null;
    profiles: { display_name: string } | { display_name: string }[] | null;
  };
  const sh = must(sheet) as SheetRow | null;
  const sentByName = sh?.profiles ? (Array.isArray(sh.profiles) ? sh.profiles[0]?.display_name : sh.profiles.display_name) : null;

  type SetRow = Omit<SheetSet, "lines" | "customers"> & {
    cut_set_lines: SheetLine[];
    cut_set_customers: { customer_id: string }[];
  };
  const setList: SheetSet[] = ((must(sets) ?? []) as SetRow[]).map((s) => ({
    id: s.id,
    name: s.name,
    lambs: num(s.lambs),
    size_class_id: s.size_class_id,
    headline: s.headline,
    sort: s.sort,
    filled_week: s.filled_week,
    lines: (s.cut_set_lines ?? [])
      .map((l) => ({ ...l, qty: l.qty == null ? null : num(l.qty) }))
      .sort((a, b) => a.sort - b.sort),
    customers: (s.cut_set_customers ?? []).map((c) => c.customer_id),
  }));

  const orderMap = new Map<string, { lines: Qty; units: Units }>();
  for (const o of (must(orders) ?? []) as {
    customer_id: string;
    order_lines: { product_id: string; qty: number; unit: Units[string] | null }[];
  }[]) {
    const lines: Qty = {};
    const units: Units = {};
    for (const l of o.order_lines ?? []) {
      lines[l.product_id] = num(l.qty);
      if (l.unit) units[l.product_id] = l.unit;
    }
    orderMap.set(o.customer_id, { lines, units });
  }

  return {
    week,
    processDate: (must(weekRow) as { process_date: string | null } | null)?.process_date ?? null,
    sheet: sh
      ? {
          inv_number: sh.inv_number,
          notes: sh.notes,
          pulled_large: sh.pulled_large,
          pulled_medium: sh.pulled_medium,
          pulled_small: sh.pulled_small,
          sent_at: sh.sent_at,
          sent_hash: sh.sent_hash,
          sent_by_name: sentByName ?? null,
        }
      : null,
    banners: must(banners) ?? [],
    goals: must(goals) ?? [],
    sets: setList,
    orders: orderMap,
    lastWeekWithSheet: ((must(last) ?? []) as { week_id: string }[])[0]?.week_id ?? null,
  };
}

// ----- Whole sheet -----

export async function copySheet(db: SupabaseClient, from: string, to: string) {
  const { error } = await db.rpc("copy_cut_sheet", { p_from: from, p_to: to });
  return err(error);
}

export async function startBlankSheet(db: SupabaseClient, week: string, size: string | null) {
  const { error } = await db.rpc("start_cut_sheet", { p_week: week, p_size: size });
  return err(error);
}

/** Undo for copy or blank start. Only removes a sheet that hasn't been sent. */
export async function removeUnsentSheet(db: SupabaseClient, week: string) {
  const { error } = await db.rpc("remove_unsent_cut_sheet", { p_week: week });
  return err(error);
}

export async function updateSheet(db: SupabaseClient, week: string, patch: Record<string, unknown>) {
  const { error } = await db.from("cut_sheets").update(patch).eq("week_id", week);
  return err(error);
}

export async function markSent(db: SupabaseClient, week: string, hash: string) {
  const { error } = await db.rpc("mark_cut_sheet_sent", { p_week: week, p_hash: hash });
  return err(error);
}

// ----- Banners and saving goals -----

export async function addBanner(db: SupabaseClient, week: string, sort: number) {
  const { error } = await db.from("cut_sheet_banners").insert({ week_id: week, text: "", sort });
  return err(error);
}

export async function updateBanner(db: SupabaseClient, id: string, text: string) {
  const { error } = await db.from("cut_sheet_banners").update({ text }).eq("id", id);
  return err(error);
}

export async function removeBanner(db: SupabaseClient, id: string) {
  const { error } = await db.from("cut_sheet_banners").delete().eq("id", id);
  return err(error);
}

export async function addGoal(db: SupabaseClient) {
  const { error } = await db.from("saving_goals").insert({ text: "", active: true });
  return err(error);
}

export async function updateGoal(db: SupabaseClient, id: string, patch: { text?: string; active?: boolean }) {
  const { error } = await db.from("saving_goals").update(patch).eq("id", id);
  return err(error);
}

// ----- Sets -----

export async function addSet(db: SupabaseClient, week: string, sort: number, size: string | null) {
  const { error } = await db.from("cut_sets").insert({ week_id: week, sort, size_class_id: size });
  return err(error);
}

export async function updateSet(db: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("cut_sets").update(patch).eq("id", id);
  return err(error);
}

/** Swap the order of two sets (or two lines). */
export async function swapSort(
  db: SupabaseClient,
  table: "cut_sets" | "cut_set_lines",
  a: { id: string; sort: number },
  b: { id: string; sort: number },
) {
  // Sorts can repeat (copied sheets), so give them distinct values while swapping.
  const sa = a.sort === b.sort ? b.sort + 1 : b.sort;
  const r1 = await db.from(table).update({ sort: sa }).eq("id", a.id);
  if (r1.error) return r1.error.message;
  const r2 = await db.from(table).update({ sort: a.sort }).eq("id", b.id);
  return err(r2.error);
}

/** Everything about a set, for Undo. */
export async function snapshotSet(db: SupabaseClient, id: string): Promise<unknown> {
  const { data, error } = await db.rpc("cut_set_snapshot", { p_set: id });
  if (error) throw new Error(error.message);
  return data;
}

export async function restoreSet(db: SupabaseClient, snapshot: unknown) {
  const { error } = await db.rpc("restore_cut_set", { p_snap: snapshot });
  return err(error);
}

export async function deleteSet(db: SupabaseClient, id: string) {
  const { error } = await db.from("cut_sets").delete().eq("id", id);
  return err(error);
}

export async function fillSetFromOrders(db: SupabaseClient, id: string) {
  const { data, error } = await db.rpc("fill_cut_set", { p_set: id });
  if (error) return { error: error.message, added: 0, before: null as unknown };
  const r = data as { added: number; before: unknown };
  return { error: null, added: r.added, before: r.before };
}

export async function linkCustomer(db: SupabaseClient, setId: string, customerId: string) {
  const { error } = await db.from("cut_set_customers").insert({ set_id: setId, customer_id: customerId });
  return err(error);
}

export async function unlinkCustomer(db: SupabaseClient, setId: string, customerId: string) {
  const { error } = await db.from("cut_set_customers").delete().eq("set_id", setId).eq("customer_id", customerId);
  return err(error);
}

// ----- Lines -----

/** Add a blank line: no instruction chosen yet. It doesn't print until it has one and a count. */
export async function addLine(db: SupabaseClient, setId: string, sort: number) {
  const { error } = await db.from("cut_set_lines").insert({ set_id: setId, kind: "line", cut_spec_id: null, qty: null, sort });
  return err(error);
}

export async function updateLine(db: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("cut_set_lines").update(patch).eq("id", id);
  return err(error);
}

export async function deleteLine(db: SupabaseClient, id: string) {
  const { error } = await db.from("cut_set_lines").delete().eq("id", id);
  return err(error);
}

/** "Add a new instruction...": the instruction and a matching product. Returns its id. */
export async function addCutSpec(db: SupabaseClient, text: string, useType: string) {
  const { data, error } = await db.rpc("add_cut_spec", { p_text: text, p_use_type: useType });
  return { id: (data as string | null) ?? null, error: err(error) };
}
