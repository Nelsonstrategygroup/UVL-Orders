import { describe, expect, it } from "vitest";
import { drivesLambCount, findProducts, groupProducts, needsChecking, partAmountQty, partAmountRow, placeProduct } from "./products";

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


describe("placeProduct (11/12/26)", () => {
  const p = (id: string, sort: number, group_name: string, active = true) => ({ id, name: id, sort, group_name, active });
  // As on 11/12/26: old turned-off products at 0 to 35, then the real list by hundreds.
  const list = [
    p("old-other", 33, "Other", false),
    p("sirloin", 34, "Other"),
    p("tenderloin", 35, "Other"),
    p("whole", 100, "Whole lambs"),
    p("hind", 400, "Shanks"),
    p("front", 405, "Shanks"),
    p("labeled-hind", 410, "Shanks"),
    p("legs", 500, "Legs"),
    p("pepper", 763, "Byproducts"),
    p("mixed", 764, "Shanks"),
  ];
  it("a new product goes at the end of its own group, not after a turned-off one or at the end of the list", () => {
    const fixed = list.filter((x) => x.id !== "mixed");
    const r = placeProduct(fixed, { id: null, group_name: "Shanks" }, "group-end");
    expect(r.sort).toBeGreaterThan(410);
    expect(r.sort).toBeLessThan(500);
    expect(r.renumber).toEqual([]);
    // "keep" means the same for a new product.
    expect(placeProduct(fixed, { id: null, group_name: "Shanks" }, "keep").sort).toBe(r.sort);
  });
  it("Mixed Shanks: after Front Shanks", () => {
    const r = placeProduct(list, { id: "mixed", group_name: "Shanks" }, "front");
    expect(r.sort).toBeGreaterThan(405);
    expect(r.sort).toBeLessThan(410);
  });
  it("keep: stays put; moved to another group: the end of that group", () => {
    expect(placeProduct(list, { id: "mixed", group_name: "Shanks" }, "keep").sort).toBe(764);
    const r = placeProduct(list, { id: "sirloin", group_name: "Legs" }, "keep");
    expect(r.sort).toBeGreaterThan(500);
    expect(r.sort).toBeLessThan(763);
  });
  it("a group with nothing else turned on goes at the end; start goes first", () => {
    expect(placeProduct(list, { id: null, group_name: "New group" }, "group-end").sort).toBe(774);
    expect(placeProduct(list, { id: "mixed", group_name: "Shanks" }, "start").sort).toBe(23);
  });
  it("no room between two: everything is numbered again 10 apart, in the same order", () => {
    const r = placeProduct(list, { id: "mixed", group_name: "Shanks" }, "sirloin");
    const sorts = new Map(list.map((x) => [x.id, x.sort]));
    for (const x of r.renumber) sorts.set(x.id, x.sort);
    sorts.set("mixed", r.sort);
    const order = [...sorts].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    expect(order).toEqual(["old-other", "sirloin", "mixed", "tenderloin", "whole", "hind", "front", "labeled-hind", "legs", "pepper"]);
  });
});
