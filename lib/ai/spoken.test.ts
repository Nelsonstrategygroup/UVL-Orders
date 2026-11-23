import { describe, expect, it } from "vitest";
import { forSpeech } from "./spoken";

describe("forSpeech", () => {
  it("leaves plain sentences alone", () => {
    expect(forSpeech("There were 42 BNLS Legs ordered this week.")).toBe("There were 42 BNLS Legs ordered this week.");
  });

  it("drops bold, headings and bullets", () => {
    expect(forSpeech("## This week\n- **42** legs\n- 10 racks")).toBe("This week\n42 legs\n10 racks");
  });

  it("reads a table as comma-separated rows", () => {
    const t = "| Pallet | Boxes |\n|---|---|\n| 1 | 30 |";
    expect(forSpeech(t)).toBe("Pallet, Boxes\n1, 30");
  });

  it("drops code blocks", () => {
    expect(forSpeech("Here:\n```sql\nselect 1\n```\nDone.")).toBe("Here:\nDone.");
  });
});
