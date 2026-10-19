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

export type PalletRow = { id: string; week_id: string; ship_date: string; number: number; pallet_group_id: string | null; label: string };

/** The pallets shipping on a day, in number order. */
export async function loadPallets(db: SupabaseClient, shipDate: string): Promise<PalletRow[]> {
  const { data, error } = await db
    .from("pallets")
    .select("id, week_id, ship_date, number, pallet_group_id, label")
    .eq("ship_date", shipDate)
    .order("number");
  if (error) throw new Error(error.message);
  return (data ?? []) as PalletRow[];
}

/** Start the next pallet for a ship date ("Pallet 3"). Returns it, or an error. */
export async function addPallet(
  db: SupabaseClient,
  weekId: string,
  shipDate: string,
  number: number,
  label: string,
  palletGroupId: string | null,
): Promise<{ pallet: PalletRow | null; error: string | null }> {
  const { data, error } = await db
    .from("pallets")
    .insert({ week_id: weekId, ship_date: shipDate, number, label, pallet_group_id: palletGroupId })
    .select("id, week_id, ship_date, number, pallet_group_id, label")
    .single();
  return { pallet: (data as PalletRow) ?? null, error: err(error) };
}

/** One box, as sent to record_box() (SPEC 11.11). */
export type BoxUpload = {
  client_id: string;
  order_id: string;
  product_id: string;
  source: "scan" | "manual";
  weight: number;
  lot: string;
  gtin?: string | null;
  serial?: string | null;
  serial_date?: string | null;
  case_no?: string | null;
  pack_date?: string | null;
  pallet_id?: string | null;
  raw_scan?: string | null;
  photo_path?: string | null;
  scanned_at: string;
  off_order?: boolean;
};

export type BoxResult =
  | { status: "saved"; id: string; box_no: number }
  | { status: "already"; id: string }
  | { status: "duplicate"; id: string; customer: string }
  | { status: "gone" }
  | { status: "error"; message: string };

export async function recordBox(db: SupabaseClient, box: BoxUpload): Promise<BoxResult> {
  const { data, error } = await db.rpc("record_box", { p: box });
  if (error) return { status: "error", message: error.message };
  return data as BoxResult;
}

/** Only an admin can change a box's lot (the database enforces it and logs the old one). */
export async function setBoxLot(db: SupabaseClient, weightId: string, lot: string) {
  const { error } = await db.from("packing_weights").update({ lot }).eq("id", weightId);
  return err(error);
}

/** A photo of a label that wouldn't scan, shrunk on the phone first. Returns its storage path. */
export async function uploadBoxPhoto(db: SupabaseClient, path: string, photo: Blob) {
  const { error } = await db.storage.from("box-photos").upload(path, photo, { contentType: photo.type || "image/jpeg", upsert: false });
  return err(error);
}
