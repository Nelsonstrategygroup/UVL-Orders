import { describe, expect, it } from "vitest";
import { drivesLambCount, needsChecking, partAmountQty, partAmountRow } from "./products";

describe("part amounts, either way round", () => {
  it("shows small amounts per part and big ones per unit", () => {
    expect(partAmountRow(0.4)).toEqual({ mode: "per-part", amount: 2.5 }); // 2.5 lb of chops per short loin
    expect(partAmountRow(2)).toEqual({ mode: "per-unit", amount: 2 }); // a whole lamb uses 2 legs
    expect(partAmountRow(1)).toEqual({ mode: "per-unit", amount: 1 });
  });
  it("stores how much of the part one unit uses", () => {
    expect(partAmountQty("per-part", 2.5)).toBeCloseTo(0.4);
    expect(partAmountQty("per-unit", 2)).toBe(2);
    expect(partAmountQty("per-part", 0)).toBe(0);
  });
});

describe("Setup", () => {
  const parts = [
    { id: "loin", name: "Short loin", confirmed: true, drives_count: true },
    { id: "neck", name: "Neck", confirmed: true, drives_count: false },
    { id: "hshank", name: "Hind shank", confirmed: false, drives_count: false },
  ];
  const p = (id: string, extra = {}) => ({
    id,
    name: id,
    active: true,
    unit: "each",
    uses: [{ part_id: "loin", qty: 1 }],
    confirmed: true,
    ...extra,
  });

  it("knows which products can raise the lamb count", () => {
    expect(drivesLambCount(p("loin"), parts)).toBe(true);
    expect(drivesLambCount(p("neck", { uses: [{ part_id: "neck", qty: 1 }] }), parts)).toBe(false);
    expect(drivesLambCount(p("off", { counts_toward_lambs: false }), parts)).toBe(false);
    expect(drivesLambCount(p("pepper", { not_lamb: true }), parts)).toBe(false);
  });

  it("lists what still needs checking", () => {
    const list = needsChecking(
      [
        p("ok"),
        p("new", { confirmed: false }),
        p("shoulder", { alt_unit: "lb", lb_per_unit: null }),
        p("stew", { uses: [] }),
        p("bones", { uses: [], counts_toward_lambs: false }),
        p("old", { active: false, confirmed: false }),
      ],
      parts,
    );
    expect(list.map((x) => `${x.kind}:${x.id}`)).toEqual(["product:new", "product:shoulder", "product:stew", "part:hshank"]);
    expect(list[1].why).toMatch(/no weight for one piece/);
  });
});
