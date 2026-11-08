import { describe, expect, it } from "vitest";
import { fillExtras, type ExtraLine } from "./extras";
import type { Part, Product } from "./types";
import { calcWeek } from "./week";

const part = (id: string, per: number, sort: number, made_from: string | null = null): Part => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  per_lamb: per,
  unit: "each",
  balance_check: true,
  confirmed: true,
  sort,
  made_from,
});
const parts = [part("leg", 2, 1), part("shoulder", 2, 2), part("fshank", 2, 3), part("wholeloin", 1, 4), part("rack", 1, 5, "wholeloin"), part("sloin", 1, 6, "wholeloin")];
const prod = (id: string, uses: [string, number][], extra: Partial<Product> = {}): Product => ({
  id,
  name: id,
  short_name: id,
  unit: "each",
  group_name: "x",
  cut_spec_id: null,
  fresh_only: false,
  active: true,
  sort: 1,
  uses: uses.map(([part_id, qty]) => ({ part_id, qty })),
  ...extra,
});
const products = [
  prod("legs", [["leg", 1]]),
  prod("shoulders", [["shoulder", 1]]),
  prod("shanks", [["fshank", 2]], { unit: "pack" }),
  prod("loins", [["wholeloin", 1]]),
  prod("racks", [["rack", 1]]),
  prod("sticks", []),
  prod("lamb", [], { carcass: true }),
];
const byId = new Map(products.map((p) => [p.id, p]));

/** The balance from firm lines. */
const rows = (firm: Record<string, number>, override?: number) =>
  calcWeek({ parts, products, orders: [firm], override: override ?? null }).rows;

let n = 0;
const line = (productId: string, asked: number, extra: Partial<ExtraLine> = {}): ExtraLine => {
  n++;
  return { key: `o${n}|${productId}`, orderId: `o${n}`, customerId: `c${n}`, productId, asked, rank: n, locked: false, stored: null, chosen: null, ...extra };
};
const run = (firm: Record<string, number>, lines: ExtraLine[], opts: { partial?: boolean; leTrimEstimated?: boolean; override?: number } = {}) =>
  fillExtras({ rows: rows(firm, opts.override), parts, products: byId, lines, partial: opts.partial, leTrimEstimated: opts.leTrimEstimated });

describe("only if extra lines", () => {
  it("fill from what firm lines leave, up to what was asked", () => {
    // 100 legs: 50 lambs, 100 shoulders spare.
    const a = line("shoulders", 30);
    const r = run({ legs: 100 }, [a]);
    expect(r.fills.get(a.key)).toMatchObject({ fill: 30, asked: 30, contested: false, toDecide: false });
    expect(r.contests).toEqual([]);
  });

  it("partial fills: wants 54 packs, 7 available", () => {
    // 50 lambs give 100 front shanks; firm takes 86 (43 packs), 14 left = 7 packs.
    const a = line("shanks", 54);
    const r = run({ legs: 100, shanks: 43 }, [a]);
    expect(r.fills.get(a.key)?.fill).toBe(7);
    // Nothing left of front shanks for This week's extras list.
    expect(r.left.get("fshank")).toBe(0);
  });

  it("one line short on its own isn't competing: it gets what's there", () => {
    const a = line("shanks", 54);
    const r = run({ legs: 100, shanks: 43 }, [a]);
    expect(r.fills.get(a.key)).toMatchObject({ fill: 7, contested: false, toDecide: false });
    expect(r.contests).toEqual([]);
  });

  it("all or none when partial fills are off", () => {
    const a = line("shanks", 54);
    expect(run({ legs: 100, shanks: 43 }, [a], { partial: false }).fills.get(a.key)?.fill).toBe(0);
    const b = line("shanks", 7);
    expect(run({ legs: 100, shanks: 43 }, [b], { partial: false }).fills.get(b.key)?.fill).toBe(7);
  });

  it("competing lines fill in customer order until Kathy splits them", () => {
    // 3 lambs (6 legs): 6 shoulders, firm takes 1, 5 spare; two lines want 4 each.
    const a = line("shoulders", 4);
    const b = line("shoulders", 4);
    const r = run({ legs: 6, shoulders: 1 }, [b, a]);
    expect(r.fills.get(a.key)).toMatchObject({ fill: 4, contested: true, toDecide: true });
    expect(r.fills.get(b.key)).toMatchObject({ fill: 1, contested: true, toDecide: true });
    expect(r.contests).toEqual([{ partId: "shoulder", partName: "Shoulder", available: 5, keys: [a.key, b.key], decided: false }]);
  });

  it("Kathy's split is used when it covers every line and fits", () => {
    const a = line("shoulders", 4, { chosen: 2 });
    const b = line("shoulders", 4, { chosen: 3 });
    const r = run({ legs: 6, shoulders: 1 }, [a, b]);
    expect(r.fills.get(a.key)).toMatchObject({ fill: 2, toDecide: false, contested: true });
    expect(r.fills.get(b.key)).toMatchObject({ fill: 3, toDecide: false });
    expect(r.contests[0].decided).toBe(true);
  });

  it("a split that no longer fits goes back to Kathy (customer order meanwhile)", () => {
    const a = line("shoulders", 4, { chosen: 3 });
    const b = line("shoulders", 4, { chosen: 3 });
    const r = run({ legs: 6, shoulders: 1 }, [a, b]);
    expect(r.contests[0].decided).toBe(false);
    expect(r.fills.get(a.key)).toMatchObject({ fill: 4, toDecide: true });
    expect(r.fills.get(b.key)).toMatchObject({ fill: 1, toDecide: true });
  });

  it("a line already being packed keeps what it got, before the others", () => {
    const a = line("shoulders", 4, { locked: true, stored: 3 });
    const b = line("shoulders", 4);
    const r = run({ legs: 6, shoulders: 1 }, [a, b]);
    expect(r.fills.get(a.key)).toMatchObject({ fill: 3, locked: true });
    expect(r.fills.get(b.key)?.fill).toBe(2);
  });

  it("a spare whole loin is also a spare rack: taking one takes the other", () => {
    // 10 lambs: 10 whole loins; firm: 8 racks (8 loins cut), 2 whole loins spare, 2 racks spare.
    const a = line("loins", 2);
    const b = line("racks", 5);
    const r = run({ legs: 20, racks: 8 }, [a, b]);
    expect(r.fills.get(a.key)?.fill).toBe(2);
    expect(r.fills.get(b.key)?.fill).toBe(0);
  });

  it("Le Trim's parts are marked estimated until its plan is saved", () => {
    const a = line("shoulders", 2);
    const b = line("racks", 1);
    const r = run({ legs: 20 }, [a, b], { leTrimEstimated: true });
    expect(r.fills.get(a.key)?.estimated).toBe(true);
    expect(r.fills.get(b.key)?.estimated).toBe(false);
  });

  it("nothing from the lamb: all of it; a carcass lamb is never spare", () => {
    const a = line("sticks", 3);
    const b = line("lamb", 1);
    const r = run({ legs: 20 }, [a, b]);
    expect(r.fills.get(a.key)?.fill).toBe(3);
    expect(r.fills.get(b.key)?.fill).toBe(0);
  });

  it("nothing spare when the lamb count leaves the part short", () => {
    const a = line("legs", 5);
    expect(run({ legs: 100 }, [a], { override: 40 }).fills.get(a.key)?.fill).toBe(0);
  });
});
