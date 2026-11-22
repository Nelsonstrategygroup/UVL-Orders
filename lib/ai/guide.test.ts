import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DATA_GUIDE } from "./dataGuide";
import { guideFor, guideViewNames, parseGuide } from "./guide";

describe("data guide", () => {
  test("dataGuide.ts matches data-guide.md (run npm run ai:guide after editing it)", () => {
    const md = readFileSync(join(process.cwd(), "lib", "ai", "data-guide.md"), "utf8").replace(/\r\n/g, "\n");
    expect(DATA_GUIDE).toBe(md);
  });

  test("every section has its generated column list", () => {
    const { views } = parseGuide(DATA_GUIDE);
    expect(views.size).toBeGreaterThan(70);
    for (const [name, text] of views) expect(text, name).toMatch(/\nColumns: \w/);
  });

  test("the General part names no view a reader might not see", () => {
    const { general } = parseGuide(DATA_GUIDE);
    for (const hidden of ["prices", "invoices", "pnl_", "kill_", "producer", "half_whole_contacts", "customer_contacts", "contact_log", "payments"]) {
      expect(general, hidden).not.toContain(hidden);
    }
  });

  test("a reader gets only its own views' sections", () => {
    const g = guideFor(["orders", "order_lines", "products", "weeks"]);
    expect(g).toContain("### orders");
    expect(g).toContain("INV#");
    expect(g).not.toContain("### prices");
    expect(g).not.toContain("### pnl_income");
    expect(g).not.toMatch(/maintainers|npm run/);
    expect(g).not.toContain("<!--");
  });

  test("unknown view names are ignored", () => {
    expect(guideFor(["nope"])).not.toContain("### nope");
    expect(guideViewNames()).toContain("manifest_boxes");
  });
});
