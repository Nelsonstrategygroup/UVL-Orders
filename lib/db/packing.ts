// Reads and writes for the Packing screen (stage 3: packing by weight).
// The packing role may read orders, order lines, products, weeks, customers,
// pallet groups, and names; and read and write packing_lines (marks and
// counts), packing_weights, and packing_orders (pallet). Nothing else.

import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName, sortByDisplayName } from "../calc/customers";
import { num } from "../calc/num";
import type { PackLine, Weight } from "../calc/packing";
import type { Qty } from "../calc/types";

export type PackProduct = { id: string; name: string; unit: string; sort: number };

/** Marks on one line: an optional piece count, not filled, and a flag. */
export type LineMark = { count: number | null; shorted: boolean; flagged: boolean; flagNote: string };

export type PackWeight = Weight & { id: string; by: string | null; at: string };

export type PackOrder = {
  id: string;
  customerName: string;
  /** The customer's standing notes (delivery times and so on). */
  standingNotes: string;
  /** Notes on this week's order. */
  orderNotes: string;
  /** Pallet group and spot ("Bellingham Stores", "Left half"), if set. */
  group: string | null;
  spot: string;
  lines: Qty;
  /** Lines taken in another unit than the product's own ("lb" for a piece product). */
  units: Record<string, string>;
  marks: Record<string, LineMark>;
  weights: PackWeight[];
  pallet: string;
  /** Who last weighed or marked something, and when. */
  lastBy: string | null;
  lastAt: string | null;
};

export type PackingData = {
  week: string;
  processDate: string | null;
  products: Map<string, PackProduct>;
  /** Orders with something on them, in pallet group order, then by name. */
  orders: PackOrder[];
};

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

/** Each line of an order as the packing rules see it. */
export function packLines(o: PackOrder, products: Map<string, PackProduct>): [string, PackLine][] {
  return Object.entries(o.lines)
    .filter(([, q]) => q > 0)
    .sort(([a], [b]) => (products.get(a)?.sort ?? 1e9) - (products.get(b)?.sort ?? 1e9))
    .map(([pid, q]) => {
      const m = o.marks[pid];
      const weight = o.weights.filter((w) => w.product_id === pid).reduce((s, w) => s + w.weight, 0);
      return [
        pid,
        {
          ordered: q,
          unit: o.units[pid] ?? products.get(pid)?.unit ?? "each",
          weight,
          count: m?.count ?? null,
          shorted: m?.shorted ?? false,
          flagged: m?.flagged ?? false,
          flagNote: m?.flagNote ?? "",
        },
      ];
    });
}

