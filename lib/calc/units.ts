// What one unit of a product is, in words, so freezer counts match the cut
// sheet. Products sold in packs ("Front Shanks 2/pack") are counted by the
// piece, not by the pack: one unit uses one shank.

import type { OrderUnit, Part, Product, Qty, Units } from "./types";

const PACK = /\b\d+\s*\/\s*pa(?:c)?k\b/i;

/** "front shanks (not packs)" for an old Mohawk-named pack product; otherwise the unit word ("pcs", "lb"). */
export function countUnit(p: Pick<Product, "name" | "unit" | "uses">, parts: Pick<Part, "id" | "name">[]): string {
  if (!PACK.test(p.name)) return unitWord(p.unit);
  const only = p.uses.length === 1 && p.uses[0].qty === 1 ? parts.find((x) => x.id === p.uses[0].part_id) : undefined;
  const what = only ? `${only.name.toLowerCase()}s` : unitWord(p.unit);
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
 *
 * Pieces are whole (Lucas, 11/7/26): a line taken in pounds becomes whole
 * pieces once, to the nearest piece, and never less than 1 (20 lb of 4.5 lb
 * shoulders is 4; 120 lb is 27). Labels, the Weigh and Pallet Sheets,
 * Packing, the lamb count and the totals all use that count. Open question
 * for Kathy: nearest, or always up?
 */
export function toProductUnit(
  qty: number,
  unit: string | undefined,
  product: Pick<Product, "unit" | "lb_per_unit"> & { pieces_per_pack?: number | null },
): number {
  if (!unit || unit === product.unit) return qty;
  // Packs and pieces (shanks, 2 a pack; Lucas, 11/10/26): 8 packs of a product
  // counted in pieces is 16, and 15 pieces of a product counted in packs is
  // 7.5 packs (not whole packs: see notWholePacks). Before this a pack line
  // counted as that many pieces, so Mixed Shanks labels and totals mixed the two.
  const per = product.pieces_per_pack ?? 0;
  if (per > 0 && unit === "pack" && product.unit === "each") return qty * per;
  if (per > 0 && unit === "each" && product.unit === "pack") return qty / per;
  const w = product.lb_per_unit ?? 0;
  if (unit === "lb") return w > 0 && qty > 0 ? Math.max(1, Math.round(qty / w)) : 0;
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

/**
 * Lines counted in pieces that don't make whole packs (Lucas, 11/10/26):
 * "15 Mixed Shanks" can't be packs of 2. A product sold in packs
 * (pieces_per_pack) with a line in pieces, taken that way or because the
 * product itself is counted in pieces. For This week to flag, so someone asks
 * what was meant.
 */
export function notWholePacks(
  lines: Qty,
  units: Units | undefined,
  productById: Map<string, Pick<Product, "name" | "unit"> & { pieces_per_pack?: number | null }>,
): { name: string; qty: number; per: number }[] {
  const out: { name: string; qty: number; per: number }[] = [];
  for (const [id, q] of Object.entries(lines)) {
    const p = productById.get(id);
    const per = p?.pieces_per_pack ?? 0;
    if (!p || !(per > 1) || !(q > 0)) continue;
    if ((units?.[id] ?? p.unit) !== "each") continue;
    const left = q % per;
    if (left > 1e-9 && per - left > 1e-9) out.push({ name: p.name, qty: q, per });
  }
  return out;
}

/**
 * Lines taken in pounds (or pieces) that can't be turned into the product's
 * own unit because it has no weight per piece. They count as 0 in the
 * balance, so This week lists them.
 */
export function cantConvert(
  lines: Qty,
  units: Units | undefined,
  productById: Map<string, Pick<Product, "name" | "unit" | "lb_per_unit">>,
): { name: string; qty: number; unit: string }[] {
  const out: { name: string; qty: number; unit: string }[] = [];
  for (const [id, q] of Object.entries(lines)) {
    const p = productById.get(id);
    const u = units?.[id];
    if (!p || !u || u === p.unit || !(q > 0)) continue;
    if (!(p.lb_per_unit && p.lb_per_unit > 0) && (u === "lb" || p.unit === "lb")) out.push({ name: p.name, qty: q, unit: u });
  }
  return out;
}
