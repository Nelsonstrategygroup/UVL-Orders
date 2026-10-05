import { describe, expect, it } from "vitest";
import { afterTap, lineLook, lineWords, orderPacked, packStats, showOrder } from "./packing";

describe("packing a line", () => {
  it("says what state a line is in, in words", () => {
    expect(lineWords(4, 0, "each")).toBe("Tap when packed");
    expect(lineWords(4, 4, "each")).toBe("Packed");
    expect(lineWords(4, 3, "each")).toBe("Packed 3, short 1");
    expect(lineWords(4, 5, "each")).toBe("Packed 5, over 1");
    expect(lineWords(10, 9.5, "lb")).toBe("Pounds. Packed 9.5, short 0.5");
  });

  it("counts over as packed, and partial as not", () => {
    expect(lineLook(4, 0)).toBe("todo");
    expect(lineLook(4, 3)).toBe("part");
    expect(lineLook(4, 4)).toBe("done");
    expect(lineLook(4, 5)).toBe("done");
  });

  it("tapping packs the full amount, and tapping a packed row unchecks it", () => {
    expect(afterTap(4, 0)).toBe(4);
    expect(afterTap(4, 3)).toBe(4);
    expect(afterTap(4, 4)).toBe(0);
    expect(afterTap(4, 6)).toBe(0);
  });
});

describe("packing a week", () => {
  const a = { lines: { s1: 4, s14: 2 }, packed: { s1: 4 } };
  const b = { lines: { s7: 1 }, packed: { s7: 1, s99: 3 } }; // s99 no longer on the order
  const empty = { lines: {}, packed: {} };

  it("counts lines packed out of lines ordered", () => {
    expect(packStats([a, b, empty])).toEqual({ done: 2, total: 3 });
  });

  it("knows when a customer is all packed", () => {
    expect(orderPacked(a)).toBe(false);
    expect(orderPacked(b)).toBe(true);
    expect(orderPacked(empty)).toBe(false);
  });

  it("filters To pack, Done, All", () => {
    expect([a, b].filter((o) => showOrder(o, "todo"))).toEqual([a]);
    expect([a, b].filter((o) => showOrder(o, "done"))).toEqual([b]);
    expect([a, b].filter((o) => showOrder(o, "all"))).toEqual([a, b]);
  });
});
