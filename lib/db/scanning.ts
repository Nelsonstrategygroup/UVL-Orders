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

/** A pallet this week (scan-to-pallet routing, change request 10/26/26). */
export type PalletRow = {
  id: string;
  week_id: string;
  tag: string;
  status: "planned" | "open" | "full" | "shipped";
  created_at: string;
  /** Its shipments: "point:<id>" for a distributor, "customer:<id>" for Direct. */
  shipKeys: string[];
  /** Planned boxes (empty until the planner). */
  plan: { customerId: string; productId: string; boxes: number }[];
  /** Customers (stores) planned onto this pallet for the week (pallet_customers). */
  customers: string[];
};

type PalletDb = {
  id: string;
  week_id: string;
  tag: string;
  status: PalletRow["status"];
  created_at: string;
  pallet_shipments: { shipments: { ship_to_customer_id: string | null; ship_to_point_id: string | null } | null }[] | null;
  pallet_plan_lines: { customer_id: string; product_id: string; planned_boxes: number }[] | null;
  pallet_customers: { customer_id: string }[] | null;
};

/** The week's pallets, oldest first. */
export async function loadPallets(db: SupabaseClient, week: string): Promise<PalletRow[]> {
  const { data, error } = await db
    .from("pallets")
    .select(
      "id, week_id, tag, status, created_at, pallet_shipments(shipments(ship_to_customer_id, ship_to_point_id)), pallet_plan_lines(customer_id, product_id, planned_boxes), pallet_customers(customer_id)",
    )
    .eq("week_id", week)
    .order("created_at");
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as PalletDb[]).map((p) => ({
    id: p.id,
    week_id: p.week_id,
    tag: p.tag,
    status: p.status,
    created_at: p.created_at,
    shipKeys: (p.pallet_shipments ?? [])
      .map((l) => l.shipments)
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((x) => (x.ship_to_point_id ? `point:${x.ship_to_point_id}` : `customer:${x.ship_to_customer_id}`)),
    plan: (p.pallet_plan_lines ?? []).map((l) => ({ customerId: l.customer_id, productId: l.product_id, boxes: l.planned_boxes })),
    customers: (p.pallet_customers ?? []).map((c) => c.customer_id),
  }));
}

/** One box, as sent to record_box() (SPEC 11.11). */
export type BoxUpload = {
  client_id: string;
  /** Null for an unassigned box (no open order needed it); then week_id. */
  order_id: string | null;
  week_id?: string | null;
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
  /** Which box of the customer's product this is, and its label number (10/26/26). */
  slot?: number | null;
  label_no?: number | null;
  /** Scan-to-pallet routing (10/26/26): the box type, how the customer was chosen, what was suggested, and the boxes planned (to flag over-packing). */
  box_type_id?: string | null;
  route?: "suggested" | "other" | "picked" | "locked" | "unassigned" | null;
  suggested_order_id?: string | null;
  planned_boxes?: number | null;
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
