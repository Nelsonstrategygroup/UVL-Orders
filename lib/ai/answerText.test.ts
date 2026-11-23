import { describe, expect, it } from "vitest";
import { answerLine } from "./answerText";

describe("answerLine", () => {
  it("leaves a plain line as one piece", () => {
    expect(answerLine("22 orders this week.")).toEqual([{ text: "22 orders this week.", bold: false }]);
  });

  it("shows **bold** as bold, without the asterisks", () => {
    expect(answerLine("- **Week of Nov 16 (INV 3004):** 22 orders.")).toEqual([
      { text: "- ", bold: false },
      { text: "Week of Nov 16 (INV 3004):", bold: true },
      { text: " 22 orders.", bold: false },
    ]);
  });

  it("makes a heading a bold line", () => {
    expect(answerLine("## Totals")).toEqual([{ text: "Totals", bold: true }]);
  });

  it("drops a stray ** with no partner", () => {
    expect(answerLine("Total ** 42")).toEqual([{ text: "Total  42", bold: false }]);
  });
});
