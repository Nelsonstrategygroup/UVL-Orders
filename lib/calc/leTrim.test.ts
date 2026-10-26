// The Le Trim plan (change request 10/25/26).

import { describe, expect, it } from "vitest";
import { leTrimChecks, leTrimCutLines, leTrimOrdered, leTrimSpare, legsFor, suggestLeTrim, trimFor } from "./leTrim";
import type { Part, Product } from "./types";
import { calcWeek } from "./week";

const part = (id: string, per_lamb: number, drives: boolean, sort: number): Part => ({
  id,
  name: id,
  per_lamb,
  unit: id === "trim" ? "lb" : "each",
  balance_check: id !== "trim",
  confirmed: true,
  sort,
  drives_count: drives,
  made_from: null,
});
const parts: Part[] = [part("leg", 2, true, 0), part("shoulder", 2, true, 1), part("trim", 5, false, 2)];
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
  prod("ground", { trim: 5 }, { unit: "pack" }),
  prod("cp-le-trim", {}, { unit: "lb", fill_note: "Kathy fills from extra shoulders or legs." }),
];
// 50 legs sets the count at 25 lambs: 50 shoulders and 125 lb trim come with them.
const orders = [{ legs: 50, shoulders: 20, ground: 5, "cp-le-trim": 300 }];
const settings = { shoulderTrimLb: 5, halfLegTrimLb: 6.5 };

describe("Le Trim", () => {
  const before = calcWeek({ parts, products, orders });
  const spare = leTrimSpare(before);
  const ordered = leTrimOrdered(before);

  it("is ordered in pounds, made in 10 lb packs, and kept out of the lamb count", () => {
    expect(ordered).toEqual({ lb: 300, packs: 30 });
    expect(before.final).toBe(25);
  });

  it("what's spare before the plan: shoulders, legs (two half legs each), trim", () => {
    expect(spare).toEqual({ shoulders: 30, legs: 0, halfLegs: 0, trimLb: 100 });
  });

  it("a saved plan takes its shoulders, legs and trim out of the extras, and never changes the lamb count", () => {
    const after = calcWeek({ parts, products, orders, leTrim: { shoulders: 24, legs: 3, trimLb: 140 } });
    const left = (id: string) => after.rows.find((r) => r.part.id === id)!.left;
    expect(after.final).toBe(25);
    expect(left("shoulder")).toBe(6);
    expect(left("leg")).toBe(-3); // more legs than were extra: shown as short, not a new lamb
    expect(left("trim")).toBe(-40);
  });

  it("whole legs halved: two half legs per leg, rounded up", () => {
    expect([legsFor(0), legsFor(1), legsFor(2), legsFor(7)]).toEqual([0, 1, 1, 4]);
  });

  it("estimates the trim from the settings", () => {
    expect(trimFor({ shoulders: 24, halfLegs: 6 }, settings)).toBe(159);
  });

  it("says what fits and what doesn't, in plain words, without blocking", () => {
    const checks = leTrimChecks({ shoulders: 34, halfLegs: 2, trimLb: 120 }, spare, ordered, { lb: spare.trimLb, actual: false });
    expect(checks.map((c) => c.ok)).toEqual([false, false, false, false]);
    expect(checks[0].text).toBe("36 shoulders and half legs for 30 packs of Le Trim (6 more than packs).");
    expect(checks[1].text).toBe("Shoulders: 4 more than the 30 extra.");
    expect(checks[3].text).toBe("Trim: 120 lb used, about 100 lb spare. 20 lb short.");
    const fine = leTrimChecks({ shoulders: 30, halfLegs: 0, trimLb: 90 }, spare, ordered, { lb: 110, actual: true });
    expect(fine.every((c) => c.ok)).toBe(true);
    expect(fine[3].text).toBe("Trim: 90 lb used, 110 lb spare. 20 lb left over.");
  });

  it("Suggest fills shoulders first, then half legs, and only fills the boxes", () => {
    expect(suggestLeTrim({ packs: 30 }, { shoulders: 24, legs: 5, halfLegs: 10, trimLb: 100 }, settings)).toEqual({
      shoulders: 24,
      halfLegs: 6,
      trimLb: 159,
    });
  });

  it("puts the plan on the cut sheet", () => {
    expect(leTrimCutLines({ shoulders: 24, halfLegs: 7 })).toEqual(["Bone out 24 shoulders for Le Trim", "Halve 4 legs for Le Trim"]);
    expect(leTrimCutLines({ shoulders: 0, halfLegs: 0 })).toEqual([]);
    expect(leTrimCutLines(null)).toEqual([]);
  });
});
