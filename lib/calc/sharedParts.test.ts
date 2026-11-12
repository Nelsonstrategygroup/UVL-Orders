import { describe, expect, it } from "vitest";
import type { Part, Product } from "./types";
import { calcWeek, sharedNote, sharedOrdered } from "./week";

const part = (id: string, name: string, per: number, sort: number, drives = true): Part => ({
  id,
  name,
  per_lamb: per,
  unit: "each",
  balance_check: true,
  confirmed: true,
  sort,
  made_from: null,
  drives_count: drives,
});
const parts = [part("leg", "Leg", 2, 1), part("fshank", "Front shank", 2, 2, false), part("hshank", "Hind shank", 2, 3, false)];
const prod = (id: string, name: string, uses: [string, number][], extra: Partial<Product> = {}): Product => ({
  id,
  name,
  short_name: name,
  unit: "pack",
  group_name: "x",
  cut_spec_id: null,
  fresh_only: false,
  active: true,
  sort: 1,
  uses: uses.map(([part_id, qty]) => ({ part_id, qty })),
  ...extra,
});
const products = [
  prod("legs", "BNLS Legs", [["leg", 1]], { unit: "each" }),
  prod("front", "Front Shanks", [["fshank", 2]], { pieces_per_pack: 2 }),
  prod("hind", "Hind Shanks", [["hshank", 2]], { pieces_per_pack: 2 }),
  prod("mixed", "Mixed Shanks", [], { pieces_per_pack: 2, draws_from: ["fshank", "hshank"], counts_toward_lambs: false }),
];
const week = (lines: Record<string, number>) => calcWeek({ parts, products, orders: [lines] });

describe("Mixed Shanks: a product drawn from more than one part (11/11/26)", () => {
  it("has its own row against what front and hind have left between them", () => {
    // 100 legs: 50 lambs give 100 front and 100 hind shanks. Front Shanks 40 packs (80), Hind 30 packs (60).
    // Left: 20 front + 40 hind = 60 shanks = 30 packs. Mixed Shanks 47 packs = 94 shanks: short 34 shanks = 17 packs.
    const c = week({ legs: 100, front: 40, hind: 30, mixed: 47 });
    expect(c.shared).toHaveLength(1);
    expect(c.shared[0]).toMatchObject({ qty: 47, per: 2, need: 94, parts: ["Front shank", "Hind shank"], available: 60, left: -34, status: "short" });
  });

  it("doesn't change the front and hind rows, or the lamb count", () => {
    const without = week({ legs: 100, front: 40, hind: 30 });
    const withMixed = week({ legs: 100, front: 40, hind: 30, mixed: 47 });
    const row = (c: typeof without, id: string) => c.rows.find((r) => r.part.id === id)!;
    for (const id of ["fshank", "hshank"]) expect([row(withMixed, id).need, row(withMixed, id).left]).toEqual([row(without, id).need, row(without, id).left]);
    expect(withMixed.final).toBe(without.final);
  });

  it("a part that's already short gives it nothing; enough left is extra", () => {
    // Front Shanks 60 packs (120) of 100: short 20. Only hind's 100 are left.
    expect(week({ legs: 100, front: 60, mixed: 47 }).shared[0]).toMatchObject({ available: 100, left: 6, status: "extra" });
    expect(week({ legs: 100, front: 60, mixed: 50 }).shared[0].status).toBe("even");
  });

  it("counted in single shanks until it's set to packs in Setup", () => {
    const pieces = products.map((p) => (p.id === "mixed" ? { ...p, unit: "each" } : p));
    const c = calcWeek({ parts, products: pieces, orders: [{ legs: 100, mixed: 79 }] });
    expect(c.shared[0]).toMatchObject({ per: 1, need: 79, available: 200, left: 121 });
  });

  it("none ordered: no row. The note is Kathy's wording", () => {
    expect(week({ legs: 100, front: 40 }).shared).toEqual([]);
    expect(sharedNote({ parts: ["Front shank", "Hind shank"] })).toBe("Draws from front and hind, order to be confirmed with Kathy.");
    expect(sharedNote({ parts: ["Leg", "Shoulder"] })).toBe("Draws from leg and shoulder, order to be confirmed with Kathy.");
  });

  it("the cut sheet's notice: what's ordered and where it comes from", () => {
    expect(sharedOrdered({ mixed: 47, front: 40 }, products, parts)).toEqual([
      { id: "mixed", name: "Mixed Shanks", qty: 47, unit: "pack", note: "Draws from front and hind, order to be confirmed with Kathy." },
    ]);
    expect(sharedOrdered({ front: 40 }, products, parts)).toEqual([]);
  });
});
