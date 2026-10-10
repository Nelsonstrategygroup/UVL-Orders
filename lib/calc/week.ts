// SPEC 6.1: the weekly lamb guide, based on orders. Ported from the
// prototype's calcWeek.
//
// The week has ONE lamb count, `final`, worked out here and nowhere else:
// "Your number" if entered, otherwise the cut sheet total if the week has a
// cut sheet, otherwise the count recommended from orders. The headline, the
// producer message, and the carcass balance all use it.

import { BALANCE_PARTS } from "./cutsheet";
import { addInto, ceilSafe, EPS, num } from "./num";
import type { Part, Product, Qty } from "./types";

const MAIN_CUTS = new Set(BALANCE_PARTS.map((p) => p.id));

export type PartStatus = "none" | "short" | "sets" | "even" | "extra";

export type PartRow = {
  part: Part;
  /** How much of this part the orders need. */
  need: number;
  /** Lambs needed to cover that need on its own (0 for parts that don't drive the count). */
  lambs: number;
  /** Whether this part can set the lamb count. Byproducts are tracked but never do. */
  drives: boolean;
  /** What the final lamb count gives. */
  supply: number;
  /** supply - need. Negative means short. */
  left: number;
  status: PartStatus;
  /**
   * A main cut that Kathy plans for: the six parts every cut sheet set must
   * add up to (leg, shoulder, rack, short loin, front and hind shank). False
   * for what simply comes with every lamb (necks, Denver ribs, trim, bones,
   * organs, and any part added in Setup).
   */
  planned: boolean;
};

export type LambSource = "your number" | "cut sheet" | "orders";

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
  /** THE lamb count for the week (see the top of this file). */
  final: number;
  /** Where `final` came from. */
  source: LambSource;
  overridden: boolean;
  /** Lambs on the week's cut sheet, or 0 when there is none. */
  cutSheetLambs: number;
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
  /** Total lambs on the week's cut sheet; 0 or missing when there is none. */
  cutSheetLambs?: number;
}): WeekCalc {
  const parts = [...input.parts].sort((a, b) => a.sort - b.sort);
  const totals = sumOrders(input.orders);

  const withShort: Qty = { ...totals };
  for (const k in input.shortfall ?? {}) addInto(withShort, k, input.shortfall![k]);

  // need: everything ordered, for the balance table. driveNeed: only what can
  // set the count (products that count toward lambs, from driving parts).
  const need: Qty = {};
  const driveNeed: Qty = {};
  for (const p of input.products) {
    const q = withShort[p.id] ?? 0;
    if (!q) continue;
    const counts = p.counts_toward_lambs !== false && !p.not_lamb;
    for (const u of p.uses) {
      addInto(need, u.part_id, q * num(u.qty));
      if (counts) addInto(driveNeed, u.part_id, q * num(u.qty));
    }
  }

  const base = parts.map((part) => {
    const drives = part.drives_count !== false;
    const nd = driveNeed[part.id] ?? 0;
    const per = num(part.per_lamb);
    return { part, drives, need: need[part.id] ?? 0, lambs: drives && nd > 0 && per > 0 ? ceilSafe(nd / per) : 0 };
  });

  const recommended = base.reduce((m, r) => Math.max(m, r.lambs), 0);
  const overridden = input.override != null;
  const cutSheetLambs = Math.max(0, Math.round(num(input.cutSheetLambs ?? 0)));
  const source: LambSource = overridden ? "your number" : cutSheetLambs > 0 ? "cut sheet" : "orders";
  const final =
    source === "your number" ? Math.max(0, Math.round(num(input.override))) : source === "cut sheet" ? cutSheetLambs : recommended;

  const rows: PartRow[] = base.map((r) => {
    const supply = final * num(r.part.per_lamb);
    const left = supply - r.need;
    let status: PartStatus;
    // Nothing ordered and nothing coming: no tag. Nothing ordered but the
    // lambs still give some: all of it is extra.
    if (r.need === 0 && supply < EPS) status = "none";
    else if (left < -EPS) status = "short";
    else if (r.drives && source === "orders" && recommended > 0 && r.lambs === recommended) status = "sets";
    else if (Math.abs(left) < EPS) status = "even";
    else status = "extra";
    return { ...r, supply, left, status, planned: MAIN_CUTS.has(r.part.id) };
  });

  const driver = recommended > 0 ? (rows.find((r) => r.drives && r.lambs === recommended) ?? null) : null;
  return { totals, withShort, rows, recommended, driver, final, source, overridden, cutSheetLambs };
}

/** Main cuts with some left over: the extras Kathy has to find a home for. */
export function plannedExtras(rows: PartRow[]): PartRow[] {
  return rows.filter((r) => r.planned && r.left > EPS);
}

/**
 * One line saying where the week's lamb count came from, for example
 * "144 from the cut sheet (orders suggest 0)". Null when there is nothing
 * to count yet.
 */
export function lambSourceLine(c: Pick<WeekCalc, "final" | "source" | "recommended" | "cutSheetLambs">): string | null {
  const n = c.final;
  if (c.source === "cut sheet")
    return `${n} from the cut sheet (${c.recommended === n ? "orders agree" : `orders suggest ${c.recommended}`})`;
  if (c.source === "your number") {
    const others = [
      c.cutSheetLambs > 0 && c.cutSheetLambs !== n ? `cut sheet has ${c.cutSheetLambs}` : "",
      c.recommended !== n ? `orders suggest ${c.recommended}` : "",
    ].filter(Boolean);
    return `${n} is your number${others.length ? ` (${others.join(", ")})` : ""}`;
  }
  return c.recommended > 0 ? `${n} from orders` : null;
}
