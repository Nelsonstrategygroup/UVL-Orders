import { describe, expect, it } from "vitest";
import type { Part, Product } from "./types";
import { calcWeek, sharedNote, sharedOrdered, sharedTakes } from "./week";
import { partBalances } from "./working";

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
  prod("mixed", "Mixed Shanks", [], { pieces_per_pack: 2, draws_from: ["hshank", "fshank"], counts_toward_lambs: false }),
];
const week = (lines: Record<string, number>) => calcWeek({ parts, products, orders: [lines] });
const row = (c: ReturnType<typeof week>, id: string) => c.rows.find((r) => r.part.id === id)!;

describe("Mixed Shanks: hind shanks first, then front (11/11/26; hind first, Lucas 11/12/26)", () => {
  it("takes what hind has left, then front; the rest is its own shortfall", () => {
    // 100 legs: 50 lambs give 100 front and 100 hind shanks. Front Shanks 40 packs (80), Hind 30 packs (60).
    // Left: 40 hind, then 20 front = 60 shanks = 30 packs. Mixed Shanks 47 packs = 94 shanks: short 34 shanks = 17 packs.
    const c = week({ legs: 100, front: 40, hind: 30, mixed: 47 });
    expect(c.shared).toHaveLength(1);
    expect(c.shared[0]).toMatchObject({ qty: 47, per: 2, need: 94, parts: ["Hind shank", "Front shank"], available: 60, left: -34, status: "short" });
    expect(c.shared[0].takes.map((t) => [t.partId, t.n])).toEqual([
      ["hshank", 40],
      ["fshank", 20],
    ]);
    expect(sharedTakes(c.shared[0])).toBe("20 hind, 10 front");
    // What it takes is in the hind and front rows: nothing left in either, and neither short.
    expect([row(c, "hshank").need, row(c, "hshank").left, row(c, "hshank").status]).toEqual([100, 0, "even"]);
    expect([row(c, "fshank").need, row(c, "fshank").left, row(c, "fshank").status]).toEqual([100, 0, "even"]);
    expect(row(c, "hshank").sharedOut).toEqual([{ product: "Mixed Shanks", n: 40 }]);
  });

  it("enough hind: front isn't touched. It never changes the lamb count", () => {
    const without = week({ legs: 100, front: 40, hind: 30 });
    const c = week({ legs: 100, front: 40, hind: 30, mixed: 15 });
    expect(c.shared[0].takes.map((t) => t.n)).toEqual([30, 0]);
    expect(c.shared[0]).toMatchObject({ available: 60, left: 30, status: "extra" });
    expect(row(c, "hshank").left).toBe(10);
    expect([row(c, "fshank").need, row(c, "fshank").left]).toEqual([row(without, "fshank").need, row(without, "fshank").left]);
    expect(row(c, "fshank").sharedOut).toBeUndefined();
    expect(c.final).toBe(without.final);
    expect(sharedTakes(c.shared[0])).toBe("15 hind");
  });

  it("a part that's already short gives it nothing and stays short by the same amount", () => {
    // Front Shanks 60 packs (120) of 100: short 20. Only hind's 100 are left.
    const c = week({ legs: 100, front: 60, mixed: 47 });
    expect(c.shared[0]).toMatchObject({ available: 100, left: 6, status: "extra" });
    expect(row(c, "fshank").left).toBe(-20);
    expect(row(c, "fshank").status).toBe("short");
    expect(week({ legs: 100, front: 60, mixed: 50 }).shared[0].status).toBe("even");
  });

  it("the printed balance lists it as a use of hind and front, not Le Trim", () => {
    const c = week({ legs: 100, front: 40, hind: 30, mixed: 47 });
    const b = partBalances(c, products);
    const hind = b.find((x) => x.part.id === "hshank")!;
    expect(hind.uses.map((u) => [u.product, u.total])).toEqual([
      ["Hind Shanks", 60],
      ["Mixed Shanks", 40],
    ]);
    expect(hind.leTrim).toBe(0);
    expect(b.find((x) => x.part.id === "fshank")!.uses.map((u) => [u.product, u.total])).toEqual([
      ["Front Shanks", 80],
      ["Mixed Shanks", 20],
    ]);
  });

  it("counted in single shanks when set to single shanks", () => {
    const pieces = products.map((p) => (p.id === "mixed" ? { ...p, unit: "each" } : p));
    const c = calcWeek({ parts, products: pieces, orders: [{ legs: 100, mixed: 79 }] });
    expect(c.shared[0]).toMatchObject({ per: 1, need: 79, available: 200, left: 121 });
  });

  it("none ordered: no row. The note says which is used first", () => {
    expect(week({ legs: 100, front: 40 }).shared).toEqual([]);
    expect(sharedNote({ parts: ["Hind shank", "Front shank"] })).toBe("Uses hind first, then front.");
    expect(sharedNote({ parts: ["Leg", "Shoulder", "Neck"] })).toBe("Uses leg first, then shoulder, then neck.");
  });

  it("the cut sheet's notice: what's ordered and where it comes from", () => {
    expect(sharedOrdered({ mixed: 47, front: 40 }, products, parts)).toEqual([
      { id: "mixed", name: "Mixed Shanks", qty: 47, unit: "pack", note: "Uses hind first, then front." },
    ]);
    expect(sharedOrdered({ front: 40 }, products, parts)).toEqual([]);
  });
});
