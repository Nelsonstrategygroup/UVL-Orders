// What happens after a box label is read (SPEC 11.3 to 11.5). Pure: the scan
// screen asks decideScan() what to do next and shows that.
//
// Order of checks:
//   1. The label must read (parseLabel); otherwise "scan again".
//   2. The same box (GTIN + serial) must not be recorded already.
//   3. The GTIN must be known; otherwise warn and offer a rescan first
//      (wrong label scanned, wrong label on the box, wrong box on the pallet).
//   4. The product should be on this customer's order; otherwise ask. (Not
//      when routing: the customer is suggested after the scan.)
//   5. Every box needs a lot: from the barcode (AI 10), or remembered for the
//      same GTIN + pack date, or typed from the label.
//   6. A weight outside the product's normal range is a warning, never a block.

import { fmt } from "../calc/num";
import { boxKey, parseLabel, type Gs1Box } from "./gs1";

export type ScanProduct = { id: string; name: string; box_lb_min?: number | null; box_lb_max?: number | null };

export type ScanContext = {
  /** GTIN -> product id. */
  gtinMap: Map<string, string>;
  /** "GTIN|YYYY-MM-DD" -> lot. */
  lots: Map<string, string>;
  /** Boxes already recorded or waiting to upload: "GTIN:serial" -> who has it. */
  known: Map<string, string>;
  /** Product ids on the chosen customer's order; null when the app suggests the customer after the scan (routing). */
  onOrder: Set<string> | null;
  products: Map<string, ScanProduct>;
};

export type ScanStep =
  | { kind: "misread"; message: string }
  | { kind: "duplicate"; message: string; box: Gs1Box }
  | { kind: "unknown-gtin"; message: string; box: Gs1Box }
  | { kind: "off-order"; message: string; box: Gs1Box; productId: string }
  | { kind: "need-lot"; message: string; box: Gs1Box; productId: string }
  | { kind: "ready"; box: Gs1Box; productId: string; lot: string; lotFrom: "label" | "known" | "typed"; warnings: string[] };

export const lotKey = (gtin: string, packDate: string | null) => `${gtin}|${packDate ?? ""}`;

/** A lot typed from the label: 6 digits. */
export const LOT_PATTERN = /^\d{6}$/;

/** The warning for a weight outside the product's normal box range, or null. */
export function weightWarning(weightLb: number | null, p: ScanProduct | undefined): string | null {
  if (weightLb == null || !p) return null;
  const lo = p.box_lb_min ?? null;
  const hi = p.box_lb_max ?? null;
  if (lo != null && weightLb < lo) return `${fmt(weightLb)} lb is light for ${p.name} (usually ${fmt(lo)} to ${fmt(hi ?? lo)} lb). Check the box.`;
  if (hi != null && weightLb > hi) return `${fmt(weightLb)} lb is heavy for ${p.name} (usually ${fmt(lo ?? hi)} to ${fmt(hi)} lb). Check the box.`;
  return null;
}

/**
 * The next step for a scan. `answers` carries what the packer already said
 * for this box: that it's right to add it to this order, the product chosen
 * for an unknown GTIN, and a typed lot.
 */
export function decideScan(
  raw: string | Gs1Box,
  ctx: ScanContext,
  answers: { addOffOrder?: boolean; productId?: string; lot?: string } = {},
): ScanStep {
  let box: Gs1Box;
  if (typeof raw === "string") {
    const r = parseLabel(raw);
    if (!r.ok) return { kind: "misread", message: r.message };
    box = r.box;
  } else box = raw;

  const key = boxKey(box);
  const who = key ? ctx.known.get(key) : undefined;
  if (who !== undefined)
    return { kind: "duplicate", message: `This box is already scanned${who ? ` for ${who}` : ""}. Don't pack it twice.`, box };

  const productId = ctx.gtinMap.get(box.gtin) ?? answers.productId;
  if (!productId)
    return {
      kind: "unknown-gtin",
      message: "This product isn't known. Check that the label belongs on this box and the box belongs on this pallet, then scan again.",
      box,
    };
  const product = ctx.products.get(productId);
  const name = product?.name ?? "This product";

  if (ctx.onOrder && !ctx.onOrder.has(productId) && !answers.addOffOrder)
    return { kind: "off-order", message: `${name} isn't on this customer's order.`, box, productId };

  let lot = box.lot ?? undefined;
  let lotFrom: "label" | "known" | "typed" = "label";
  if (!lot) {
    lot = ctx.lots.get(lotKey(box.gtin, box.packDate));
    lotFrom = "known";
  }
  if (!lot && answers.lot && LOT_PATTERN.test(answers.lot.trim())) {
    lot = answers.lot.trim();
    lotFrom = "typed";
  }
  if (!lot)
    return { kind: "need-lot", message: `Type the 6-digit lot printed on the ${name} label.`, box, productId };

  const warnings: string[] = [];
  const w = weightWarning(box.weightLb, product);
  if (w) warnings.push(w);
  if (box.weightLb == null) warnings.push("The label has no weight.");
  return { kind: "ready", box, productId, lot, lotFrom, warnings };
}
