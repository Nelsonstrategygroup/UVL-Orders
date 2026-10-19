// SPEC 11.3 to 11.5: what happens after a label is read.

import { describe, expect, it } from "vitest";
import { decideScan, lotKey, weightWarning, type ScanContext } from "./flow";

const RACK = "0110698746488816112610143202002215212628710066"; // French rack, 22.15 lb, packed 10/14
const FAT = "0110698746489288112610143202000240212628720063"; // lamb fat, 2.40 lb

const ctx = (over: Partial<ScanContext> = {}): ScanContext => ({
  gtinMap: new Map([["10698746488816", "rack"]]),
  lots: new Map(),
  known: new Map(),
  onOrder: new Set(["rack"]),
  products: new Map([
    ["rack", { id: "rack", name: "French Rack", box_lb_min: 18, box_lb_max: 26 }],
    ["fat", { id: "fat", name: "Lamb Fat" }],
  ]),
  ...over,
});

describe("a scan, step by step", () => {
  it("a misread asks for a rescan", () => {
    expect(decideScan("0110698746488817112610143202002215212628710066", ctx())).toMatchObject({ kind: "misread" });
  });

  it("a box already scanned is refused, naming who has it", () => {
    const s = decideScan(RACK, ctx({ known: new Map([["10698746488816:2628710066", "PCC: Kirkland"]]) }));
    expect(s).toMatchObject({ kind: "duplicate" });
    expect(s.kind === "duplicate" && s.message).toContain("PCC: Kirkland");
  });

  it("an unknown GTIN warns first and offers a rescan", () => {
    const s = decideScan(FAT, ctx());
    expect(s.kind).toBe("unknown-gtin");
    expect(s.kind === "unknown-gtin" && s.message).toMatch(/scan again/);
  });

  it("once the packer says which product it is, it carries on", () => {
    expect(decideScan(FAT, ctx({ onOrder: new Set(["rack", "fat"]) }), { productId: "fat" })).toMatchObject({ kind: "need-lot", productId: "fat" });
  });

  it("a product not on the order asks before adding it", () => {
    expect(decideScan(RACK, ctx({ onOrder: new Set() }))).toMatchObject({ kind: "off-order", productId: "rack" });
    expect(decideScan(RACK, ctx({ onOrder: new Set() }), { addOffOrder: true }).kind).toBe("need-lot");
  });

  it("with no lot known, it asks for the 6-digit lot from the label", () => {
    const s = decideScan(RACK, ctx());
    expect(s).toMatchObject({ kind: "need-lot" });
    expect(decideScan(RACK, ctx(), { lot: "12345" }).kind).toBe("need-lot"); // not 6 digits
    expect(decideScan(RACK, ctx(), { lot: " 528801 " })).toMatchObject({ kind: "ready", lot: "528801", lotFrom: "typed" });
  });

  it("a lot known for the same GTIN and pack date fills in by itself", () => {
    const lots = new Map([[lotKey("10698746488816", "2026-10-14"), "528801"]]);
    expect(decideScan(RACK, ctx({ lots }))).toMatchObject({ kind: "ready", lot: "528801", lotFrom: "known", warnings: [] });
    // A different pack date isn't the same lot.
    const other = new Map([[lotKey("10698746488816", "2026-10-13"), "528800"]]);
    expect(decideScan(RACK, ctx({ lots: other })).kind).toBe("need-lot");
  });

  it("a lot in the barcode (AI 10) wins over the one on file", () => {
    // AI 10 = 654321, ended by GS, then the serial.
    const withLot = "0110698746488816112610143202002215" + "10654321" + "\u001d" + "212628710066";
    const lots = new Map([[lotKey("10698746488816", "2026-10-14"), "528801"]]);
    expect(decideScan(withLot, ctx({ lots }))).toMatchObject({ kind: "ready", lot: "654321", lotFrom: "label" });
  });

  it("the lot is never the scan or pack date", () => {
    const s = decideScan(RACK, ctx());
    expect(s.kind).toBe("need-lot");
  });
});

describe("box weight", () => {
  it("outside the normal range is a warning, never a block", () => {
    const light = "0110698746488816112610143202000990212628710070"; // 9.90 lb
    const lots = new Map([[lotKey("10698746488816", "2026-10-14"), "528801"]]);
    const s = decideScan(light, ctx({ lots }));
    expect(s.kind).toBe("ready");
    expect(s.kind === "ready" && s.warnings[0]).toMatch(/light for French Rack/);
  });

  it("no range set: no warning", () => {
    expect(weightWarning(2.4, { id: "fat", name: "Lamb Fat" })).toBeNull();
    expect(weightWarning(30, { id: "r", name: "R", box_lb_max: 26 })).toMatch(/heavy/);
  });
});
