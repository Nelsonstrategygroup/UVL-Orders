import { describe, expect, it } from "vitest";
import { centsText, sheetPay, weekPay, type KillSheet } from "./lambCost";
import {
  invoiceIncome,
  parseMoney,
  rateOn,
  weekPnl,
  weeklyFromParts,
  type CategoryRate,
  type ExpenseCategory,
  type ExpenseEntry,
  type IncomeEntry,
  type PackedLine,
  type PnlAdjustment,
} from "./pnl";
import { freezerIn, freezerOut, type ValuedBox, type ValuedTake } from "./freezer";

const WEEK = "2026-11-16";
const sheet: KillSheet = {
  id: "s1",
  producer_id: "p1",
  kill_date: "2026-11-13",
  week_id: WEEK,
  base_rate: "3.0000",
  live_factor: "2.0200",
  rate_source: "base",
  notes: "",
};
// 60 + 64 = 124 carcass lb; x 2.02 = 250.48 live lb; x $3.00 = $751.44
const pay = weekPay([
  sheetPay(
    sheet,
    [
      { id: "a", sheet_id: "s1", position: 1, carcass_lb: "60" },
      { id: "b", sheet_id: "s1", position: 2, carcass_lb: "64" },
    ],
    [],
  ),
]);
const noSheets = weekPay([]);

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
  cat("c3", "Old freight", "Operating", "entered", 330, { active: false }),
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
  rate("alb", "2027-01-04", { amount: "2.0000" }),
  rate("mkt", "2026-10-01", { percent: "4.0000" }),
  rate("ins", "2026-10-08", {
    parts: [
      { label: "Weekly", amount: 60, per: "week" },
      { label: "Weekly", amount: 15.69, per: "week" },
      { label: "Yearly", amount: 1698, per: "year" },
      { label: "Yearly", amount: 110, per: "year" },
    ],
  }),
];
const exp = (id: string, category_id: string, amount: string): ExpenseEntry => ({ id, entry_date: "2026-11-13", week_id: WEEK, category_id, amount, note: "" });
const inc = (id: string, customer_id: string | null, customer_name: string, amount: string): IncomeEntry => ({
  id,
  entry_date: "2026-11-17",
  week_id: WEEK,
  customer_id,
  customer_name,
  amount,
  note: "",
});
const line = (p: ReturnType<typeof weekPnl>, id: string) => p.categories.find((l) => l.categoryId === id)!;

