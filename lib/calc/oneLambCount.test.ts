// Step 4 of the 2026-10-06 fix: This week has ONE lamb count. The headline,
// the producer message, and the carcass balance ("what X lambs will give you"
// and the Get column) must always use the same number.

import { describe, expect, it } from "vitest";
import { cutSheetTotals, weekNumbers } from "./summary";
import { sampleSheet, seedParts, seedProducts, seedSizes } from "./testData";
import { calcWeek, lambSourceLine } from "./week";

const sheet = cutSheetTotals(sampleSheet.sets, seedSizes); // 144 lambs
const none = cutSheetTotals([], seedSizes);

const cases = [
  { name: "no orders, no cut sheet", orders: [], override: null, cs: none, want: 0, from: "orders" },
  { name: "orders only", orders: [{ s1: 100 }], override: null, cs: none, want: 50, from: "orders" },
  { name: "cut sheet, no orders (the 144 vs 0 bug)", orders: [], override: null, cs: sheet, want: 144, from: "cut sheet" },
  { name: "cut sheet and orders", orders: [{ s1: 100 }], override: null, cs: sheet, want: 144, from: "cut sheet" },
  { name: "your number beats the cut sheet", orders: [{ s1: 100 }], override: 120, cs: sheet, want: 120, from: "your number" },
  { name: "your number, no cut sheet", orders: [{ s1: 100 }], override: 8, cs: none, want: 8, from: "your number" },
] as const;

describe("one lamb count on This week", () => {
  for (const k of cases) {
    it(`${k.name}: everything says ${k.want}`, () => {
      const c = calcWeek({
        parts: seedParts,
        products: seedProducts,
        orders: [...k.orders],
        override: k.override,
        cutSheetLambs: k.cs.total,
      });
      const n = weekNumbers(c, k.cs, null);
      expect(c.source).toBe(k.from);
      expect(n.headline).toBe(k.want);
      expect(n.balanceLambs).toBe(n.headline);
      // The Get column is that many lambs' worth of each part.
      for (const r of c.rows) expect(r.supply).toBeCloseTo(n.headline * Number(r.part.per_lamb));
      // The message asks for the same number.
      expect(n.message.startsWith(`Please bring ${k.want} lamb`)).toBe(true);
    });
  }

  it("says where the count came from in one line", () => {
    const line = (orders: { s1: number }[], override: number | null, cs: typeof sheet) =>
      lambSourceLine(calcWeek({ parts: seedParts, products: seedProducts, orders, override, cutSheetLambs: cs.total }));
    expect(line([], null, sheet)).toBe("144 from the cut sheet (orders suggest 0)");
    expect(line([{ s1: 288 }], null, sheet)).toBe("144 from the cut sheet (orders agree)");
    expect(line([{ s1: 100 }], 120, sheet)).toBe("120 is your number (cut sheet has 144, orders suggest 50)");
    expect(line([{ s1: 100 }], 50, none)).toBe("50 is your number");
    expect(line([{ s1: 100 }], null, none)).toBe("50 from orders");
    expect(line([], null, none)).toBeNull();
  });

  it("the message lists the cut sheet's sizes only when the count came from it", () => {
    const c = calcWeek({ parts: seedParts, products: seedProducts, orders: [], override: 120, cutSheetLambs: 144 });
    expect(weekNumbers(c, sheet, null).message).toBe("Please bring 120 lambs. Thank you!");
    const d = calcWeek({ parts: seedParts, products: seedProducts, orders: [], cutSheetLambs: 144 });
    expect(weekNumbers(d, sheet, null).message).toBe(
      "Please bring 144 lambs: 40 XL, 81 Large, 16 Medium, 2 Small, 5 XS. Thank you!",
    );
  });
});
