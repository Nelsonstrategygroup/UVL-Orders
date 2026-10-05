import { describe, expect, it } from "vitest";
import { ceilSafe, fmt, num } from "./num";

describe("number helpers", () => {
  it("formats without losing small fractions", () => {
    expect(fmt(2)).toBe("2");
    expect(fmt(0.5)).toBe("0.5");
    expect(fmt(0.125)).toBe("0.125");
    expect(fmt(2.25)).toBe("2.25");
    expect(fmt(1 / 3)).toBe("0.333");
    expect(fmt(0.1 + 0.2)).toBe("0.3");
  });

  it("parses loosely", () => {
    expect(num("4")).toBe(4);
    expect(num("")).toBe(0);
    expect(num(null)).toBe(0);
    expect(num("abc")).toBe(0);
  });

  it("rounds up without floating point dust", () => {
    expect(ceilSafe(50.0000000001)).toBe(50);
    expect(ceilSafe(50.5)).toBe(51);
  });
});
