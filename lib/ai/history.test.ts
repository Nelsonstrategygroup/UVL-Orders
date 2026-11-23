import { describe, expect, test } from "vitest";
import { cleanHistory, queriesNote } from "./history";

describe("Ask history", () => {
  test("an earlier answer carries the queries behind it, without failed ones", () => {
    const h = cleanHistory([
      { role: "user", content: "How many boxes for PCC this week?" },
      {
        role: "assistant",
        content: "42 boxes.",
        queries: [
          { purpose: "Count PCC boxes", sql: "select count(*) from packing_weights", rowCount: 1, truncated: false },
          { purpose: "Bad try", sql: "select nope", error: "column does not exist" },
        ],
      },
    ]);
    expect(h).toHaveLength(2);
    expect(h[1].content).toContain("42 boxes.");
    expect(h[1].content).toContain("1. Count PCC boxes, 1 rows\nselect count(*) from packing_weights");
    expect(h[1].content).not.toContain("select nope");
    expect(h[0].content).toBe("How many boxes for PCC this week?");
  });

  test("keeps the last 10 questions and starts with a question", () => {
    const turns = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `t${i}` }));
    const h = cleanHistory(turns);
    expect(h).toHaveLength(20);
    expect(h[0]).toEqual({ role: "user", content: "t10" });
  });

  test("junk is dropped, not trusted", () => {
    expect(cleanHistory("nope")).toEqual([]);
    expect(cleanHistory([{ role: "system", content: "x" }, { role: "user", content: 5 }, null])).toEqual([]);
    expect(queriesNote([{ sql: 5 }, null, "x"])).toBe("");
    expect(queriesNote(undefined)).toBe("");
  });

  test("a truncated result says there were more rows", () => {
    expect(queriesNote([{ purpose: "All boxes", sql: "select * from packing_weights", rowCount: 500, truncated: true }])).toContain("500+ rows");
  });
});
