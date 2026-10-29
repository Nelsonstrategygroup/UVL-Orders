import { describe, expect, it } from "vitest";
import { centsText, lineTotalCents, parsePrice, priceFor, priceHistory, priceText, type PriceRow } from "./prices";

const row = (id: string, product_id: string, customer_id: string | null, price: number | string, effective_from: string): PriceRow => ({
  id,
  product_id,
  customer_id,
  price,
  effective_from,
  note: "",
});

describe("priceFor", () => {
  const prices = [
    row("d1", "rack", null, 18, "2026-10-01"),
    row("d2", "rack", null, 19, "2026-11-01"),
    row("c1", "rack", "newport", 17.5, "2026-10-15"),
    row("o1", "legs", null, 9, "2026-10-01"),
  ];
  it("uses the newest default on or before the invoice date", () => {
    expect(priceFor(prices, "rack", null, "2026-10-27")?.id).toBe("d1");
    expect(priceFor(prices, "rack", null, "2026-11-01")?.id).toBe("d2");
    expect(priceFor(prices, "rack", "pcc10", "2026-11-03")?.id).toBe("d2");
  });
  it("uses the customer's own price before the default, once it's in effect", () => {
    expect(priceFor(prices, "rack", "newport", "2026-10-27")?.id).toBe("c1");
    expect(priceFor(prices, "rack", "newport", "2026-11-05")?.id).toBe("c1");
    expect(priceFor(prices, "rack", "newport", "2026-10-10")?.id).toBe("d1");
  });
  it("is null when there's no price yet (Price needed)", () => {
    expect(priceFor(prices, "rack", null, "2026-09-30")).toBeNull();
    expect(priceFor(prices, "shanks", "newport", "2026-10-27")).toBeNull();
  });
  it("lists a price history newest first", () => {
    expect(priceHistory(prices, "rack", null).map((p) => p.id)).toEqual(["d2", "d1"]);
    expect(priceHistory(prices, "rack", "newport").map((p) => p.id)).toEqual(["c1"]);
  });
});

describe("parsePrice", () => {
  it("reads what people type", () => {
    expect(parsePrice("9.50")).toBe("9.5");
    expect(parsePrice("$9.50")).toBe("9.5");
    expect(parsePrice(" 12 ")).toBe("12");
    expect(parsePrice("1,200.00")).toBe("1200");
    expect(parsePrice(".75")).toBe("0.75");
    expect(parsePrice("8.1254")).toBe("8.1254");
    expect(parsePrice("0")).toBe("0");
  });
  it("refuses what isn't a price", () => {
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("abc")).toBeNull();
    expect(parsePrice("-3")).toBeNull();
    expect(parsePrice("8.12345")).toBeNull();
    expect(parsePrice("1.2.3")).toBeNull();
  });
});

describe("money text", () => {
  it("shows prices with 2 to 4 decimals", () => {
    expect(priceText(9.5)).toBe("$9.50");
    expect(priceText("8.125")).toBe("$8.125");
    expect(priceText(1200)).toBe("$1,200.00");
    expect(priceText("0.0000")).toBe("$0.00");
  });
  it("shows cents as dollars", () => {
    expect(centsText(BigInt(123456))).toBe("$1,234.56");
    expect(centsText(5)).toBe("$0.05");
    expect(centsText(-250)).toBe("-$2.50");
  });
});

describe("lineTotalCents (weight x price, rounded half up to the cent, once)", () => {
  it("is exact where floating point isn't", () => {
    // 0.1 * 3 in floating point is 0.30000000000000004.
    expect(lineTotalCents("0.1", "3")).toBe(BigInt(30));
    expect(lineTotalCents("35.75", "12.99")).toBe(BigInt(46439)); // 464.3925
    expect(lineTotalCents(20.1, 9.5)).toBe(BigInt(19095));
  });
  it("rounds half a cent up", () => {
    expect(lineTotalCents("1.005", "1")).toBe(BigInt(101)); // 1.005
    expect(lineTotalCents("2.5", "0.001")).toBe(BigInt(0)); // 0.0025
    expect(lineTotalCents("5", "0.001")).toBe(BigInt(1)); // 0.005
  });
  it("bills cases and pieces as whole numbers", () => {
    expect(lineTotalCents(3, "42")).toBe(BigInt(12600));
    expect(lineTotalCents(0, "42")).toBe(BigInt(0));
  });
  it("refuses more decimals than it can hold exactly", () => {
    expect(() => lineTotalCents("1.0001", "1")).toThrow();
    expect(() => lineTotalCents("1", "1.00001")).toThrow();
  });
});
