// SPEC 12.3: splitting an order into boxes, with Kathy's limits and the 45 lb cap.

import { describe, expect, it } from "vitest";
import { boxCapacity, orderBoxes, orderBoxesText, planBoxes, planText, type BoxLimit, type BoxType } from "./boxes";

const TYPES: BoxType[] = [
  { id: "mvm", name: "MVM", size_rank: 1 },
  { id: "roll-stock", name: "Roll Stock", size_rank: 2 },
  { id: "jerky", name: "Jerky", size_rank: 3 },
  { id: "white", name: "White", size_rank: 4 },
  { id: "baby", name: "Baby", size_rank: 5 },
];
const ok = (box_type_id: string, max_count: number | null, max_lb: number | null = null): BoxLimit => ({ box_type_id, max_count, max_lb, status: "ok" });
const unsure = (box_type_id: string): BoxLimit => ({ box_type_id, max_count: null, max_lb: null, status: "needs_checking" });
const no = (box_type_id: string): BoxLimit => ({ box_type_id, max_count: null, max_lb: null, status: "does_not_fit" });

// From Kathy's sheet (reference/UVL_Box_Limits_for_Claude_Code.csv).
const BNLS_LEGS = [ok("mvm", 6), ok("roll-stock", 5), ok("jerky", 4), ok("white", 2), unsure("baby")];
const CAP_ON_RACK = [ok("mvm", 10), ok("roll-stock", 6), ok("jerky", 6), ok("white", 2), unsure("baby")];
const TRIM_6 = [ok("mvm", 8), ok("roll-stock", 6), ok("jerky", 4), ok("white", 2), unsure("baby")];
const LE_TRIM = [ok("mvm", null, 40), ok("roll-stock", null, 30), ok("jerky", null, 20), ok("white", null, 10), unsure("baby")];
const HEART = [no("mvm"), no("roll-stock"), ok("jerky", null, 25), ok("white", null, 15), unsure("baby")];
const DENVER = TYPES.map((t) => unsure(t.id));
const BNLS_SHOULDER = [unsure("mvm"), ok("roll-stock", 8), ok("jerky", 5), ok("white", 4), ok("baby", 2)];

const legs = { name: "BNLS Legs", unit: "each" };
const plan = (n: number, p: { name: string; unit: string; lb_per_unit?: number | null }, limits: BoxLimit[], cap = 45) => planBoxes(n, p, limits, TYPES, cap);

describe("Kathy's examples", () => {
  it("8 BNLS legs = MVM 6 + White 2", () => {
    expect(planText(plan(8, legs, BNLS_LEGS), "each")).toBe("MVM 6 + White 2");
  });

  it("12 cap-on racks = MVM 10 + White 2", () => {
    expect(planText(plan(12, { name: "Cap On Rack", unit: "each" }, CAP_ON_RACK), "each")).toBe("MVM 10 + White 2");
  });

  it("Trim 6 lb packs never go over 45 lb in an MVM box (8 x 6 = 48, so 7)", () => {
    const trim = { name: "Trim 6 lb", unit: "pack", lb_per_unit: 6 };
    expect(boxCapacity(ok("mvm", 8), trim, 45)).toBe(7);
    for (let n = 1; n <= 60; n++) {
      const p = plan(n, trim, TRIM_6);
      expect(p.boxes.reduce((s, b) => s + b.amount, 0)).toBe(n);
      for (const b of p.boxes) expect(b.lb!).toBeLessThanOrEqual(45);
    }
    expect(planText(plan(20, trim, TRIM_6), "pack")).toBe("MVM 7 + MVM 7 + Roll Stock 6");
  });
});

