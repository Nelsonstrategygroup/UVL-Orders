import { describe, expect, it } from "vitest";
import { freezerOnHand, freezerTakes, halfWholeLines, halfWholeNeeds, slotCount, slotOptions, slotParts } from "./halfWhole";
import { seedParts, seedProducts } from "./testData";
import type { HalfWholeOrder } from "./types";
import { calcWeek } from "./week";

const row = (c: ReturnType<typeof calcWeek>, part: string) => c.rows.find((r) => r.part.id === part)!;

describe("6.1 weekly lamb guide", () => {
  it("100 bone-in legs gives 50 lambs, set by legs", () => {
    const c = calcWeek({ parts: seedParts, products: seedProducts, orders: [{ s1: 100 }] });
    expect(c.recommended).toBe(50);
    expect(c.final).toBe(50);
    expect(c.driver?.part.id).toBe("leg");
    expect(row(c, "leg")).toMatchObject({ need: 100, lambs: 50, supply: 100, left: 0, status: "sets" });
    // Other parts come out extra.
    expect(row(c, "shoulder")).toMatchObject({ need: 0, supply: 100, left: 100, status: "none" });
  });

  it("adds up several orders and rounds up to whole lambs", () => {
    const c = calcWeek({ parts: seedParts, products: seedProducts, orders: [{ s1: 60 }, { s2: 41, s7: 30 }] });
    expect(c.totals).toEqual({ s1: 60, s2: 41, s7: 30 });
    expect(row(c, "leg").need).toBe(101);
    expect(c.recommended).toBe(51); // 101 legs / 2 per lamb, rounded up
    expect(row(c, "leg").left).toBe(1);
    expect(row(c, "shoulder")).toMatchObject({ need: 30, lambs: 15, supply: 102, left: 72, status: "extra" });
  });

  it("counts every part a product uses (whole loins use a rack and a short loin)", () => {
    const c = calcWeek({ parts: seedParts, products: seedProducts, orders: [{ s20: 10, s14: 6 }] });
    expect(row(c, "rack").need).toBe(16);
    expect(row(c, "loin").need).toBe(10);
    expect(c.recommended).toBe(8);
    expect(c.driver?.part.id).toBe("rack");
  });

  it("uses the override when set, and shows parts that come up short", () => {
    const c = calcWeek({ parts: seedParts, products: seedProducts, orders: [{ s1: 100 }], override: 45 });
    expect(c.recommended).toBe(50);
    expect(c.final).toBe(45);
    expect(c.overridden).toBe(true);
    expect(row(c, "leg")).toMatchObject({ supply: 90, left: -10, status: "short" });
  });

  it("marks a part even when it matches exactly but doesn't set the count", () => {
    const c = calcWeek({ parts: seedParts, products: seedProducts, orders: [{ s1: 100, s7: 100 }], override: 50 });
    expect(row(c, "leg").status).toBe("even");
    expect(row(c, "shoulder").status).toBe("even");
  });

  it("is zero with no orders", () => {
    const c = calcWeek({ parts: seedParts, products: seedProducts, orders: [] });
    expect(c.recommended).toBe(0);
    expect(c.driver).toBeNull();
  });
});

