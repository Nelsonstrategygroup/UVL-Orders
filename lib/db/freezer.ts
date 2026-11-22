// Freezer boxes, take-outs, counts and value (migration 20261125000400).
// Loaders for the freezer screens, and the copy kept on the phone so Add to
// freezer and counts work with no signal (the freezer has none).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CountItem, InBox, ValuedBox, ValuedTake } from "../calc/freezer";

const PAGE = 1000;
const HELD_DAYS = 120;

async function all<T>(page: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let a = 0; ; a += PAGE) {
    const { data, error } = await page(a, a + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

export type FreezerProduct = {
  id: string;
  name: string;
  unit: string;
  lb_per_unit: number | null;
  active: boolean;
  fresh_only: boolean;
  sort: number;
};

export type FreezerBoxRow = InBox & {
  qty: number;
  serial_date: string | null;
  case_no: string | null;
  product_confirmed: boolean;
  source: string;
  reason: string;
  note: string;
  week_id: string;
  counts_as_income: boolean;
  client_id: string | null;
  created_by: string | null;
  created_at: string;
};

export type FreezerCountRow = {
  id: string;
  kind: "stock_in" | "reconcile";
  product_ids: string[] | null;
  status: "open" | "applied" | "discarded";
  count_date: string;
  note: string;
  started_by: string | null;
  started_at: string;
  applied_by: string | null;
  applied_at: string | null;
  applied_anyway: boolean;
  results: Record<string, unknown> | null;
};

export type CountDevice = { device_id: string; person_name: string; waiting: number; last_seen: string };

/** Everything Add to freezer and a count need, kept on the phone. */
export type FreezerBundle = {
  products: FreezerProduct[];
  gtins: { gtin: string; product_id: string }[];
  lots: { gtin: string; pack_date: string; lot: string }[];
  /** Boxes still in the freezer. */
  boxes: FreezerBoxRow[];
  /** On hand per product (the freezer log). */
  onHand: Record<string, number>;
  /** Boxes packed for a customer (recent weeks), by label. */
  held: { gtin: string; serial: string; customer: string; week_id: string }[];
  /** The open count, its items and phones. */
  count: FreezerCountRow | null;
  items: CountItem[];
  devices: CountDevice[];
  /** People's names, for "Started by". */
  people: Record<string, string>;
};

const BOX_COLS =
  "id, client_id, product_id, qty, qty_left, weight_lb, gtin, serial, serial_date, case_no, pack_date, lot, product_confirmed, source, reason, note, added_on, week_id, counts_as_income, created_by, created_at";
const COUNT_COLS =
  "id, kind, product_ids, status, count_date, note, started_by, started_at, applied_by, applied_at, applied_anyway, results";
const ITEM_COLS =
  "id, kind, product_id, qty, weight_lb, gtin, serial, lot, pack_date, product_confirmed, decision, voided, scanned_at, device_id";

const numOrNull = (v: unknown) => (v == null || v === "" ? null : Number(v));

function toBox(r: Record<string, unknown>): FreezerBoxRow {
  return {
    ...(r as unknown as FreezerBoxRow),
    qty: Number(r.qty),
    qty_left: Number(r.qty_left),
    weight_lb: numOrNull(r.weight_lb),
  };
}

export function toItem(r: Record<string, unknown>): CountItem {
  return { ...(r as unknown as CountItem), qty: Number(r.qty), weight_lb: numOrNull(r.weight_lb) };
}

export async function loadFreezerBundle(db: SupabaseClient): Promise<FreezerBundle> {
  const since = new Date(Date.now() - HELD_DAYS * 86400000).toISOString();
  const [products, gtins, lots, boxes, log, held, counts, people] = await Promise.all([
    all<FreezerProduct>((a, b) => db.from("products").select("id, name, unit, lb_per_unit, active, fresh_only, sort").order("sort").range(a, b)),
    all<{ gtin: string; product_id: string }>((a, b) => db.from("gtin_products").select("gtin, product_id").range(a, b)),
    all<{ gtin: string; pack_date: string; lot: string }>((a, b) => db.from("lots").select("gtin, pack_date, lot").range(a, b)),
    all<Record<string, unknown>>((a, b) => db.from("freezer_boxes").select(BOX_COLS).gt("qty_left", 0).order("added_on").range(a, b)),
    all<{ product_id: string; qty: number | string }>((a, b) => db.from("freezer_log").select("product_id, qty").range(a, b)),
    all<{ gtin: string; serial: string; orders: { week_id: string; customers: { name: string } | null } | null }>((a, b) =>
      db
        .from("packing_weights")
        .select("gtin, serial, orders(week_id, customers(name))")
        .not("serial", "is", null)
        .not("order_id", "is", null)
        .gte("created_at", since)
        .order("id")
        .range(a, b),
    ),
    db.from("freezer_counts").select(COUNT_COLS).eq("status", "open").limit(1),
    // Names only label who started a count; a phone that can't read them still works.
    all<{ id: string; display_name: string }>((a, b) => db.from("profiles").select("id, display_name").range(a, b)).catch(() => []),
  ]);
  if (counts.error) throw new Error(counts.error.message);
  const count = ((counts.data ?? [])[0] as FreezerCountRow | undefined) ?? null;
  let items: CountItem[] = [];
  let devices: CountDevice[] = [];
  if (count) {
    const [it, dv] = await Promise.all([
      all<Record<string, unknown>>((a, b) => db.from("freezer_count_items").select(ITEM_COLS).eq("count_id", count.id).order("scanned_at").range(a, b)),
      db.from("freezer_count_devices").select("device_id, person_name, waiting, last_seen").eq("count_id", count.id),
    ]);
    if (dv.error) throw new Error(dv.error.message);
    items = it.map(toItem);
    devices = (dv.data ?? []) as CountDevice[];
  }
  const onHand: Record<string, number> = {};
  for (const l of log) onHand[l.product_id] = Math.round(((onHand[l.product_id] ?? 0) + Number(l.qty)) * 1000) / 1000;
  return {
    products: products.map((p) => ({ ...p, lb_per_unit: numOrNull(p.lb_per_unit) })),
    gtins,
    lots,
    boxes: boxes.map(toBox),
    onHand,
    held: held
      .filter((h) => h.orders)
      .map((h) => ({ gtin: h.gtin, serial: h.serial, customer: h.orders?.customers?.name ?? "a customer", week_id: h.orders!.week_id })),
    count,
    items,
    devices,
    people: Object.fromEntries(people.map((p) => [p.id, p.display_name])),
  };
}

// ---------------------------------------------------------------------------
// The Freezer screen (online): boxes, take-outs, values (admin), past counts.
// ---------------------------------------------------------------------------

export type FreezerScreenData = {
  boxes: (FreezerBoxRow & Partial<Pick<ValuedBox, "price" | "price_unit" | "percent" | "value">> & { value_note: string })[];
  takes: (ValuedTake & { note: string; count_id: string | null; created_at: string })[];
  counts: FreezerCountRow[];
  /** Admins (and the P&L) only: the freezer value percent from dates on. */
  rates: { id: string; effective_from: string; percent: number; note: string }[];
};

export async function loadFreezerScreen(db: SupabaseClient, withValues: boolean): Promise<FreezerScreenData> {
  const [boxes, takes, counts, values, rates] = await Promise.all([
    all<Record<string, unknown>>((a, b) => db.from("freezer_boxes").select(BOX_COLS).order("added_on", { ascending: false }).range(a, b)),
    all<ValuedTake & { note: string; count_id: string | null; created_at: string }>((a, b) =>
      db.from("freezer_takes").select("id, box_id, qty, taken_on, week_id, reason, note, counts_in_pnl, count_id, created_at").range(a, b),
    ),
    all<FreezerCountRow>((a, b) => db.from("freezer_counts").select(COUNT_COLS).neq("status", "open").order("started_at", { ascending: false }).range(a, b)),
    withValues
      ? all<{ box_id: string; price: string | null; price_unit: string | null; percent: string | null; value: string | null; note: string }>((a, b) =>
          db.from("freezer_box_values").select("box_id, price, price_unit, percent, value, note").range(a, b),
        )
      : Promise.resolve([]),
    withValues
      ? all<{ id: string; effective_from: string; percent: number; note: string }>((a, b) =>
          db.from("freezer_value_rates").select("id, effective_from, percent, note").order("effective_from").range(a, b),
        )
      : Promise.resolve([]),
  ]);
  const byBox = new Map(values.map((v) => [v.box_id, v]));
  return {
    boxes: boxes.map((r) => {
      const v = byBox.get(r.id as string);
      return { ...toBox(r), price: v?.price ?? null, price_unit: v?.price_unit ?? null, percent: v?.percent ?? null, value: v?.value ?? null, value_note: v?.note ?? "" };
    }),
    takes: takes.map((t) => ({ ...t, qty: Number(t.qty) })),
    counts,
    rates: rates.map((r) => ({ ...r, percent: Number(r.percent) })),
  };
}

export async function loadCount(db: SupabaseClient, id: string) {
  const [c, items] = await Promise.all([
    db.from("freezer_counts").select(COUNT_COLS).eq("id", id).maybeSingle(),
    all<Record<string, unknown>>((a, b) => db.from("freezer_count_items").select(ITEM_COLS).eq("count_id", id).order("scanned_at").range(a, b)),
  ]);
  if (c.error) throw new Error(c.error.message);
  return { count: (c.data as FreezerCountRow | null) ?? null, items: items.map(toItem) };
}

// ---------------------------------------------------------------------------
// Online actions (the rest go through the outbox).
// ---------------------------------------------------------------------------

const msg = (e: { message: string } | null) => (e ? e.message : null);

export async function setFreezerIncome(db: SupabaseClient, boxId: string, counts: boolean) {
  return msg((await db.rpc("set_freezer_income", { p_id: boxId, p_counts: counts })).error);
}

export async function confirmFreezerBox(db: SupabaseClient, boxId: string, productId: string) {
  return msg((await db.rpc("confirm_freezer_box", { p_id: boxId, p_product: productId })).error);
}

export async function removeFreezerBox(db: SupabaseClient, boxId: string) {
  return msg((await db.rpc("remove_freezer_box", { p_id: boxId })).error);
}

export async function takeFromFreezer(db: SupabaseClient, p: { box_id: string; qty?: number; reason: string; note: string }) {
  return msg((await db.rpc("take_from_freezer", { p })).error);
}

export async function applyCount(
  db: SupabaseClient,
  p: { count: string; adds: string[]; removals: { box_id: string; reason: string; note: string }[]; results: unknown; anyway: boolean },
) {
  return msg(
    (await db.rpc("apply_freezer_count", { p_count: p.count, p_adds: p.adds, p_removals: p.removals, p_results: p.results, p_anyway: p.anyway })).error,
  );
}

export async function discardCount(db: SupabaseClient, id: string) {
  return msg((await db.rpc("discard_freezer_count", { p_count: id })).error);
}

export async function countCheckin(db: SupabaseClient, count: string, device: string, person: string, waiting: number) {
  return msg((await db.rpc("freezer_count_checkin", { p_count: count, p_device: device, p_person: person, p_waiting: waiting })).error);
}

export async function saveFreezerRate(db: SupabaseClient, r: { effective_from: string; percent: number; note: string }) {
  return msg((await db.from("freezer_value_rates").upsert(r, { onConflict: "effective_from" })).error);
}

export async function deleteFreezerRate(db: SupabaseClient, id: string) {
  return msg((await db.from("freezer_value_rates").delete().eq("id", id)).error);
}

/** This phone's name in a count (kept in the browser; a new one if storage is blocked). */
let fallbackDevice: string | null = null;
export function deviceId(): string {
  const make = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2));
  try {
    const k = "uvl-device-id";
    let v = localStorage.getItem(k);
    if (!v) {
      v = make();
      localStorage.setItem(k, v);
    }
    return v;
  } catch {
    fallbackDevice ??= make();
    return fallbackDevice;
  }
}
