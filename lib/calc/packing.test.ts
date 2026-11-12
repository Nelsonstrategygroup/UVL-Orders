import { describe, expect, it } from "vitest";
import { boxes, boxCount, boxCountWords, packRows, lineDone, type BoxCountRow, lineLook, lineWords, nextBox, orderedWords, orderPacked, packStats, showOrder, type PackLine } from "./packing";

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
      "Box packed, 10.95 lb, with Liver, Kidney; 2 of 3",
    );
    // A scan gives the box's weight, not its packs: never "filled" from a scan alone (Kathy, 11/11/26).
    expect(lineWords(line({ weight: 10.95, unit: "pack", ordered: 3, together: "Liver, Kidney" }))).toBe(
      "Box packed, 10.95 lb, with Liver, Kidney; count not recorded",
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
    expect(rows[1]).toMatchObject({ pid: "heart", members: ["heart", "liver", "kidney"], ordered: "1 box", words: "Box packed, 10.95 lb, count not recorded", orderedEach: "Ordered: 3 Heart, 3 Liver, 3 Kidney", uncounted: true });
    expect(packStats([{ lines: rows.map((r) => r.line) }])).toEqual({ done: 2, total: 2 });
  });

  it("named for what the store ordered; counts typed at Mohawk show", () => {
    const rows = packRows([["liver", pk({ ordered: 12, weight: 9, count: 12 })], ["kidney", pk({ ordered: 8, weight: 9 })]], group, name);
    expect(rows).toHaveLength(1);
    // A count for one of them: said, and the other still isn't recorded.
    expect(rows[0]).toMatchObject({ name: "Liver / Kidney", words: "Box packed, 9 lb, sent 12 Liver; Kidney count not recorded", orderedEach: "Ordered: 12 Liver, 8 Kidney", uncounted: true });
    // Counts for all of them (optional): what was sent, and no longer "not recorded".
    const all = packRows([["liver", pk({ ordered: 12, weight: 9, count: 10 })], ["kidney", pk({ ordered: 8, weight: 9, count: 8 })]], group, name);
    expect(all[0]).toMatchObject({ words: "Box packed, 9 lb, sent 10 Liver, 8 Kidney", uncounted: false });
  });

  it("not weighed yet, not filled only when none of them are, and a flag shows", () => {
    expect(packRows([["heart", pk({})], ["liver", pk({})]], group, name)[0].words).toBe("Tap to weigh");
    expect(packRows([["heart", pk({ shorted: true })], ["liver", pk({})]], group, name)[0].line.shorted).toBe(false);
    expect(packRows([["heart", pk({ shorted: true })], ["liver", pk({ shorted: true })]], group, name)[0].words).toBe("Not filled");
    expect(packRows([["heart", pk({ weight: 5, flagged: true, flagNote: "torn bag" })]], group, name)[0].words).toBe("Box packed, 5 lb, count not recorded · Flag: torn bag");
    // Nothing packed yet, or not filled: nothing to count.
    expect(packRows([["heart", pk({})], ["liver", pk({})]], group, name)[0].uncounted).toBe(false);
    expect(packRows([["heart", pk({ shorted: true })], ["liver", pk({ shorted: true })]], group, name)[0].uncounted).toBe(false);
  });

  it("other lines are unchanged", () => {
    const l = line({ ordered: 20, unit: "lb", weight: 18 });
    expect(packRows([["trim", l]], group, name)[0]).toMatchObject({ pid: "trim", line: l, ordered: orderedWords(l), words: lineWords(l) });
  });
});

describe("boxes expected against boxes packed (11/10/26)", () => {
  const row = (extra: Partial<BoxCountRow>): BoxCountRow => ({ name: "Racks", onOrder: true, planned: 1, packed: 0, shorted: false, counted: false, ...extra });
  const trim = (packedLb: number, packed: number) => row({ name: "Le Trim", planned: 3, packed, byWeight: { ordered: 120, packed: packedLb } });

  it("counts from the box labels; nothing is flagged while packing", () => {
    const c = boxCount([row({ planned: 2, packed: 1 }), row({ planned: 5, packed: 5 })], false);
    expect(c).toMatchObject({ expected: 7, packed: 6, waiting: [], state: null });
    expect(boxCountWords(c)).toBe("Boxes: 7 expected · 6 packed");
  });

  it("all packed: a match", () => {
    expect(boxCount([row({ planned: 2, packed: 2 }), row({ planned: 5, packed: 5 })], true).state).toEqual({ kind: "ok" });
  });

  it("fewer than expected is flagged only once every line is done; more is flagged at once", () => {
    expect(boxCount([row({ planned: 2, packed: 1 })], true).state).toEqual({ kind: "short", n: 1, products: ["Racks"] });
    expect(boxCount([row({ planned: 2, packed: 1 })], false).state).toBeNull();
    // An extra box of one product isn't hidden by a missing box of another.
    expect(boxCount([row({ planned: 2, packed: 3 }), row({ name: "Legs", planned: 1, packed: 0 })], false).state).toEqual({ kind: "extra", n: 1, products: ["Racks"] });
  });

  it("Le Trim, ordered by weight: named and kept apart until its pounds are packed", () => {
    const c = boxCount([row({ planned: 7, packed: 6 }), trim(82, 2)], false);
    expect(c).toMatchObject({ expected: 7, packed: 6, waiting: [{ name: "Le Trim", about: 3, packed: 2 }], state: null });
    expect(boxCountWords(c)).toBe("Boxes: 7 expected · 6 packed, plus Le Trim (about 3 boxes by weight; 2 so far, 82 of 120 lb)");
    // Still short of its pounds when everything else is done: no tick, the pounds say why.
    expect(boxCount([row({ planned: 7, packed: 7 }), trim(82, 2)], true).state).toBeNull();
  });

  it("once Le Trim is packed, the boxes it took are its count, not the estimate", () => {
    // 120 lb went in 4 boxes, not the 3 estimated.
    const c = boxCount([row({ planned: 7, packed: 7 }), trim(119.6, 4)], true);
    expect(c).toMatchObject({ expected: 11, packed: 11, waiting: [], state: { kind: "ok" } });
    expect(boxCountWords(c)).toBe("Boxes: 11 expected · 11 packed");
  });

  it("as many boxes as the estimate also settles it, a little under its pounds", () => {
    const c = boxCount([row({ name: "Le Trim", planned: 2, packed: 2, byWeight: { ordered: 80, packed: 79.45 } })], true);
    expect(c).toMatchObject({ expected: 2, packed: 2, waiting: [], state: { kind: "ok" } });
  });

  it("no box size: counted when packed, with no estimate", () => {
    const necks = row({ name: "Necks", planned: null, packed: 0 });
    expect(boxCountWords(boxCount([necks], false))).toBe("Boxes: 0 expected · 0 packed, plus Necks (count when packed)");
    // Once it has a box, the boxes packed are its count.
    expect(boxCount([{ ...necks, packed: 2 }], true)).toMatchObject({ expected: 2, packed: 2, waiting: [], state: { kind: "ok" } });
  });

  it("not filled expects nothing; boxes not on the order are counted apart", () => {
    const c = boxCount([row({ planned: 2, packed: 0, shorted: true }), row({ planned: 1, packed: 1 }), row({ name: "Pepper Sticks", onOrder: false, planned: null, packed: 1 })], true);
    expect(c).toMatchObject({ expected: 1, packed: 1, offOrder: 1, state: { kind: "ok" } });
    expect(boxCountWords(c)).toBe("Boxes: 1 expected · 1 packed, 1 not on the order");
  });
});
