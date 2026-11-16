import { describe, expect, it } from "vitest";
import { centsText, sheetPay, weekPay, type KillSheet } from "./lambCost";
import { chargesOn, invoiceIncome, parseMoney, weekPnl, type PackedLine, type PnlAdjustment, type ExpenseCategory, type ExpenseEntry, type IncomeEntry, type LambCharge, type PercentCharge } from "./pnl";

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

const lambCharges: LambCharge[] = [
  { id: "l1", name: "ALB/OSC", effective_from: "2026-10-01", per_lamb: "1.8000", note: "" },
  { id: "l2", name: "ALB/OSC", effective_from: "2027-01-04", per_lamb: "2.0000", note: "" },
  { id: "l3", name: "Old fee", effective_from: "2026-01-01", per_lamb: "5", note: "" },
  { id: "l4", name: "Old fee", effective_from: "2026-10-01", per_lamb: "0", note: "stopped" },
];
const percentCharges: PercentCharge[] = [{ id: "p1", name: "Marketing", effective_from: "2026-10-01", percent: "4.0000", note: "" }];
const categories: ExpenseCategory[] = [
  { id: "c1", name: "Butcher (Mohawk)", active: true, sort: 1 },
  { id: "c2", name: "Labor", active: true, sort: 2 },
  { id: "c3", name: "Freight", active: false, sort: 3 },
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

describe("chargesOn", () => {
  it("takes each charge's newest rate on or before the week, and drops ones set to 0", () => {
    expect(chargesOn(lambCharges, WEEK, (r) => r.per_lamb).map((c) => `${c.name} ${c.per_lamb}`)).toEqual(["ALB/OSC 1.8000"]);
    expect(chargesOn(lambCharges, "2027-01-04", (r) => r.per_lamb).map((c) => c.per_lamb)).toEqual(["2.0000"]);
    expect(chargesOn(lambCharges, "2026-09-28", (r) => r.per_lamb).map((c) => c.name)).toEqual(["Old fee"]);
  });
});

describe("weekPnl", () => {
  const full = weekPnl({
    week: WEEK,
    pay,
    income: [inc("i1", "k1", "PCC Fremont", "980.50"), inc("i2", "k1", "PCC Fremont", "100"), inc("i3", "k2", "Corfini", "0.01")],
    expenses: [exp("e1", "c1", "1250"), exp("e2", "c2", "150"), exp("e3", "c2", "50"), exp("e4", "c3", "10")],
    categories,
    lambCharges,
    percentCharges,
  });

  it("adds income up by customer", () => {
    expect(full.income.map((r) => `${r.name} ${r.entries} ${centsText(r.cents)}`)).toEqual(["Corfini 1 $0.01", "PCC Fremont 2 $1,080.50"]);
    expect(centsText(full.incomeCents)).toBe("$1,080.51");
  });

  it("works out each charge, with its math", () => {
    expect(full.charges).toEqual([
      { kind: "lamb", name: "ALB/OSC", rate: "1.8000", lambs: 2, cents: BigInt(360), adj: BigInt(0), total: BigInt(360) },
      { kind: "percent", name: "Marketing", percent: "4.0000", income: BigInt(108051), cents: BigInt(4322), adj: BigInt(0), total: BigInt(4322) }, // 43.2204
    ]);
  });

  it("adds expenses up by category, retired ones included", () => {
    expect(full.expenses.map((r) => `${r.name} ${centsText(r.cents)}`)).toEqual(["Butcher (Mohawk) $1,250.00", "Labor $200.00", "Freight $10.00"]);
  });

  it("totals, profit, per head and per carcass lb", () => {
    expect(centsText(full.producerCents)).toBe("$751.44");
    // 751.44 + 3.60 + 43.22 + 1,460.00
    expect(centsText(full.totalExpense!)).toBe("$2,258.26");
    expect(centsText(full.profit!)).toBe("-$1,177.75");
    expect(centsText(full.profitPerHead!)).toBe("-$588.88"); // -588.875 rounds away from zero
    expect(full.costPerCarcassLb).toBe(BigInt(182118)); // 2,258.26 / 124 = 18.21177...
  });

  it("says what's missing instead of showing a misleading number", () => {
    const noIncome = weekPnl({ week: WEEK, pay, income: [], expenses: [], categories, lambCharges, percentCharges });
    expect(noIncome.hasIncome).toBe(false);
    expect(noIncome.charges.find((c) => c.kind === "percent")!.cents).toBeNull();
    expect(noIncome.totalExpense).not.toBeNull();
    expect(noIncome.profit).toBeNull();
    expect(noIncome.profitPerHead).toBeNull();
    expect(noIncome.costPerCarcassLb).toBeNull();

    const noSheet = weekPnl({ week: WEEK, pay: noSheets, income: [inc("i1", "k1", "PCC", "100")], expenses: [], categories, lambCharges, percentCharges });
    expect(noSheet.hasSheets).toBe(false);
    expect(noSheet.charges.find((c) => c.kind === "lamb")!.cents).toBeNull();
    expect(noSheet.charges.find((c) => c.kind === "percent")!.cents).toBe(BigInt(400));
    expect(noSheet.totalExpense).toBeNull();
    expect(noSheet.profit).toBeNull();
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
      lambCharges,
      percentCharges,
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
    expect(weekPnl({ week: W, pay, income: [], expenses: [], categories, lambCharges, percentCharges, invoices: done }).projected).toBe(false);
  });
  it("has no income before anything is packed", () => {
    const none = invoiceIncome({ week: W, locations: [locations[3]], invoices: [], packed: [packed("keycity", "racks", null, "shorted")], prices, charges, productName: (id) => id });
    expect(weekPnl({ week: W, pay, income: [], expenses: [], categories, lambCharges, percentCharges, invoices: none }).hasIncome).toBe(false);
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
  const base = { week: WEEK, pay, income: [inc("i1", "k1", "PCC Fremont", "1000")], expenses: [exp("e1", "c2", "100")], categories, lambCharges, percentCharges };
  const p = weekPnl({
    ...base,
    adjustments: [
      a("1", "adjustment", "producer", "expense", "-50"),
      a("2", "adjustment", "producer", "expense", "-999", true), // voided: counts for nothing
      a("3", "adjustment", "income", "income", "25"),
      a("4", "one_off", null, "income", "75"),
      a("5", "adjustment", "charge:ALB/OSC", "expense", "1.80"),
      a("6", "adjustment", "category:c1", "expense", "300"),
      a("7", "one_off", null, "expense", "412.50"),
    ],
  });
  it("adds each line's adjustments to what's calculated, voided ones left out", () => {
    expect(p).toMatchObject({ producerCalc: BigInt(75144), producerAdj: BigInt(-5000), producerCents: BigInt(70144) });
    expect(p).toMatchObject({ incomeCalc: BigInt(100000), incomeAdj: BigInt(2500), oneOffIncomeCents: BigInt(7500), incomeCents: BigInt(110000) });
    expect(p.charges[0]).toMatchObject({ cents: BigInt(360), adj: BigInt(180), total: BigInt(540) });
  });
  it("works marketing out on income after adjustments and one-off income", () => {
    expect(p.charges[1]).toMatchObject({ income: BigInt(110000), cents: BigInt(4400), total: BigInt(4400) });
  });
  it("adjusts an expense category even with no entries, and adds one-off expenses", () => {
    expect(p.expenses.map((r) => [r.name, r.cents, r.adj, r.total])).toEqual([
      ["Butcher (Mohawk)", BigInt(0), BigInt(30000), BigInt(30000)],
      ["Labor", BigInt(10000), BigInt(0), BigInt(10000)],
    ]);
    expect(p.oneOffExpenseCents).toBe(BigInt(41250));
    expect(p.expenseCents).toBe(BigInt(30000 + 10000 + 41250));
  });
  it("carries the totals through to profit", () => {
    expect(p.totalExpense).toBe(BigInt(70144 + 540 + 4400 + 81250));
    expect(p.profit).toBe(BigInt(110000) - BigInt(70144 + 540 + 4400 + 81250));
  });
  it("is unchanged with no adjustments", () => {
    const q = weekPnl(base);
    expect(q.producerCents).toBe(BigInt(75144));
    expect(q.incomeCents).toBe(BigInt(100000));
    expect(q.adjustments).toEqual([]);
  });
});
