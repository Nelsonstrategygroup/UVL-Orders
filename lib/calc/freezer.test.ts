import { describe, expect, it } from "vitest";
import {
  averageWeight,
  countResults,
  freezerBalance,
  freezerIn,
  freezerOut,
  itemsToAdd,
  NO_PRICE,
  NO_WEIGHT,
  reviewCount,
  takeValue,
  valueOf,
  type CountItem,
  type InBox,
  type ValuedBox,
} from "./freezer";
import { centsText } from "./prices";

describe("freezer value: 90% of the default sale price (Kathy's rule)", () => {
  it("values a pound-priced box by its weight (the Emerson Mixed Shanks box, week of Nov 16)", () => {
    // 32.6 lb x 90% x $7.55 = $221.517, half up to $221.52
    expect(valueOf({ price: "7.55", priceUnit: "lb", percent: 90, qty: 16, weightLb: 32.6 })).toEqual({ cents: BigInt(22152), note: "" });
  });
  it("values case-priced product by the count", () => {
    expect(valueOf({ price: 48, priceUnit: "case", percent: 90, qty: 2, weightLb: null }).cents).toBe(BigInt(8640));
  });
  it("has no value without a default price, or a weight for a pound price", () => {
    expect(valueOf({ price: null, priceUnit: "lb", percent: 90, qty: 3, weightLb: 4.2 })).toEqual({ cents: null, note: NO_PRICE });
    expect(valueOf({ price: 7.55, priceUnit: "lb", percent: 90, qty: 3, weightLb: null })).toEqual({ cents: null, note: NO_WEIGHT });
  });
  it("rounds half up once, from exact decimals", () => {
    // 1.005 lb x $1 x 50% = $0.5025 -> $0.50 ; 0.01 lb x $0.5 x 100% = $0.005 -> $0.01
    expect(valueOf({ price: 1, priceUnit: "lb", percent: 50, qty: 1, weightLb: 1.005 }).cents).toBe(BigInt(50));
    expect(valueOf({ price: "0.5", priceUnit: "lb", percent: 100, qty: 1, weightLb: "0.01" }).cents).toBe(BigInt(1));
  });
  it("takes part of a box back at its share of the value it went in at", () => {
    expect(takeValue(BigInt(22152), 16, 16)).toBe(BigInt(22152));
    expect(takeValue(BigInt(22152), 16, 4)).toBe(BigInt(5538));
    expect(takeValue(BigInt(1000), 3, 1)).toBe(BigInt(333));
    expect(takeValue(null, 3, 1)).toBeNull();
  });
});

const box = (over: Partial<ValuedBox>): ValuedBox => ({
  id: "b1",
  product_id: "shanks",
  qty: 16,
  weight_lb: 32.6,
  added_on: "2026-11-12",
  week_id: "2026-11-09",
  counts_as_income: true,
  reason: "leftover",
  serial: "2631310052",
  price: "7.5500",
  price_unit: "lb",
  percent: "90",
  value: "221.52",
  note: "",
  ...over,
});

describe("Into freezer and Out of freezer on the Weekly P&L", () => {
  const boxes = [
    box({}),
    box({ id: "b2", product_id: "tongue", serial: null, value: null, price: null, note: NO_PRICE, weight_lb: 4.2, qty: 3 }),
    box({ id: "b3", counts_as_income: false, value: "50.00" }),
  ];
  it("counts a box that went in as that week's income, and lists the ones with no value", () => {
    const line = freezerIn("2026-11-09", boxes);
    expect(centsText(line.cents)).toBe("$221.52");
    expect(line.rows.map((r) => r.boxId)).toEqual(["b1", "b2"]);
    expect(line.noValue.map((r) => r.productId)).toEqual(["tongue"]);
  });
  it("takes it back out the week it's packed for an order, at the value it went in at", () => {
    const out = freezerOut("2026-11-16", [{ id: "t1", box_id: "b1", qty: 16, taken_on: "2026-11-16", week_id: "2026-11-16", reason: "packed", counts_in_pnl: true }], boxes);
    expect(centsText(out.cents)).toBe("-$221.52");
    expect(out.rows[0]).toMatchObject({ weightLb: 32.6, price: "7.5500", percent: "90", reason: "packed" });
  });
  it("leaves out take-outs that don't count and other weeks", () => {
    const takes = [
      { id: "t1", box_id: "b3", qty: 16, taken_on: "2026-11-16", week_id: "2026-11-16", reason: "packed", counts_in_pnl: false },
      { id: "t2", box_id: "b1", qty: 4, taken_on: "2026-11-23", week_id: "2026-11-23", reason: "packed", counts_in_pnl: true },
    ];
    expect(freezerOut("2026-11-16", takes, boxes).rows).toEqual([]);
    expect(centsText(freezerOut("2026-11-23", takes, boxes).cents)).toBe("-$55.38");
  });
  it("values what's in the freezer now", () => {
    const bal = freezerBalance([
      { ...box({}), qty_left: 12 },
      { ...box({ id: "b2", value: null }), qty_left: 3 },
      { ...box({ id: "b3" }), qty_left: 0 },
    ]);
    expect(bal).toEqual({ cents: BigInt(16614), boxes: 2, noValue: 1 });
  });
});

