// Freezer boxes, counts and value (Lucas and Kathy, 11/19-20/26).
//
// Kathy's rule: product put in the freezer counts at a percent (90%) of its
// default sale price, because some of it never sells at full price. A box's
// value is fixed the day it goes in; whatever comes out is taken back at that
// value, never today's price. The database works the value out the same way
// (public.freezer_value) and keeps it on the box; valueOf here is for the
// screens and the tests.
//
// A count lines up what was scanned or counted by hand with what the app
// thinks is in the freezer. Nothing changes until the count is applied.
//
// Money is exact (BigInt cents), like the rest of the P&L.

import { toFixedInt } from "./prices";
import { roundToCents } from "./lambCost";

const ZERO = BigInt(0);

// ---------------------------------------------------------------------------
// Value
// ---------------------------------------------------------------------------

export type ValueInput = {
  /** The default sale price on the day (null: none). Up to 4 decimals. */
  price: number | string | null;
  priceUnit: "lb" | "case" | "each" | string | null;
  /** The freezer value percent on the day (90). Null: none set. */
  percent: number | string | null;
  /** Pieces, packs or cases, in the product's unit. */
  qty: number | string;
  weightLb: number | string | null;
};

export type BoxValue = { cents: bigint | null; note: string };

export const NO_PRICE = "No freezer value: no default price";
export const NO_PERCENT = "No freezer value: no percent set in P&L Setup";
export const NO_WEIGHT = "No freezer value: no weight";

/** weight (lb price) or count (case or each price) x price x percent, half up to the cent. */
export function valueOf(v: ValueInput): BoxValue {
  if (v.price == null || v.price === "") return { cents: null, note: NO_PRICE };
  if (v.percent == null || v.percent === "") return { cents: null, note: NO_PERCENT };
  const byWeight = v.priceUnit === "lb";
  const amount = byWeight ? v.weightLb : v.qty;
  if (amount == null || amount === "" || Number(amount) <= 0) return { cents: null, note: byWeight ? NO_WEIGHT : "No freezer value: no count" };
  // amount (3 decimals) x price (4) x percent (4) / 100 = dollars with 11 + 2 decimals; to cents.
  const raw = toFixedInt(trim(amount, 3), 3) * toFixedInt(trim(v.price, 4), 4) * toFixedInt(trim(v.percent, 4), 4);
  return { cents: roundToCents(raw, 13), note: "" };
}

/** A decimal string with at most `places` decimals (a typed weight may have more; it's rounded). */
function trim(v: number | string, places: number): string {
  const s = typeof v === "number" ? String(v) : v.trim();
  const [, f = ""] = s.split(".");
  if (f.length <= places) return s;
  return Number(s).toFixed(places);
}

/** What part of a box's value a take-out takes back: value x taken / box count, half up to the cent. */
export function takeValue(boxCents: bigint | null, boxQty: number | string, takenQty: number | string): bigint | null {
  if (boxCents == null) return null;
  const q = toFixedInt(trim(boxQty, 3), 3);
  const t = toFixedInt(trim(takenQty, 3), 3);
  if (q <= ZERO) return null;
  if (t === q) return boxCents;
  // Values are never negative.
  return (boxCents * t * BigInt(2) + q) / (q * BigInt(2));
}

// ---------------------------------------------------------------------------
// The P&L lines: Into freezer and Out of freezer
// ---------------------------------------------------------------------------

export type ValuedBox = {
  id: string;
  product_id: string;
  qty: number | string;
  weight_lb: number | string | null;
  added_on: string;
  week_id: string;
  counts_as_income: boolean;
  reason: string;
  serial: string | null;
  /** From freezer_box_values. */
  price: number | string | null;
  price_unit: string | null;
  percent: number | string | null;
  value: number | string | null;
  note: string;
};

export type ValuedTake = {
  id: string;
  box_id: string;
  qty: number | string;
  taken_on: string;
  week_id: string;
  reason: string;
  counts_in_pnl: boolean;
};

export type FreezerLineRow = {
  id: string;
  boxId: string;
  productId: string;
  date: string;
  qty: number;
  weightLb: number | null;
  serial: string | null;
  price: string | null;
  priceUnit: string | null;
  percent: string | null;
  cents: bigint | null;
  note: string;
  reason: string;
};

export type FreezerLine = { cents: bigint; rows: FreezerLineRow[]; noValue: FreezerLineRow[] };

const str = (v: number | string | null) => (v == null || v === "" ? null : String(v));
const n = (v: number | string | null) => (v == null || v === "" ? null : Number(v));
const boxCents = (b: ValuedBox) => (b.value == null || b.value === "" ? null : toFixedInt(String(b.value), 2));

