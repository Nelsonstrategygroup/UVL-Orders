// Splitting an order line into boxes (SPEC 12.3). Pure: Orders, Packing, and
// the box label list all use planBoxes().
//
// - Products never share a box.
// - A box's limit is the lowest of its max count, what fits under its max lb,
//   and what fits under the box cap (45 lb, a setting). Pounds-per-unit turns
//   pieces or packs into pounds; without it, the count still works but the
//   weight can't be checked.
// - One box when one box holds it all: the smallest that does. Otherwise full
//   boxes of the largest type the product fits in, then the smallest box that
//   holds the rest.
// - Only confirmed limits (status "ok") are used. A box Kathy hasn't confirmed
//   ("needs_checking") is never planned; if it could have changed the split,
//   the plan says so, and the label list shows it in red until it's settled.

import { EPS, fmt, num } from "./num";
import type { Qty } from "./types";
import { toProductUnit } from "./units";

export type BoxType = { id: string; name: string; size_rank: number };
export type BoxLimit = {
  box_type_id: string;
  max_count: number | null;
  max_lb: number | null;
  status: "ok" | "does_not_fit" | "needs_checking";
  note?: string;
};
export type BoxedProduct = { name: string; unit: string; lb_per_unit?: number | null };

export type PlannedBox = { typeId: string; typeName: string; amount: number; /** Pounds in the box, when known. */ lb: number | null };

export type BoxPlan = {
  boxes: PlannedBox[];
  /** Why it couldn't be split, or null. */
  problem: string | null;
  /** Unconfirmed box types that might have changed this split. */
  unconfirmed: string[];
  /** Pieces or packs with no pounds per unit: the box weight can't be checked. */
  weightUnknown: boolean;
  /** Never boxed: every box type is "never goes in it" (Carcass Lamb, sent in a shroud). */
  notBoxed: boolean;
};

const isLb = (unit: string) => unit === "lb";

/**
 * How much of the product (in its own unit) one box of this type holds, or
 * null when it can't be worked out (an lb-only limit on a product with no
 * pounds per unit). Pieces and packs are whole numbers.
 */
export function boxCapacity(limit: BoxLimit, p: BoxedProduct, capLb: number): number | null {
  if (limit.status !== "ok") return null;
  const perUnit = isLb(p.unit) ? 1 : (p.lb_per_unit ?? null);
  const options: number[] = [];
  if (limit.max_count != null) options.push(limit.max_count);
  if (limit.max_lb != null && perUnit) options.push(limit.max_lb / perUnit);
  if (perUnit) options.push(capLb / perUnit);
  // Only a pound limit, and no pounds per unit: can't tell how many fit.
  if (limit.max_count == null && !perUnit) return null;
  if (!options.length) return null;
  const raw = Math.min(...options);
  const cap = isLb(p.unit) ? Math.floor(raw * 100 + EPS) / 100 : Math.floor(raw + EPS);
  return cap > 0 ? cap : null;
}

