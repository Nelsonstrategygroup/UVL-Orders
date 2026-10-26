// The week's carcass balance from what's loaded for the week: one place, so
// This week and the Le Trim screen work it out the same way.

import { halfWholeNeeds } from "./calc/halfWhole";
import { cutSheetTotals } from "./calc/summary";
import { inProductUnits } from "./calc/units";
import { calcWeek } from "./calc/week";
import type { Catalog, WeekData } from "./db/types";

/**
 * calcWeek with the week's orders (and requested lines: they're cut and
 * frozen that week), the half and whole shortfall, your number, and the cut
 * sheet total. `withLeTrim: false` leaves the saved Le Trim plan out, to see
 * what's spare before it.
 */
export function weekCalc(data: WeekData, catalog: Catalog, opts: { withLeTrim?: boolean } = {}) {
  const w = data.weekRow;
  const requested = [...data.requests.values()].flat();
  const { short } = halfWholeNeeds(data.freezer, data.halfWhole, catalog.parts, catalog.products);
  const cs = cutSheetTotals(data.cutSets, catalog.sizes);
  const plan = opts.withLeTrim === false ? null : data.leTrim;
  const c = calcWeek({
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
    leTrim: plan ? { shoulders: plan.shoulders, legs: plan.legs, trimLb: plan.trim_lb } : null,
  });
  return { c, cs, short, requested };
}
