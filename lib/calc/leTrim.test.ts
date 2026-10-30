// Le Trim (change requests 10/25/26 and 10/29/26): by weight, from what's
// spare, with extra lambs on the week.

import { describe, expect, it } from "vitest";
import {
  lbPerExtraLamb,
  leTrimChecks,
  leTrimCutLines,
  leTrimNeed,
  leTrimOrdered,
  leTrimShortText,
  leTrimSpare,
  legsFor,
  planLb,
  suggestLeTrim,
  type LeTrimWeights,
} from "./leTrim";
import type { Part, Product, Qty } from "./types";
import { carcassLine, calcWeek, plannedExtras, wholeLeft, wholeNeed } from "./week";

const part = (id: string, per_lamb: number, drives: boolean, sort: number, made_from: string | null = null): Part => ({
  id,
  name: id,
  per_lamb,
  unit: id === "trim" ? "lb" : "each",
  balance_check: id !== "trim",
  confirmed: true,
  sort,
  drives_count: drives,
  made_from,
});
const parts: Part[] = [
  part("leg", 2, true, 0),
  part("shoulder", 2, true, 1),
  part("wholeloin", 2, true, 2),
  part("rack", 2, false, 3, "wholeloin"),
  part("loin", 2, false, 4, "wholeloin"),
  part("fshank", 2, false, 5),
  part("trim", 5, false, 6),
];
const prod = (id: string, uses: Record<string, number>, extra: Partial<Product> = {}): Product => ({
  id,
  name: id,
  short_name: "",
  unit: "each",
  group_name: "",
  cut_spec_id: null,
  fresh_only: false,
  active: true,
  sort: 0,
  uses: Object.entries(uses).map(([part_id, qty]) => ({ part_id, qty })),
  ...extra,
});
const products: Product[] = [
  prod("legs", { leg: 1 }),
  prod("shoulders", { shoulder: 1 }),
  prod("racks", { rack: 1 }),
  prod("ground", { trim: 5 }, { unit: "pack" }),
  prod("cp-le-trim", {}, { unit: "lb", fill_note: "Kathy fills from extra shoulders or legs." }),
];
// Setup's averages: 5 lb trim per lamb, 5 lb shoulder, 6.5 lb leg (3.25 a half).
const W: LeTrimWeights = { trimPerLambLb: 5, shoulderLb: 5, legLb: 6.5 };

/** As lib/weekCalc.ts does it: the balance before Le Trim, what's spare, and Le Trim by weight. */
function week(orders: Qty, extraLambs = 0) {
  const before = calcWeek({ parts, products, orders: [orders], extraLambs });
  const need = leTrimNeed(leTrimOrdered(before).lb, leTrimSpare(before), W);
  const after = calcWeek({ parts, products, orders: [orders], extraLambs, leTrim: { shoulders: need.shoulders, legs: need.legs, trimLb: need.trimLb } });
  return { before, need, after, left: (id: string) => after.rows.find((r) => r.part.id === id)!.left };
}

// 110 legs and 110 shoulders set the count at 55; racks need only 50 whole loins.
const A: Qty = { legs: 110, shoulders: 110, racks: 100, "cp-le-trim": 720 };

describe("Le Trim by weight: the four cases (10/29/26)", () => {
  it("one extra average-size lamb gives about 28 lb: 5 trim + 10 shoulder + 13 leg", () => {
    expect(lbPerExtraLamb(W)).toBe(28);
  });

  it("A: 55 lambs, 720 lb Le Trim, no other trim, no spare legs or shoulders: about 16 extra, never near 140", () => {
    const { before, need } = week(A);
    expect(before.final).toBe(55);
    expect(leTrimSpare(before)).toEqual({ shoulders: 0, legs: 0, halfLegs: 0, trimLb: 275 });
    expect(need).toMatchObject({ trimLb: 275, shoulders: 0, halfLegs: 0, shortLb: 445, extraLambs: 16 });
    expect(leTrimShortText(need)).toBe("Le Trim is short approximately 445 lb. Approximately 16 extra average-size lambs would cover it.");
  });

  it("B: A plus 16 extra lambs (Le Trim): covered, 71 lambs, and their racks, loins and shanks are left over", () => {
    const { before, need, left } = week(A, 16);
    expect(before.final).toBe(71);
    expect(carcassLine(before)).toBe("55 for parts + 16 extra = 71 lambs");
    expect(need).toMatchObject({ trimLb: 355, shoulders: 32, halfLegs: 64, legs: 32, shortLb: 0, extraLambs: 0 });
    expect(leTrimShortText(need)).toBeNull();
    // The extra lambs' shoulders and legs went to Le Trim; the rest is left over.
    expect([left("shoulder"), left("leg"), left("trim")]).toEqual([0, 0, 0]);
    expect(left("rack")).toBe(42);
    expect(left("loin")).toBe(142);
    expect(left("fshank")).toBe(142);
  });

  it("C: A with 10 spare shoulders: they're used first (50 lb), so about 15 extra", () => {
    const { need } = week({ ...A, shoulders: 100 });
    expect(need).toMatchObject({ trimLb: 275, shoulders: 10, shortLb: 395, extraLambs: 15 });
  });

  it("D: a normal week covered by leftovers: no warning, the lamb count unchanged", () => {
    const orders: Qty = { legs: 110, shoulders: 60, racks: 100, "cp-le-trim": 300 };
    const { before, need, after, left } = week(orders);
    expect(need).toMatchObject({ trimLb: 275, shoulders: 5, halfLegs: 0, shortLb: 0, extraLambs: 0 });
    expect(leTrimShortText(need)).toBeNull();
    expect(before.final).toBe(55);
    expect(after.final).toBe(55);
    expect(left("shoulder")).toBe(45);
  });
});

