import { describe, expect, it } from "vitest";
import { weekPay } from "./lambCost";
import { weekPnl, type CategoryRate, type ExpenseCategory } from "./pnl";
import { driverRateOn, runPay, stopsMade, type DriverRate, type RunStop, type TruckDriver, type TruckRun } from "./truck";

const WEEK = "2026-11-16";
const drivers: TruckDriver[] = [
  { id: "d1", name: "Sam", active: true, maintenance: false, note: "" },
  { id: "d2", name: "Jo", active: true, maintenance: true, note: "" },
  { id: "d3", name: "New driver", active: true, maintenance: false, note: "" },
];
const rates: DriverRate[] = [
  { id: "r1", driver_id: "d1", effective_from: "2026-10-08", base: "290", per_extra: "40", per_skipped: "40", note: "" },
  { id: "r2", driver_id: "d1", effective_from: "2026-12-01", base: "300", per_extra: "40", per_skipped: "40", note: "" },
  { id: "r3", driver_id: "d2", effective_from: "2026-10-08", base: "290", per_extra: "40", per_skipped: "40", note: "" },
];
const run = (id: string, driver_id: string, run_date: string, fuel: string | null): TruckRun => ({
  id,
  run_date,
  week_id: WEEK,
  driver_id,
  fuel,
  note: "",
  receipt_path: null,
  receipt_name: "",
});
let n = 0;
const stop = (run_id: string, kind: RunStop["kind"], name: string): RunStop => ({ id: `s${++n}`, run_id, kind, customer_id: null, point_id: null, name, sort: n });
const stops = [
  stop("a", "stop", "Newport Ave"),
  stop("a", "stop", "Emerson"),
  stop("a", "extra", "Farm stand"),
  stop("a", "skipped", "Corfini"),
  stop("a", "extra", "Market"),
  stop("b", "stop", "Newport Ave"),
];

describe("truck run pay", () => {
  it("takes the driver's rate on the run's date", () => {
    expect(driverRateOn(rates, "d1", "2026-11-17")!.base).toBe("290");
    expect(driverRateOn(rates, "d1", "2026-12-01")!.base).toBe("300");
    expect(driverRateOn(rates, "d1", "2026-10-01")).toBeNull();
  });
  it("pays base + extra stops − skipped stops", () => {
    const r = runPay(run("a", "d1", "2026-11-17", "112.40"), stops, drivers, rates);
    expect(r).toMatchObject({ driverName: "Sam", regular: 2, extra: 2, skipped: 1, pay: BigInt(33000), fuel: BigInt(11240), maintenance: false });
    expect(stopsMade(r)).toBe(4);
    expect(r.stops.map((s) => s.name)).toEqual(["Newport Ave", "Emerson", "Farm stand", "Corfini", "Market"]);
  });
  it("has no pay without a rate, and no fuel until it's entered", () => {
    const r = runPay(run("c", "d3", "2026-11-17", null), [], drivers, rates);
    expect(r.pay).toBeNull();
    expect(r.fuel).toBeNull();
  });
});

describe("truck categories on the P&L", () => {
  const cat = (id: string, name: string, method: ExpenseCategory["method"], more: Partial<ExpenseCategory> = {}): ExpenseCategory => ({
    id,
    name,
    active: true,
    sort: 100,
    group_name: "Delivery",
    method,
    income_base: "all",
    base_category_ids: [],
    note: "",
    delivery_kind: "truck",
    ...more,
  });
  const categories = [
    cat("pay", "Truck, driver pay", "per_truck_run", { truck_part: "driver_pay", sort: 100 }),
    cat("saif", "Truck, payroll taxes: SAIF", "percent_category", { base_category_ids: ["pay"], sort: 110 }),
    cat("fica", "Truck, payroll taxes: FICA", "percent_category", { base_category_ids: ["pay"], sort: 115 }),
    cat("fuel", "Truck, fuel", "per_truck_run", { truck_part: "fuel", sort: 120 }),
    cat("mnt", "Truck, maintenance", "per_truck_run", { truck_part: "maintenance", sort: 130 }),
    cat("ins", "Truck, insurance", "fixed_weekly", { sort: 140 }),
    cat("frt", "Freight, other carriers", "entered", { delivery_kind: "freight", sort: 200 }),
  ];
  const cr = (category_id: string, r: Partial<CategoryRate>): CategoryRate => ({
    id: category_id,
    category_id,
    effective_from: "2026-10-08",
    amount: null,
    percent: null,
    parts: [],
    note: "",
    ...r,
  });
  const catRates = [
    cr("saif", { percent: "10" }),
    cr("fica", { percent: "8" }),
    cr("mnt", { amount: "50" }),
    cr("ins", { parts: [{ label: "Weekly", amount: 100, per: "week" }] }),
  ];
  const runs = [runPay(run("a", "d1", "2026-11-17", "112.40"), stops, drivers, rates), runPay(run("b", "d2", "2026-11-18", "60"), stops, drivers, rates)];
  const p = weekPnl({
    week: WEEK,
    pay: weekPay([]),
    income: [],
    expenses: [{ id: "e", entry_date: WEEK, week_id: WEEK, category_id: "frt", amount: "75", note: "" }],
    categories,
    rates: catRates,
    runs,
    noProcessing: true,
  });
  const line = (id: string) => p.categories.find((l) => l.categoryId === id)!;
  it("adds up driver pay, taxes on it, fuel and maintenance", () => {
    expect(line("pay").total).toBe(BigInt(33000 + 29000)); // 330 + 290
    expect(line("saif").total).toBe(BigInt(6200)); // 10% of 620
    expect(line("fica").total).toBe(BigInt(4960)); // 8% of 620
    expect(line("fuel").total).toBe(BigInt(17240)); // 112.40 + 60
    expect(line("mnt").total).toBe(BigInt(5000)); // one run by a driver with maintenance on
  });
  it("works out truck cost per stop, leaving freight out", () => {
    expect(p.truckStops).toBe(5); // 4 + 1
    expect(p.truckCents).toBe(BigInt(62000 + 6200 + 4960 + 17240 + 5000 + 10000));
    expect(p.costPerStop).toBe(BigInt(21080)); // 1,054.00 / 5
  });
  it("says when a driver has no pay rate", () => {
    const q = weekPnl({ week: WEEK, pay: weekPay([]), income: [], expenses: [], categories, rates: catRates, runs: [runPay(run("c", "d3", "2026-11-17", null), [], drivers, rates)] });
    expect(q.categories.find((l) => l.categoryId === "pay")).toMatchObject({ total: null, waiting: "No pay rate for New driver (P&L Setup)." });
    expect(q.categories.find((l) => l.categoryId === "saif")!.total).toBeNull();
  });
});
