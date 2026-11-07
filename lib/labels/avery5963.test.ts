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
    expect(l.dest[0].size).toBeGreaterThanOrEqual(14); // two lines would reach the top line (the pallet and INV#): it fits below them
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
      expect(p.x + m.bold(p.text, p.size)).toBeLessThanOrEqual(l.band!.x + l.band!.w);
      expect(p.y - p.size * 0.718).toBeGreaterThanOrEqual(l.band!.y);
      expect(p.y).toBeLessThanOrEqual(l.band!.y + l.band!.h);
    }
    expect(l.band!.x - (l.qtyBox!.x + l.qtyBox!.w)).toBeCloseTo(0.07 * 72);
    expect(l.band!.x + l.band!.w).toBeCloseTo(288 - 0.18 * 72);
    expect([l.qtyBox!.w, l.qtyBox!.h, l.band!.h]).toEqual([0.85 * 72, 0.66 * 72, 0.66 * 72]);
  });

  it("the quantity fits its box: '10' with 'lb' underneath", () => {
    const l = L({ qty: "10", unit: "lb" });
    expect(l.qtyLines.map((q) => q.text)).toEqual(["10", "lb"]);
    for (const q of l.qtyLines) expect(m.bold(q.text, q.size)).toBeLessThanOrEqual(l.qtyBox!.w - 8 + 0.01);
  });

  it("the write-in label: a big green band, each organ's name over a white box to write in, ordered under it, Box ___ of ___ (10/31/26)", () => {
    const writeIn = [
      { name: "Hearts", ordered: "4 pk" },
      { name: "Livers", ordered: "12 pk" },
      { name: "Kidneys", ordered: "6 pk" },
    ];
    const l = L({ qty: "", unit: "", product: "Heart, Liver, Kidney", boxType: "", writeIn });
    expect(l.qtyBox).toBeNull();
    expect(l.typeTag).toBeNull();
    expect(l.band!.h).toBeCloseTo(0.9 * 72);
    expect(l.band!.x + l.band!.w).toBeCloseTo(288 - 0.18 * 72);
    expect(l.writeText.map((t) => t.text)).toEqual(["Hearts", "Livers", "Kidneys"]);
    expect(l.writeText[0].size).toBeGreaterThanOrEqual(16);
    expect(l.orderedText.map((t) => t.text)).toEqual(["ordered: 4 pk", "ordered: 12 pk", "ordered: 6 pk"]);
    for (const [i, b] of l.writeBoxes.entries()) {
      expect(b.w).toBeGreaterThanOrEqual(1 * 72); // room for a 2 to 3 digit number in marker
      expect(b.h).toBeGreaterThanOrEqual(0.35 * 72);
      expect(b.y).toBeGreaterThan(l.writeText[i].y); // under its name
      expect(b.y + b.h).toBeLessThan(l.orderedText[i].y - 7.5 * 0.718);
      expect(l.orderedText[i].y).toBeLessThanOrEqual(l.band!.y + l.band!.h);
      if (i) expect(b.x).toBeGreaterThan(l.writeBoxes[i - 1].x + l.writeBoxes[i - 1].w);
    }
    for (const t of l.writeText) expect(t.x + m.bold(t.text, t.size)).toBeLessThanOrEqual(l.band!.x + l.band!.w);
    // The customer still fits above the rule.
    // Under the pallet number and INV#, above the taller green band.
    expect(L({ name: "PCC", location: "#10 Issaquah", writeIn, inv: "3001" }).dest[0].size).toBeGreaterThanOrEqual(14);
    expect(l.boxText.text).toBe("Box");
    expect(l.boxMore.map((t) => t.text)).toEqual(["of"]);
    expect(l.blanks).toHaveLength(2);
    expect(l.blanks[1].x + l.blanks[1].w).toBeLessThan(l.labelNo.x);
    expect(l.boxText.y).toBeGreaterThan(l.band!.y + l.band!.h);
    // One organ: one box, 1.2 in wide.
    expect(L({ writeIn: [{ name: "Livers", ordered: "3 pk" }] }).writeBoxes[0].w).toBeCloseTo(1.2 * 72);
  });

  it("the write-in label makes a PDF", async () => {
    const doc = await PDFDocument.load(await labelsPdf([{ ...label(3), writeIn: [{ name: "Hearts", ordered: "4 pk" }] }]));
    expect(doc.getPageCount()).toBe(1);
  });

  it("the week's INV# sits alone in the top right corner, bold 12 pt, inside the padding; a blank when not set (10/31/26)", () => {
    const l = L({ inv: "3001" });
    expect(l.inv.text).toBe("INV# 3001");
    expect(l.inv.size).toBeGreaterThanOrEqual(12);
    expect(l.inv.x + l.inv.w).toBeCloseTo(288 - 0.18 * 72);
    expect(l.inv.y - l.inv.size * 0.718).toBeCloseTo(0.18 * 72);
    expect(L({ inv: null }).inv.text).toBe("INV# ______");
    // Only once: not with the label number any more.
    expect(l.labelNo.text).not.toContain("INV");
  });

  // The longest customer and location in the system (PCC #24 Central District), and longer, on both kinds of label.
  const names: [string, string][] = [
    ["PCC", "#24 Central District"],
    ["PCC", "#22 Madison Valley"],
    ["Windy River Livestock", ""],
    ["Preservation Meat Collective", "Portland"],
    ["Jalapeno Honey Pepper Sticks Wholesale Distribution Company", "Southern Oregon"],
  ];
  const writeIn = [
    { name: "Hearts", ordered: "4 pk" },
    { name: "Livers", ordered: "4 pk" },
    { name: "Kidneys", ordered: "4 pk" },
  ];
  for (const [name, location] of names)
    for (const kind of ["box", "organs"] as const)
      it(`the INV# never touches the customer: ${name} ${location} (${kind} label)`, () => {
        const l = L({ name, location, inv: "______", ...(kind === "organs" ? { writeIn } : {}) });
        const invBox = { left: l.inv.x, top: l.inv.y - l.inv.size * 0.718, bottom: l.inv.y + l.inv.size * 0.207 };
        for (const d of l.dest) {
          const top = d.y - d.size * 0.718;
          const bottom = d.y + d.size * 0.207;
          const right = d.x + m.bold(d.text, d.size);
          const besideIt = top < invBox.bottom && bottom > invBox.top;
          if (besideIt) expect(right).toBeLessThan(invBox.left - 4);
          expect(bottom).toBeLessThan(l.ruleY);
        }
      });

  for (const [name, location] of names)
    for (const kind of ["box", "organs"] as const)
      it(`the pallet number never touches the customer: ${name} ${location} (${kind} label)`, () => {
        const l = L({ name, location, inv: "3002", pallet: "P12", ...(kind === "organs" ? { writeIn } : {}) });
        const tag = { right: l.pallet.x + l.pallet.w, bottom: l.pallet.y + l.pallet.size * 0.207 };
        for (const d of l.dest) {
          const top = d.y - d.size * 0.718;
          // Below the pallet number (the name starts at the same left edge).
          expect(top).toBeGreaterThan(tag.bottom);
          expect(d.y + d.size * 0.207).toBeLessThan(l.ruleY);
        }
        expect(tag.right).toBeLessThan(l.inv.x - 20);
      });

  it("the planned pallet sits top left, bold, the INV#'s size, inside the padding; none planned prints P___", () => {
    const l = L({ pallet: "P3", inv: "3002" });
    expect(l.pallet.text).toBe("P3");
    expect(l.pallet.x).toBeCloseTo(0.18 * 72);
    expect(l.pallet.y).toBe(l.inv.y);
    expect(l.pallet.size).toBe(l.inv.size);
    expect(L({ pallet: null }).pallet.text).toBe("P___");
    expect(L({ pallet: "  " }).pallet.text).toBe("P___");
  });

  it("a name that fits on one line keeps its size and place", () => {
    const l = L({ name: "PCC", location: "#24 Central District", inv: "3001" });
    expect(l.dest).toHaveLength(1);
    expect(l.dest[0].size).toBe(22);
  });

  it("the red box tag and the ROLL STOCK tag don't overlap the label number", () => {
    const l = L({ number: 168, boxNo: 10, boxCount: 12, boxType: "Roll Stock", inv: "3001" });
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