const item = (id: string, over: Partial<CountItem> = {}): CountItem => ({
  id,
  kind: "scan",
  product_id: "shanks",
  qty: 16,
  weight_lb: 30,
  gtin: "10698746488816",
  serial: id,
  lot: "123456",
  pack_date: "2026-11-10",
  product_confirmed: true,
  decision: null,
  voided: false,
  scanned_at: `2026-11-20T10:00:0${id.length % 10}Z`,
  device_id: "a",
  ...over,
});
const inBox = (id: string, over: Partial<InBox> = {}): InBox => ({
  id: `box-${id}`,
  product_id: "shanks",
  qty_left: 16,
  weight_lb: 30,
  gtin: "10698746488816",
  serial: id,
  lot: "123456",
  pack_date: "2026-11-10",
  added_on: "2026-11-12",
  ...over,
});

describe("freezer count review", () => {
  const boxes = [inBox("s1"), inBox("s2"), inBox("r1", { product_id: "racks", qty_left: 6 })];
  const onHand = { shanks: 40, racks: 6 };

  it("groups matched, found, held and not counted by product, with totals", () => {
    const r = reviewCount({
      kind: "reconcile",
      scope: null,
      items: [
        item("s1"),
        item("s1", { id: "dup", device_id: "b" }), // the same box on a second phone
        item("s9", { decision: "add" }),
        item("s8"),
        item("e1"),
        item("m1", { kind: "manual", gtin: null, serial: null, qty: 2, product_id: "shanks" }),
        item("v1", { voided: true }),
      ],
      boxes,
      onHand,
      held: [{ gtin: "10698746488816", serial: "e1", customer: "Emerson", week_id: "2026-11-09" }],
    });
    const shanks = r.products.find((p) => p.productId === "shanks")!;
    expect(shanks.matched.map((m) => m.box.id)).toEqual(["box-s1"]);
    expect(shanks.found.map((f) => [f.item.id, f.added])).toEqual([
      ["s9", true],
      ["s8", false],
      ["m1", false],
    ]);
    expect(shanks.held.map((h) => h.held.customer)).toEqual(["Emerson"]);
    expect(shanks.notCounted.map((b) => b.id)).toEqual(["box-s2"]);
    // counted: 16 matched + 16 + 16 + 2 found = 50; app 40
    expect([shanks.app, shanks.counted, shanks.difference]).toEqual([40, 50, 10]);
    const racks = r.products.find((p) => p.productId === "racks")!;
    expect([racks.notCounted.length, racks.app, racks.counted, racks.difference]).toEqual([1, 6, 0, -6]);
    expect(r.totals).toEqual({ app: 46, counted: 50, difference: 4 });
    expect(itemsToAdd(r)).toEqual(["s9"]);
  });

  it("covers only the products chosen", () => {
    const r = reviewCount({ kind: "reconcile", scope: ["racks"], items: [item("s1")], boxes, onHand, held: [] });
    expect(r.products.map((p) => p.productId)).toEqual(["racks"]);
    expect(r.products[0].notCounted).toHaveLength(1);
    expect(r.outOfScope.map((i) => i.id)).toEqual(["s1"]);
  });

  it("adds every box in a stock-in count unless skipped, and holds back labels with no product", () => {
    const r = reviewCount({
      kind: "stock_in",
      scope: null,
      items: [item("n1"), item("n2", { decision: "skip" }), item("n3", { product_id: null, product_confirmed: false })],
      boxes: [],
      onHand: {},
      held: [],
    });
    expect(itemsToAdd(r)).toEqual(["n1"]);
    expect(r.noProduct.map((i) => i.id)).toEqual(["n3"]);
  });

  it("keeps the review as the count's record, with what was removed", () => {
    const r = reviewCount({ kind: "reconcile", scope: ["racks"], items: [], boxes, onHand, held: [] });
    const saved = countResults(r, [{ box_id: "box-r1", reason: "sold", note: "" }]);
    expect(saved.products[0]).toMatchObject({ product_id: "racks", app: 6, counted: 0, difference: -6 });
    expect(saved.products[0].not_counted).toEqual([{ box_id: "box-r1", serial: "r1", qty: 6, weight_lb: 30, removed: "sold", note: "" }]);
  });
});

describe("average weight", () => {
  it("is pounds over pieces for boxes with both", () => {
    expect(averageWeight([{ qty: 16, weight_lb: 32.6 }, { qty: 4, weight_lb: 8 }, { qty: 3, weight_lb: null }])).toBe(2.03);
    expect(averageWeight([{ qty: 3, weight_lb: null }])).toBeNull();
  });
});
