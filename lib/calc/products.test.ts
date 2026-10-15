import { describe, expect, it } from "vitest";
import { boxesNeeded, boxesText, drivesLambCount, findProducts, groupProducts, needsChecking, partAmountQty, partAmountRow } from "./products";

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

describe("Add a product picker", () => {
  const list = [
    { id: "a", name: "BLS Legs", short_name: "", active: true },
    { id: "b", name: "Hind Shanks", short_name: "HS", active: true },
    { id: "c", name: "Labeled Hind Shanks", short_name: "", active: true },
    { id: "d", name: "Old Legs", short_name: "", active: false },
    { id: "e", name: "Front Shanks", short_name: "FS", active: true },
  ];
  const ids = (q: string) => findProducts(list, q).map((x) => x.id);

  it("finds by any part of the name, names starting with it first", () => {
    expect(ids("hind")).toEqual(["b", "c"]);
    expect(ids("shank")).toEqual(["b", "c", "e"]);
    expect(ids("legs")).toEqual(["a"]);
  });

  it("finds by short name and by several words", () => {
    expect(ids("fs")).toEqual(["e"]);
    expect(ids("lab hind")).toEqual(["c"]);
    expect(ids("HIND")).toEqual(["b", "c"]);
  });

  it("never shows retired products, and nothing for an empty box", () => {
    expect(ids("old")).toEqual([]);
    expect(ids("   ")).toEqual([]);
  });
});

describe("product groups on the order form", () => {
  it("shows each group once, even when a product was added out of order", () => {
    const list = [
      { name: "Whole Loin", group_name: "Loins and chops", sort: 34 },
      { name: "Whole Lamb", group_name: "Whole lambs", sort: 100 },
      { name: "Chops", group_name: "Loins and chops", sort: 200 },
      { name: "AO Legs", group_name: "Legs", sort: 522 },
      { name: "BLS Legs", group_name: "Legs", sort: 500 },
    ];
    expect(groupProducts(list).map((g) => `${g.group}: ${g.products.map((x) => x.name).join(", ")}`)).toEqual([
      "Loins and chops: Whole Loin, Chops",
      "Whole lambs: Whole Lamb",
      "Legs: BLS Legs, AO Legs",
    ]);
  });
});

describe("boxes per order (products never share a box)", () => {
  const byId = new Map([
    ["legs", { name: "BLS Legs", unit: "each", per_box: 6 }],
    ["rack", { name: "French Rack", unit: "each", per_box: 10 }],
    ["trim", { name: "Trim 5 lb", unit: "pack", lb_per_unit: 5, per_box: 8 }],
    ["shoulder", { name: "BLS Shoulder", unit: "each", lb_per_unit: 4, per_box: 6 }],
    ["heart", { name: "Heart", unit: "pack", per_box: null }],
  ]);

  it("rounds each product up to whole boxes, then adds them", () => {
    expect(boxesNeeded({ legs: 7, rack: 3 }, {}, byId)).toEqual({ boxes: 3, unknown: [] });
    expect(boxesNeeded({ legs: 6, rack: 10, trim: 16 }, {}, byId)).toEqual({ boxes: 4, unknown: [] });
    expect(boxesText({ boxes: 1, unknown: [] })).toBe("1 box");
  });

  it("converts an amount taken in pounds to pieces first", () => {
    // 30 lb of shoulder at about 4 lb each is 7.5 pieces, so 2 boxes of 6.
    expect(boxesNeeded({ shoulder: 30 }, { shoulder: "lb" }, byId).boxes).toBe(2);
  });

  it("lists products with no box size yet, and says at least", () => {
    const b = boxesNeeded({ legs: 2, heart: 5 }, {}, byId);
    expect(b).toEqual({ boxes: 1, unknown: ["Heart"] });
    expect(boxesText(b)).toBe("at least 1 box");
    expect(boxesText(boxesNeeded({ heart: 5 }, {}, byId))).toBe("");
  });
});
