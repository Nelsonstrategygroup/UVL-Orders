// SPEC 6.1: the weekly lamb guide, based on orders. Ported from the
// prototype's calcWeek.

import { addInto, ceilSafe, EPS, num } from "./num";
import type { Part, Product, Qty } from "./types";

export type PartStatus = "none" | "short" | "sets" | "even" | "extra";

export type PartRow = {
  part: Part;
  /** How much of this part the orders need. */
  need: number;
  /** Lambs needed to cover that need on its own. */
  lambs: number;
  /** What the final lamb count gives. */
  supply: number;
  /** supply - need. Negative means short. */
  left: number;
  status: PartStatus;
};

export type WeekCalc = {
  /** Sum of order lines per product. */
  totals: Qty;
  /** totals plus the half and whole shortfall. */
  withShort: Qty;
  rows: PartRow[];
  /** Recommended lamb count: the largest per-part count. */
  recommended: number;
  /** The part that sets the recommended count, if any. */
  driver: PartRow | null;
  /** The override when set, otherwise the recommended count. */
  final: number;
  overridden: boolean;
};

export function sumOrders(orders: Qty[]): Qty {
  const totals: Qty = {};
  for (const lines of orders) for (const k in lines) addInto(totals, k, num(lines[k]));
  return totals;
}

export function calcWeek(input: {
  parts: Part[];
  products: Product[];
  /** Each order's lines for the week. */
  orders: Qty[];
  /** Half and whole shortfall per product (6.2). */
  shortfall?: Qty;
  /** weeks.lamb_override */
  override?: number | null;
}): WeekCalc {
  const parts = [...input.parts].sort((a, b) => a.sort - b.sort);
  const totals = sumOrders(input.orders);

  const withShort: Qty = { ...totals };
  for (const k in input.shortfall ?? {}) addInto(withShort, k, input.shortfall![k]);

  const need: Qty = {};
  for (const p of input.products) {
    const q = withShort[p.id] ?? 0;
    if (!q) continue;
    for (const u of p.uses) addInto(need, u.part_id, q * num(u.qty));
  }

  const base = parts.map((part) => {
    const nd = need[part.id] ?? 0;
    const per = num(part.per_lamb);
    return { part, need: nd, lambs: nd > 0 && per > 0 ? ceilSafe(nd / per) : 0 };
  });

  const recommended = base.reduce((m, r) => Math.max(m, r.lambs), 0);
  const overridden = input.override != null;
  const final = overridden ? Math.max(0, Math.round(num(input.override))) : recommended;

  const rows: PartRow[] = base.map((r) => {
    const supply = final * num(r.part.per_lamb);
    const left = supply - r.need;
    let status: PartStatus;
    if (r.need === 0) status = "none";
    else if (left < -EPS) status = "short";
    else if (!overridden && recommended > 0 && r.lambs === recommended) status = "sets";
    else if (Math.abs(left) < EPS) status = "even";
    else status = "extra";
    return { ...r, supply, left, status };
  });

  const driver = recommended > 0 ? (rows.find((r) => r.lambs === recommended) ?? null) : null;
  return { totals, withShort, rows, recommended, driver, final, overridden };
}
