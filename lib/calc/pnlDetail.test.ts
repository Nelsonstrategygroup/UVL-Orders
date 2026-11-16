import { describe, expect, it } from "vitest";
import { sheetPay, weekPay, type KillSheet } from "./lambCost";
import { invoiceIncome, weekPnl, type ExpenseCategory, type ExpenseEntry, type LambCharge, type PackedLine, type PercentCharge } from "./pnl";
import { pnlChecks, pnlDetails, type DetailInput } from "./pnlDetail";

const WEEK = "2026-11-16";
const sheet: KillSheet = {
  id: "s1",
  producer_id: "eric",
  kill_date: "2026-11-13",
  week_id: WEEK,
  base_rate: "3.0000",
  live_factor: "2.0200",
  rate_source: "base",
  notes: "",
};
// 60 + 64 = 124 carcass lb; x 2.02 = 250.48 live lb; x $3.00 = $751.44
const lambs = [
  { id: "a", sheet_id: "s1", position: 1, carcass_lb: "60" },
  { id: "b", sheet_id: "s1", position: 2, carcass_lb: "64" },
];
const pays = [sheetPay(sheet, lambs, [{ id: "x", sheet_id: "s1", lamb_id: "b", kind: "dollars", amount: "5", reason: "premium", note: "well finished" }])];
const pay = weekPay(pays);
const lambCharges: LambCharge[] = [{ id: "l1", name: "ALB/OSC", effective_from: "2026-10-01", per_lamb: "1.8000", note: "" }];
const percentCharges: PercentCharge[] = [{ id: "p1", name: "Marketing", effective_from: "2026-10-01", percent: "4.0000", note: "" }];
const categories: ExpenseCategory[] = [
  { id: "c1", name: "Butcher (Mohawk)", active: true, sort: 1 },
  { id: "c2", name: "Labor", active: true, sort: 2 },
];
const expenses: ExpenseEntry[] = [
  { id: "e1", entry_date: "2026-11-16", week_id: WEEK, category_id: "c2", amount: "120", note: "Packing help", created_by: "u1", created_at: "2026-11-16T22:10:00Z" },
];
const prices = [{ id: "p", product_id: "racks", customer_id: null, price: "16.15", effective_from: "2026-10-08", note: "" }];
const packed: PackedLine[] = [
  {
    customer_id: "emerson",
    kind: "packed",
    product_id: "racks",
    description: "Racks",
    ordered_qty: "20",
    ordered_unit: null,
    boxes: 2,
    quantity: "20.5",
    price_unit: "lb",
    not_on_order: false,
    sort: 1,
    detail: null,
  },
];
const ii = invoiceIncome({
  week: WEEK,
  locations: [
    { id: "emerson", name: "Emerson", chainId: null },
    { id: "keycity", name: "Key City", chainId: null },
  ],
  invoices: [],
  packed,
  prices,
  charges: [],
  productName: (id) => id,
});
const p = weekPnl({ week: WEEK, pay, income: [], expenses, categories, lambCharges, percentCharges, invoices: ii });
const input: DetailInput = {
  week: WEEK,
  p,
  ii,
  pays,
  pay,
  settings: [{ id: "s", effective_from: "2026-10-01", base_rate: "3.0000", live_factor: "2.0200", note: "" }],
  rates: [],
  lambCharges,
  percentCharges,
  income: [],
  expenses,
  categories,
  prices,
  charges: [],
  boxes: [
    { customer_id: "emerson", product_id: "racks", weight: "10.25" },
    { customer_id: "emerson", product_id: "racks", weight: "10.25" },
  ],
  producerName: () => "Eric Freepons",
  lead: (id) => id,
  userName: (id) => (id === "u1" ? "Kathy Panner" : "Unknown"),
};
const d = pnlDetails(input);
const line = (key: string) => d.find((x) => x.key === key)!;

