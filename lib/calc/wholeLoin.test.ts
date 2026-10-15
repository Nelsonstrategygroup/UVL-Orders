// The whole loin model (Kathy and Chris, 10/15/26), checked against the real
// orders for the week of Oct 12, 2026 and Chris's hand counts.

import { describe, expect, it } from "vitest";
import type { Part, Product } from "./types";
import { calcWeek, carcassLine, plannedExtras } from "./week";

const part = (id: string, name: string, per_lamb: number, drives: boolean, made_from: string | null = null, sort = 0): Part => ({
  id,
  name,
  per_lamb,
  unit: id === "trim" ? "lb" : "each",
  balance_check: ["leg", "shoulder", "rack", "loin", "fshank", "hshank", "neck"].includes(id),
  confirmed: true,
  sort,
  drives_count: drives,
  made_from,
});

// The live parts after the fix.
const parts: Part[] = [
  part("leg", "Leg", 2, true, null, 0),
  part("shoulder", "Shoulder", 2, true, null, 1),
  part("wholeloin", "Whole loin", 2, true, null, 2),
  part("rack", "Rack", 2, false, "wholeloin", 2),
  part("loin", "Short loin", 2, false, "wholeloin", 3),
  part("fshank", "Front shank", 2, false, null, 4),
  part("hshank", "Hind shank", 2, false, null, 5),
  part("neck", "Neck", 1, false, null, 6),
  part("trim", "Trim", 5, false, null, 7),
  part("denver", "Denver ribs", 2, false, null, 8),
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

// The live products after the fix (byproducts don't count toward lambs).
const byproduct = { counts_toward_lambs: false };
const products: Product[] = [
  prod("whole-lamb", { leg: 2, shoulder: 2, wholeloin: 2, fshank: 2 }),
  prod("carcass-lamb", {}, { carcass: true }),
  prod("whole-loin", { wholeloin: 1 }),
  prod("chops", { loin: 0.4 }, { unit: "lb" }),
  prod("short-loin", { loin: 1 }),
  prod("boneless-loins", { loin: 2 }),
  prod("french-rack", { rack: 1 }),
  prod("cap-on-rack", { rack: 1 }),
  prod("chop-ready-rack", { rack: 1 }),
  prod("hind-shanks", { hshank: 1 }),
  prod("front-shanks", { fshank: 1 }),
  prod("bls-legs", { leg: 1 }),
  prod("bi-legs", { leg: 1 }),
  prod("ao-legs", { leg: 1 }),
  prod("bls-shoulder", { shoulder: 1 }),
  prod("bi-shoulder", { shoulder: 1 }),
  prod("stew-meat", {}, { unit: "lb" }),
  prod("ground-1", { trim: 1 }, { unit: "pack" }),
  prod("ground-5", { trim: 5 }, { unit: "pack" }),
  // Still carries its old shoulder draw until the cleanup migration; the note wins.
  prod("le-trim", { shoulder: 0.1 }, { unit: "lb", fill_note: "Kathy fills from extra shoulders or legs." }),
  prod("heart", {}, byproduct),
  prod("liver", {}, byproduct),
  prod("kidney", {}, byproduct),
  prod("necks", { neck: 1 }, byproduct),
  prod("bones", {}, byproduct),
];

// Week of Oct 12, 2026: every order's lines added up (from the live database, 10/15).
const oct12 = {
  "whole-loin": 10,
  "ao-legs": 12,
  "bi-legs": 26,
  "bls-legs": 77,
  "bls-shoulder": 39,
  "boneless-loins": 36,
  bones: 60,
  "cap-on-rack": 121,
  chops: 20,
  "french-rack": 16,
  "front-shanks": 116,
  "ground-1": 76,
  "ground-5": 8, // 40 lb at 5 lb a pack
  heart: 52,
  "hind-shanks": 12,
  kidney: 50,
  "le-trim": 720,
  liver: 54,
  necks: 42,
  "short-loin": 47,
  "stew-meat": 40,
  "whole-lamb": 5,
  "bi-shoulder": 34,
};

const row = (c: ReturnType<typeof calcWeek>, id: string) => c.rows.find((r) => r.part.id === id)!;

describe("week of Oct 12, 2026 under the whole loin model", () => {
  const c = calcWeek({ parts, products, orders: [oct12] });

  it("legs: 77 BLS + 26 BI + 12 AO + 10 from 5 whole lambs = 125", () => {
    expect(row(c, "leg")).toMatchObject({ need: 125, lambs: 63 });
  });

  it("shoulders: 39 BLS + 34 BI + 10 from whole lambs = 83; Le Trim takes none", () => {
    expect(row(c, "shoulder")).toMatchObject({ need: 83, lambs: 42 });
  });

  it("racks 137 (121 cap-on + 16 French) and short loins 127 (47 + 72 boneless + 8 from chops)", () => {
    expect(row(c, "rack").need).toBe(137);
    expect(row(c, "loin").need).toBeCloseTo(127);
  });

  it("whole loins: 10 ordered + 10 in whole lambs + the larger of racks and short loins = 157", () => {
    expect(row(c, "wholeloin")).toMatchObject({ need: 157, lambs: 79, drives: true });
  });

  it("79 lambs, set by whole loins; racks and short loins are sub-rows and never set it", () => {
    expect(c.final).toBe(79);
    expect(c.source).toBe("orders");
    expect(c.driver?.part.id).toBe("wholeloin");
    expect(row(c, "wholeloin").status).toBe("sets");
    expect(c.rows.map((r) => r.part.id).slice(0, 5)).toEqual(["leg", "shoulder", "wholeloin", "rack", "loin"]);
    // 158 whole loins, 20 go out whole: 138 are cut into a rack and a short loin each.
    expect(row(c, "rack")).toMatchObject({ parent: "wholeloin", drives: false, supply: 138, left: 1, status: "extra" });
    expect(row(c, "loin")).toMatchObject({ parent: "wholeloin", drives: false, supply: 138 });
    expect(row(c, "loin").left).toBeCloseTo(11);
  });

  it("front shanks: 116 + 10 from whole lambs = 126, shown but never setting the count", () => {
    expect(row(c, "fshank")).toMatchObject({ need: 126, lambs: 0, supply: 158, left: 32, drives: false });
    // Hind shanks come off the legs: available, not planned, never in the extras list.
    expect(row(c, "hshank")).toMatchObject({ need: 12, lambs: 0, drives: false, planned: false, availableOnly: true });
    expect(plannedExtras(c.rows).map((r) => r.part.id)).not.toContain("hshank");
    // The spare whole loin shows as its spare rack and short loin, not twice.
    expect(plannedExtras(c.rows).map((r) => `${r.part.id} ${Math.round(r.left)}`)).toEqual(["leg 33", "shoulder 75", "rack 1", "loin 11", "fshank 32"]);
  });

  it("Le Trim is listed on its own, 720 lb, and not in the balance", () => {
    expect(c.filled.map((f) => [f.product.id, f.qty, f.note])).toEqual([
      ["le-trim", 720, "Kathy fills from extra shoulders or legs."],
    ]);
  });

  it("with the 6 chop-ready racks: racks 143, whole loins 163, 82 lambs", () => {
    const c6 = calcWeek({ parts, products, orders: [{ ...oct12, "chop-ready-rack": 6 }] });
    expect(row(c6, "rack").need).toBe(143);
    expect(row(c6, "wholeloin").need).toBe(163);
    expect(c6.final).toBe(82);
  });
});

describe("carcass lambs", () => {
  it("are added on top of the lambs for parts and stay out of the balance", () => {
    const c = calcWeek({ parts, products, orders: [{ ...oct12, "carcass-lamb": 2 }] });
    expect(c).toMatchObject({ partsLambs: 79, carcass: 2, recommended: 81, final: 81 });
    expect(carcassLine(c)).toBe("79 for parts + 2 carcass = 81 lambs");
    // The balance is for the 79 cut into parts.
    expect(row(c, "leg").supply).toBe(158);
  });

  it("with a cut sheet total, the rest after carcass lambs are cut into parts", () => {
    const c = calcWeek({ parts, products, orders: [{ "carcass-lamb": 2, "bls-legs": 10 }], cutSheetLambs: 40 });
    expect(c).toMatchObject({ final: 40, carcass: 2, partsLambs: 38 });
    expect(row(c, "leg").supply).toBe(76);
  });

  it("only carcass lambs: no part sets the count", () => {
    const c = calcWeek({ parts, products, orders: [{ "carcass-lamb": 3 }] });
    expect(c).toMatchObject({ final: 3, partsLambs: 0, driver: null });
    expect(c.rows.every((r) => r.status === "none")).toBe(true);
  });
});

describe("whole loins ordered whole", () => {
  it("add to the racks or short loins, whichever is larger", () => {
    const c = calcWeek({ parts, products, orders: [{ "whole-loin": 4, "short-loin": 6, "french-rack": 2 }] });
    expect(row(c, "wholeloin").need).toBe(10); // 4 + max(2, 6)
    expect(c.final).toBe(5);
  });
});

describe("before the fix (old data, for comparison)", () => {
  it("the same week showed 78, set by shoulders (155 with Le Trim's 72)", () => {
    const oldParts = parts
      .filter((p) => p.id !== "wholeloin")
      .map((p) => ({ ...p, made_from: null, drives_count: ["leg", "shoulder", "rack", "loin", "fshank"].includes(p.id) }));
    const oldProducts = products.map((p) =>
      p.id === "whole-lamb"
        ? { ...p, uses: p.uses.filter((u) => u.part_id !== "wholeloin") }
        : p.id === "whole-loin"
          ? { ...p, uses: [] }
          : { ...p, fill_note: "" },
    );
    const c = calcWeek({ parts: oldParts, products: oldProducts, orders: [oct12] });
    expect(row(c, "shoulder").need).toBeCloseTo(155);
    expect(c.final).toBe(78);
  });
});
