import { describe, expect, it } from "vitest";
import { centsText, sheetPay, weekPay, type KillSheet } from "./lambCost";
import { chargesOn, weekPnl, type ExpenseCategory, type ExpenseEntry, type IncomeEntry, type LambCharge, type PercentCharge } from "./pnl";

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
      { kind: "lamb", name: "ALB/OSC", rate: "1.8000", lambs: 2, cents: BigInt(360) },
      { kind: "percent", name: "Marketing", percent: "4.0000", income: BigInt(108051), cents: BigInt(4322) }, // 43.2204
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
