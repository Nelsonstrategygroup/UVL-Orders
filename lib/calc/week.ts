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
// - Extra lambs (10/29/26): Kathy adds them on the week for any reason (Le
//   Trim, freezer stock, small lambs...). They go on top of the count from
//   orders: lambs = lambs for parts + carcass lambs + extra lambs. Their parts
//   are supply in the balance like any other lamb's. "Your number" and the
//   cut sheet total are taken as they are (Kathy puts the extras in her sets).

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
  /** Recommended lamb count: lambs for parts, plus carcass lambs, plus extra lambs. */
  recommended: number;
  /** Lambs the orders' parts need (the largest per-part count), before carcass and extra lambs. */
  orderLambs: number;
  /** Extra lambs added on the week (week_extra_lambs). */
  extra: number;
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
  /**
   * The saved Le Trim plan: what it takes out of the extras (shoulders, whole
   * legs halved, trim lb). It uses up extras but never sets the lamb count.
   */
  leTrim?: { shoulders: number; legs: number; trimLb: number } | null;
  /** Extra lambs added on the week, on top of the count from orders. */
  extraLambs?: number;
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

  // Le Trim (10/25/26): the plan uses extras, so it adds to what's needed but
  // never to what sets the lamb count.
  if (input.leTrim) {
    addInto(need, "shoulder", num(input.leTrim.shoulders));
    addInto(need, "leg", num(input.leTrim.legs));
    addInto(need, "trim", num(input.leTrim.trimLb));
  }

  // A parent part (whole loin) is needed for what's ordered whole plus the
  // largest need among the parts cut from it.
  const parentNeed = (id: string, from: Qty) => {
    const kids = children(id);
    const most = kids.reduce((m, k) => Math.max(m, from[k.id] ?? 0), 0);
    return (from[id] ?? 0) + most;
  };
  // Whole loins that go out whole (ordered whole, or inside a boxed Whole
  // Lamb) are never cut, so they give no racks or short loins.
  const intact: Qty = {};
  for (const p of parts) {
    if (!children(p.id).length) continue;
    intact[p.id] = need[p.id] ?? 0;
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
  const extra = Math.max(0, Math.round(num(input.extraLambs ?? 0)));
  const recommended = partsRecommended + carcass + extra;
  const overridden = input.override != null;
  const cutSheetLambs = Math.max(0, Math.round(num(input.cutSheetLambs ?? 0)));
  const source: LambSource = overridden ? "your number" : cutSheetLambs > 0 ? "cut sheet" : "orders";
  const final =
    source === "your number" ? Math.max(0, Math.round(num(input.override))) : source === "cut sheet" ? cutSheetLambs : recommended;
  // Carcass lambs leave uncut, so only the rest are cut into parts.
  const partsLambs = Math.max(0, final - carcass);

  const toRow = (r: (typeof base)[number]): PartRow => {
    const lb = r.part.unit === "lb";
    const up = parentOf(r.part);
    // A cut-from part gets one per whole loin that is cut (not those that go out whole).
    const supply = up
      ? Math.max(0, partsLambs * num(byId.get(up)!.per_lamb) - (intact[up] ?? 0))
      : partsLambs * num(r.part.per_lamb);
    const left = supply - r.need;
    // Pieces are whole (10/29/26): less than a whole piece spare is even; any part of one short is one short.
    const shown = lb ? left : Math.floor(left + EPS);
    let status: PartStatus;
    // Nothing ordered and nothing coming: no tag. Nothing ordered but the
    // lambs still give some: all of it is extra.
    if (r.need === 0 && supply < EPS) status = "none";
    else if (shown < -EPS) status = "short";
    else if (r.drives && source === "orders" && partsRecommended > 0 && r.lambs === partsRecommended) status = "sets";
    else if (Math.abs(shown) < EPS) status = "even";
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
    orderLambs: partsRecommended,
    extra,
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

/**
 * Pieces are whole (10/29/26): a need for 84.67 shoulders (pounds ordered of a
 * piece product) is 85, 22.3 left over is 22, 0.33 left over is none, and
 * 0.33 short is 1 short. Pounds (trim) stay as they are.
 */
export const wholeNeed = (r: Pick<PartRow, "part" | "need">) => (r.part.unit === "lb" ? r.need : Math.ceil(r.need - EPS));
export const wholeLeft = (r: Pick<PartRow, "part" | "left">) => (r.part.unit === "lb" ? r.left : Math.floor(r.left + EPS));

/** Main cuts with at least one whole piece left over: the extras Kathy has to find a home for. */
export function plannedExtras(rows: PartRow[]): PartRow[] {
  // A spare whole loin is already counted as a spare rack and short loin.
  const parents = new Set(rows.map((r) => r.parent).filter(Boolean));
  return rows.filter((r) => r.planned && wholeLeft(r) > EPS && !parents.has(r.part.id));
}

/**
 * "78 for parts + 2 carcass = 80 lambs", "55 for parts + 16 extra = 71
 * lambs", or null when there are no carcass or extra lambs. From orders the
 * parts count is what orders need; otherwise it's what's left of the count.
 */
export function carcassLine(c: Pick<WeekCalc, "final" | "carcass" | "partsLambs"> & Partial<Pick<WeekCalc, "extra" | "orderLambs" | "source">>): string | null {
  const extra = c.extra ?? 0;
  if (!c.carcass && !extra) return null;
  const fromOrders = (c.source ?? "orders") === "orders";
  const parts = fromOrders && extra ? (c.orderLambs ?? c.partsLambs - extra) : c.partsLambs;
  const bits = [`${parts} for parts`, c.carcass ? `${c.carcass} carcass` : "", fromOrders && extra ? `${extra} extra` : ""].filter(Boolean);
  if (bits.length < 2) return null;
  return `${bits.join(" + ")} = ${c.final} lambs`;
}

/**
 * One line saying where the week's lamb count came from, for example
 * "144 from the cut sheet (orders suggest 0)". Null when there is nothing
 * to count yet.
 */
export function lambSourceLine(c: Pick<WeekCalc, "final" | "source" | "recommended" | "cutSheetLambs"> & Partial<Pick<WeekCalc, "extra">>): string | null {
  const n = c.final;
  // Extra lambs are in the suggested count (10/29/26).
  const orders = c.extra ? "orders and extra lambs" : "orders";
  if (c.source === "cut sheet")
    return `${n} from the cut sheet (${c.recommended === n ? `${orders} agree` : `${orders} suggest ${c.recommended}`})`;
  if (c.source === "your number") {
    const others = [
      c.cutSheetLambs > 0 && c.cutSheetLambs !== n ? `cut sheet has ${c.cutSheetLambs}` : "",
      c.recommended !== n ? `${orders} suggest ${c.recommended}` : "",
    ].filter(Boolean);
    return `${n} is your number${others.length ? ` (${others.join(", ")})` : ""}`;
  }
  return c.recommended > 0 ? `${n} from ${orders}` : null;
}