describe("6.2 half and whole shortfall", () => {
  // A whole lamb with every slot filled with the first product that fits it.
  function wholeLamb(status: HalfWholeOrder["status"] = "pending"): HalfWholeOrder {
    const choices = slotParts(seedParts).flatMap((part) =>
      Array.from({ length: slotCount(part, "whole") }, (_, slot) => ({
        part_id: part.id,
        slot,
        product_id: slotOptions(part.id, seedProducts)[0]?.id ?? null,
      })),
    );
    return { id: "hw1", size: "whole", status, choices };
  }

  it("has two slots per balance part on a whole lamb, and adds ground lamb from trim", () => {
    const lines = halfWholeLines(wholeLamb(), seedParts, seedProducts);
    expect(lines).toEqual({
      s1: 2, // legs
      s7: 2, // shoulders
      s14: 2, // racks
      s22: 2, // short loins
      s27: 2, // front shanks
      s28: 2, // hind shanks
      s32: 1, // neck
      ground: 5, // 5 lb trim per lamb
    });
  });

  it("a pending whole lamb with an empty freezer adds 2 legs, 2 shoulders, and so on to the week", () => {
    const { short } = halfWholeNeeds([], [wholeLamb()], seedParts, seedProducts);
    expect(short).toMatchObject({ s1: 2, s7: 2, s14: 2, s22: 2, s27: 2, s28: 2, s32: 1, ground: 5 });

    const c = calcWeek({ parts: seedParts, products: seedProducts, orders: [{ s1: 10 }], shortfall: short });
    expect(c.totals.s1).toBe(10);
    expect(c.withShort.s1).toBe(12);
    expect(row(c, "leg").need).toBe(12);
    expect(row(c, "shoulder").need).toBe(2);
    expect(row(c, "trim").need).toBe(5);
  });

  it("uses freezer stock before cutting fresh", () => {
    const freezer = [
      { product_id: "s1", qty: 5 },
      { product_id: "s7", qty: 1 },
    ];
    const { short, onHand } = halfWholeNeeds(freezer, [wholeLamb()], seedParts, seedProducts);
    expect(onHand.s1).toBe(5);
    expect(short.s1).toBeUndefined();
    expect(short.s7).toBe(1);
  });

  it("filled orders don't count against the freezer by themselves; what they took is logged", () => {
    const freezer = [{ product_id: "s1", qty: 3 }];
    const { onHand, short } = halfWholeNeeds(freezer, [wholeLamb("filled")], seedParts, seedProducts);
    expect(onHand.s1).toBe(3);
    expect(short).toEqual({});
  });

  it("filling an order takes only what the freezer has; the rest was cut fresh (Option A)", () => {
    const lines = halfWholeLines(wholeLamb(), seedParts, seedProducts);
    const onHand = { s1: 3, s7: 1, s14: 0 };
    expect(freezerTakes(lines, onHand, seedProducts)).toEqual({ s1: 2, s7: 1 });
    // After logging those takes, nothing goes below zero.
    const after = freezerOnHand(
      [
        { product_id: "s1", qty: 3 },
        { product_id: "s7", qty: 1 },
        { product_id: "s1", qty: -2 },
        { product_id: "s7", qty: -1 },
      ],
      seedProducts,
    );
    expect(after.s1).toBe(1);
    expect(after.s7).toBe(0);
    expect(after.s14).toBe(0);
  });

  it("treats a freezer count below zero as empty when working out the shortfall", () => {
    const { short } = halfWholeNeeds([{ product_id: "s1", qty: -4 }], [wholeLamb()], seedParts, seedProducts);
    expect(short.s1).toBe(2);
  });

  it("never counts fresh-only products as in the freezer", () => {
    const products = seedProducts.map((p) => (p.id === "s1" ? { ...p, fresh_only: true } : p));
    const { short } = halfWholeNeeds([{ product_id: "s1", qty: 50 }], [wholeLamb()], seedParts, products);
    expect(short.s1).toBe(2);
  });

  it("gives a half lamb one of each part, including a neck, as in the prototype", () => {
    const slots = Object.fromEntries(slotParts(seedParts).map((p) => [p.id, slotCount(p, "half")]));
    expect(slots).toEqual({ leg: 1, shoulder: 1, rack: 1, loin: 1, fshank: 1, hshank: 1, neck: 1 });
    expect(slotCount(seedParts.find((p) => p.id === "neck")!, "whole")).toBe(1);
  });

  it("ignores cancelled orders, and a half lamb is half the trim", () => {
    const half: HalfWholeOrder = { id: "h", size: "half", status: "pending", choices: [] };
    const cancelled = { ...wholeLamb(), status: "cancelled" as const };
    const { short } = halfWholeNeeds([], [half, cancelled], seedParts, seedProducts);
    expect(short).toEqual({ ground: 2.5 });
  });
});
