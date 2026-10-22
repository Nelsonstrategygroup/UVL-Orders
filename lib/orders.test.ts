// The order screen's quantity box (10/22/26: "only one digit goes in").

import { describe, expect, it } from "vitest";
import { stepNote, typeQty } from "./orders";

describe("typing a quantity", () => {
  it("keeps every digit typed, and saves the whole number", () => {
    expect(typeQty("80")).toEqual({ text: "80", qty: 80 });
    expect(typeQty("125")).toEqual({ text: "125", qty: 125 });
  });

  it("pounds: a decimal goes in one key at a time ('12.' stays '12.')", () => {
    expect(typeQty("12.")).toEqual({ text: "12.", qty: 12 });
    expect(typeQty("12.5")).toEqual({ text: "12.5", qty: 12.5 });
  });

  it("ignores stray keys and a second decimal point", () => {
    expect(typeQty("1a2.5.0")).toEqual({ text: "12.50", qty: 12.5 });
  });

  it("adds to what's already in the box", () => {
    expect(typeQty("0", "8")).toEqual({ text: "80", qty: 80 });
  });
});

describe("steps (Le Trim, 10 lb)", () => {
  it("doesn't block or change what's typed: it suggests", () => {
    expect(stepNote("Le Trim", 85, 10, "lb")).toBe("Le Trim goes in 10 lb steps. Did you mean 80 or 90?");
    expect(stepNote("Le Trim", 82, 10, "lb")).toBe("Le Trim goes in 10 lb steps. Did you mean 80?");
    expect(stepNote("Le Trim", 8, 10, "lb")).toBe("Le Trim goes in 10 lb steps. Did you mean 10?");
  });

  it("says nothing when it's in steps, or the product has none", () => {
    expect(stepNote("Le Trim", 80, 10, "lb")).toBeNull();
    expect(stepNote("Chops", 12.5, 1, "lb")).toBeNull();
    expect(stepNote("Le Trim", 0, 10, "lb")).toBeNull();
  });
});
