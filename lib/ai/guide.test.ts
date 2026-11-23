import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DATA_GUIDE } from "./dataGuide";
import { CALC_HEADING, guideCalcs, guideFor, guideViewNames, parseGuide } from "./guide";

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

  test("each calculation needs real views and names no other view", () => {
    const views = new Set(guideViewNames());
    const { calcs } = parseGuide(DATA_GUIDE);
    expect(calcs.map((c) => c.title)).toEqual(expect.arrayContaining(["The week's lamb count", "The weekly P&L", "Producer pay"]));
    for (const c of calcs) {
      for (const v of c.needs) expect(views.has(v), `${c.title} needs ${v}`).toBe(true);
      // Every backticked name that is a view (or view.column) must be in its needs.
      for (const [, tok] of c.text.matchAll(/`([a-z_]+)(?:.[a-z_]+)?`/g)) {
        if (views.has(tok)) expect(c.needs, `${c.title} names ${tok}`).toContain(tok);
      }
    }
  });

  test("a calculation is sent only when every view it needs can be read", () => {
    const all = guideFor(guideViewNames());
    expect(all).toContain(`## ${CALC_HEADING}`);
    for (const c of guideCalcs()) expect(all).toContain(`### ${c.title}
`);
    expect(all).not.toContain("(needs:");

    const producer = guideCalcs().find((c) => c.title === "Producer pay")!;
    const without = guideFor(guideViewNames().filter((v) => v !== "kill_adjustments"));
    expect(without).not.toContain("### Producer pay");
    expect(guideFor(producer.needs)).toContain("### Producer pay");

    expect(guideFor(["orders", "weeks"])).not.toContain(`## ${CALC_HEADING}`);
  });
});
