// What a scanned label means for the freezer (Add to freezer and counts,
// 11/19-20/26). Same GS1-128 parsing as Packing (lib/scan/gs1.ts). Pure, so
// it works on the phone with no signal.
//
// - A box already in the freezer: say so and don't add it twice (in a count
//   it's a match).
// - A box packed for a customer (Emerson's held boxes): shown, never added.
// - An unknown GTIN: an admin says which product it is (the app learns it);
//   anyone else picks the product for this box only, saved as "not
//   confirmed", for an admin to confirm later. Never an alert.
// - The count: pounds for a product counted in pounds; otherwise the person
//   types it, starting from the last count for that product (or the weight ÷
//   pounds per piece).

import { boxKey, parseLabel, type Gs1Box } from "../scan/gs1";
import { lotKey } from "../scan/flow";

export type FreezerScanProduct = { id: string; name: string; unit: string; lb_per_unit: number | null };

export type FreezerScanContext = {
  products: Map<string, FreezerScanProduct>;
  gtinMap: Map<string, string>;
  /** Known lots, by GTIN + pack date. */
  lots: Map<string, string>;
  /** Boxes in the freezer, by GTIN|serial: product id. */
  inFreezer: Map<string, string>;
  /** Boxes packed for a customer, by GTIN|serial: the customer. */
  held: Map<string, string>;
  /** Scanned already this time (this session or this count), by GTIN|serial. */
  scannedNow: Set<string>;
  /** The last count typed for each product this time. */
  lastCount: Map<string, number>;
};

export type FreezerScanStep =
  | { kind: "misread"; message: string }
  | { kind: "again"; message: string; box: Gs1Box }
  | { kind: "in-freezer"; message: string; box: Gs1Box; productId: string }
  | { kind: "held"; message: string; box: Gs1Box; customer: string }
  | { kind: "unknown-gtin"; message: string; box: Gs1Box }
  | { kind: "ready"; box: Gs1Box; productId: string; lot: string | null; qty: number; qtyIsWeight: boolean; confirmed: boolean };

/** How many to start the count at: the weight for pounds; else the last count, else weight ÷ lb per piece, else 1. */
export function startingCount(p: FreezerScanProduct | undefined, weightLb: number | null, last: number | undefined): { qty: number; isWeight: boolean } {
  if (p?.unit === "lb") return { qty: weightLb ?? 0, isWeight: true };
  if (last && last > 0) return { qty: last, isWeight: false };
  if (weightLb && p?.lb_per_unit && p.lb_per_unit > 0) return { qty: Math.max(1, Math.round(weightLb / p.lb_per_unit)), isWeight: false };
  return { qty: 1, isWeight: false };
}

/**
 * One label. `answers.productId`: the product picked for an unknown GTIN
 * (confirmed: picked by an admin, who teaches it).
 */
export function decideFreezerScan(
  raw: string | Gs1Box,
  ctx: FreezerScanContext,
  answers: { productId?: string; confirmed?: boolean } = {},
): FreezerScanStep {
  let box: Gs1Box;
  if (typeof raw === "string") {
    const r = parseLabel(raw);
    if (!r.ok) return { kind: "misread", message: r.message };
    box = r.box;
  } else box = raw;

  const key = boxKey(box);
  if (key && ctx.scannedNow.has(key)) return { kind: "again", message: "This box was already scanned.", box };
  const inFreezer = key ? ctx.inFreezer.get(key) : undefined;
  if (inFreezer) return { kind: "in-freezer", message: "This box is already in the freezer.", box, productId: inFreezer };
  const customer = key ? ctx.held.get(key) : undefined;
  if (customer) return { kind: "held", message: `Packed for ${customer}, held in the freezer. It isn't added.`, box, customer };

  const known = ctx.gtinMap.get(box.gtin);
  const productId = known ?? answers.productId;
  if (!productId)
    return {
      kind: "unknown-gtin",
      message: "This product isn't known. Check the label belongs on this box, then scan again or choose the product.",
      box,
    };
  const lot = box.lot ?? ctx.lots.get(lotKey(box.gtin, box.packDate)) ?? null;
  const p = ctx.products.get(productId);
  const start = startingCount(p, box.weightLb, ctx.lastCount.get(productId));
  return { kind: "ready", box, productId, lot, qty: start.qty, qtyIsWeight: start.isWeight, confirmed: !!known || !!answers.confirmed };
}

/** A box record's key, the same as a scanned label's (boxKey: GTIN:serial), if it has both. */
export const freezerKey = (gtin: string | null | undefined, serial: string | null | undefined) => (gtin && serial ? `${gtin}:${serial}` : null);
