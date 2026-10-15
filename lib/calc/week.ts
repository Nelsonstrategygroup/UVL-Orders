// SPEC 6.1: the weekly lamb guide, based on orders. Ported from the
// prototype's calcWeek, then changed to the whole loin model (10/15/26).
//
// The week has ONE lamb count, `final`, worked out here and nowhere else:
// "Your number" if entered, otherwise the cut sheet total if the week has a
// cut sheet, otherwise the count recommended from orders. The headline, the
// producer message, and the carcass balance all use it.
//
// The model (confirmed by Kathy and Chris, 10/15/26):
// - A part can be cut from another part (parts.made_from). Racks and short
//   loins are cut from whole loins: one whole loin gives one of each. The
//   whole loins needed are those ordered whole plus the larger of the racks
//   and short loins needed; the other one comes out extra.
// - Parts that are cut from another part never set the count themselves.
// - Carcass lambs (products.carcass) go out uncut: they use no parts and are
//   added on top: lambs = lambs for parts + carcass lambs.
// - Products with a fill note (Le Trim) take nothing from the balance. Kathy
//   fills them from extras; they are listed on their own.

import { BALANCE_PARTS } from "./cutsheet";
import { addInto, ceilSafe, EPS, num } from "./num";
import type { Part, Product, Qty } from "./types";

const MAIN_CUTS = new Set(BALANCE_PARTS.map((p) => p.id));

// Hind shanks come off the back legs. They are there when they are there:
// shown as available, not planned for, never "extra" (Lucas, 10/15/26).
const AVAILABLE_ONLY = new Set(["hshank"]);

export type PartStatus = "none" | "short" | "sets" | "even" | "extra";

export type PartRow = {
  part: Part;
  /** How much of this part the orders need (for a whole loin: ordered whole plus the larger of racks and short loins). */
  need: number;
  /** Lambs needed to cover that need on its own (0 for parts that don't drive the count). */
  lambs: number;
  /** Whether this part can set the lamb count. Byproducts and cut-from parts never do. */
  drives: boolean;
  /** What the lambs for parts give. */
  supply: number;
  /** supply - need. Negative means short. */
  left: number;
  status: PartStatus;
  /**
   * A main cut that Kathy plans for: the six parts every cut sheet set must
   * add up to, and the whole loin they're cut from. False for what simply
   * comes with every lamb (necks, Denver ribs, trim, bones, organs).
   */
  planned: boolean;
  /** The part this one is cut from (rack and short loin: whole loin); shown under it. */
  parent: string | null;
  /** Shown as available rather than extra (hind shanks: they come off the legs). */
  availableOnly: boolean;
};

/** A product filled from extras instead of the balance (Le Trim). */
export type FilledFromExtras = { product: Product; qty: number; note: string };

export type LambSource = "your number" | "cut sheet" | "orders";