describe("parseMoney", () => {
  it("reads typed amounts", () => {
    expect(parseMoney("$1,250.00")).toBe("1250");
    expect(parseMoney("980.5")).toBe("980.5");
    expect(parseMoney(".75")).toBe("0.75");
    expect(parseMoney("-25")).toBe("-25");
    expect(parseMoney("-$25.10")).toBe("-25.1");
  });
  it("refuses what isn't money, or 0", () => {
    expect(parseMoney("0")).toBeNull();
    expect(parseMoney("12.345")).toBeNull();
    expect(parseMoney("ten")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
});

describe("category rates", () => {
  it("takes the newest rate on or before the week", () => {
    expect(rateOn(rates, "alb", WEEK)!.amount).toBe("1.8000");
    expect(rateOn(rates, "alb", "2027-01-04")!.amount).toBe("2.0000");
    expect(rateOn(rates, "alb", "2026-09-28")).toBeNull();
  });
  it("builds a fixed weekly amount from weekly and yearly parts", () => {
    // 60 + 15.69 + (1,698 + 110) / 52 = 75.69 + 34.769... = 110.46
    expect(weeklyFromParts(rateOn(rates, "ins", WEEK)!.parts)).toEqual({ cents: BigInt(11046), weekly: BigInt(7569), yearly: BigInt(180800) });
  });
});

describe("weekPnl", () => {
  const full = weekPnl({
    week: WEEK,
    pay,
    income: [inc("i1", "k1", "PCC Fremont", "980.50"), inc("i2", "k1", "PCC Fremont", "100"), inc("i3", "k2", "Corfini", "0.01")],
    expenses: [exp("e1", "c1", "1250"), exp("e2", "c2", "150"), exp("e3", "c2", "50"), exp("e4", "c3", "10")],
    categories,
    rates,
    lbShipped: "250.00",
  });

  it("adds income up by customer", () => {
    expect(full.income.map((r) => `${r.name} ${r.entries} ${centsText(r.cents)}`)).toEqual(["Corfini 1 $0.01", "PCC Fremont 2 $1,080.50"]);
    expect(centsText(full.incomeCents)).toBe("$1,080.51");
  });

  it("works out each category by its method, retired ones with entries included", () => {
    expect(full.categories.map((l) => `${l.name} ${l.total == null ? "-" : centsText(l.total)}`)).toEqual([
      "Producer pay $751.44",
      "Processing, Mohawk $1,250.00",
      "Truck, insurance $110.46",
      "Marketing $43.22", // 4% × 1,080.51 = 43.2204
      "ALB/OSC assessments $3.60", // 2 lambs × 1.80
      "Labor, other $200.00",
      "Old freight $10.00",
    ]);
    expect(line(full, "mkt")).toMatchObject({ base: BigInt(108051), rate: { percent: "4.0000" } });
  });

  it("totals each group", () => {
    expect(full.groups.map((g) => `${g.name} ${centsText(g.total)}`)).toEqual(["Cost of product $2,001.44", "Delivery $110.46", "Operating $256.82"]);
  });

  it("totals, profit, per head, per carcass lb, and delivery per lb", () => {
    expect(centsText(full.totalExpense!)).toBe("$2,368.72");
    expect(centsText(full.profit!)).toBe("-$1,288.21");
    expect(centsText(full.profitPerHead!)).toBe("-$644.11"); // -644.105 rounds away from zero
    expect(full.costPerCarcassLb).toBe(BigInt(191026)); // 2,368.72 / 124 = 19.10258...
    expect(full.netDelivery).toBe(BigInt(11046));
    expect(full.deliveryPerLb).toBe(BigInt(4418)); // 110.46 / 250 = 0.44184
  });

  it("says what's missing instead of showing a misleading number", () => {
    const noIncome = weekPnl({ week: WEEK, pay, income: [], expenses: [], categories, rates });
    expect(noIncome.hasIncome).toBe(false);
    expect(line(noIncome, "mkt")).toMatchObject({ calc: null, total: null, waiting: "No income yet." });
    expect(noIncome.totalExpense).not.toBeNull();
    expect(noIncome.profit).toBeNull();
    expect(noIncome.profitPerHead).toBeNull();
    expect(noIncome.costPerCarcassLb).toBeNull();

    const noSheet = weekPnl({ week: WEEK, pay: noSheets, income: [inc("i1", "k1", "PCC", "100")], expenses: [], categories, rates });
    expect(noSheet.hasSheets).toBe(false);
    expect(line(noSheet, "prod").total).toBeNull();
    expect(line(noSheet, "alb").total).toBeNull();
    expect(line(noSheet, "mkt").total).toBe(BigInt(400));
    expect(noSheet.totalExpense).toBeNull();
    expect(noSheet.profit).toBeNull();
  });

  it("counts fixed weekly amounts in a week with no processing", () => {
    const off = weekPnl({ week: WEEK, pay: noSheets, income: [], expenses: [], categories, rates, noProcessing: true });
    expect(line(off, "prod").total).toBe(BigInt(0));
    expect(line(off, "alb").total).toBe(BigInt(0));
    expect(off.totalExpense).toBe(BigInt(11046));
    expect(off.profit).toBe(BigInt(-11046));
    expect(off.profitPerHead).toBeNull();
  });

  it("uses sales only when the base is set to sales", () => {
    const sales = categories.map((c) => (c.id === "mkt" ? { ...c, income_base: "sales" as const } : c));
    expect(line(weekPnl({ week: WEEK, pay, income: [inc("i1", "k1", "PCC", "100")], expenses: [], categories: sales, rates }), "mkt")).toMatchObject({
      base: BigInt(0),
      total: BigInt(0),
    });
  });

  it("works out a percent of other categories on their totals", () => {
    const withTax = [...categories, cat("saif", "Truck, payroll taxes: SAIF", "Delivery", "percent_category", 110, { base_category_ids: ["c2"] })];
    const p = weekPnl({
      week: WEEK,
      pay,
      income: [],
      expenses: [exp("e2", "c2", "150")],
      categories: withTax,
      rates: [...rates, rate("saif", "2026-10-08", { percent: "10" })],
    });
    expect(line(p, "saif")).toMatchObject({ base: BigInt(15000), calc: BigInt(1500), total: BigInt(1500) });
  });

  it("says when a category has no rate", () => {
    const p = weekPnl({ week: "2026-09-28", pay, income: [], expenses: [], categories, rates });
    expect(line(p, "alb")).toMatchObject({ calc: BigInt(0), waiting: "No rate for this week (P&L Setup)." });
  });
});

describe("income from invoices and packing (Lucas, 11/15/26)", () => {
  const W = "2026-11-09";
  const price = (product_id: string, v: string, customer_id: string | null = null) => ({
    id: `${product_id}-${customer_id}`,
    product_id,
    customer_id,
    price: v,
    effective_from: "2026-10-08",
    note: "",
  });
  const prices = [price("racks", "16.15"), price("racks", "16", "pcc"), price("carcass", "6")];
  const charges = [{ ...price("carcass", "40"), name: "Mohawk charge, shrouded carcass" }];
  const packed = (customer_id: string, product_id: string, quantity: string | null, kind: "packed" | "shorted" = "packed"): PackedLine => ({
    customer_id,
    kind,
    product_id,
    description: product_id,
    ordered_qty: "1",
    ordered_unit: null,
    boxes: kind === "packed" ? 1 : 0,
    quantity,
    price_unit: product_id === "sticks" ? "case" : "lb",
    not_on_order: false,
    sort: 1,
    detail: null,
  });
  const locations = [
    { id: "emerson", name: "Emerson", chainId: null },
    { id: "pcc10", name: "PCC: #10 Issaquah", chainId: "pcc" },
    { id: "newport", name: "Newport Ave", chainId: null },
    { id: "keycity", name: "Key City", chainId: null },
  ];
  const r = invoiceIncome({
    week: W,
    locations,
    invoices: [{ customer_id: "newport", status: "finalized", total: "1000.00", invoice_date: "2026-11-10" }],
    packed: [
      packed("emerson", "carcass", "62"),
      packed("pcc10", "racks", "10"),
      packed("pcc10", "sticks", "1"),
      packed("pcc10", "legs", null, "shorted"),
      packed("keycity", "racks", null, "shorted"),
      // Ignored: Newport is finalized, so its invoice total is used.
      packed("newport", "racks", "99"),
    ],
    prices,
    charges,
    productName: (id) => (id === "sticks" ? "Pepper Sticks" : id),
  });
  const row = (id: string) => r.rows.find((x) => x.customerId === id)!;
  it("uses the invoice total once finalized", () => {
    expect(row("newport")).toMatchObject({ status: "finalized", cents: BigInt(100000) });
    expect(r.finalizedCents).toBe(BigInt(100000));
  });
  it("prices what's packed as the invoice will, Mohawk charge included", () => {
    expect(row("emerson")).toMatchObject({ status: "packed", cents: BigInt(41200) }); // 62 x 6.00 + 40
    expect(row("pcc10")).toMatchObject({ status: "packed", cents: BigInt(16000), unpackedLines: 1 }); // 10 x 16.00 (PCC)
    expect(r.packedCents).toBe(BigInt(57200));
  });
  it("leaves out and lists packed products with no price", () => {
    expect(row("pcc10").priceNeeded).toEqual(["Pepper Sticks"]);
    expect(r.priceNeeded).toEqual([{ product: "Pepper Sticks", locations: ["PCC: #10 Issaquah"] }]);
  });
  it("counts nothing for a location not packed", () => {
    expect(row("keycity")).toMatchObject({ status: "not_packed", cents: null, unpackedLines: 1 });
    expect(r.notPacked.map((x) => x.name)).toEqual(["Key City"]);
    expect(r).toMatchObject({ projected: true, finalizedCount: 1, packedCount: 2 });
  });
  it("adds into the P&L as projected income, with entered income as other income", () => {
    const p = weekPnl({
      week: W,
      pay,
      income: [inc("o1", null, "Farm stand", "50")],
      expenses: [],
      categories,
      rates,
      invoices: r,
    });
    expect(p.incomeCents).toBe(BigInt(100000 + 57200 + 5000));
    expect(p.otherCents).toBe(BigInt(5000));
    expect(p.projected).toBe(true);
    expect(p.hasIncome).toBe(true);
  });
  it("is final once every packed location is finalized", () => {
    const done = invoiceIncome({
      week: W,
      locations: [locations[2]],
      invoices: [{ customer_id: "newport", status: "sent", total: "1000.00", invoice_date: "2026-11-10" }],
      packed: [],
      prices,
      charges,
      productName: (id) => id,
    });
    expect(done.projected).toBe(false);
    expect(weekPnl({ week: W, pay, income: [], expenses: [], categories,
      rates, invoices: done }).projected).toBe(false);
  });
  it("counts a stand-alone sale once finalized, as its own row, never as projected (Lucas, 11/20/26)", () => {
    const withSales = invoiceIncome({
      week: W,
      locations: [locations[2]],
      invoices: [
        { id: "n1", customer_id: "newport", status: "finalized", total: "1000.00", invoice_date: "2026-11-10" },
        // A finalized sale for Newport, beside its weekly invoice.
        { id: "s1", number: "3005-NEWP-S1", customer_id: "newport", status: "finalized", total: "96.00", invoice_date: "2026-11-11", sale_no: 1 },
        // A sale to someone with no order this week.
        { id: "s2", number: "3005-FARM-S1", customer_id: "farm", status: "sent", total: "20.50", invoice_date: "2026-11-12", sale_no: 1 },
        // Draft and void sales count for nothing.
        { id: "s3", number: "3005-NEWP-S2", customer_id: "newport", status: "draft", total: null, invoice_date: "2026-11-12", sale_no: 2 },
        { id: "s4", number: "3005-NEWP-S3", customer_id: "newport", status: "void", total: "50.00", invoice_date: "2026-11-12", sale_no: 3 },
      ],
      packed: [],
      prices,
      charges,
      productName: (id) => id,
      nameOf: (id) => (id === "farm" ? "Farm Store" : id),
    });
    expect(withSales.rows.find((x) => x.customerId === "newport" && !x.sale)).toMatchObject({ status: "finalized", cents: BigInt(100000), invoiceId: "n1" });
    expect(withSales.rows.filter((x) => x.sale).map((x) => [x.name, x.cents])).toEqual([
      ["Newport Ave, sale 3005-NEWP-S1", BigInt(9600)],
      ["Farm Store, sale 3005-FARM-S1", BigInt(2050)],
    ]);
    expect(withSales.finalizedCents).toBe(BigInt(100000 + 9600 + 2050));
    expect(withSales.projected).toBe(false);
  });
  it("has no income before anything is packed", () => {
    const none = invoiceIncome({ week: W, locations: [locations[3]], invoices: [], packed: [packed("keycity", "racks", null, "shorted")], prices, charges, productName: (id) => id });
    expect(weekPnl({ week: W, pay, income: [], expenses: [], categories,
      rates, invoices: none }).hasIncome).toBe(false);
  });
});

describe("adjustments and one-off lines (Lucas, 11/15/26)", () => {
  const a = (id: string, kind: "adjustment" | "one_off", line_key: string | null, side: "income" | "expense", amount: string, voided = false): PnlAdjustment => ({
    id,
    week_id: WEEK,
    kind,
    line_key,
    side,
    label: kind === "one_off" ? `One-off ${id}` : "",
    amount,
    reason: "test",
    attachment_path: null,
    attachment_name: "",
    created_by_name: "Kathy",
    created_at: "2026-11-16T20:00:00Z",
    voided_at: voided ? "2026-11-17T20:00:00Z" : null,
    voided_by_name: voided ? "Kathy" : "",
    void_reason: voided ? "twice" : "",
  });
  const base = { week: WEEK, pay, income: [inc("i1", "k1", "PCC Fremont", "1000")], expenses: [exp("e1", "c2", "100")], categories, rates };
  const p = weekPnl({
    ...base,
    adjustments: [
      a("1", "adjustment", "category:prod", "expense", "-50"),
      a("2", "adjustment", "category:prod", "expense", "-999", true), // voided: counts for nothing
      a("3", "adjustment", "income", "income", "25"),
      a("4", "one_off", null, "income", "75"),
      a("5", "adjustment", "category:alb", "expense", "1.80"),
      a("6", "adjustment", "category:c1", "expense", "300"),
      a("7", "one_off", null, "expense", "412.50"),
      a("8", "adjustment", "producer", "expense", "-10"), // made before categories: still producer pay
    ],
  });
  it("adds each line's adjustments to what's calculated, voided ones left out", () => {
    expect(line(p, "prod")).toMatchObject({ calc: BigInt(75144), adj: BigInt(-6000), total: BigInt(69144) });
    expect(p).toMatchObject({ incomeCalc: BigInt(100000), incomeAdj: BigInt(2500), oneOffIncomeCents: BigInt(7500), incomeCents: BigInt(110000) });
    expect(line(p, "alb")).toMatchObject({ calc: BigInt(360), adj: BigInt(180), total: BigInt(540) });
  });
  it("works marketing out on income after adjustments and one-off income", () => {
    expect(line(p, "mkt")).toMatchObject({ base: BigInt(110000), calc: BigInt(4400), total: BigInt(4400) });
  });
  it("adjusts a category with no entries, and adds one-off expenses", () => {
    expect(line(p, "c1")).toMatchObject({ entered: BigInt(0), adj: BigInt(30000), total: BigInt(30000) });
    expect(line(p, "c2")).toMatchObject({ entered: BigInt(10000), total: BigInt(10000) });
    expect(p.oneOffExpenseCents).toBe(BigInt(41250));
  });
  it("carries the totals through to profit", () => {
    const expected = BigInt(69144 + 30000 + 11046 + 4400 + 540 + 10000 + 41250);
    expect(p.totalExpense).toBe(expected);
    expect(p.profit).toBe(BigInt(110000) - expected);
  });
  it("is unchanged with no adjustments", () => {
    const q = weekPnl(base);
    expect(line(q, "prod").total).toBe(BigInt(75144));
    expect(q.incomeCents).toBe(BigInt(100000));
    expect(q.adjustments).toEqual([]);
  });
});

describe("Into freezer and Out of freezer (Kathy's rule, 11/20/26)", () => {
  // The Emerson Mixed Shanks box: 32.6 lb x 90% x $7.55 = $221.52.
  const box: ValuedBox = {
    id: "b1",
    product_id: "shanks",
    qty: 16,
    weight_lb: 32.6,
    added_on: "2026-11-12",
    week_id: "2026-11-09",
    counts_as_income: true,
    reason: "leftover",
    serial: "2631310052",
    price: "7.5500",
    price_unit: "lb",
    percent: "90",
    value: "221.52",
    note: "",
  };
  const take: ValuedTake = { id: "t1", box_id: "b1", qty: 16, taken_on: "2026-11-16", week_id: WEEK, reason: "packed", counts_in_pnl: true };
  const base = { pay, income: [inc("i1", "k1", "PCC Bothell", "1000")], expenses: [], categories, rates };

  it("counts the box going in as income in its week", () => {
    const p = weekPnl({ ...base, week: "2026-11-09", freezer: { in: freezerIn("2026-11-09", [box]), out: freezerOut("2026-11-09", [], [box]) } });
    expect(centsText(p.freezerIn!.total)).toBe("$221.52");
    expect(centsText(p.incomeCents)).toBe("$1,221.52");
  });

  it("takes it back the week it's packed for an order, so the sale on the invoice is counted once", () => {
    const p = weekPnl({ ...base, week: WEEK, freezer: { in: freezerIn(WEEK, [box]), out: freezerOut(WEEK, [take], [box]) } });
    expect(p.freezerOut!.total).toBe(BigInt(-22152));
    expect(centsText(p.incomeCents)).toBe("$778.48");
  });

  it("leaves freezer in and out out of a percent of income", () => {
    const p = weekPnl({ ...base, week: "2026-11-09", freezer: { in: freezerIn("2026-11-09", [box]), out: freezerOut("2026-11-09", [], [box]) } });
    // Marketing 4% of $1,000 (not of $1,221.52)
    expect(line(p, "mkt").total).toBe(BigInt(4000));
  });

  it("takes adjustments to either line", () => {
    const adj: PnlAdjustment = {
      id: "a1",
      week_id: "2026-11-09",
      kind: "adjustment",
      line_key: "freezer_in",
      side: "income",
      label: "",
      amount: "-21.52",
      reason: "box was damaged",
      attachment_path: null,
      attachment_name: "",
      created_by_name: "Lucas",
      created_at: "2026-11-20T20:00:00Z",
      voided_at: null,
      voided_by_name: "",
      void_reason: "",
    };
    const p = weekPnl({ ...base, week: "2026-11-09", adjustments: [adj], freezer: { in: freezerIn("2026-11-09", [box]), out: freezerOut("2026-11-09", [], [box]) } });
    expect(centsText(p.freezerIn!.total)).toBe("$200.00");
    expect(p.incomeAdj).toBe(BigInt(0));
  });

  it("is nothing for a week with no freezer boxes", () => {
    const p = weekPnl({ ...base, week: WEEK });
    expect(p.freezerCents).toBe(BigInt(0));
    expect(p.incomeCents).toBe(BigInt(100000));
  });
});