export async function loadPacking(db: SupabaseClient, week: string): Promise<PackingData> {
  const [weekRow, orders, customers, groups, products, people] = await Promise.all([
    db.from("weeks").select("process_date").eq("id", week).maybeSingle(),
    db
      .from("orders")
      .select(
        "id, customer_id, notes, order_lines(product_id, qty, unit), packing_lines(product_id, packed_qty, shorted, flagged, flag_note, packed_by, packed_at), packing_weights(id, product_id, weight, box_no, created_by, created_at), packing_orders(pallet, updated_by, updated_at, created_at)",
      )
      .eq("week_id", week),
    db.from("customers").select("id, name, active, call_day, parent_customer_id, notes, pallet_group_id, pallet_spot, pallet_sort"),
    db.from("pallet_groups").select("id, name, sort"),
    db.from("products").select("id, name, unit, sort").order("sort"),
    db.from("profiles").select("id, display_name"),
  ]);

  const custList = must(customers) as {
    id: string;
    name: string;
    active: boolean;
    call_day: string | null;
    parent_customer_id: string | null;
    notes: string;
    pallet_group_id: string | null;
    pallet_spot: string;
    pallet_sort: number;
  }[];
  const byId = new Map(custList.map((c) => [c.id, c]));
  const groupList = (must(groups) ?? []) as { id: string; name: string; sort: number }[];
  const groupById = new Map(groupList.map((g) => [g.id, g]));
  const names = new Map((must(people) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));

  type Row = {
    id: string;
    customer_id: string;
    notes: string;
    order_lines: { product_id: string; qty: number; unit: string | null }[];
    packing_lines: {
      product_id: string;
      packed_qty: number | null;
      shorted: boolean;
      flagged: boolean;
      flag_note: string;
      packed_by: string | null;
      packed_at: string;
    }[];
    packing_weights: { id: string; product_id: string; weight: number; box_no: number | null; created_by: string | null; created_at: string }[];
    packing_orders:
      | { pallet: string; updated_by: string | null; updated_at: string | null; created_at: string }
      | { pallet: string; updated_by: string | null; updated_at: string | null; created_at: string }[]
      | null;
  };

  const list: (PackOrder & { rank: [number, number, string] })[] = [];
  for (const o of must(orders) as Row[]) {
    const lines: Qty = {};
    const units: Record<string, string> = {};
    for (const l of o.order_lines ?? []) {
      if (num(l.qty) <= 0) continue;
      lines[l.product_id] = num(l.qty);
      if (l.unit) units[l.product_id] = l.unit;
    }
    if (!Object.keys(lines).length) continue;

    let lastAt: string | null = null;
    let lastBy: string | null = null;
    const touch = (at: string | null, by: string | null) => {
      if (at && (!lastAt || at > lastAt)) {
        lastAt = at;
        lastBy = by;
      }
    };
    const marks: Record<string, LineMark> = {};
    for (const p of o.packing_lines ?? []) {
      marks[p.product_id] = {
        count: p.packed_qty == null ? null : num(p.packed_qty),
        shorted: p.shorted,
        flagged: p.flagged,
        flagNote: p.flag_note ?? "",
      };
      touch(p.packed_at, p.packed_by);
    }
    const weights: PackWeight[] = (o.packing_weights ?? [])
      .map((w) => ({
        id: w.id,
        product_id: w.product_id,
        weight: num(w.weight),
        box_no: w.box_no,
        by: w.created_by ? (names.get(w.created_by) ?? "Someone") : null,
        at: w.created_at,
      }))
      .sort((a, b) => a.at.localeCompare(b.at));
    for (const w of o.packing_weights ?? []) touch(w.created_at, w.created_by);
    // packing_orders is one-to-one with orders, so it may come back as an object or a one-item list.
    const po = Array.isArray(o.packing_orders) ? o.packing_orders[0] : o.packing_orders;
    if (po) touch(po.updated_at ?? po.created_at, po.updated_by);

    const cust = byId.get(o.customer_id);
    const group = cust?.pallet_group_id ? groupById.get(cust.pallet_group_id) : undefined;
    const name = cust ? displayName(cust, byId) : "Unknown customer";
    list.push({
      id: o.id,
      customerName: name,
      standingNotes: (cust?.notes ?? "").trim(),
      orderNotes: (o.notes ?? "").trim(),
      group: group?.name ?? null,
      spot: cust?.pallet_spot ?? "",
      lines,
      units,
      marks,
      weights,
      pallet: po?.pallet ?? "",
      lastBy: lastBy ? (names.get(lastBy) ?? "Someone") : null,
      lastAt,
      // Pallet groups first, in their order; then everyone else by name.
      rank: group ? [0, group.sort * 10000 + (cust?.pallet_sort ?? 0), name] : [1, 0, name],
    });
  }

  // Ungrouped customers: alphabetical, locations under their chain.
  const custOrder = new Map(sortByDisplayName(custList, byId).map((c, i) => [displayName(c, byId), i]));
  list.sort(
    (a, b) =>
      a.rank[0] - b.rank[0] ||
      a.rank[1] - b.rank[1] ||
      (custOrder.get(a.rank[2]) ?? 1e9) - (custOrder.get(b.rank[2]) ?? 1e9),
  );

  const prods = (must(products) as PackProduct[]) ?? [];
  const wr = must(weekRow) as { process_date: string | null } | null;
  return {
    week,
    processDate: wr?.process_date ?? null,
    products: new Map(prods.map((p) => [p.id, p])),
    orders: list.map((o) => {
      const { rank, ...rest } = o;
      void rank;
      return rest;
    }),
  };
}

/** Record one weight (one box or case, or the whole line). Returns its id. */
export async function addWeight(
  db: SupabaseClient,
  orderId: string,
  productId: string,
  weight: number,
  boxNo: number | null,
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await db
    .from("packing_weights")
    .insert({ order_id: orderId, product_id: productId, weight, box_no: boxNo })
    .select("id")
    .single();
  return { id: (data?.id as string | undefined) ?? null, error: error ? error.message : null };
}

export async function removeWeight(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await db.from("packing_weights").delete().eq("id", id);
  return error ? error.message : null;
}

/** Save a line's marks: piece count, not filled, flag and note. */
export async function saveMark(
  db: SupabaseClient,
  orderId: string,
  productId: string,
  m: LineMark,
): Promise<string | null> {
  const { error } = await db.from("packing_lines").upsert(
    {
      order_id: orderId,
      product_id: productId,
      packed_qty: m.count,
      shorted: m.shorted,
      flagged: m.flagged,
      flag_note: m.flagNote,
    },
    { onConflict: "order_id,product_id" },
  );
  return error ? error.message : null;
}

/** Save the pallet a customer's order went on. */
export async function savePallet(db: SupabaseClient, orderId: string, pallet: string): Promise<string | null> {
  const { error } = await db.from("packing_orders").upsert({ order_id: orderId, pallet }, { onConflict: "order_id" });
  return error ? error.message : null;
}