/** Split one order line (amount in the product's own unit) into boxes. */
export function planBoxes(amount: number, p: BoxedProduct, limits: BoxLimit[], types: BoxType[], capLb: number): BoxPlan {
  const weightUnknown = !isLb(p.unit) && !(p.lb_per_unit && p.lb_per_unit > 0);
  const notBoxed = limits.length > 0 && limits.every((l) => l.status === "does_not_fit");
  const plan: BoxPlan = { boxes: [], problem: null, unconfirmed: [], weightUnknown, notBoxed };
  if (!(amount > EPS) || notBoxed) return plan;

  const byType = new Map(limits.map((l) => [l.box_type_id, l]));
  const ordered = [...types].sort((a, b) => a.size_rank - b.size_rank); // largest first
  const usable = ordered
    .map((t) => ({ t, cap: byType.get(t.id) ? boxCapacity(byType.get(t.id)!, p, capLb) : null }))
    .filter((x): x is { t: BoxType; cap: number } => x.cap != null);
  const unsure = ordered.filter((t) => byType.get(t.id)?.status === "needs_checking");

  if (!usable.length) {
    const lbOnly = ordered.some((t) => {
      const l = byType.get(t.id);
      return l?.status === "ok" && l.max_count == null && l.max_lb != null;
    });
    // Pound limits that can't be used come first: that's the fix that unlocks them.
    plan.problem =
      lbOnly && weightUnknown
        ? "Needs a weight per unit in Setup to use its pound limits"
        : unsure.length
          ? `Box limits need checking in Setup (${unsure.map((t) => t.name).join(", ")})`
          : "No box limits in Setup";
    plan.unconfirmed = unsure.map((t) => t.name);
    return plan;
  }

  const lbOf = (n: number) => (isLb(p.unit) ? n : p.lb_per_unit ? Math.round(n * p.lb_per_unit * 100) / 100 : null);
  const box = (x: { t: BoxType }, n: number): PlannedBox => ({ typeId: x.t.id, typeName: x.t.name, amount: n, lb: lbOf(n) });
  const smallestHolding = (n: number) => [...usable].reverse().find((x) => x.cap + EPS >= n);
  const flagSmaller = (x: { t: BoxType }) =>
    unsure.filter((t) => t.size_rank > x.t.size_rank).forEach((t) => plan.unconfirmed.includes(t.name) || plan.unconfirmed.push(t.name));

  const one = smallestHolding(amount);
  if (one) {
    plan.boxes.push(box(one, amount));
    flagSmaller(one);
    return plan;
  }

  // Full boxes of the largest type, then the smallest box for the rest.
  const big = usable[0];
  unsure.filter((t) => t.size_rank < big.t.size_rank).forEach((t) => plan.unconfirmed.push(t.name));
  const full = Math.floor((amount + EPS) / big.cap);
  for (let i = 0; i < full; i++) plan.boxes.push(box(big, big.cap));
  const rest = Math.round((amount - full * big.cap) * 100) / 100;
  if (rest > EPS) {
    const last = smallestHolding(rest)!;
    plan.boxes.push(box(last, rest));
    flagSmaller(last);
  }
  return plan;
}

/** "MVM 6 + White 2" */
export function planText(plan: BoxPlan, unit: string): string {
  return plan.boxes.map((b) => `${b.typeName} ${unit === "lb" ? `${fmt(b.amount)} lb` : fmt(b.amount)}`).join(" + ");
}

/** Box types, each product's limits, and the cap: everything planBoxes needs. */
export type BoxSetup = { types: BoxType[]; limits: Map<string, BoxLimit[]>; capLb: number };

export type OrderBoxes = {
  /** Boxes planned for the whole order. */
  boxes: number;
  /** Products that can't be split into boxes yet, with why. */
  problems: { name: string; problem: string }[];
  /** Products whose split might change once a box is confirmed. */
  unconfirmed: string[];
};

/** Boxes for one order: each line split on its own (products never share a box). */
export function orderBoxes(
  lines: Qty,
  units: Record<string, string> | undefined,
  products: Map<string, BoxedProduct>,
  setup: BoxSetup,
): OrderBoxes {
  const out: OrderBoxes = { boxes: 0, problems: [], unconfirmed: [] };
  for (const [id, q] of Object.entries(lines)) {
    const p = products.get(id);
    if (!p || !(num(q) > 0)) continue;
    const plan = planBoxes(toProductUnit(num(q), units?.[id], { unit: p.unit, lb_per_unit: p.lb_per_unit ?? null }), p, setup.limits.get(id) ?? [], setup.types, setup.capLb);
    out.boxes += plan.boxes.length;
    if (plan.problem) out.problems.push({ name: p.name, problem: plan.problem });
    else if (plan.unconfirmed.length) out.unconfirmed.push(p.name);
  }
  return out;
}

/** "3 boxes", or "at least 3 boxes" when some products can't be boxed yet; "" for none. */
export function orderBoxesText(b: OrderBoxes): string {
  if (!b.boxes) return "";
  return `${b.problems.length ? "at least " : ""}${b.boxes} box${b.boxes === 1 ? "" : "es"}`;
}
