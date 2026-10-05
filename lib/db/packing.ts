// Reads and writes for the Packing screen. The packing role may read orders,
// order lines, products, weeks, customers, and names; and read and write
// packing_lines and packing_orders (SPEC 4.8). Nothing else is touched here.

import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName, sortByDisplayName } from "../calc/customers";
import { num } from "../calc/num";
import type { Qty } from "../calc/types";

export type PackProduct = { id: string; name: string; unit: string; sort: number };

export type PackOrder = {
  id: string;
  customerName: string;
  lines: Qty;
  packed: Qty;
  boxes: number | null;
  pallet: string;
  /** Who last packed a line or changed boxes and pallet, and when. */
  lastBy: string | null;
  lastAt: string | null;
};

export type PackingData = {
  week: string;
  processDate: string | null;
  products: Map<string, PackProduct>;
  /** Orders with something on them, sorted so locations sit under their chain. */
  orders: PackOrder[];
};

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export async function loadPacking(db: SupabaseClient, week: string): Promise<PackingData> {
  const [weekRow, orders, customers, products, people] = await Promise.all([
    db.from("weeks").select("process_date").eq("id", week).maybeSingle(),
    db
      .from("orders")
      .select(
        "id, customer_id, order_lines(product_id, qty), packing_lines(product_id, packed_qty, packed_by, packed_at), packing_orders(boxes, pallet, updated_by, updated_at, created_at)",
      )
      .eq("week_id", week),
    db.from("customers").select("id, name, active, call_day, parent_customer_id"),
    db.from("products").select("id, name, unit, sort").order("sort"),
    db.from("profiles").select("id, display_name"),
  ]);

  const custList = must(customers) as {
    id: string;
    name: string;
    active: boolean;
    call_day: string | null;
    parent_customer_id: string | null;
  }[];
  const byId = new Map(custList.map((c) => [c.id, c]));
  const names = new Map((must(people) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));

  type Row = {
    id: string;
    customer_id: string;
    order_lines: { product_id: string; qty: number }[];
    packing_lines: { product_id: string; packed_qty: number; packed_by: string | null; packed_at: string }[];
    packing_orders:
      | { boxes: number | null; pallet: string; updated_by: string | null; updated_at: string | null; created_at: string }
      | { boxes: number | null; pallet: string; updated_by: string | null; updated_at: string | null; created_at: string }[]
      | null;
  };

  const list: PackOrder[] = [];
  for (const o of must(orders) as Row[]) {
    const lines: Qty = {};
    for (const l of o.order_lines ?? []) if (num(l.qty) > 0) lines[l.product_id] = num(l.qty);
    if (!Object.keys(lines).length) continue;

    const packed: Qty = {};
    let lastAt: string | null = null;
    let lastBy: string | null = null;
    const touch = (at: string | null, by: string | null) => {
      if (at && (!lastAt || at > lastAt)) {
        lastAt = at;
        lastBy = by;
      }
    };
    for (const p of o.packing_lines ?? []) {
      packed[p.product_id] = num(p.packed_qty);
      touch(p.packed_at, p.packed_by);
    }
    // packing_orders is one-to-one with orders, so it may come back as an object or a one-item list.
    const po = Array.isArray(o.packing_orders) ? o.packing_orders[0] : o.packing_orders;
    if (po) touch(po.updated_at ?? po.created_at, po.updated_by);

    const cust = byId.get(o.customer_id);
    list.push({
      id: o.id,
      customerName: cust ? displayName(cust, byId) : "Unknown customer",
      lines,
      packed,
      boxes: po?.boxes ?? null,
      pallet: po?.pallet ?? "",
      lastBy: lastBy ? (names.get(lastBy) ?? "Someone") : null,
      lastAt,
    });
  }

  // Same order as the office screens: alphabetical, locations under their chain.
  const custOrder = sortByDisplayName(custList, byId).map((c) => displayName(c, byId));
  const rank = new Map(custOrder.map((n, i) => [n, i]));
  list.sort((a, b) => (rank.get(a.customerName) ?? 1e9) - (rank.get(b.customerName) ?? 1e9));

  const prods = (must(products) as PackProduct[]) ?? [];
  const wr = must(weekRow) as { process_date: string | null } | null;
  return { week, processDate: wr?.process_date ?? null, products: new Map(prods.map((p) => [p.id, p])), orders: list };
}

/** Save how much of one line is packed. The database records who and when. */
export async function savePacked(db: SupabaseClient, orderId: string, productId: string, qty: number) {
  const { error } = await db
    .from("packing_lines")
    .upsert({ order_id: orderId, product_id: productId, packed_qty: Math.max(0, qty) }, { onConflict: "order_id,product_id" });
  return error ? error.message : null;
}

/** Save boxes and pallet for one customer's order. */
export async function savePackMeta(db: SupabaseClient, orderId: string, meta: { boxes: number | null; pallet: string }) {
  const { error } = await db
    .from("packing_orders")
    .upsert({ order_id: orderId, boxes: meta.boxes, pallet: meta.pallet }, { onConflict: "order_id" });
  return error ? error.message : null;
}
