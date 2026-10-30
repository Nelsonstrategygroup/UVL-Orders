import { describe, expect, it } from "vitest";
import type { Part, Product } from "./types";
import { calcWeek } from "./week";
import { countWorking, partBalances } from "./working";

const part = (id: string, name: string, per_lamb: number, drives: boolean, sort: number, made_from: string | null = null): Part => ({
  id,
  name,
  per_lamb,
  unit: id === "trim" ? "lb" : "each",
  balance_check: true,
  confirmed: true,
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
];
const prod = (id: string, name: string, uses: Record<string, number>, extra: Partial<Product> = {}): Product => ({
  id,
  name,
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
  prod("bnls", "BNLS Legs", { leg: 1 }),
  prod("bis", "BI Shoulder", { shoulder: 1 }),
  prod("rack", "Racks", { rack: 1 }),
  prod("sl", "Short Loin", { loin: 1 }),
  prod("whole", "Whole Lamb", { leg: 2, shoulder: 2, wholeloin: 2, fshank: 2 }),
  prod("carc", "Carcass Lamb", {}, { carcass: true }),
  prod("sticks", "Pepper Sticks", {}, { not_lamb: true }),
  prod("le", "Le Trim", {}, { fill_note: "From extras" }),
];

describe("how the lamb count was worked out", () => {
  const orders = [{ bnls: 60, bis: 30, rack: 82, sl: 76, whole: 4, carc: 1, sticks: 2, le: 720 }];
  const c = calcWeek({ parts, products, orders, extraLambs: 15 });
  const w = countWorking(c, parts, products);

  it("shows each part's need by product, over what a lamb gives, and the part that sets it, matching calcWeek", () => {
    expect(w.parts.map((p) => [p.part.id, p.need, p.lambs, p.sets])).toEqual([
      ["leg", 68, 34, false],
      ["shoulder", 38, 19, false],
      ["wholeloin", 90, 45, true],
    ]);
    expect(c.orderLambs).toBe(45);
    expect(w.parts[0].lines).toEqual([
      { product: "BNLS Legs", qty: 60, each: 1, total: 60 },
      { product: "Whole Lamb", qty: 4, each: 2, total: 8 },
    ]);
    // Whole loins: 8 whole (in Whole Lambs) plus the larger of racks (82) and short loins (76).
    expect(w.parts[2].cutFrom.map((k) => [k.part.id, k.need])).toEqual([
      ["rack", 82],
      ["loin", 76],
    ]);
  });

  it("lists what never sets the count, carcass lambs, and products not counted; Le Trim has its own section", () => {
    expect(w.never.map((n) => [n.part.id, n.why])).toEqual([
      ["rack", "cut from whole loins"],
      ["loin", "cut from whole loins"],
      ["fshank", "never sets the count"],
    ]);
    expect(w.carcass).toEqual([{ product: "Carcass Lamb", qty: 1 }]);
    expect(w.notCounted).toEqual([{ product: "Pepper Sticks", qty: 2 }]);
    expect(c.recommended).toBe(45 + 1 + 15);
  });
});

describe("the carcass balance, part by part", () => {
  const orders = [{ bnls: 60, bis: 30, rack: 82, sl: 76, whole: 4, carc: 1, sticks: 2, le: 720 }];
  // 45 lambs from orders; Le Trim takes 10 shoulders and 5 legs from what's spare.
  const c = calcWeek({ parts, products, orders, leTrim: { shoulders: 10, legs: 5, trimLb: 0 } });
  const b = partBalances(c, products);
  const row = (id: string) => b.find((x) => x.part.id === id)!;

  it("shows what the lambs give, where every piece goes, and what's left", () => {
    expect(row("leg")).toMatchObject({ supply: 90, leTrim: 5, left: 17 });
    expect(row("leg").uses.map((u) => [u.product, u.total])).toEqual([
      ["BNLS Legs", 60],
      ["Whole Lamb", 8],
    ]);
    expect(row("shoulder")).toMatchObject({ supply: 90, leTrim: 10, left: 42 });
  });

  it("whole loins: those going out whole, then those cut into racks and short loins", () => {
    expect(row("wholeloin")).toMatchObject({ supply: 90, leTrim: 0, left: 0, cut: { amount: 82 } });
    expect(row("wholeloin").uses.map((u) => [u.product, u.total])).toEqual([["Whole Lamb", 8]]);
    expect(row("rack")).toMatchObject({ supply: 82, left: 0, parent: { id: "wholeloin" } });
    expect(row("loin")).toMatchObject({ supply: 82, left: 6 });
  });
});
