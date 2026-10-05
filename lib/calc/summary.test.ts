import { describe, expect, it } from "vitest";
import { cutSheetTotals, legBreakdown, legBreakdownText, producerMessage } from "./summary";
import { sampleSheet, seedProducts, seedSizes } from "./testData";

describe("cut sheet totals", () => {
  it("Kathy's 9/30 sheet is 144 lambs: 40 XL, 81 Large, 16 Medium, 2 Small, 5 XS", () => {
    const t = cutSheetTotals(sampleSheet.sets, seedSizes);
    expect(t.total).toBe(144);
    expect(t.bySize.map((s) => `${s.lambs} ${s.label}`)).toEqual(["40 XL", "81 Large", "16 Medium", "2 Small", "5 XS"]);
  });
});

describe("producer message", () => {
  it("uses the cut sheet's sizes when there is one", () => {
    const cs = cutSheetTotals(
      [
        { lambs: 40, size_class_id: "Large" },
        { lambs: 16, size_class_id: "Medium" },
        { lambs: 14, size_class_id: "Small" },
      ],
      seedSizes,
    );
    expect(producerMessage({ lambs: 61, processDate: "2026-10-21", cutSheet: cs })).toBe(
      "Please bring 70 lambs for processing on Wednesday, Oct 21: 40 Large, 16 Medium, 14 Small. Thank you!",
    );
  });

  it("uses the order count without a cut sheet", () => {
    expect(producerMessage({ lambs: 61, processDate: "2026-10-21" })).toBe(
      "Please bring 61 lambs for processing on Wednesday, Oct 21. Thank you!",
    );
    expect(producerMessage({ lambs: 1, processDate: null })).toBe("Please bring 1 lamb. Thank you!");
  });
});

describe("leg breakdown", () => {
  it("groups leg products as bone-in, AO, boneless, then other", () => {
    // s1 bone-in, s3 AO leg, s4 AO odd legs, s2 + s5 boneless, s6 leg steaks
    const b = legBreakdown({ s1: 40, s3: 10, s4: 2, s2: 76, s5: 4, s6: 3, s7: 99 }, seedProducts);
    expect(b.total).toBe(135);
    expect(legBreakdownText(b)).toBe("Legs: 40 bone-in, 12 AO, 80 boneless, 3 other. 135 total.");
  });

  it("is empty with no legs", () => {
    expect(legBreakdownText(legBreakdown({ s7: 4 }, seedProducts))).toBe("");
  });
});
