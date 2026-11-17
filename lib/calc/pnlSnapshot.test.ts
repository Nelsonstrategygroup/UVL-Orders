import { describe, expect, it } from "vitest";
import { fromSnapshot, toSnapshot } from "./pnlSnapshot";

describe("P&L snapshot", () => {
  it("keeps cents as bigints through JSON", () => {
    const v = { income: BigInt(3132263), lines: [{ cents: BigInt(-2500), name: "Dock" }], none: null, n: 3, text: "x" };
    const saved = toSnapshot(v);
    expect(saved.income).toEqual({ $big: "3132263" });
    expect(fromSnapshot(saved)).toEqual(v);
  });
  it("leaves other objects alone", () => {
    const v = { a: { $big: "x" }, b: { $big: "1", c: 2 } };
    expect(fromSnapshot(toSnapshot(v))).toEqual(v);
  });
  it("survives being stored and read as text", () => {
    const v = { p: { incomeCents: BigInt(100), profit: null } };
    expect(fromSnapshot(JSON.parse(JSON.stringify(toSnapshot(v))))).toEqual(v);
  });
});
