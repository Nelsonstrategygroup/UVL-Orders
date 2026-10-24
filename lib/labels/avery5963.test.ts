// Avery 5963 label sheets (change request 10/23/26).

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { alignmentPdf, labelsPdf, PAGE, parseRange, placeLabels, slotBox, type PrintLabel } from "./avery5963";

const label = (n: number): PrintLabel => ({ number: n, name: "PCC", location: "#02 Kirkland", qty: "6", unit: "", product: "BLS Legs", boxNo: 1, boxCount: 2, boxType: "MVM" });

describe("sheet geometry", () => {
  it("position 1 is 0.15625\" from the left and 0.5\" from the top; 4\" x 2\"", () => {
    const b = slotBox(1);
    expect(b.x).toBeCloseTo(0.15625 * 72);
    expect(PAGE.h - (b.y + b.h)).toBeCloseTo(0.5 * 72);
    expect([b.w, b.h]).toEqual([288, 144]);
  });

  it("position 2 is across a 0.1875\" gap; position 10 is bottom right, no vertical gaps", () => {
    expect(slotBox(2).x).toBeCloseTo((0.15625 + 4 + 0.1875) * 72);
    const b = slotBox(10);
    expect(b.x).toBeCloseTo((0.15625 + 4 + 0.1875) * 72);
    expect(PAGE.h - (b.y + b.h)).toBeCloseTo((0.5 + 4 * 2) * 72);
    expect(slotBox(3).y + slotBox(3).h).toBeCloseTo(slotBox(1).y);
  });

  it("the printer offset moves every label (+x right, +y down)", () => {
    const b = slotBox(1, { x: 0.05, y: -0.03 });
    expect(b.x).toBeCloseTo((0.15625 + 0.05) * 72);
    expect(PAGE.h - (b.y + b.h)).toBeCloseTo((0.5 - 0.03) * 72);
  });
});

describe("start at label", () => {
  it("print selected from position 7 fills 7 to 10, then starts a new sheet at 1", () => {
    expect(placeLabels(6, 7)).toEqual([
      { page: 0, slot: 7 },
      { page: 0, slot: 8 },
      { page: 0, slot: 9 },
      { page: 0, slot: 10 },
      { page: 1, slot: 1 },
      { page: 1, slot: 2 },
    ]);
  });

  it("from position 1, twelve labels fill one sheet and two on the next", () => {
    const p = placeLabels(12, 1);
    expect(p[9]).toEqual({ page: 0, slot: 10 });
    expect(p[11]).toEqual({ page: 1, slot: 2 });
  });
});

describe("range box", () => {
  it("reads 14-20 and single numbers", () => {
    expect([...parseRange("14-20, 25")]).toEqual([14, 15, 16, 17, 18, 19, 20, 25]);
    expect([...parseRange("3 1")].sort()).toEqual([1, 3]);
    expect(parseRange("abc").size).toBe(0);
  });
});

describe("the PDF", () => {
  it("is exactly US Letter, one page per ten labels from the start position", async () => {
    const doc = await PDFDocument.load(await labelsPdf([1, 2, 3, 4, 5].map(label), { start: 8 }));
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });

  it("a very long customer name still makes a PDF (it shrinks to fit)", async () => {
    const long = { ...label(1), name: "Jalapeno Honey Pepper Sticks Wholesale Distribution Company of Southern Oregon" };
    const doc = await PDFDocument.load(await labelsPdf([long]));
    expect(doc.getPageCount()).toBe(1);
  });

  it("the alignment test is one Letter page", async () => {
    const doc = await PDFDocument.load(await alignmentPdf());
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });
});

