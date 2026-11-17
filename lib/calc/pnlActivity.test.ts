import { describe, expect, it } from "vitest";
import { describe as describeRow, describeEvent, groupEntries, rateAppliesTo, rateRange, rangeText, type AuditRow, type Names, type RateRow } from "./pnlActivity";

const names: Names = {
  product: (id) => ({ "leg": "Leg of Lamb" })[id] ?? id,
  customer: (id) => (id ? ({ pcc: "PCC" })[id] ?? id : "Everyone (default)"),
  producer: (id) => ({ eric: "Eric Freepons" })[id] ?? id,
  category: (id) => ({ c1: "Butcher (Mohawk)" })[id] ?? id,
  user: (id) => ({ u1: "Kathy Panner" })[id ?? ""] ?? "someone",
  sheet: (id) => (id === "s1" ? { label: "Eric Freepons, kill Nov 13", week: "2026-11-16" } : { label: "a weigh sheet", week: null }),
  expenseWeek: (id) => (id === "x1" ? "2026-11-16" : null),
};

let n = 0;
const row = (r: Partial<AuditRow>): AuditRow => ({
  id: ++n,
  table_name: "prices",
  row_id: "r",
  action: "insert",
  old_data: null,
  new_data: null,
  user_id: "u1",
  at: "2026-11-15T18:00:00Z",
  source: "Setup > Prices",
  ...r,
});

const current: RateRow[] = [
  { table: "prices", key: "leg|pcc", effective_from: "2026-10-08" },
  { table: "prices", key: "leg|pcc", effective_from: "2026-11-23" },
];

describe("P&L activity", () => {
  it("a price change shows old and new, and the weeks it applies to", () => {
    const e = describeRow(
      row({
        action: "update",
        old_data: { product_id: "leg", customer_id: "pcc", price: "9.5", effective_from: "2026-10-08", note: "" },
        new_data: { product_id: "leg", customer_id: "pcc", price: "10", effective_from: "2026-10-08", note: "" },
      }),
      names,
      current,
    )!;
    expect(e.title).toBe("Price: Leg of Lamb · PCC");
    expect(e.action).toBe("Changed");
    expect(e.who).toBe("Kathy Panner");
    expect(e.fields).toEqual([{ label: "Price", old: "$9.50", new: "$10.00" }]);
    expect(e.applies).toBe("Invoices dated Oct 8 to Nov 22");
    expect(e.week).toBeNull();
  });

  it("the latest rate applies from its date on", () => {
    expect(rangeText(rateRange("prices", { product_id: "leg", customer_id: "pcc", effective_from: "2026-11-23" }, current))).toBe("From Nov 23 on");
  });

  it("a price applies to a week when the invoice date falls in its range", () => {
    const d = { product_id: "leg", customer_id: "pcc", effective_from: "2026-10-08" };
    expect(rateAppliesTo("prices", d, current, "2026-11-16")).toBe(true); // invoices Nov 17
    expect(rateAppliesTo("prices", d, current, "2026-11-23")).toBe(false); // invoices Nov 24: the newer price
    expect(rateAppliesTo("prices", d, current, "2026-10-05")).toBe(false); // before it started
  });

  it("a producer rate applies to the kill days of the week", () => {
    const rates: RateRow[] = [{ table: "producer_rates", key: "eric", effective_from: "2026-11-13" }];
    const d = { producer_id: "eric", effective_from: "2026-11-13" };
    expect(rateAppliesTo("producer_rates", d, rates, "2026-11-16")).toBe(true); // kills Nov 12 to 18
    expect(rateAppliesTo("producer_rates", d, rates, "2026-11-09")).toBe(false);
  });

  it("an expense added belongs to its week", () => {
    const e = describeRow(
      row({ table_name: "pnl_expenses", new_data: { category_id: "c1", entry_date: "2026-11-16", week_id: "2026-11-16", amount: "4200", note: "" } }),
      names,
      [],
    )!;
    expect(e.title).toBe("Expense: Butcher (Mohawk)");
    expect(e.week).toBe("2026-11-16");
    expect(e.fields).toEqual([
      { label: "Category", new: "Butcher (Mohawk)" },
      { label: "Date", new: "Nov 16" },
      { label: "Amount", new: "$4,200.00" },
    ]);
    expect(e.applies).toBeNull();
  });

  it("voiding an adjustment says Voided, with why", () => {
    const before = { kind: "adjustment", line_key: "producer", side: "expense", amount: "-250", reason: "Dock", week_id: "2026-11-16", voided_at: null, void_reason: "" };
    const e = describeRow(
      row({ table_name: "pnl_adjustments", action: "update", old_data: before, new_data: { ...before, voided_at: "2026-11-16T20:00:00Z", void_reason: "Entered twice" } }),
      names,
      [],
    )!;
    expect(e.action).toBe("Voided");
    expect(e.title).toBe("Adjustment: Producer cost");
    expect(e.fields).toEqual([{ label: "Voided because", old: "", new: "Entered twice" }]);
  });

  it("a lamb weight belongs to its weigh sheet's week", () => {
    const e = describeRow(row({ table_name: "kill_lambs", action: "delete", old_data: { sheet_id: "s1", position: 4, carcass_lb: "71.5" } }), names, [])!;
    expect(e.title).toBe("Lamb weight: Eric Freepons, kill Nov 13");
    expect(e.action).toBe("Deleted");
    expect(e.week).toBe("2026-11-16");
    expect(e.fields).toEqual([
      { label: "Lamb #", old: "4" },
      { label: "Carcass lb", old: "71.50" },
    ]);
  });

  it("a change to nothing the P&L shows is left out", () => {
    const d = { product_id: "leg", customer_id: "pcc", price: "10", effective_from: "2026-10-08", note: "", created_by: "a" };
    expect(describeRow(row({ action: "update", old_data: d, new_data: { ...d, created_by: "b" } }), names, current)).toBeNull();
  });

  it("closes and reopens read plainly", () => {
    const e = describeEvent({ id: "1", week_id: "2026-11-09", action: "reopened", reason: "Mohawk bill came in", missing: [], by_name: "Lucas Nelson", at: "2026-11-20T18:00:00Z" });
    expect(e.title).toBe("Week of Nov 9");
    expect(e.action).toBe("Reopened");
    expect(e.fields).toEqual([{ label: "Reason", new: "Mohawk bill came in" }]);
  });

  it("groups a run of the same change by the same person", () => {
    const lamb = (i: number, at: string) =>
      describeRow(row({ table_name: "kill_lambs", new_data: { sheet_id: "s1", position: i, carcass_lb: "70" }, at, source: "weigh sheet" }), names, [])!;
    const other = describeRow(row({ table_name: "pnl_income", new_data: { customer_name: "Farm stand", amount: "50", week_id: "2026-11-16" }, at: "2026-11-15T19:00:00Z" }), names, [])!;
    const groups = groupEntries([lamb(1, "2026-11-15T18:00:00Z"), lamb(2, "2026-11-15T18:01:00Z"), lamb(3, "2026-11-15T18:02:00Z"), other, lamb(4, "2026-11-15T20:00:00Z")]);
    expect(groups.map((g) => g.entries.length)).toEqual([1, 1, 3]);
    expect(groups[1].entries[0].title).toBe("Other income: Farm stand");
  });
});
