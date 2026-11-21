import { describe, expect, it } from "vitest";
import { decideFreezerScan, freezerKey, startingCount, type FreezerScanContext } from "./freezerScan";

const RACK = "0110698746488816112610143202002215212628710066"; // French rack, 22.15 lb, packed 10/14, serial 2628710066
const RACK_KEY = "10698746488816:2628710066";

const ctx = (over: Partial<FreezerScanContext> = {}): FreezerScanContext => ({
  products: new Map([
    ["rack", { id: "rack", name: "French Rack", unit: "each", lb_per_unit: 1.9 }],
    ["trim", { id: "trim", name: "Le Trim", unit: "lb", lb_per_unit: null }],
  ]),
  gtinMap: new Map([["10698746488816", "rack"]]),
  lots: new Map([["10698746488816|2026-10-14", "287001"]]),
  inFreezer: new Map(),
  held: new Map(),
  scannedNow: new Set(),
  lastCount: new Map(),
  ...over,
});

describe("a freezer scan", () => {
  it("is ready with the product, the known lot and a starting count", () => {
    expect(decideFreezerScan(RACK, ctx())).toMatchObject({ kind: "ready", productId: "rack", lot: "287001", qty: 12, qtyIsWeight: false, confirmed: true });
  });
  it("starts from the last count typed for that product", () => {
    expect(decideFreezerScan(RACK, ctx({ lastCount: new Map([["rack", 10]]) }))).toMatchObject({ qty: 10 });
  });
  it("says a box is already in the freezer, and doesn't add it twice", () => {
    expect(decideFreezerScan(RACK, ctx({ inFreezer: new Map([[RACK_KEY, "rack"]]) }))).toMatchObject({ kind: "in-freezer", message: "This box is already in the freezer." });
    expect(decideFreezerScan(RACK, ctx({ scannedNow: new Set([RACK_KEY]) }))).toMatchObject({ kind: "again" });
  });
  it("shows a box packed for a customer as held, never added", () => {
    expect(decideFreezerScan(RACK, ctx({ held: new Map([[RACK_KEY, "Emerson"]]) }))).toMatchObject({
      kind: "held",
      message: "Packed for Emerson, held in the freezer. It isn't added.",
    });
  });
  it("asks for the product of an unknown label; a non-admin's pick is not confirmed", () => {
    expect(decideFreezerScan(RACK, ctx({ gtinMap: new Map() }))).toMatchObject({ kind: "unknown-gtin" });
    expect(decideFreezerScan(RACK, ctx({ gtinMap: new Map() }), { productId: "rack" })).toMatchObject({ kind: "ready", confirmed: false });
    expect(decideFreezerScan(RACK, ctx({ gtinMap: new Map() }), { productId: "rack", confirmed: true })).toMatchObject({ confirmed: true });
  });
  it("asks for a rescan when the label can't be read", () => {
    expect(decideFreezerScan("0110698746488817112610143202002215212628710066", ctx())).toMatchObject({ kind: "misread" });
  });
  it("matches a box record's key to a label's", () => {
    expect(freezerKey("10698746488816", "2628710066")).toBe(RACK_KEY);
    expect(freezerKey("10698746488816", null)).toBeNull();
  });
});

describe("starting count", () => {
  it("is the weight for a product counted in pounds", () => {
    expect(startingCount({ id: "trim", name: "Le Trim", unit: "lb", lb_per_unit: null }, 41.2, undefined)).toEqual({ qty: 41.2, isWeight: true });
  });
  it("is 1 with nothing to go on", () => {
    expect(startingCount({ id: "x", name: "X", unit: "each", lb_per_unit: null }, 20, undefined)).toEqual({ qty: 1, isWeight: false });
  });
});
