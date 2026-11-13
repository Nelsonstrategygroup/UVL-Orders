import { describe, expect, it } from "vitest";
import { lambCheck } from "./lambCheck";
import type { Part, Product, Qty, Units } from "./types";
import { inProductUnits } from "./units";
import { calcWeek } from "./week";

const part = (id: string, name: string, per_lamb: number, drives: boolean, sort: number, made_from: string | null = null, confirmed = true): Part => ({
  id,
  name,
  per_lamb,
  unit: id === "trim" ? "lb" : "each",
  balance_check: true,
  confirmed,
  sort,
  drives_count: drives,
  made_from,
});
const parts: Part[] = [
  part("leg", "Leg", 2, true, 0),
  part("shoulder", "Shoulder", 2, true, 1),
  part("wholeloin", "Whole loin", 2, true, 2),
  part("rack", "Rack", 2, false, 3, "wholeloin"),
  part("loin", "Short loin", 2, false, 4, "wholeloin"),
  part("fshank", "Front shank", 2, false, 5),
  part("hshank", "Hind shank", 2, false, 6, null, false),
];
let sort = 0;
const prod = (id: string, name: string, uses: Record<string, number>, extra: Partial<Product> = {}): Product => ({
  id,
  name,
  short_name: "",
  unit: "each",
  group_name: "",
  cut_spec_id: null,
  fresh_only: false,
  active: true,
  sort: sort++,
  uses: Object.entries(uses).map(([part_id, qty]) => ({ part_id, qty })),
  ...extra,
});
const products: Product[] = [
  prod("bnls", "BNLS Legs", { leg: 1 }),
  prod("bi", "BI Legs", { leg: 1 }),
  prod("sh", "BNLS Shoulder", { shoulder: 1 }, { lb_per_unit: 4.5 }),
  prod("whole", "Whole Loin", { wholeloin: 1 }),
  prod("rack", "Racks", { rack: 1 }),
  prod("bl", "BNLS Loins", { loin: 2 }),
  prod("fs", "Front Shanks", { fshank: 2 }, { unit: "pack" }),
  prod("heart", "Heart", {}, { unit: "pack", counts_toward_lambs: false }),
  prod("pep", "Pepper Sticks", {}, { unit: "case", not_lamb: true }),
];
const byId = new Map(products.map((p) => [p.id, p]));
const orders: { customer: string; lines: Qty; units?: Units }[] = [
  { customer: "PCC #05 View Ridge", lines: { bnls: 30, sh: 10, rack: 40, fs: 5, heart: 3 } },
  { customer: "Key City", lines: { bi: 20, sh: 20 }, units: { sh: "lb" } },
  { customer: "Newport Ave", lines: { bnls: 10, sh: 120, whole: 4, bl: 15, pep: 1 }, units: { sh: "lb" } },
];
const c = calcWeek({ parts, products, orders: orders.map((o) => inProductUnits(o.lines, o.units, byId)), extraLambs: 14 });
const r = lambCheck({
  weekName: "Nov 9",
  c,
  parts,
  products,
  orders,
  requested: [],
  short: {},
  extraLambs: [{ lambs: 14, reason: "le_trim", note: "" }],
  leTrim: null,
  answers: { ordered: 3, total: 5, waiting: ["McClendons"], noOrder: ["Seven Feathers"] },
  packSizes: new Map([["fshank", 2]]),
});
const group = (title: string) => r.groups.find((g) => g.title === title)!;