describe("the split rule", () => {
  it("one box when one box holds it: the smallest that does", () => {
    expect(planText(plan(5, legs, BNLS_LEGS), "each")).toBe("Roll Stock 5");
    expect(planText(plan(2, legs, BNLS_LEGS), "each")).toBe("White 2");
    expect(planText(plan(6, legs, BNLS_LEGS), "each")).toBe("MVM 6");
  });

  it("full boxes of the largest, then the smallest box for the rest", () => {
    expect(planText(plan(14, legs, BNLS_LEGS), "each")).toBe("MVM 6 + MVM 6 + White 2");
    expect(planText(plan(13, legs, BNLS_LEGS), "each")).toBe("MVM 6 + MVM 6 + White 1");
    expect(planText(plan(16, legs, BNLS_LEGS), "each")).toBe("MVM 6 + MVM 6 + Jerky 4");
    expect(planText(plan(12, legs, BNLS_LEGS), "each")).toBe("MVM 6 + MVM 6");
  });

  it("pounds: Le Trim 70 lb = MVM 40 lb + Roll Stock 30 lb", () => {
    expect(planText(plan(70, { name: "Le Trim", unit: "lb" }, LE_TRIM), "lb")).toBe("MVM 40 lb + Roll Stock 30 lb");
  });

  it("the cap is a setting", () => {
    const trim = { name: "Trim 6 lb", unit: "pack", lb_per_unit: 6 };
    expect(boxCapacity(ok("mvm", 8), trim, 30)).toBe(5);
    expect(boxCapacity(ok("mvm", null, 45), { name: "Chops", unit: "lb" }, 30)).toBe(30);
  });

  it("a product that never goes in a box type is never put in one", () => {
    const rack = [ok("mvm", 18), ok("roll-stock", 10), ok("jerky", 8), no("white"), no("baby")];
    expect(planText(plan(3, { name: "French Rack", unit: "each" }, rack), "each")).toBe("Jerky 3");
  });
});

describe("what goes in red", () => {
  it("no confirmed box at all", () => {
    const p = plan(10, { name: "Denver Ribs", unit: "lb" }, DENVER);
    expect(p.boxes).toEqual([]);
    expect(p.problem).toMatch(/need checking/);
  });

  it("pound limits but no weight per pack", () => {
    const p = plan(10, { name: "Heart", unit: "pack" }, HEART.filter((l) => l.status !== "needs_checking"));
    expect(p.problem).toMatch(/weight per unit/);
  });

  it("an unconfirmed smaller box that might have held the rest", () => {
    const p = plan(8, legs, BNLS_LEGS);
    expect(planText(p, "each")).toBe("MVM 6 + White 2");
    expect(p.unconfirmed).toEqual(["Baby"]);
  });

  it("an unconfirmed bigger box that might have taken the full boxes", () => {
    const p = plan(20, { name: "BNLS Shoulder", unit: "each" }, BNLS_SHOULDER);
    expect(planText(p, "each")).toBe("Roll Stock 8 + Roll Stock 8 + White 4");
    expect(p.unconfirmed).toEqual(["MVM"]);
  });

  it("pieces with no weight per piece: the count still works, the weight can't be checked", () => {
    const p = plan(8, legs, BNLS_LEGS);
    expect(p.weightUnknown).toBe(true);
    expect(p.boxes.every((b) => b.lb === null)).toBe(true);
  });

  it("a product that never goes in any box isn't a problem: it's not boxed (Carcass Lamb)", () => {
    const p = plan(2, { name: "Carcass Lamb", unit: "each" }, TYPES.map((t) => no(t.id)));
    expect(p).toMatchObject({ boxes: [], problem: null, notBoxed: true });
  });

  it("nothing ordered, nothing planned", () => {
    expect(plan(0, legs, BNLS_LEGS)).toMatchObject({ boxes: [], problem: null });
  });
});

describe("boxes for a whole order", () => {
  const setup = { types: TYPES, limits: new Map([["legs", BNLS_LEGS], ["denver", DENVER]]), capLb: 45 };
  const products = new Map([
    ["legs", { name: "BNLS Legs", unit: "each" }],
    ["denver", { name: "Denver Ribs", unit: "lb" }],
  ]);

  it("adds up each product's boxes", () => {
    const b = orderBoxes({ legs: 8 }, {}, products, setup);
    expect(b).toMatchObject({ boxes: 2, problems: [], unconfirmed: ["BNLS Legs"] });
    expect(orderBoxesText(b)).toBe("2 boxes");
  });

  it("says 'at least' when a product can't be boxed yet", () => {
    const b = orderBoxes({ legs: 8, denver: 10 }, {}, products, setup);
    expect(b.problems.map((x) => x.name)).toEqual(["Denver Ribs"]);
    expect(orderBoxesText(b)).toBe("at least 2 boxes");
  });
});