describe("P&L line detail", () => {
  it("shows a weigh sheet's pay step by step, with the rate and where it came from", () => {
    const s = line("producer").items[0];
    expect(s.label).toBe("Eric Freepons · kill Friday, Nov 13");
    expect(s.amount).toBe("$756.44");
    expect(s.math).toEqual([
      "2 lambs · 124.00 carcass lb",
      "× 2.02 live factor = 250.48 live lb",
      "× $3.00 per live lb = $751.44",
      "+ Lamb #2: Premium $5.00 = $5.00 (well finished)",
      "= $756.44",
      "Rounded once to the cent: $756.44",
      "Rate $3.00 per live lb × 2.02: Setup from Oct 1, 2026.",
    ]);
    expect(s.links).toEqual([{ label: "Weigh sheet and photo", href: "/weigh-sheets/s1" }]);
  });
  it("says when a sheet keeps a rate Setup no longer gives", () => {
    const other = pnlDetails({ ...input, settings: [{ id: "s", effective_from: "2026-10-01", base_rate: "3.2500", live_factor: "2.0200", note: "" }] });
    expect(other.find((x) => x.key === "producer")!.items[0].math!.at(-1)).toBe(
      "Rate $3.00 per live lb × 2.02, saved on the sheet (Setup from Oct 1, 2026 says otherwise; the sheet keeps its own).",
    );
  });
  it("shows packed income as weight × price, with the price's source and the boxes", () => {
    const em = line("income").items[0];
    expect(em).toMatchObject({ label: "Emerson", tag: "Packed", amount: "$331.08" });
    expect(em.items![0]).toMatchObject({
      label: "Racks",
      math: ["20.50 lb × $16.15/lb = $331.08 (default price, from Oct 8, 2026)"],
      note: "2 boxes: 10.25 + 10.25 lb",
    });
    expect(line("income").items.at(-1)).toMatchObject({ label: "Not packed yet", note: "Key City" });
    expect(line("income").how.at(-1)).toBe("Finalized $0.00 + packed, not invoiced $331.08 = $331.08");
    expect(line("income").title).toBe("Income (projected)");
  });
  it("shows per-lamb and percent charges with their numbers and dates", () => {
    expect(line("charge:ALB/OSC").how).toEqual([
      "Lambs on this week's weigh sheets × $1.80 a lamb (P&L Setup, from Oct 1, 2026).",
      "2 lambs × $1.80 = $3.60",
    ]);
    expect(line("charge:Marketing").how[1]).toBe("4% × $331.08 projected income = $13.24");
  });
  it("lists each expense with who entered it", () => {
    const labor = line("expenses").items[0];
    expect(labor.label).toBe("Labor");
    expect(labor.items![0].note).toBe("Packing help · Entered by Kathy Panner, Nov 16, 2:10 PM");
  });
  it("works out the results with their numbers", () => {
    expect(line("total").how[1]).toBe("$756.44 + $16.84 + $120.00 = $893.28");
    expect(line("profit").how[1]).toBe("$331.08 − $893.28 = -$562.20");
    expect(line("perhead").how[1]).toBe("-$562.20 ÷ 2 lambs = -$281.10");
  });
});

describe("P&L checks", () => {
  it("lists what's missing", () => {
    expect(pnlChecks({ p, ii, lambCount: 3, categories, expenses }).map((c) => c.key)).toEqual(["invoices", "notpacked", "lambs", "butcher"]);
  });
  it("is empty when nothing is missing", () => {
    const done = invoiceIncome({
      week: WEEK,
      locations: [{ id: "emerson", name: "Emerson", chainId: null }],
      invoices: [{ customer_id: "emerson", status: "finalized", total: "331.08", invoice_date: "2026-11-17" }],
      packed: [],
      prices,
      charges: [],
      productName: (id) => id,
    });
    const all = [...expenses, { ...expenses[0], id: "e2", category_id: "c1" }];
    const pp = weekPnl({ week: WEEK, pay, income: [], expenses: all, categories, lambCharges, percentCharges, invoices: done });
    expect(pnlChecks({ p: pp, ii: done, lambCount: 2, categories, expenses: all })).toEqual([]);
  });
  it("says when there's no weigh sheet, and a price is missing", () => {
    const none = weekPnl({ week: WEEK, pay: weekPay([]), income: [], expenses, categories, lambCharges, percentCharges, invoices: ii });
    const priced = invoiceIncome({ week: WEEK, locations: [{ id: "emerson", name: "Emerson", chainId: null }], invoices: [], packed, prices: [], charges: [], productName: () => "Racks" });
    const keys = pnlChecks({ p: none, ii: priced, lambCount: null, categories, expenses }).map((c) => c.key);
    expect(keys).toEqual(["invoices", "price:Racks", "sheet", "butcher"]);
  });
});
