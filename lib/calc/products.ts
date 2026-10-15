// Customer products in Setup: entering part amounts the way Kathy thinks of
// them, and what still needs checking.

import { EPS, num } from "./num";
import type { OrderUnit, Part, Product, Qty } from "./types";
import { toProductUnit } from "./units";

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

/**
 * The "Add a product" picker on the order form: active products whose name
 * or short name contains every word typed, names that start with it first.
 */
export function findProducts<P extends Pick<Product, "id" | "name" | "short_name" | "active">>(
  products: P[],
  query: string,
  limit = 8,
): P[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const text = (x: P) => `${x.name} ${x.short_name ?? ""}`.toLowerCase();
  const starts = (x: P) =>
    x.name.toLowerCase().startsWith(words[0]) || (x.short_name ?? "").toLowerCase().startsWith(words[0]);
  return products
    .filter((x) => x.active && words.every((w) => text(x).includes(w)))
    .sort((a, b) => Number(starts(b)) - Number(starts(a)))
    .slice(0, limit);
}

/**
 * Products by group, for the order form and the paper order sheet. Each
 * group shows once, in the place of its first product, however products
 * were added; inside a group, by sort order then name.
 */
export function groupProducts<P extends { name: string; group_name: string; sort: number }>(
  products: P[],
): { group: string; products: P[] }[] {
  const byName = (a: P, b: P) => a.sort - b.sort || a.name.localeCompare(b.name);
  const groups = new Map<string, P[]>();
  for (const x of [...products].sort(byName)) {
    const g = x.group_name || "Other";
    groups.set(g, [...(groups.get(g) ?? []), x]);
  }
  return [...groups].map(([group, list]) => ({ group, products: list }));
}

export type BoxProduct = { name: string; unit: string; lb_per_unit?: number | null; per_box?: number | null };

/**
 * Boxes an order needs. Products never share a box, so each product takes
 * ceil(amount / how many fit). Products with no box size yet (or an amount in
 * pounds with no weight per piece to convert) are listed in `unknown`.
 */
export function boxesNeeded(
  lines: Qty,
  units: Record<string, string> | undefined,
  byId: Map<string, BoxProduct>,
): { boxes: number; unknown: string[] } {
  let boxes = 0;
  const unknown: string[] = [];
  for (const [id, q] of Object.entries(lines)) {
    if (!(num(q) > 0)) continue;
    const p = byId.get(id);
    if (!p) continue;
    const amount = toProductUnit(num(q), units?.[id], p);
    if (!p.per_box || !(amount > 0)) {
      unknown.push(p.name);
      continue;
    }
    boxes += Math.ceil(amount / p.per_box - EPS);
  }
  return { boxes, unknown };
}

/** "3 boxes", "at least 3 boxes" when some products have no box size, or "" when none do. */
export function boxesText(b: { boxes: number; unknown: string[] }): string {
  if (!b.boxes) return "";
  return `${b.unknown.length ? "at least " : ""}${b.boxes} box${b.boxes === 1 ? "" : "es"}`;
}
