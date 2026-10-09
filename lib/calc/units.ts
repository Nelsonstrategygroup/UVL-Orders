// What one unit of a product is, in words, so freezer counts match the cut
// sheet. Products sold in packs ("Front Shanks 2/pack") are counted by the
// piece, not by the pack: one unit uses one shank.

import type { OrderUnit, Part, Product, Qty, Units } from "./types";

const PACK = /\b\d+\s*\/\s*pa(?:c)?k\b/i;

/** "front shanks (not packs)" for a pack product; otherwise the product's unit. */
export function countUnit(p: Pick<Product, "name" | "unit" | "uses">, parts: Pick<Part, "id" | "name">[]): string {
  if (!PACK.test(p.name)) return p.unit;
  const only = p.uses.length === 1 && p.uses[0].qty === 1 ? parts.find((x) => x.id === p.uses[0].part_id) : undefined;
  const what = only ? `${only.name.toLowerCase()}s` : p.unit;
  return `${what} (not packs)`;
}

// ---------------------------------------------------------------------------
// Order units: pieces, packs, pounds, or cases (customer products).
// ---------------------------------------------------------------------------

export const ORDER_UNITS: OrderUnit[] = ["each", "pack", "lb", "case"];

const WORD: Record<string, [string, string]> = {
  each: ["pc", "pcs"],
  pack: ["pack", "packs"],
  lb: ["lb", "lb"],
  case: ["case", "cases"],
  leg: ["leg", "legs"],
  loin: ["loin", "loins"],
  lamb: ["lamb", "lambs"],
};

/** "pcs", "lb", "packs": the word after a quantity. */
export function unitWord(unit: string, qty = 2): string {
  const w = WORD[unit];
  if (!w) return unit;
  return qty === 1 ? w[0] : w[1];
}

/** How a unit is named in Setup and on the switch: "Pieces", "Pounds". */
export const UNIT_NAME: Record<OrderUnit, string> = { each: "Pieces", pack: "Packs", lb: "Pounds", case: "Cases" };

/** The unit a line was taken in: its own, or the product's. */
export function lineUnit(productId: string, product: Pick<Product, "unit"> | undefined, units: Units | undefined): string {
  return units?.[productId] ?? product?.unit ?? "each";
}

/**
 * A quantity in the product's own unit. Pounds become pieces (or packs or
 * cases) with lb_per_unit, and back. Without a piece weight a line taken in
 * the other unit can't be converted and counts as 0 (Setup flags it).
 * The database does the same in qty_in_product_unit.
 */
export function toProductUnit(qty: number, unit: string | undefined, product: Pick<Product, "unit" | "lb_per_unit">): number {
  if (!unit || unit === product.unit) return qty;
  const w = product.lb_per_unit ?? 0;
  if (unit === "lb") return w > 0 ? qty / w : 0;
  if (product.unit === "lb") return qty * w;
  return qty;
}

/** An order's lines in each product's own unit, for the lamb count and totals. */
export function inProductUnits(lines: Qty, units: Units | undefined, productById: Map<string, Pick<Product, "unit" | "lb_per_unit">>): Qty {
  const out: Qty = {};
  for (const [id, q] of Object.entries(lines)) {
    const p = productById.get(id);
    out[id] = p ? toProductUnit(q, units?.[id], p) : q;
  }
  return out;
}
