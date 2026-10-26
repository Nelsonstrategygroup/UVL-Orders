// The Le Trim plan (change request 10/25/26). Le Trim is made by hand from
// what's left over: boned-out shoulders and half legs, each with trim. Kathy
// decides the mix after the other orders are in; this works out what's spare,
// checks what she enters, and suggests a starting point. Nothing here changes
// the lamb count, and nothing blocks saving: she may knowingly save a
// shortfall.

import { fmt, num } from "./num";
import type { WeekCalc } from "./week";

/** What Kathy used for the week's Le Trim. */
export type LeTrimPlan = { shoulders: number; halfLegs: number; trimLb: number };

/** Trim lb per component (Setup > Le Trim). */
export type LeTrimSettings = { shoulderTrimLb: number; halfLegTrimLb: number };

/** Whole legs halved for this many half legs. */
export const legsFor = (halfLegs: number) => Math.ceil(Math.max(0, halfLegs) / 2);

/** Le Trim ordered for the week: pounds, and packs at its order step (10 lb). */
export function leTrimOrdered(c: Pick<WeekCalc, "filled">, productId = "cp-le-trim", packLb = 10): { lb: number; packs: number } {
  const f = c.filled.find((x) => x.product.id === productId);
  const lb = num(f?.qty ?? 0);
  return { lb, packs: packLb > 0 ? Math.ceil(lb / packLb) : 0 };
}

/**
 * What's spare before Le Trim: extra shoulders, extra legs (and the most
 * half legs they make), and extra trim. From the balance worked out WITHOUT
 * the plan, so it doesn't count the plan against itself.
 */
export function leTrimSpare(c: Pick<WeekCalc, "rows">): { shoulders: number; legs: number; halfLegs: number; trimLb: number } {
  const left = (id: string) => Math.max(0, num(c.rows.find((r) => r.part.id === id)?.left ?? 0));
  const legs = Math.floor(left("leg"));
  return { shoulders: Math.floor(left("shoulder")), legs, halfLegs: legs * 2, trimLb: left("trim") };
}

/** About how much trim this mix takes, from the settings. */
export const trimFor = (p: Pick<LeTrimPlan, "shoulders" | "halfLegs">, s: LeTrimSettings) =>
  Math.round((p.shoulders * s.shoulderTrimLb + p.halfLegs * s.halfLegTrimLb) * 10) / 10;

export type LeTrimCheck = { ok: boolean; text: string };

/** The live checks, in plain words. Warnings only. */
export function leTrimChecks(
  plan: LeTrimPlan,
  spare: ReturnType<typeof leTrimSpare>,
  ordered: { packs: number },
  trimAvailable: { lb: number; actual: boolean },
): LeTrimCheck[] {
  const out: LeTrimCheck[] = [];
  const pieces = plan.shoulders + plan.halfLegs;
  out.push(
    pieces === ordered.packs
      ? { ok: true, text: `${pieces} shoulders and half legs for ${ordered.packs} packs of Le Trim.` }
      : { ok: false, text: `${pieces} shoulders and half legs for ${ordered.packs} packs of Le Trim (${pieces > ordered.packs ? `${pieces - ordered.packs} more` : `${ordered.packs - pieces} fewer`} than packs).` },
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
  const about = trimAvailable.actual ? "" : "about ";
  out.push(
    diff >= 0
      ? { ok: true, text: `Trim: ${fmt(plan.trimLb)} lb used, ${about}${fmt(trimAvailable.lb)} lb spare. ${fmt(diff)} lb left over.` }
      : { ok: false, text: `Trim: ${fmt(plan.trimLb)} lb used, ${about}${fmt(trimAvailable.lb)} lb spare. ${fmt(-diff)} lb short.` },
  );
  return out;
}

/** "Suggest": shoulders first, then half legs, for the packs ordered; trim from the settings. Only fills the boxes. */
export function suggestLeTrim(ordered: { packs: number }, spare: ReturnType<typeof leTrimSpare>, s: LeTrimSettings): LeTrimPlan {
  const shoulders = Math.min(ordered.packs, spare.shoulders);
  const halfLegs = Math.min(ordered.packs - shoulders, spare.halfLegs);
  return { shoulders, halfLegs, trimLb: trimFor({ shoulders, halfLegs }, s) };
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
