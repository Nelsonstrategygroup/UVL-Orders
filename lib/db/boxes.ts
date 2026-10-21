// Box types, box limits, and the box cap (SPEC 12). Read by Orders, Packing,
// the label list, and Setup; changed by admins in Setup.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BoxLimit, BoxSetup, BoxType } from "../calc/boxes";
import { num } from "../calc/num";

export type BoxLimitRow = BoxLimit & { product_id: string; note: string };

export async function loadBoxSetup(db: SupabaseClient): Promise<BoxSetup & { rows: BoxLimitRow[] }> {
  const [types, limits, settings] = await Promise.all([
    db.from("box_types").select("id, name, size_rank").eq("active", true).order("size_rank"),
    db.from("product_box_limits").select("product_id, box_type_id, max_count, max_lb, status, note"),
    db.from("app_settings").select("box_cap_lb").maybeSingle(),
  ]);
  if (types.error) throw new Error(types.error.message);
  if (limits.error) throw new Error(limits.error.message);
  const rows = (limits.data ?? []).map((l) => ({
    ...l,
    max_count: l.max_count == null ? null : num(l.max_count),
    max_lb: l.max_lb == null ? null : num(l.max_lb),
    note: l.note ?? "",
  })) as BoxLimitRow[];
  const byProduct = new Map<string, BoxLimit[]>();
  for (const r of rows) byProduct.set(r.product_id, [...(byProduct.get(r.product_id) ?? []), r]);
  return {
    types: (types.data ?? []) as BoxType[],
    limits: byProduct,
    capLb: num(settings.data?.box_cap_lb) || 45,
    rows,
  };
}

/** Set one cell of the box grid (admins only; the database checks). */
export async function saveBoxLimit(
  db: SupabaseClient,
  row: { product_id: string; box_type_id: string; max_count: number | null; max_lb: number | null; status: BoxLimit["status"]; note: string },
) {
  const { error } = await db.from("product_box_limits").upsert(row, { onConflict: "product_id,box_type_id" });
  return error ? error.message : null;
}

export async function saveBoxCap(db: SupabaseClient, capLb: number) {
  const { error } = await db.from("app_settings").update({ box_cap_lb: capLb }).eq("id", true);
  return error ? error.message : null;
}