describe("the label layout (10/24/26)", async () => {
  // Measure with the fonts the PDF uses.
  const { PDFDocument: Doc, StandardFonts } = await import("pdf-lib");
  const { layoutLabel, LAYOUT } = await import("./avery5963");
  const doc = await Doc.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const m = { bold: (t: string, s: number) => bold.widthOfTextAtSize(t, s), regular: (t: string, s: number) => regular.widthOfTextAtSize(t, s) };
  const inner = 288 - 2 * 0.18 * 72;
  const L = (over: Partial<PrintLabel>) => layoutLabel({ ...label(14), ...over }, m);

  it("customer and location print together on one bold line, at 22 pt when it fits", () => {
    const l = L({ name: "PCC", location: "#10 Issaquah" });
    expect(l.dest.map((d) => d.text)).toEqual(["PCC #10 Issaquah"]);
    expect(l.dest[0].size).toBe(22);
    expect(L({ name: "Port Townsend", location: "" }).dest.map((d) => d.text)).toEqual(["Port Townsend"]);
  });

  it("a long destination wraps to two lines (before shrinking) without overlapping the rule", () => {
    const l = L({ name: "Preservation Meat Collective", location: "Portland" });
    expect(l.dest.length).toBe(2);
    expect(l.dest[0].size).toBe(22);
    for (const d of l.dest) expect(m.bold(d.text, d.size)).toBeLessThanOrEqual(inner);
    const last = l.dest[l.dest.length - 1];
    expect(last.y + last.size * 0.207).toBeLessThan(l.ruleY); // descenders stay above the rule
    expect(l.dest[0].y - l.dest[0].size * 0.718).toBeGreaterThanOrEqual(0.18 * 72 - 0.5); // and below the top padding
  });

  it("the destination sits in the same spot on every label (just above the rule)", () => {
    expect(L({ name: "Key City", location: "" }).ruleY).toBe(L({ name: "Preservation Meat Collective", location: "Portland" }).ruleY);
  });

  it("a long product name fits in two lines inside the green band", () => {
    const l = L({ product: "Bone-In Shoulder Chops" });
    expect(l.productLines.length).toBeLessThanOrEqual(2);
    expect(l.productLines[0].size).toBeGreaterThanOrEqual(LAYOUT.productMin);
    for (const p of l.productLines) {
      expect(p.x + m.bold(p.text, p.size)).toBeLessThanOrEqual(l.band.x + l.band.w);
      expect(p.y - p.size * 0.718).toBeGreaterThanOrEqual(l.band.y);
      expect(p.y).toBeLessThanOrEqual(l.band.y + l.band.h);
    }
    expect(l.band.x - (l.qtyBox.x + l.qtyBox.w)).toBeCloseTo(0.07 * 72);
    expect(l.band.x + l.band.w).toBeCloseTo(288 - 0.18 * 72);
    expect([l.qtyBox.w, l.qtyBox.h, l.band.h]).toEqual([0.85 * 72, 0.66 * 72, 0.66 * 72]);
  });

  it("the quantity fits its box: '10' with 'lb' underneath", () => {
    const l = L({ qty: "10", unit: "lb" });
    expect(l.qtyLines.map((q) => q.text)).toEqual(["10", "lb"]);
    for (const q of l.qtyLines) expect(m.bold(q.text, q.size)).toBeLessThanOrEqual(l.qtyBox.w - 8 + 0.01);
  });

  it("the red box tag and the ROLL STOCK tag don't overlap the label number", () => {
    const l = L({ number: 168, boxNo: 10, boxCount: 12, boxType: "Roll Stock" });
    expect(l.boxTag).not.toBeNull();
    expect(l.boxText.text).toBe("BOX 10 OF 12");
    expect(l.typeText!.text).toBe("ROLL STOCK");
    expect(l.labelNo.text).toBe("label 168");
    expect(l.boxTag!.x + l.boxTag!.w).toBeLessThan(l.labelNo.x);
    expect(l.labelNo.x + l.labelNo.w).toBeLessThan(l.typeTag!.x);
  });

  it("a single-box label never shows the red tag", () => {
    const l = L({ boxNo: 1, boxCount: 1 });
    expect(l.boxTag).toBeNull();
    expect(l.boxText.text).toBe("Box 1 of 1");
    expect(l.boxText.size).toBe(9);
  });

  it("a label never shows a question mark: an unknown box type leaves the tag off", () => {
    const l = L({ boxType: "?" });
    expect(l.typeTag).toBeNull();
    expect(l.typeText).toBeNull();
    const all = [...l.dest, ...l.qtyLines, ...l.productLines, l.boxText, l.labelNo].map((x) => x.text).join(" ");
    expect(all).not.toContain("?");
  });
});
