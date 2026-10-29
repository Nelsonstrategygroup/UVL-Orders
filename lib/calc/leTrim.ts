// Le Trim (change requests 10/25/26 and 10/29/26). Le Trim is ordered in
// pounds and made by weight: trim first, then boned-out shoulders, then half
// legs, all from what the week's lambs leave over after every other order.
// What's still not covered is a shortfall, shown as "about N extra
// average-size lambs" (each gives trim, 2 shoulders and 4 half legs). The app
// never adds lambs itself: Kathy adds them on the week's Extra lambs line,
// and their parts are then supply like any other lamb's.
//
// Kathy can also save what she actually used (the Le Trim plan); that goes
// on the cut sheet. Nothing here blocks saving.
//
// Averages are in Setup > Le Trim (shoulder, leg) and Setup > Parts (trim per
// lamb). OPEN: the 5 lb shoulder isn't confirmed (Chris saw about 4 lb on
// 10/26 with lighter lambs), and shoulders before half legs is an assumption:
// change LE_TRIM_USE_ORDER to change it.

import { EPS, fmt, num } from "./num";
import type { WeekCalc } from "./week";

/** What Kathy used for the week's Le Trim. */
export type LeTrimPlan = { shoulders: number; halfLegs: number; trimLb: number };

/** Average weights (lb): trim per lamb (Setup > Parts, Trim), a boneless shoulder and a boneless leg (Setup > Le Trim). */
export type LeTrimWeights = { trimPerLambLb: number; shoulderLb: number; legLb: number };

export type LeTrimPiece = "shoulder" | "halfLeg";

/** After trim, the order pieces are used in. OPEN: an assumption (Lucas, 10/29/26); change it here. */
export const LE_TRIM_USE_ORDER: LeTrimPiece[] = ["shoulder", "halfLeg"];

/** Whole legs halved for this many half legs. */
export const legsFor = (halfLegs: number) => Math.ceil(Math.max(0, halfLegs) / 2);

/** A half leg's average weight. */
export const halfLegLb = (w: LeTrimWeights) => w.legLb / 2;

/** What one extra average-size lamb gives Le Trim: its trim, 2 shoulders and 2 legs (4 half legs). */
export const lbPerExtraLamb = (w: LeTrimWeights) => w.trimPerLambLb + 2 * w.shoulderLb + 2 * w.legLb;

/** Le Trim ordered for the week: pounds, and packs at its order step (10 lb). */
export function leTrimOrdered(c: Pick<WeekCalc, "filled">, productId = "cp-le-trim", packLb = 10): { lb: number; packs: number } {
  const f = c.filled.find((x) => x.product.id === productId);
  const lb = num(f?.qty ?? 0);
  return { lb, packs: packLb > 0 ? Math.ceil(lb / packLb) : 0 };
}

/**
 * What's spare before Le Trim: shoulders, legs (and the half legs they
 * make), and trim no other order uses. From the balance worked out WITHOUT
 * Le Trim, so it isn't counted against itself. Organ Grind uses no trim
 * part, so it never reduces this.
 */
export function leTrimSpare(c: Pick<WeekCalc, "rows">): { shoulders: number; legs: number; halfLegs: number; trimLb: number } {
  const left = (id: string) => Math.max(0, num(c.rows.find((r) => r.part.id === id)?.left ?? 0));
  const legs = Math.floor(left("leg") + EPS);
  return { shoulders: Math.floor(left("shoulder") + EPS), legs, halfLegs: legs * 2, trimLb: Math.round(left("trim") * 100) / 100 };
}

export type LeTrimNeed = {
  orderedLb: number;
  /** Trim used (lb), at most what's spare. */
  trimLb: number;
  shoulders: number;
  halfLegs: number;
  /** Whole legs halved. */
  legs: number;
  /** About how much those cover (lb). */
  coveredLb: number;
  /** About how much is still not covered (lb); 0 when covered. */
  shortLb: number;
  /** About how many extra average-size lambs would cover the shortfall (rounded up). */
  extraLambs: number;
};

/**
 * Le Trim by weight: spare trim first, then spare pieces in LE_TRIM_USE_ORDER,
 * each only as many as needed. Whatever's left is the shortfall, and the
 * extra average-size lambs that would cover it.
 */