/** Into freezer for a week: boxes counting as income in it. Positive. */
export function freezerIn(week: string, boxes: ValuedBox[]): FreezerLine {
  const rows = boxes
    .filter((b) => b.week_id === week && b.counts_as_income)
    .map<FreezerLineRow>((b) => ({
      id: b.id,
      boxId: b.id,
      productId: b.product_id,
      date: b.added_on,
      qty: Number(b.qty),
      weightLb: n(b.weight_lb),
      serial: b.serial,
      price: str(b.price),
      priceUnit: b.price_unit,
      percent: str(b.percent),
      cents: boxCents(b),
      note: b.note,
      reason: b.reason,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.productId.localeCompare(b.productId));
  return total(rows);
}

/** Out of freezer for a week: take-outs counting on the P&L, at the value their box went in at. Negative. */
export function freezerOut(week: string, takes: ValuedTake[], boxes: ValuedBox[]): FreezerLine {
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const rows: FreezerLineRow[] = [];
  for (const t of takes) {
    if (t.week_id !== week || !t.counts_in_pnl) continue;
    const b = byId.get(t.box_id);
    if (!b) continue;
    const v = takeValue(boxCents(b), b.qty, t.qty);
    rows.push({
      id: t.id,
      boxId: b.id,
      productId: b.product_id,
      date: t.taken_on,
      qty: Number(t.qty),
      weightLb: n(b.weight_lb) == null ? null : (Number(b.weight_lb) * Number(t.qty)) / Number(b.qty),
      serial: b.serial,
      price: str(b.price),
      priceUnit: b.price_unit,
      percent: str(b.percent),
      cents: v == null ? null : -v,
      note: b.note,
      reason: t.reason,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.productId.localeCompare(b.productId));
  return total(rows);
}

function total(rows: FreezerLineRow[]): FreezerLine {
  return {
    cents: rows.reduce((s, r) => s + (r.cents ?? ZERO), ZERO),
    rows,
    noValue: rows.filter((r) => r.cents == null),
  };
}

/** What's in the freezer now, valued: each box's value for what's left in it. */
export function freezerBalance(boxes: (ValuedBox & { qty_left: number | string })[]): { cents: bigint; boxes: number; noValue: number } {
  let cents = ZERO;
  let count = 0;
  let noValue = 0;
  for (const b of boxes) {
    if (!(Number(b.qty_left) > 0)) continue;
    count++;
    const v = takeValue(boxCents(b), b.qty, b.qty_left);
    if (v == null) noValue++;
    else cents += v;
  }
  return { cents, boxes: count, noValue };
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

export type CountItem = {
  id: string;
  kind: "scan" | "manual";
  product_id: string | null;
  qty: number;
  weight_lb: number | null;
  gtin: string | null;
  serial: string | null;
  lot: string | null;
  pack_date: string | null;
  product_confirmed: boolean;
  decision: "add" | "skip" | null;
  voided: boolean;
  scanned_at: string;
  device_id: string;
};

export type InBox = {
  id: string;
  product_id: string;
  qty_left: number;
  weight_lb: number | null;
  gtin: string | null;
  serial: string | null;
  lot: string | null;
  pack_date: string | null;
  added_on: string;
};

/** A box packed for a customer (GTIN + serial), e.g. Emerson's held in the freezer. */
export type HeldBox = { gtin: string; serial: string; customer: string; week_id: string };

export type ProductReview = {
  productId: string;
  /** In the app and counted. */
  matched: { item: CountItem; box: InBox }[];
  /** Counted but not in the app. added: will be added when the count is applied. */
  found: { item: CountItem; added: boolean }[];
  /** Counted, but packed for a customer: shown, never added. */
  held: { item: CountItem; held: HeldBox }[];
  /** In the app (as a box) but not counted. */
  notCounted: InBox[];
  /** On hand in the app (freezer log: boxes and everything added by count alone). */
  app: number;
  /** Counted: matched + found (held boxes aren't the freezer's). */
  counted: number;
  difference: number;
};

export type CountReview = {
  products: ProductReview[];
  /** Scans with no product yet (an unknown label not picked). */
  noProduct: CountItem[];
  /** Scans of products this count doesn't cover (left out). */
  outOfScope: CountItem[];
  totals: { app: number; counted: number; difference: number };
};

const key = (gtin: string | null, serial: string | null) => (gtin && serial ? `${gtin}|${serial}` : null);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Line up a count with the app. `scope` null: the whole freezer, else only
 * these products. `onHand`: the app's quantity per product (freezer log).
 * In a reconciliation, found boxes are added only when marked Add; in a
 * stock-in count every one is added unless skipped.
 */
export function reviewCount(input: {
  kind: "stock_in" | "reconcile";
  scope: string[] | null;
  items: CountItem[];
  boxes: InBox[];
  onHand: Record<string, number>;
  held: HeldBox[];
}): CountReview {
  const inScope = (pid: string) => !input.scope || input.scope.includes(pid);
  const live = input.items.filter((i) => !i.voided);
  const boxByKey = new Map<string, InBox>();
  for (const b of input.boxes) {
    const k = key(b.gtin, b.serial);
    if (k && b.qty_left > 0) boxByKey.set(k, b);
  }
  const heldByKey = new Map(input.held.map((h) => [key(h.gtin, h.serial)!, h]));
  const per = new Map<string, ProductReview>();
  const get = (pid: string) => {
    let p = per.get(pid);
    if (!p) {
      p = { productId: pid, matched: [], found: [], held: [], notCounted: [], app: 0, counted: 0, difference: 0 };
      per.set(pid, p);
    }
    return p;
  };
  const used = new Set<string>();
  const seen = new Set<string>();
  const noProduct: CountItem[] = [];
  const outOfScope: CountItem[] = [];
  for (const item of [...live].sort((a, b) => a.scanned_at.localeCompare(b.scanned_at))) {
    const k = key(item.gtin, item.serial);
    if (k && seen.has(k)) continue; // the same box twice: once
    if (k) seen.add(k);
    const box = k ? boxByKey.get(k) : undefined;
    // A product this count doesn't cover: left out of it.
    const pid = box?.product_id ?? item.product_id;
    if (pid && !inScope(pid)) {
      outOfScope.push(item);
      continue;
    }
    if (box) {
      used.add(box.id);
      get(box.product_id).matched.push({ item, box });
      continue;
    }
    const h = k ? heldByKey.get(k) : undefined;
    if (!item.product_id) {
      if (!h) noProduct.push(item);
      continue;
    }
    if (h) {
      get(item.product_id).held.push({ item, held: h });
      continue;
    }
    const added = input.kind === "stock_in" ? item.decision !== "skip" : item.decision === "add";
    get(item.product_id).found.push({ item, added });
  }
  for (const b of input.boxes) {
    if (b.qty_left > 0 && !used.has(b.id) && inScope(b.product_id)) get(b.product_id).notCounted.push(b);
  }
  // Every product with something on hand is in a reconciliation's totals, counted or not.
  if (input.kind === "reconcile")
    for (const [pid, q] of Object.entries(input.onHand)) if (q !== 0 && inScope(pid)) get(pid);
  const products = [...per.values()]
    .map((p) => {
      const counted = r3(p.matched.reduce((s, m) => s + m.item.qty, 0) + p.found.reduce((s, f) => s + f.item.qty, 0));
      const app = r3(input.onHand[p.productId] ?? 0);
      return { ...p, app, counted, difference: r3(counted - app) };
    });
  const totals = products.reduce(
    (t, p) => ({ app: r3(t.app + p.app), counted: r3(t.counted + p.counted), difference: r3(t.difference + p.difference) }),
    { app: 0, counted: 0, difference: 0 },
  );
  return { products, noProduct, outOfScope, totals };
}

/** The count item ids to add when a count is applied. */
export function itemsToAdd(review: CountReview): string[] {
  return review.products.flatMap((p) => p.found.filter((f) => f.added).map((f) => f.item.id));
}

export const REMOVE_REASONS = [
  ["sold", "Sold"],
  ["used", "Used"],
  ["discarded", "Discarded"],
  ["not_found", "Not found"],
  ["other", "Other"],
] as const;
export type RemoveReason = (typeof REMOVE_REASONS)[number][0];

export const ADD_REASONS = [
  ["added_manually", "Added manually"],
  ["found", "Found in freezer"],
  ["put_away", "Put away outside packing"],
  ["other", "Other"],
] as const;

/** Average pounds per piece from boxes with both a count and a weight (null without any). */
export function averageWeight(boxes: { qty: number | string; weight_lb: number | string | null }[]): number | null {
  let lb = 0;
  let pcs = 0;
  for (const b of boxes) {
    const w = Number(b.weight_lb);
    const q = Number(b.qty);
    if (w > 0 && q > 0) {
      lb += w;
      pcs += q;
    }
  }
  return pcs > 0 ? Math.round((lb / pcs) * 100) / 100 : null;
}

/** What the count saves as its record (the review as shown, without the full box rows). */
export function countResults(review: CountReview, removals: { box_id: string; reason: string; note: string }[]) {
  return {
    totals: review.totals,
    products: review.products.map((p) => ({
      product_id: p.productId,
      app: p.app,
      counted: p.counted,
      difference: p.difference,
      matched: p.matched.length,
      found: p.found.map((f) => ({ item_id: f.item.id, serial: f.item.serial, qty: f.item.qty, weight_lb: f.item.weight_lb, added: f.added })),
      held: p.held.map((h) => ({ serial: h.item.serial, customer: h.held.customer })),
      not_counted: p.notCounted.map((b) => {
        const r = removals.find((x) => x.box_id === b.id);
        return { box_id: b.id, serial: b.serial, qty: b.qty_left, weight_lb: b.weight_lb, removed: r ? r.reason : null, note: r?.note ?? "" };
      }),
    })),
    no_product: review.noProduct.length,
  };
}
