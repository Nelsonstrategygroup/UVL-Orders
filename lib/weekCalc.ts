// The week's carcass balance from what's loaded for the week: one place, so
// This week and the Le Trim screen work it out the same way.

import { fillExtras, type ExtraLine } from "./calc/extras";
import { halfWholeNeeds } from "./calc/halfWhole";
import { leTrimNeed, leTrimOrdered, leTrimSpare, type LeTrimWeights } from "./calc/leTrim";
import { num } from "./calc/num";
import { cutSheetTotals } from "./calc/summary";
import { inProductUnits, toProductUnit } from "./calc/units";
import { calcWeek } from "./calc/week";
import type { Catalog, Order, WeekData } from "./db/types";
import type { Qty } from "./calc/types";

/** An order's firm lines: everything but "Only if extra" lines (they don't count; 11/8/26). */
export function firmLines(o: Pick<Order, "lines" | "extra">): Qty {
  if (!o.extra) return o.lines;
  const out: Qty = {};
  for (const [k, v] of Object.entries(o.lines)) if (!o.extra[k]) out[k] = v;
  return out;
}

/**
 * What an order goes out as: firm lines as ordered, "Only if extra" lines as
 * what they will get (saved on the line, in the product's own unit; nothing:
 * left out). The same as Packing and the box labels read (lib/db/packing.ts).
 */
export function willGetLines(o: Pick<Order, "lines" | "units" | "extra">): { lines: Qty; units: Order["units"] } {
  if (!o.extra) return { lines: o.lines, units: o.units };
  const lines: Qty = {};
  const units: Order["units"] = {};
  for (const [k, v] of Object.entries(o.lines)) {
    const x = o.extra[k];
    if (x) {
      if (num(x.fill ?? 0) > 0) lines[k] = num(x.fill);
      continue;
    }
    lines[k] = v;
    if (o.units[k]) units[k] = o.units[k];
  }
  return { lines, units };
}

/** The week's "Only if extra" lines, what each asked for in the product's own unit. */
export function extraLines(data: Pick<WeekData, "orders">, catalog: Pick<Catalog, "productById">, rank?: Map<string, number>): ExtraLine[] {
  const out: ExtraLine[] = [];
  for (const o of data.orders.values()) {
    for (const [productId, x] of Object.entries(o.extra ?? {})) {
      const q = num(o.lines[productId] ?? 0);
      const p = catalog.productById.get(productId);
      if (!(q > 0)) continue;
      out.push({
        key: `${o.id}|${productId}`,
        orderId: o.id,
        customerId: o.customer_id,
        productId,
        asked: p ? toProductUnit(q, o.units[productId], p) : q,
        rank: rank?.get(o.customer_id) ?? 1e9,
        locked: x.locked,
        stored: x.fill,
        chosen: x.chosen,
      });
    }
  }
  return out;
}

/**
 * Le Trim's averages: trim per lamb (Setup > Parts, Trim), a boneless
 * shoulder and a boneless leg (Setup > Le Trim). OPEN: the 5 lb shoulder
 * isn't confirmed (Chris saw about 4 lb on 10/26).
 */
export function leTrimWeights(catalog: Pick<Catalog, "parts" | "settings">): LeTrimWeights {
  const trim = catalog.parts.find((p) => p.id === "trim");
  return {
    trimPerLambLb: num(trim?.per_lamb ?? 5),
    shoulderLb: num(catalog.settings?.le_trim_shoulder_lb ?? 5) || 5,
    legLb: num(catalog.settings?.le_trim_leg_lb ?? 6.5) || 6.5,
  };
}

/**
 * calcWeek with the week's orders (and requested lines: they're cut and
 * frozen that week), the half and whole shortfall, extra lambs, your number,
 * and the cut sheet total.
 *
 * Le Trim (10/29/26): worked out by weight from what's spare before it
 * (trim, then shoulders, then half legs). The saved plan, if any, comes out
 * of the extras; with no plan saved, the worked-out mix does, so the balance
 * shows the shoulders and legs going to Le Trim. `withLeTrim: false` leaves
 * Le Trim out, to see what's spare before it.
 */
export function weekCalc(
  data: WeekData,
  catalog: Catalog,
  opts: {
    withLeTrim?: boolean;
    /** The shared customer order (customerRank): who fills first from extras until Kathy decides. */
    rank?: Map<string, number>;
    /** A Le Trim plan being edited, used instead of the saved one (the Le Trim page, live). */
    plan?: { shoulders: number; legs: number; trimLb: number } | null;
  } = {},
) {
  const w = data.weekRow;
  const requested = [...data.requests.values()].flat();
  const { short } = halfWholeNeeds(data.freezer, data.halfWhole, catalog.parts, catalog.products);
  const cs = cutSheetTotals(data.cutSets, catalog.sizes);
  const extraLambs = (data.extraLambs ?? []).reduce((s, r) => s + num(r.lambs), 0);
  const run = (leTrim: { shoulders: number; legs: number; trimLb: number } | null) =>
    calcWeek({
      parts: catalog.parts,
      products: catalog.products,
      // In each product's own unit (pounds of a piece product become pieces).
      orders: [
        // Firm lines only: "Only if extra" lines fill from what's left afterwards.
        ...[...data.orders.values()].map((o) => inProductUnits(firmLines(o), o.units, catalog.productById)),
        ...requested.map((r) => inProductUnits({ [r.product_id]: r.qty }, r.unit ? { [r.product_id]: r.unit } : {}, catalog.productById)),
      ],
      shortfall: short,
      override: w?.lamb_override ?? null,
      cutSheetLambs: cs.total,
      extraLambs,
      leTrim,
    });

  // Le Trim from what's spare before it. The kill sheet's actual trim, once typed on the plan, replaces the estimate.
  const before = run(null);
  const weights = leTrimWeights(catalog);
  const ordered = leTrimOrdered(before);
  const spare = leTrimSpare(before);
  const plan = data.leTrim;
  if (plan?.trim_actual_lb != null) spare.trimLb = num(plan.trim_actual_lb);
  const need = leTrimNeed(ordered.lb, spare, weights);

  const mix = opts.plan
    ? opts.plan
    : plan
    ? { shoulders: plan.shoulders, legs: plan.legs, trimLb: plan.trim_lb }
    : ordered.lb > 0
      ? { shoulders: need.shoulders, legs: need.legs, trimLb: need.trimLb }
      : null;
  const c = opts.withLeTrim === false || !mix ? before : run(mix);

  // "Only if extra" lines: what's left after every firm line and Le Trim.
  const lines = extraLines(data, catalog, opts.rank);
  const extras = fillExtras({
    rows: c.rows,
    parts: catalog.parts,
    products: catalog.productById,
    lines,
    partial: catalog.settings?.extra_fill_partial !== false,
    leTrimEstimated: ordered.lb > 0 && !plan && !opts.plan,
    // The kill sheet's trim, once typed: spare trim is that less what Le Trim takes.
    spare: plan?.trim_actual_lb != null && mix ? { trim: num(plan.trim_actual_lb) - num(mix.trimLb) } : undefined,
  });
  return {
    extras,
    extraLines: lines,
    c,
    cs,
    short,
    requested,
    extraLambs,
    leTrim: { ordered, spare, need, weights, planned: !!plan },
  };
}
