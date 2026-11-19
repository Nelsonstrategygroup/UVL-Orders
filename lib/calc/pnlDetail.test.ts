import { describe, expect, it } from "vitest";
import { sheetPay, weekPay, type KillSheet } from "./lambCost";
import { invoiceIncome, weekPnl, type CategoryRate, type ExpenseCategory, type ExpenseEntry, type PackedLine } from "./pnl";
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
const cat = (id: string, name: string, group: ExpenseCategory["group_name"], method: ExpenseCategory["method"], sort: number, more: Partial<ExpenseCategory> = {}): ExpenseCategory => ({
  id,
  name,
  active: true,
  sort,
  group_name: group,
  method,
  income_base: "all",
  base_category_ids: [],
  note: "",
  ...more,
});
const categories: ExpenseCategory[] = [
  cat("prod", "Producer pay", "Cost of product", "weigh_sheets", 10),
  cat("c1", "Processing, Mohawk", "Cost of product", "entered", 20),
  cat("ins", "Truck, insurance", "Delivery", "fixed_weekly", 140),
  cat("mkt", "Marketing", "Operating", "percent_income", 300),
  cat("alb", "ALB/OSC assessments", "Operating", "per_lamb", 310),
  cat("c2", "Labor, other", "Operating", "entered", 320),
];
const rate = (category_id: string, effective_from: string, r: Partial<CategoryRate>): CategoryRate => ({
  id: `${category_id}-${effective_from}`,
  category_id,
  effective_from,
  amount: null,
  percent: null,
  parts: [],
  note: "",
  ...r,
});
const rates: CategoryRate[] = [
  rate("alb", "2026-10-01", { amount: "1.8000" }),
  rate("mkt", "2026-10-01", { percent: "4.0000" }),
  rate("ins", "2026-10-08", {
    parts: [
      { label: "Weekly amount", amount: 60, per: "week" },
      { label: "Weekly amount", amount: 15.69, per: "week" },
      { label: "Yearly amount", amount: 1698, per: "year" },
      { label: "Yearly amount", amount: 110, per: "year" },
    ],
  }),
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
const p = weekPnl({ week: WEEK, pay, income: [], expenses, categories, rates, invoices: ii, lbShipped: "20.50" });
const input: DetailInput = {
  week: WEEK,
  p,
  ii,
  pays,
  pay,
  settings: [{ id: "s", effective_from: "2026-10-01", base_rate: "3.0000", live_factor: "2.0200", note: "" }],
  rates: [],
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
  it("shows a carcass weights sheet's pay step by step, with the rate and where it came from", () => {
    const s = line("category:prod").items[0];
    expect(s.label).toBe("Eric Freepons · kill Friday, Nov 13");
    expect(s.amount).toBe("$756.44");
    expect(s.math).toEqual([
      "124 lb × 2.02 × $3.00 = $751.44, setting from Oct 1",
      "2 lambs · 124.00 carcass lb",
      "× 2.02 live factor = 250.48 live lb",
      "× $3.00 per live lb = $751.44",
      "+ Lamb #2: Premium $5.00 = $5.00 (well finished)",
      "= $756.44",
      "Rounded once to the cent: $756.44",
      "Rate $3.00 per live lb × 2.02: Setup from Oct 1, 2026.",
    ]);
    expect(s.links).toEqual([{ label: "Carcass weights and photo", href: "/carcass-weights/s1" }]);
  });
  it("says when a sheet keeps a rate Setup no longer gives", () => {
    const other = pnlDetails({ ...input, settings: [{ id: "s", effective_from: "2026-10-01", base_rate: "3.2500", live_factor: "2.0200", note: "" }] });
    expect(other.find((x) => x.key === "category:prod")!.items[0].math!.at(-1)).toBe(
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
  it("shows per-lamb and percent categories with their numbers and dates", () => {
    expect(line("category:alb").how).toEqual([
      "Lambs on this week's carcass weights × $1.80 a lamb (P&L Setup, from Oct 1, 2026).",
      "2 lambs × $1.80 = $3.60",
    ]);
    expect(line("category:mkt").how[1]).toBe("4% × $331.08 projected income = $13.24");
    expect(line("category:mkt").title).toBe("Marketing (projected)");
  });
  it("shows a fixed weekly amount from its parts", () => {
    expect(line("category:ins").how).toEqual([
      "The same amount every week, no-processing weeks too (P&L Setup, from Oct 8, 2026).",
      "$60.00 + $15.69 + ($1,698.00 + $110.00) ÷ 52 = $110.46",
    ]);
    expect(line("category:ins").items.map((i) => `${i.label} ${i.amount} ${i.note}`)).toEqual([
      "Weekly amount $60.00 a week",
      "Weekly amount $15.69 a week",
      "Yearly amount $1,698.00 a year, ÷ 52",
      "Yearly amount $110.00 a year, ÷ 52",
    ]);
  });
  it("lists each expense with who entered it", () => {
    const labor = line("category:c2");
    expect(labor.how).toEqual(["Expenses entered on the Weekly P&L, dated in this week.", "$120.00 = $120.00"]);
    expect(labor.items[0].note).toBe("Packing help · Entered by Kathy Panner, Nov 16, 2:10 PM");
  });
  it("totals each group", () => {
    expect(line("group:Cost of product").how[1]).toBe("$756.44 + $0.00 = $756.44");
    expect(line("group:Operating").how[1]).toBe("$13.24 + $3.60 + $120.00 = $136.84");
  });
  it("works out the results with their numbers", () => {
    expect(line("total").how[1]).toBe("$756.44 + $110.46 + $136.84 + $0.00 = $1,003.74");
    expect(line("profit").how[1]).toBe("$331.08 − $1,003.74 = -$672.66");
    expect(line("perhead").how[1]).toBe("-$672.66 ÷ 2 lambs = -$336.33");
    expect(line("deliverylb").how[1]).toBe("$110.46 ÷ 20.50 lb = $5.3883 a lb");
  });
});

describe("P&L checks", () => {
  it("lists what's missing", () => {
    expect(pnlChecks({ p, ii, lambCount: 3 }).map((c) => c.key)).toEqual(["invoices", "notpacked", "lambs", "butcher"]);
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
    const pp = weekPnl({ week: WEEK, pay, income: [], expenses: all, categories, rates, invoices: done });
    expect(pnlChecks({ p: pp, ii: done, lambCount: 2 })).toEqual([]);
  });
  it("says when there's no carcass weights, a price is missing, or a category has no rate", () => {
    const none = weekPnl({ week: WEEK, pay: weekPay([]), income: [], expenses, categories, rates, invoices: ii });
    const priced = invoiceIncome({ week: WEEK, locations: [{ id: "emerson", name: "Emerson", chainId: null }], invoices: [], packed, prices: [], charges: [], productName: () => "Racks" });
    expect(pnlChecks({ p: none, ii: priced, lambCount: null }).map((c) => c.key)).toEqual(["invoices", "price:Racks", "sheet"]);
    const early = weekPnl({ week: "2026-09-28", pay, income: [], expenses: [{ ...expenses[0], category_id: "c1" }], categories, rates, invoices: ii });
    expect(pnlChecks({ p: early, ii, lambCount: 2 }).map((c) => c.text).slice(-3)).toEqual([
      "Truck, insurance has no rate for this week.",
      "Marketing has no rate for this week.",
      "ALB/OSC assessments has no rate for this week.",
    ]);
  });
});

describe("adjustments in the line detail (stage B)", () => {
  const adj = (id: string, kind: "adjustment" | "one_off", line_key: string | null, side: "income" | "expense", amount: string, voided = false) => ({
    id,
    week_id: WEEK,
    kind,
    line_key,
    side,
    label: kind === "one_off" ? "Freight bill (Heritage)" : "",
    amount,
    reason: kind === "one_off" ? "Bill #4471" : "Dock: 2 lambs condemned",
    attachment_path: id === "a1" ? "2026-11-16/adjustments/x.pdf" : null,
    attachment_name: id === "a1" ? "dock.pdf" : "",
    created_by_name: "Kathy Panner",
    created_at: "2026-11-16T22:10:00Z",
    voided_at: voided ? "2026-11-17T18:00:00Z" : null,
    voided_by_name: voided ? "Lucas Nelson" : "",
    void_reason: voided ? "Entered twice" : "",
  });
  const adjustments = [
    adj("a1", "adjustment", "category:prod", "expense", "-50"),
    adj("a2", "adjustment", "category:prod", "expense", "-50", true),
    adj("a3", "one_off", null, "expense", "412.50"),
  ];
  const pa = weekPnl({ week: WEEK, pay, income: [], expenses, categories, rates, invoices: ii, adjustments });
  const da = pnlDetails({ ...input, p: pa });
  const prod = da.find((x) => x.key === "category:prod")!;
  it("shows calculated + adjustments = total", () => {
    expect(prod.amount).toBe("$706.44");
    expect(prod.how.at(-1)).toBe("Calculated $756.44 − adjustments $50.00 = $706.44");
  });
  it("lists each adjustment with who, when and the file; voided ones marked", () => {
    const items = prod.items.filter((i) => i.tag === "Adjustment" || i.tag === "Voided");
    expect(items[0]).toMatchObject({ label: "Dock: 2 lambs condemned", amount: "-$50.00", files: [{ path: "2026-11-16/adjustments/x.pdf", name: "dock.pdf" }] });
    expect(items[0].note).toBe("Added by Kathy Panner, Nov 16, 2:10 PM");
    expect(items[1]).toMatchObject({ tag: "Voided", voided: true });
    expect(items[1].note).toBe("Added by Kathy Panner, Nov 16, 2:10 PM · Voided by Lucas Nelson, Nov 17, 10:00 AM: Entered twice");
  });
  it("lists one-off expense lines on their own", () => {
    const e = da.find((x) => x.key === "oneoff-expense")!;
    expect(e.items.at(-1)).toMatchObject({ label: "Freight bill (Heritage)", tag: "One-off expense", amount: "$412.50", math: ["Reason: Bill #4471"] });
    expect(e.amount).toBe("$412.50");
  });
});
