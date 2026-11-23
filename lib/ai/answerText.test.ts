import { describe, expect, it } from "vitest";
import { answerLine, splitAnswer } from "./answerText";

describe("splitAnswer", () => {
  it("splits the answer from the notes at a --- line", () => {
    expect(splitAnswer("Last week there were **19 orders**.\n---\nI counted an order only when the customer ordered.")).toEqual({
      main: "Last week there were **19 orders**.",
      notes: "I counted an order only when the customer ordered.",
    });
  });

  it("keeps an answer with no notes whole", () => {
    expect(splitAnswer("19 orders.")).toEqual({ main: "19 orders.", notes: "" });
  });

  it("never leaves the answer empty", () => {
    expect(splitAnswer("---\n19 orders.")).toEqual({ main: "19 orders.", notes: "" });
  });
});

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
