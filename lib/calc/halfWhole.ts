// SPEC 6.2: half and whole lambs, freezer stock, and the shortfall that is
// added to the week's totals. Ported from the prototype's hwLines,
// freezerOnHand, and hwNeeds.

import { addInto, num } from "./num";
import type { FreezerEntry, HalfWholeOrder, Part, Product, Qty } from "./types";

const FRACTION = { whole: 1, half: 0.5 } as const;

/** Parts that get a slot per cut (balance_check = true). */
export function slotParts(parts: Part[]): Part[] {
  return parts.filter((p) => p.balance_check);
}

/**
 * How many slots a part gets on a half or whole order: per_lamb * fraction,
 * rounded as in the prototype. So a half lamb gets 1 neck (0.5 rounds up).
 * Lucas chose this until Kathy confirms (docs/questions-for-kathy-and-chris.md).
 */
export function slotCount(part: Part, size: "half" | "whole"): number {
  return Math.round(num(part.per_lamb) * FRACTION[size]);
}

/** Products that can fill a slot: exactly one part use, of that part, qty 1. */
export function slotOptions(partId: string, products: Product[]): Product[] {
  return products.filter((p) => p.uses.length === 1 && p.uses[0].part_id === partId && num(p.uses[0].qty) === 1);
}

/**
 * What one half or whole order takes, by product.
 * Each chosen slot is one unit of its product. Parts that are not slot parts
 * (trim) become their single-use product automatically: per_lamb * fraction,
 * divided by how much of the part one unit uses (ground lamb from trim).
 */
export function halfWholeLines(order: HalfWholeOrder, parts: Part[], products: Product[]): Qty {
  const lines: Qty = {};
  for (const c of order.choices) if (c.product_id) addInto(lines, c.product_id, 1);

  const frac = FRACTION[order.size];
  for (const part of parts.filter((p) => !p.balance_check)) {
    const prod = products.find((p) => p.uses.length === 1 && p.uses[0].part_id === part.id);
    if (prod && num(prod.uses[0].qty) > 0) addInto(lines, prod.id, (num(part.per_lamb) * frac) / num(prod.uses[0].qty));
  }
  return lines;
}

/**
 * Freezer stock per product: everything logged in or out. When a half or
 * whole order is marked filled, what it took from the freezer is logged as
 * its own entries (see freezerTakes), so filled orders are already counted
 * here. fresh_only products are never counted as available from the freezer.
 *
 * SPEC 6.2 subtracted every cut of a filled order, including cuts that were
 * cut fresh, which drove the freezer negative. Lucas chose (Phase 5 review)
 * that a filled order takes only what the freezer had.
 */
export function freezerOnHand(freezer: FreezerEntry[], products: Product[]): Qty {
  const onHand: Qty = {};
  for (const p of products) onHand[p.id] = 0;
  for (const e of freezer) addInto(onHand, e.product_id, num(e.qty));
  for (const p of products) if (p.fresh_only) onHand[p.id] = 0;
  return onHand;
}

/**
 * What marking an order filled takes out of the freezer: for each cut, what
 * the order needs, but no more than the freezer has. The rest was cut fresh.
 */
export function freezerTakes(lines: Qty, onHand: Qty, products: Product[]): Qty {
  const takes: Qty = {};
  for (const p of products) {
    if (p.fresh_only) continue;
    const t = Math.min(lines[p.id] ?? 0, Math.max(0, onHand[p.id] ?? 0));
    if (t > 0) takes[p.id] = t;
  }
  return takes;
}

export type HalfWholeNeeds = { need: Qty; onHand: Qty; short: Qty };

/** Pending need, stock on hand, and the shortfall to cut fresh this week. */
export function halfWholeNeeds(
  freezer: FreezerEntry[],
  orders: HalfWholeOrder[],
  parts: Part[],
  products: Product[],
): HalfWholeNeeds {
  const need: Qty = {};
  for (const o of orders) {
    if (o.status !== "pending") continue;
    const l = halfWholeLines(o, parts, products);
    for (const k in l) addInto(need, k, l[k]);
  }
  const onHand = freezerOnHand(freezer, products);
  const short: Qty = {};
  for (const p of products) {
    const s = Math.max(0, (need[p.id] ?? 0) - Math.max(0, onHand[p.id] ?? 0));
    if (s > 0) short[p.id] = s;
  }
  return { need, onHand, short };
}