describe("Le Trim", () => {
  const before = calcWeek({ parts, products, orders: [{ legs: 50, shoulders: 20, ground: 5, "cp-le-trim": 300 }] });
  const spare = leTrimSpare(before);

  it("is ordered in pounds, kept out of the lamb count; spare is what other orders leave", () => {
    expect(leTrimOrdered(before)).toEqual({ lb: 300, packs: 30 });
    expect(before.final).toBe(25);
    expect(spare).toEqual({ shoulders: 30, legs: 0, halfLegs: 0, trimLb: 100 });
  });

  it("uses shoulders before half legs, only as many as needed", () => {
    const n = leTrimNeed(100, { shoulders: 4, halfLegs: 10, trimLb: 50 }, W);
    expect(n).toMatchObject({ trimLb: 50, shoulders: 4, halfLegs: 10, legs: 5, shortLb: 0 });
    expect(n.coveredLb).toBe(102.5);
    // Half legs first, if the order is changed.
    expect(leTrimNeed(100, { shoulders: 4, halfLegs: 10, trimLb: 50 }, W, ["halfLeg", "shoulder"])).toMatchObject({ halfLegs: 10, shoulders: 4 });
  });

  it("a saved plan takes its shoulders, legs and trim out of the extras, and never changes the lamb count", () => {
    const after = calcWeek({ parts, products, orders: [{ legs: 50, shoulders: 20, ground: 5, "cp-le-trim": 300 }], leTrim: { shoulders: 24, legs: 3, trimLb: 140 } });
    const left = (id: string) => after.rows.find((r) => r.part.id === id)!.left;
    expect(after.final).toBe(25);
    expect(left("shoulder")).toBe(6);
    expect(left("leg")).toBe(-3); // more legs than were extra: shown as short, not a new lamb
    expect(left("trim")).toBe(-40);
  });

  it("whole legs halved: two half legs per leg, rounded up", () => {
    expect([legsFor(0), legsFor(1), legsFor(2), legsFor(7)]).toEqual([0, 1, 1, 4]);
  });

  it("checks what Kathy typed by weight, in plain words, without blocking", () => {
    const checks = leTrimChecks({ shoulders: 34, halfLegs: 2, trimLb: 120 }, spare, 300, { lb: spare.trimLb, actual: false }, W);
    expect(planLb({ shoulders: 34, halfLegs: 2, trimLb: 120 }, W)).toBe(296.5);
    expect(checks.map((c) => c.ok)).toEqual([false, false, false, false]);
    expect(checks[0].text).toBe("Approximately 297 lb: about 4 lb short of the 300 lb ordered.");
    expect(checks[1].text).toBe("Shoulders: 4 more than the 30 extra.");
    expect(checks[3].text).toBe("Trim: 120 lb used, approximately 100 lb spare. 20 lb more than spare.");
    const fine = leTrimChecks({ shoulders: 30, halfLegs: 0, trimLb: 150 }, spare, 300, { lb: 160, actual: true }, W);
    expect(fine.every((c) => c.ok)).toBe(true);
    expect(fine[3].text).toBe("Trim: 150 lb used, 160 lb spare.");
  });

  it("Suggest fills the by-weight mix", () => {
    expect(suggestLeTrim(leTrimNeed(300, spare, W))).toEqual({ trimLb: 100, shoulders: 30, halfLegs: 0 });
  });

  it("puts the plan on the cut sheet", () => {
    expect(leTrimCutLines({ shoulders: 24, halfLegs: 7 })).toEqual(["Bone out 24 shoulders for Le Trim", "Halve 4 legs for Le Trim"]);
    expect(leTrimCutLines({ shoulders: 0, halfLegs: 0 })).toEqual([]);
    expect(leTrimCutLines(null)).toEqual([]);
  });
});

describe("whole pieces (10/29/26)", () => {
  it("less than a whole piece spare is even; any part of one short is one short; needs round up", () => {
    const spareThird = calcWeek({ parts, products, orders: [{ legs: 50, shoulders: 49 + 2 / 3 }] });
    const sh = spareThird.rows.find((r) => r.part.id === "shoulder")!;
    expect(sh.left).toBeCloseTo(1 / 3);
    // Shoulders tie with legs for the count here, so they "set" it; none shows as extra.
    expect([wholeLeft(sh), wholeNeed(sh), sh.status]).toEqual([0, 50, "sets"]);
    expect(plannedExtras(spareThird.rows).map((r) => r.part.id)).not.toContain("shoulder");

    // Short only when the count is fixed (Your number 25): a third of a shoulder short is one short.
    const shortThird = calcWeek({ parts, products, orders: [{ legs: 50, shoulders: 50 + 1 / 3 }], override: 25 });
    const s2 = shortThird.rows.find((r) => r.part.id === "shoulder")!;
    expect([wholeLeft(s2), wholeNeed(s2), s2.status]).toEqual([-1, 51, "short"]);
  });
});
