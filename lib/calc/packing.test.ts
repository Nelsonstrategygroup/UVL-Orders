import { describe, expect, it } from "vitest";
import { boxes, packRows, lineDone, lineLook, lineWords, nextBox, orderedWords, orderPacked, packStats, showOrder, type PackLine } from "./packing";

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
    expect(lineWords(line({ weight: 10.95, unit: "pack", ordered: 3, count: 2, together: "Liver, Kidney" }))).toBe(
      "Packed 10.95 lb in one box with Liver, Kidney, 2 of 3",
    );
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

describe("what was ordered, in words (Lucas, 11/7/26)", () => {
  it("shows pieces taken in pounds as whole pieces, then the pounds", () => {
    expect(orderedWords({ ordered: 120, unit: "lb", pieces: 27, pieceUnit: "each" })).toBe("27 (120 lb ordered)");
    expect(orderedWords({ ordered: 8, unit: "pack" })).toBe("8 packs");
    expect(orderedWords({ ordered: 45, unit: "lb" })).toBe("45 lb");
    expect(orderedWords({ ordered: 6, unit: "each" })).toBe("6");
  });
});

describe("rows on a store's packing card (11/10/26)", () => {
  const group = (pid: string) => (["heart", "liver", "kidney"].includes(pid) ? ["heart", "liver", "kidney"] : [pid]);
  const name = (pid: string) => ({ heart: "Heart", liver: "Liver", kidney: "Kidney", rack: "Racks" })[pid] ?? pid;
  const pk = (extra: Partial<PackLine>): PackLine => line({ ordered: 3, unit: "pack", ...extra });

  it("Heart, Liver and Kidney are one row and one line: Burien's 9 lines are 8 boxes", () => {
    const lines: [string, PackLine][] = [
      ["rack", line({ ordered: 6, unit: "each", weight: 22 })],
      ["heart", pk({ weight: 10.95 })],
      ["liver", pk({ weight: 10.95 })],
      ["kidney", pk({ weight: 10.95 })],
    ];
    const rows = packRows(lines, group, name);
    expect(rows.map((r) => r.name)).toEqual(["Racks", "Heart / Liver / Kidney"]);
    expect(rows[1]).toMatchObject({ pid: "heart", members: ["heart", "liver", "kidney"], ordered: "1 box", words: "Packed 10.95 lb in one box", orderedEach: "Ordered: 3 Heart, 3 Liver, 3 Kidney" });
    expect(packStats([{ lines: rows.map((r) => r.line) }])).toEqual({ done: 2, total: 2 });
  });

  it("named for what the store ordered; counts typed at Mohawk show", () => {
    const rows = packRows([["liver", pk({ ordered: 12, weight: 9, count: 12 })], ["kidney", pk({ ordered: 8, weight: 9 })]], group, name);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Liver / Kidney", words: "Packed 9 lb in one box, 12 Liver", orderedEach: "Ordered: 12 Liver, 8 Kidney" });
  });

  it("not weighed yet, not filled only when none of them are, and a flag shows", () => {
    expect(packRows([["heart", pk({})], ["liver", pk({})]], group, name)[0].words).toBe("Tap to weigh");
    expect(packRows([["heart", pk({ shorted: true })], ["liver", pk({})]], group, name)[0].line.shorted).toBe(false);
    expect(packRows([["heart", pk({ shorted: true })], ["liver", pk({ shorted: true })]], group, name)[0].words).toBe("Not filled");
    expect(packRows([["heart", pk({ weight: 5, flagged: true, flagNote: "torn bag" })]], group, name)[0].words).toBe("Packed 5 lb in one box · Flag: torn bag");
  });

  it("other lines are unchanged", () => {
    const l = line({ ordered: 20, unit: "lb", weight: 18 });
    expect(packRows([["trim", l]], group, name)[0]).toMatchObject({ pid: "trim", line: l, ordered: orderedWords(l), words: lineWords(l) });
  });
});