export function leTrimNeed(
  orderedLb: number,
  spare: { shoulders: number; halfLegs: number; trimLb: number },
  w: LeTrimWeights,
  order: LeTrimPiece[] = LE_TRIM_USE_ORDER,
): LeTrimNeed {
  const ordered = Math.max(0, num(orderedLb));
  const trimLb = Math.min(ordered, Math.max(0, spare.trimLb));
  let left = ordered - trimLb;
  const used: Record<LeTrimPiece, number> = { shoulder: 0, halfLeg: 0 };
  const each: Record<LeTrimPiece, number> = { shoulder: w.shoulderLb, halfLeg: halfLegLb(w) };
  const have: Record<LeTrimPiece, number> = { shoulder: spare.shoulders, halfLeg: spare.halfLegs };
  for (const piece of order) {
    if (left <= EPS || !(each[piece] > 0)) continue;
    used[piece] = Math.min(Math.max(0, Math.floor(have[piece])), Math.ceil(left / each[piece] - EPS));
    left -= used[piece] * each[piece];
  }
  const coveredLb = trimLb + used.shoulder * each.shoulder + used.halfLeg * each.halfLeg;
  const shortLb = left > EPS ? left : 0;
  const per = lbPerExtraLamb(w);
  return {
    orderedLb: ordered,
    trimLb: Math.round(trimLb * 100) / 100,
    shoulders: used.shoulder,
    halfLegs: used.halfLeg,
    legs: legsFor(used.halfLeg),
    coveredLb: Math.round(coveredLb * 100) / 100,
    shortLb: Math.round(shortLb * 100) / 100,
    extraLambs: shortLb > 0 && per > 0 ? Math.ceil(shortLb / per - EPS) : 0,
  };
}

/**
 * "Le Trim is short approximately 445 lb. Approximately 16 extra average-size
 * lambs would cover it." Null when it's covered. The averages are only
 * averages: smaller or bigger lambs need more or fewer (Lucas, 10/29/26).
 */
export function leTrimShortText(n: Pick<LeTrimNeed, "shortLb" | "extraLambs">): string | null {
  if (!(n.shortLb > 0)) return null;
  const lb = Math.max(1, Math.round(n.shortLb));
  return `Le Trim is short approximately ${lb} lb. Approximately ${n.extraLambs} extra average-size lamb${n.extraLambs === 1 ? "" : "s"} would cover it.`;
}

/** About how many pounds a plan makes, at the averages. */
export const planLb = (p: LeTrimPlan, w: LeTrimWeights) =>
  Math.round((num(p.trimLb) + p.shoulders * w.shoulderLb + p.halfLegs * halfLegLb(w)) * 100) / 100;

/** "Suggest": the by-weight mix (trim, then shoulders, then half legs). Only fills the boxes. */
export function suggestLeTrim(n: LeTrimNeed): LeTrimPlan {
  return { shoulders: n.shoulders, halfLegs: n.halfLegs, trimLb: n.trimLb };
}

export type LeTrimCheck = { ok: boolean; text: string };

/** The live checks on what Kathy typed, in plain words. Warnings only. */
export function leTrimChecks(
  plan: LeTrimPlan,
  spare: ReturnType<typeof leTrimSpare>,
  orderedLb: number,
  trimAvailable: { lb: number; actual: boolean },
  w: LeTrimWeights,
): LeTrimCheck[] {
  const out: LeTrimCheck[] = [];
  const lb = planLb(plan, w);
  const short = Math.round((orderedLb - lb) * 10) / 10;
  out.push(
    short <= 0.5
      ? { ok: true, text: `Approximately ${fmt(Math.round(lb))} lb for the ${fmt(orderedLb)} lb of Le Trim ordered.` }
      : { ok: false, text: `Approximately ${fmt(Math.round(lb))} lb: about ${fmt(Math.round(short))} lb short of the ${fmt(orderedLb)} lb ordered.` },
  );
  out.push(
    plan.shoulders <= spare.shoulders
      ? { ok: true, text: `Shoulders: ${plan.shoulders} of ${spare.shoulders} extra.` }
      : { ok: false, text: `Shoulders: ${plan.shoulders - spare.shoulders} more than the ${spare.shoulders} extra.` },
  );
  out.push(
    plan.halfLegs <= spare.halfLegs
      ? { ok: true, text: `Half legs: ${plan.halfLegs} of ${spare.halfLegs} (${spare.legs} extra legs).` }
      : { ok: false, text: `Half legs: ${plan.halfLegs - spare.halfLegs} more than the ${spare.halfLegs} the ${spare.legs} extra legs make.` },
  );
  const diff = Math.round((trimAvailable.lb - plan.trimLb) * 10) / 10;
  const about = trimAvailable.actual ? "" : "approximately ";
  out.push(
    diff >= 0
      ? { ok: true, text: `Trim: ${fmt(plan.trimLb)} lb used, ${about}${fmt(trimAvailable.lb)} lb spare.` }
      : { ok: false, text: `Trim: ${fmt(plan.trimLb)} lb used, ${about}${fmt(trimAvailable.lb)} lb spare. ${fmt(-diff)} lb more than spare.` },
  );
  return out;
}

/** The cut sheet's lines for the plan: "Bone out 40 shoulders for Le Trim", "Halve 18 legs for Le Trim". */
export function leTrimCutLines(plan: Pick<LeTrimPlan, "shoulders" | "halfLegs"> | null | undefined): string[] {
  if (!plan) return [];
  const out: string[] = [];
  if (plan.shoulders > 0) out.push(`Bone out ${plan.shoulders} shoulder${plan.shoulders === 1 ? "" : "s"} for Le Trim`);
  const legs = legsFor(plan.halfLegs);
  if (legs > 0) out.push(`Halve ${legs} leg${legs === 1 ? "" : "s"} for Le Trim`);
  return out;
}