describe("lamb count check (Lucas, 11/7/26)", () => {
  it("says who has ordered and names who hasn't answered", () => {
    expect(r.answersLine).toBe("Week of Nov 9 · 3 of 5 customers have ordered.");
    expect(r.waitingLine).toContain("McClendons");
    expect(r.noOrderLine).toBe("No order this week: Seven Feathers.");
  });

  it("adds up each product as on the order grid, and writes out each part's sum", () => {
    expect(group("Legs").products.map((p) => [p.name, p.total])).toEqual([["BNLS Legs", "40"], ["BI Legs", "20"]]);
    expect(group("Legs").math).toEqual(["BNLS Legs 40 + BI Legs 20 = 60 legs"]);
  });

  it("shows each pound order turned into whole pieces", () => {
    const sh = group("Shoulders").products[0];
    expect(sh.total).toBe("41");
    expect(sh.converted).toEqual(["Key City 20 lb ÷ 4.5 lb each = 4.44, rounded to 4", "Newport Ave 120 lb ÷ 4.5 lb each = 26.67, rounded to 27"]);
  });

  it("whole loins: sold whole plus the larger of racks and short loins, cut from them", () => {
    const g = group("Whole loins and what's cut from them");
    expect(g.math).toContain("Whole loins needed: 4 sold whole + the larger of 40 racks and 30 short loins = 44 whole loins");
    expect(g.note).toBe("Racks and short loins are cut from whole loins: one whole loin gives one of each.");
  });

  it("groups shanks together, and keeps products that don't count apart", () => {
    expect(group("Shanks").math).toEqual(["Front Shanks 5 × 2 = 10 front shanks"]);
    expect(group("Other lamb products (they don't change the count)").products.map((p) => p.name)).toEqual(["Heart"]);
    expect(group("Not from the lamb").products.map((p) => p.name)).toEqual(["Pepper Sticks"]);
  });

  it("works out lambs per part, marks the one that sets the count, and adds the extras", () => {
    expect(r.lambs).toEqual([
      { text: "60 legs ÷ 2 per lamb = 30 lambs", sets: true },
      { text: "41 shoulders ÷ 2 per lamb = 20.5, rounded up to 21 lambs", sets: false },
      { text: "44 whole loins ÷ 2 per lamb = 22 lambs", sets: false },
    ]);
    expect(c.orderLambs).toBe(30);
  });

  it("totals the count with each extra and its reason", () => {
    expect(r.countParts).toEqual(["30 lambs for the parts", "14 extra for Le Trim"]);
    expect(r.countTotal).toBe("30 + 14 extra = 44 lambs");
    expect(r.replaced).toBeNull();
  });

  it("checks what the lambs give against what the orders take", () => {
    const legs = r.balance.find((b) => b.name === "Legs")!;
    expect(legs).toMatchObject({ give: "44 × 2 = 88", take: ["Orders take 60"], result: "Left over 28" });
    const fs = r.balance.find((b) => b.name === "Front shanks")!;
    expect(fs.give).toBe("44 × 2 = 88 (44 packs)");
    expect(r.check).toEqual({ ok: true, text: "Every part covers its orders." });
    expect(r.guesses).toBe("Still starting guesses, not checked yet: hind shanks (2 per lamb).");
  });
});

describe("lamb count check: Mixed Shanks (11/12/26)", () => {
  it("is listed with the shanks, and its shanks are in the hind and front sums", () => {
    const mixed = prod("mx", "Mixed Shanks", {}, { unit: "pack", pieces_per_pack: 2, draws_from: ["hshank", "fshank"], counts_toward_lambs: false });
    const all = [...products, mixed];
    const ids = new Map(all.map((p) => [p.id, p]));
    const os = [{ customer: "PCC #16 Bothell", lines: { bnls: 100, fs: 40, mx: 70 } as Qty }];
    const cw = calcWeek({ parts, products: all, orders: os.map((o) => inProductUnits(o.lines, undefined, ids)) });
    const rr = lambCheck({
      weekName: "Nov 16",
      c: cw,
      parts,
      products: all,
      orders: os,
      requested: [],
      short: {},
      extraLambs: [],
      leTrim: null,
      answers: { ordered: 1, total: 1, waiting: [], noOrder: [] },
      packSizes: new Map([["fshank", 2], ["hshank", 2]]),
    });
    const shanks = rr.groups.find((g) => g.title === "Shanks")!;
    expect(shanks.products.map((p) => p.name)).toContain("Mixed Shanks");
    expect(rr.groups.find((g) => g.title.startsWith("Other lamb products"))?.products.map((p) => p.name) ?? []).not.toContain("Mixed Shanks");
    // 50 lambs: 100 hind, all to Mixed Shanks first; 100 front, 80 to Front Shanks, the last 20 to Mixed Shanks.
    expect(shanks.math).toEqual(["Front Shanks 40 × 2 + Mixed Shanks 10 × 2 = 100 front shanks", "Mixed Shanks 50 × 2 = 100 hind shanks"]);
    // Page 2: the hind shank row says it's used first; the front row doesn't repeat it.
    const row = (n: string) => rr.balance.find((b) => b.name.toLowerCase().startsWith(n))!;
    expect(row("hind").take).toContain("Mixed Shanks uses hind first, then front.");
    expect(row("front").take.join(" ")).not.toContain("uses hind first");
  });
});
