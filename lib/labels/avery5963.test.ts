// Avery 5963 label sheets (change request 10/23/26).

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { alignmentPdf, labelsPdf, PAGE, parseRange, placeLabels, slotBox, type PrintLabel } from "./avery5963";

const label = (n: number): PrintLabel => ({ number: n, name: "PCC", location: "#02 Kirkland", what: "6 BLS Legs", boxNo: 1, boxCount: 2, boxType: "MVM" });

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
