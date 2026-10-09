// Customer products in Setup: entering part amounts the way Kathy thinks of
// them, and what still needs checking.

import { num } from "./num";
import type { OrderUnit, Part, Product } from "./types";

/**
 * A part amount can be said two ways:
 *   "per-unit": one of this product uses N of the part (a Whole Lamb uses 2 legs)
 *   "per-part": one of the part makes N of this product (2.5 lb of Chops per short loin)
 * Both are stored the same way: how much of the part one unit uses.
 */
export type UseMode = "per-unit" | "per-part";

const round = (v: number) => Math.round(v * 10000) / 10000;

/** How to show a stored amount: less than one of the part per unit reads better per part. */
export function partAmountRow(qty: number): { mode: UseMode; amount: number } {
  const q = num(qty);
  if (q > 0 && q < 1) return { mode: "per-part", amount: round(1 / q) };
  return { mode: "per-unit", amount: round(q) };
}

/** The stored amount (part per unit) from what was typed. */
export function partAmountQty(mode: UseMode, amount: number): number {
  const a = num(amount);
  if (a <= 0) return 0;
  return mode === "per-part" ? 1 / a : a;
}

type ProductLite = Pick<Product, "id" | "name" | "active" | "uses"> & {
  confirmed?: boolean;
  alt_unit?: OrderUnit | null;
  lb_per_unit?: number | null;
  unit: string;
  counts_toward_lambs?: boolean;
  not_lamb?: boolean;
};

/** Whether ordering this product can raise the lamb count. */
export function drivesLambCount(p: ProductLite, parts: Pick<Part, "id" | "drives_count">[]): boolean {
  if (p.not_lamb || p.counts_toward_lambs === false) return false;
  return p.uses.some((u) => num(u.qty) > 0 && parts.find((x) => x.id === u.part_id)?.drives_count !== false);
}

export type CheckItem = { kind: "product" | "part"; id: string; name: string; why: string };

/** What Setup lists under "Needs checking". Only products that are turned on. */
export function needsChecking(products: ProductLite[], parts: Pick<Part, "id" | "name" | "confirmed">[]): CheckItem[] {
  const out: CheckItem[] = [];
  for (const p of products) {
    if (!p.active) continue;
    const whys: string[] = [];
    if (p.confirmed === false) whys.push("starting values not confirmed");
    const twoUnits = p.alt_unit && (p.alt_unit === "lb" || p.unit === "lb");
    if (twoUnits && !(num(p.lb_per_unit ?? 0) > 0)) whys.push("ordered in pieces or pounds, but no weight for one piece");
    if (!p.not_lamb && p.counts_toward_lambs !== false && p.uses.length === 0)
      whys.push("uses no parts, so it can't change the lamb count");
    if (whys.length) out.push({ kind: "product", id: p.id, name: p.name, why: whys.join("; ") });
  }
  for (const pt of parts) if (!pt.confirmed) out.push({ kind: "part", id: pt.id, name: pt.name, why: "per lamb not confirmed" });
  return out;
}
