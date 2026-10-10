import { describe, expect, it } from "vitest";
import { boxes, lineDone, lineLook, lineWords, nextBox, orderPacked, packStats, showOrder, type PackLine } from "./packing";

const line = (extra: Partial<PackLine>): PackLine => ({
  ordered: 20,
  unit: "lb",
  weight: 0,
  count: null,
  shorted: false,
  flagged: false,
  flagNote: "",
  ...extra,
});

describe("packing a line by weight", () => {
  it("compares pounds with pounds ordered", () => {
    expect(lineWords(line({}))).toBe("Tap to weigh");
    expect(lineWords(line({ weight: 20 }))).toBe("Packed 20 lb");
    // The paper sheet: Hind Shanks 20 ordered, 15.20 filled.
    expect(lineWords(line({ weight: 15.2 }))).toBe("Packed 15.2 lb, short 4.8 lb");
    expect(lineWords(line({ weight: 24.15 }))).toBe("Packed 24.15 lb, over 4.15 lb");
    expect(lineLook(line({ weight: 15.2 }))).toBe("short");
    expect(lineLook(line({ weight: 24.15 }))).toBe("over");
    expect(lineLook(line({ weight: 20 }))).toBe("done");
  });

  it("for pieces, shows the weight and the count if there is one", () => {
    // BI Loin: 14 ordered, 37.60 lb filled.
    const loin = line({ ordered: 14, unit: "each", weight: 37.6 });
    expect(lineWords(loin)).toBe("Packed 37.6 lb");
    expect(lineLook(loin)).toBe("done");
    expect(lineWords({ ...loin, count: 13 })).toBe("Packed 37.6 lb, 13 of 14");
    expect(lineLook({ ...loin, count: 13 })).toBe("short");
  });

  it("marks not filled (the X) and flags with a note", () => {
    expect(lineWords(line({ shorted: true }))).toBe("Not filled");
    expect(lineLook(line({ shorted: true }))).toBe("short");
    expect(lineDone(line({ shorted: true }))).toBe(true);
    const flagged = line({ weight: 20, flagged: true, flagNote: "Ask Kathy" });
    expect(lineLook(flagged)).toBe("flag");
    expect(lineWords(flagged)).toBe("Packed 20 lb · Flag: Ask Kathy");
  });

  it("an order is packed when every line has a weight or is not filled", () => {
    const done = [line({ weight: 20 }), line({ shorted: true })];
    const notYet = [line({ weight: 20 }), line({})];
    expect(orderPacked(done)).toBe(true);
    expect(orderPacked(notYet)).toBe(false);
    expect(packStats([{ lines: done }, { lines: notYet }])).toEqual({ done: 3, total: 4 });
    expect(showOrder(done, "todo")).toBe(false);
    expect(showOrder(notYet, "todo")).toBe(true);
    expect(showOrder(done, "done")).toBe(true);
    expect(showOrder(notYet, "all")).toBe(true);
  });
});

describe("boxes", () => {
  it("adds up each box and spots mixed boxes", () => {
    // Le Trim in three cases, and a mixed box with chops and shanks.
    const w = [
      { product_id: "le-trim", weight: 53.65, box_no: 1 },
      { product_id: "le-trim", weight: 84.8, box_no: 2 },
      { product_id: "le-trim", weight: 87.65, box_no: 3 },
      { product_id: "chops", weight: 15.45, box_no: 4 },
      { product_id: "shanks", weight: 15.2, box_no: 4 },
      { product_id: "x", weight: 1, box_no: null },
    ];
    expect(boxes(w).map((b) => `${b.box_no}:${b.weight.toFixed(2)}:${b.mixed}`)).toEqual([
      "1:53.65:false",
      "2:84.80:false",
      "3:87.65:false",
      "4:30.65:true",
    ]);
    expect(nextBox(w)).toBe(5);
    expect(nextBox([])).toBe(1);
  });
});
