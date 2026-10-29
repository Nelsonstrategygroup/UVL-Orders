// The week's carcass balance from what's loaded for the week: one place, so
// This week and the Le Trim screen work it out the same way.

import { halfWholeNeeds } from "./calc/halfWhole";
import { leTrimNeed, leTrimOrdered, leTrimSpare, type LeTrimWeights } from "./calc/leTrim";
import { num } from "./calc/num";
import { cutSheetTotals } from "./calc/summary";
import { inProductUnits } from "./calc/units";
import { calcWeek } from "./calc/week";
import type { Catalog, WeekData } from "./db/types";

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
export function weekCalc(data: WeekData, catalog: Catalog, opts: { withLeTrim?: boolean } = {}) {
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
        ...[...data.orders.values()].map((o) => inProductUnits(o.lines, o.units, catalog.productById)),
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

  const mix = plan
    ? { shoulders: plan.shoulders, legs: plan.legs, trimLb: plan.trim_lb }
    : ordered.lb > 0
      ? { shoulders: need.shoulders, legs: need.legs, trimLb: need.trimLb }
      : null;
  const c = opts.withLeTrim === false || !mix ? before : run(mix);
  return {
    c,
    cs,
    short,
    requested,
    extraLambs,
    leTrim: { ordered, spare, need, weights, planned: !!plan },
  };
}
