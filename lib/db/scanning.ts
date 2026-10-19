// Scanning data (SPEC 11): which product a box label's GTIN is, and the lots
// remembered per GTIN + pack date. Packing's scan screen and Setup use these.

import type { SupabaseClient } from "@supabase/supabase-js";

export type GtinRow = { gtin: string; product_id: string; note: string; created_at: string };
export type LotRow = { gtin: string; pack_date: string; lot: string };

const err = (e: { message: string } | null) => (e ? e.message : null);

export async function loadGtins(db: SupabaseClient): Promise<GtinRow[]> {
  const { data, error } = await db.from("gtin_products").select("gtin, product_id, note, created_at").order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as GtinRow[];
}

/** Add a GTIN or point it at another product (admins only; the database checks). */
export async function saveGtin(db: SupabaseClient, gtin: string, productId: string, note = "") {
  const { error } = await db.from("gtin_products").upsert({ gtin, product_id: productId, note }, { onConflict: "gtin" });
  return err(error);
}

export async function deleteGtin(db: SupabaseClient, gtin: string) {
  const { error } = await db.from("gtin_products").delete().eq("gtin", gtin);
  return err(error);
}

export async function loadLots(db: SupabaseClient): Promise<LotRow[]> {
  const { data, error } = await db.from("lots").select("gtin, pack_date, lot").order("pack_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as LotRow[];
}