export type WeekCalc = {
  /** Sum of order lines per product. */
  totals: Qty;
  /** totals plus the half and whole shortfall. */
  withShort: Qty;
  rows: PartRow[];
  /** Recommended lamb count: lambs for parts plus carcass lambs. */
  recommended: number;
  /** Lambs the parts need: the largest per-part count. */
  partsLambs: number;
  /** Carcass lambs ordered (uncut, on top of the lambs for parts). */
  carcass: number;
  /** The part that sets the count for parts, if any. */
  driver: PartRow | null;
  /** THE lamb count for the week (see the top of this file). */
  final: number;
  /** Where `final` came from. */
  source: LambSource;
  overridden: boolean;
  /** Lambs on the week's cut sheet, or 0 when there is none. */
  cutSheetLambs: number;
  /** Products Kathy fills from extras, kept out of the balance. */
  filled: FilledFromExtras[];
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
  const byId = new Map(parts.map((p) => [p.id, p]));
  // Only a parent that exists counts; anything else is a plain part.
  const parentOf = (p: Part) => (p.made_from && p.made_from !== p.id && byId.has(p.made_from) ? p.made_from : null);
  const children = (id: string) => parts.filter((p) => parentOf(p) === id);
  const totals = sumOrders(input.orders);

  const withShort: Qty = { ...totals };
  for (const k in input.shortfall ?? {}) addInto(withShort, k, input.shortfall![k]);

  // need: everything ordered, for the balance table. driveNeed: only what can
  // set the count (products that count toward lambs).
  const need: Qty = {};
  const driveNeed: Qty = {};
  let carcass = 0;
  const filled: FilledFromExtras[] = [];
  for (const p of input.products) {
    const q = withShort[p.id] ?? 0;
    if (!q) continue;
    if (p.carcass) {
      carcass += q;
      continue;
    }
    const note = (p.fill_note ?? "").trim();
    if (note) {
      filled.push({ product: p, qty: q, note });
      continue;
    }
    const counts = p.counts_toward_lambs !== false && !p.not_lamb;
    for (const u of p.uses) {
      addInto(need, u.part_id, q * num(u.qty));
      if (counts) addInto(driveNeed, u.part_id, q * num(u.qty));
    }
  }

  // A parent part (whole loin) is needed for what's ordered whole plus the
  // largest need among the parts cut from it.
  const parentNeed = (id: string, from: Qty) => {
    const kids = children(id);
    const most = kids.reduce((m, k) => Math.max(m, from[k.id] ?? 0), 0);
    return (from[id] ?? 0) + most;
  };
  for (const p of parts) {
    if (!children(p.id).length) continue;
    need[p.id] = parentNeed(p.id, need);
    driveNeed[p.id] = parentNeed(p.id, driveNeed);
  }

  const base = parts.map((part) => {
    const drives = part.drives_count !== false && !parentOf(part);
    const nd = driveNeed[part.id] ?? 0;
    const per = num(part.per_lamb);
    return { part, drives, need: need[part.id] ?? 0, lambs: drives && nd > 0 && per > 0 ? ceilSafe(nd / per) : 0 };
  });

  const partsRecommended = base.reduce((m, r) => Math.max(m, r.lambs), 0);
  const recommended = partsRecommended + carcass;
  const overridden = input.override != null;
  const cutSheetLambs = Math.max(0, Math.round(num(input.cutSheetLambs ?? 0)));
  const source: LambSource = overridden ? "your number" : cutSheetLambs > 0 ? "cut sheet" : "orders";
  const final =
    source === "your number" ? Math.max(0, Math.round(num(input.override))) : source === "cut sheet" ? cutSheetLambs : recommended;
  // Carcass lambs leave uncut, so only the rest are cut into parts.
  const partsLambs = Math.max(0, final - carcass);

  const toRow = (r: (typeof base)[number]): PartRow => {
    const supply = partsLambs * num(r.part.per_lamb);
    const left = supply - r.need;
    let status: PartStatus;
    // Nothing ordered and nothing coming: no tag. Nothing ordered but the
    // lambs still give some: all of it is extra.
    if (r.need === 0 && supply < EPS) status = "none";
    else if (left < -EPS) status = "short";
    else if (r.drives && source === "orders" && partsRecommended > 0 && r.lambs === partsRecommended) status = "sets";
    else if (Math.abs(left) < EPS) status = "even";
    else status = "extra";
    const parent = parentOf(r.part);
    return {
      ...r,
      supply,
      left,
      status,
      planned: (MAIN_CUTS.has(r.part.id) && !AVAILABLE_ONLY.has(r.part.id)) || children(r.part.id).length > 0 || !!parent,
      parent,
      availableOnly: AVAILABLE_ONLY.has(r.part.id),
    };
  };
  // Parents first, each followed by the parts cut from it.
  const rows: PartRow[] = [];
  for (const r of base) {
    if (parentOf(r.part)) continue;
    rows.push(toRow(r));
    for (const k of base) if (parentOf(k.part) === r.part.id) rows.push(toRow(k));
  }

  const driver = partsRecommended > 0 ? (rows.find((r) => r.drives && r.lambs === partsRecommended) ?? null) : null;
  return {
    totals,
    withShort,
    rows,
    recommended,
    partsLambs,
    carcass,
    driver,
    final,
    source,
    overridden,
    cutSheetLambs,
    filled,
  };
}

/** Main cuts with some left over: the extras Kathy has to find a home for. */
export function plannedExtras(rows: PartRow[]): PartRow[] {
  return rows.filter((r) => r.planned && r.left > EPS);
}

/** "78 for parts + 2 carcass = 80 lambs", or null when there are no carcass lambs. */
export function carcassLine(c: Pick<WeekCalc, "final" | "carcass" | "partsLambs">): string | null {
  if (!c.carcass) return null;
  return `${c.partsLambs} for parts + ${c.carcass} carcass = ${c.final} lambs`;
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
