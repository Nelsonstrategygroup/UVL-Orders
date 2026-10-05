// Half and whole lamb orders and the freezer log (SPEC 4.6, 5.7, 5.8).

import type { SupabaseClient } from "@supabase/supabase-js";
import { num } from "../calc/num";
import type { HalfWholeOrder } from "../calc/types";

export type HWOrder = HalfWholeOrder & {
  customer_name: string;
  phone: string;
  need_by: string | null;
  notes: string;
  created_at: string;
};

export type FreezerRow = {
  id: string;
  entry_date: string;
  product_id: string;
  qty: number;
  note: string;
  created_at: string;
};

export type HalfWholeData = { orders: HWOrder[]; freezer: FreezerRow[] };

const PAGE = 1000;

async function all<T>(page: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let a = 0; ; a += PAGE) {
    const { data, error } = await page(a, a + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

export async function loadHalfWhole(db: SupabaseClient): Promise<HalfWholeData> {
  const [orders, freezer] = await Promise.all([
    all<Omit<HWOrder, "choices"> & { half_whole_choices: HWOrder["choices"] }>((a, b) =>
      db
        .from("half_whole_orders")
        .select("id, customer_name, phone, size, status, need_by, notes, created_at, half_whole_choices(part_id, slot, product_id)")
        .order("created_at")
        .range(a, b),
    ),
    all<FreezerRow>((a, b) =>
      db
        .from("freezer_log")
        .select("id, entry_date, product_id, qty, note, created_at")
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(a, b),
    ),
  ]);
  return {
    orders: orders.map(({ half_whole_choices, ...o }) => ({ ...o, choices: half_whole_choices ?? [] })),
    freezer: freezer.map((f) => ({ ...f, qty: num(f.qty) })),
  };
}

export type HWInput = {
  id: string | null;
  customer_name: string;
  phone: string;
  size: "half" | "whole";
  status: HalfWholeOrder["status"];
  need_by: string | null;
  notes: string;
  choices: { part_id: string; slot: number; product_id: string | null }[];
};

/** Save an order and all its choices in one step. Returns its id. */
export async function saveHalfWhole(db: SupabaseClient, o: HWInput) {
  const { choices, ...order } = o;
  const { data, error } = await db.rpc("save_half_whole", { p_order: order, p_choices: choices });
  return { id: (data as string | null) ?? null, error: error ? error.message : null };
}

export async function setHalfWholeStatus(db: SupabaseClient, id: string, status: HalfWholeOrder["status"]) {
  const { error } = await db.from("half_whole_orders").update({ status }).eq("id", id);
  return error ? error.message : null;
}

export async function addFreezerEntry(
  db: SupabaseClient,
  e: { product_id: string; qty: number; note: string; id?: string; entry_date?: string },
) {
  const { error } = await db.from("freezer_log").insert(e);
  return error ? error.message : null;
}

export async function removeFreezerEntry(db: SupabaseClient, id: string) {
  const { error } = await db.from("freezer_log").delete().eq("id", id);
  return error ? error.message : null;
}
