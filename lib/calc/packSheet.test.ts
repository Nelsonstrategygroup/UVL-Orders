import { describe, expect, it } from "vitest";
import { blankWords, boxKey, nextBlank, sheetRows, type SheetLabel } from "./packSheet";

const labels: SheetLabel[] = [
  { key: boxKey("c1", "le-trim", 1), boxNo: 1, boxCount: 3 },
  { key: boxKey("c1", "le-trim", 2), boxNo: 2, boxCount: 3 },
  { key: boxKey("c1", "le-trim", 3), boxNo: 3, boxCount: 3 },
  { key: boxKey("c1", "heart", 1), boxNo: 1, boxCount: 1, noBox: true },
  { key: boxKey("c2", "le-trim", 1), boxNo: 1, boxCount: 1 },
];
const numbers = new Map([
  [boxKey("c1", "le-trim", 1), 14],
  [boxKey("c1", "le-trim", 2), 15],
  [boxKey("c1", "le-trim", 3), 16],
  [boxKey("c2", "le-trim", 1), 17],
]);
const settings = { unknown: 6, spare: 2 };
const w = (id: string, product_id: string, weight: number, slot: number | null = null, label_no: number | null = null, at = id) => ({
  id,
  product_id,
  weight,
  slot,
  label_no,
  at,
});

describe("the packing sheet's weight blanks", () => {
  it("known box count: one blank per box with its label number, then 2 spares", () => {
    const [row] = sheetRows({ customerId: "c1", productIds: ["le-trim"], weights: [] }, labels, numbers, settings);
    expect(row.known).toBe(true);
    expect(row.boxCount).toBe(3);
    expect(row.blanks.map((b) => [b.slot, b.labelNo, b.planned])).toEqual([
      [1, 14, true],
      [2, 15, true],
      [3, 16, true],
      [4, null, false],
      [5, null, false],
    ]);
  });

  it("box count unknown (no box size): 6 blanks with empty label numbers, or the product's own number", () => {
    const [heart, ground] = sheetRows({ customerId: "c1", productIds: ["heart", "ground"], weights: [] }, labels, numbers, {
      ...settings,
      perProduct: new Map([["ground", 9]]),
    });
    expect(heart.known).toBe(false);
    expect(heart.blanks).toHaveLength(6);
    expect(heart.blanks.every((b) => b.labelNo == null && !b.planned)).toBe(true);
    expect(ground.blanks).toHaveLength(9);
  });

  it("label numbers not handed out yet: still one blank per box, number left blank", () => {
    const [row] = sheetRows({ customerId: "c1", productIds: ["le-trim"], weights: [] }, labels, new Map(), settings);
    expect(row.blanks.slice(0, 3).map((b) => [b.labelNo, b.planned])).toEqual([
      [null, true],
      [null, true],
      [null, true],
    ]);
  });

  it("each weight sits in its own box; the total adds them up; other products and customers stay out", () => {
    const [row] = sheetRows(
      {
        customerId: "c1",
        productIds: ["le-trim"],
        weights: [w("a", "le-trim", 44.6, 2, 15), w("b", "le-trim", 30.25, 5, 31), w("c", "heart", 9, 1)],
      },
      labels,
      numbers,
      settings,
    );
    expect(row.blanks[1].weight?.id).toBe("a");
    expect(row.blanks[4].weight?.id).toBe("b");
    expect(row.blanks[4].labelNo).toBe(31); // written in above a spare blank
    expect(row.blanks[0].weight).toBeNull();
    expect(row.total).toBe(74.85);
  });

  it("older weights (no box) go to the box with their label number, else the first empty blank", () => {
    const [row] = sheetRows(
      { customerId: "c1", productIds: ["le-trim"], weights: [w("a", "le-trim", 40, null, 16), w("b", "le-trim", 41, null, null)] },
      labels,
      numbers,
      settings,
    );
    expect(row.blanks[2].weight?.id).toBe("a");
    expect(row.blanks[0].weight?.id).toBe("b");
  });

  it("more weights than blanks adds blanks; two in one box keeps both; Add a box adds an empty one", () => {
    const many = Array.from({ length: 7 }, (_, i) => w(`w${i}`, "heart", 10));
    const [heart] = sheetRows({ customerId: "c1", productIds: ["heart"], weights: [...many, w("x", "heart", 1, 1)] }, labels, numbers, settings);
    expect(heart.blanks).toHaveLength(8);
    expect(heart.blanks.every((b) => b.weight)).toBe(true);
    expect(heart.blanks[0].weight?.id).toBe("x");
    const [more] = sheetRows({ customerId: "c2", productIds: ["le-trim"], weights: [] }, labels, numbers, settings, { "le-trim": 1 });
    expect(more.blanks).toHaveLength(4); // 1 box + 2 spares + 1 added
  });

  it("the next weight (a scan) goes to the first empty box, with its label number", () => {
    const [row] = sheetRows({ customerId: "c1", productIds: ["le-trim"], weights: [w("a", "le-trim", 44.6, 1, 14)] }, labels, numbers, settings);
    expect(nextBlank(row)).toEqual({ slot: 2, label_no: 15 });
    expect(blankWords(row, 2)).toBe("Box 2 of 3 · label 15");
    expect(blankWords(row, 4)).toBe("Spare box");
    const full = sheetRows(
      { customerId: "c2", productIds: ["le-trim"], weights: [w("a", "le-trim", 1, 1), w("b", "le-trim", 1, 2), w("c", "le-trim", 1, 3)] },
      labels,
      numbers,
      settings,
    )[0];
    expect(nextBlank(full)).toEqual({ slot: 4, label_no: null });
  });
});
