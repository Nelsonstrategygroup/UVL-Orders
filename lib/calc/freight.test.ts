import { describe, expect, it } from "vitest";
import { weekPay } from "./lambCost";
import { covers, freightFor, weekPnl, type CategoryRate, type ExpenseCategory, type FreightBox, type FreightInput } from "./pnl";
import { runPay } from "./truck";

const WEEK = "2026-11-09";
const cat = (id: string, name: string, method: ExpenseCategory["method"], customer_ids: string[], more: Partial<ExpenseCategory> = {}): ExpenseCategory => ({
  id,
  name,
  active: true,
  sort: 170,
  group_name: "Delivery",
  method,
  income_base: "all",
  base_category_ids: [],
  note: "",
  delivery_kind: "freight",
  carrier: name,
  customer_ids,
  weight_basis: "gross",
  ...more,
});
const categories = [
  cat("ply", "Freight, Plymouth", "freight_weight", ["pcc", "keycity", "pt"]),
  cat("her", "Freight, Heritage cross-dock", "freight_pallet", ["pcc"], { sort: 180 }),
  cat("pet", "Freight, Petersons to Plymouth", "freight_pallet", ["pcc"], { sort: 190 }),
];
const rate = (category_id: string, amount: string, more: Partial<CategoryRate> = {}): CategoryRate => ({
  id: category_id,
  category_id,
  effective_from: "2026-10-08",
  amount,
  percent: null,
  parts: [],
  note: "",
  per_box_lb: "0",
  per_pallet_lb: "0",
  ...more,
});
const rates = [rate("ply", "0.058"), rate("her", "25"), rate("pet", "100")];

// The week of Nov 9 as packed: P1 and P2 PCC stores; P3 PCC stores with Key
// City and Port Townsend; P4 Newport Ave; P5 Emerson (by truck).
const box = (customer_id: string, weight: string, pallet_id: string | null): FreightBox => ({ customer_id, weight, pallet_id });
const freight: FreightInput = {
  boxes: [
    box("pcc10", "500.00", "p1"),
    box("pcc11", "410.40", "p1"),
    box("pcc12", "878.80", "p2"),
    box("pcc05", "900.00", "p3"),
    box("keycity", "38.00", "p3"),
    box("pt", "101.65", "p3"),
    box("newport", "206.40", "p4"),
    box("emerson", "110.95", "p5"),
    box("pcc13", "12.00", null), // not on a pallet: not counted
  ],
  pallets: [
    { id: "p1", tag: "P1" },
    { id: "p2", tag: "P2" },
    { id: "p3", tag: "P3" },
    { id: "p4", tag: "P4" },
    { id: "p5", tag: "P5" },
  ],
  chainOf: { pcc10: "pcc", pcc11: "pcc", pcc12: "pcc", pcc05: "pcc", pcc13: "pcc", keycity: null, pt: null, newport: null, emerson: null },
};

describe("freight from pallets", () => {
  it("a chain covers its stores", () => {
    expect(covers(categories[1], "pcc10", freight.chainOf)).toBe(true);
    expect(covers(categories[1], "keycity", freight.chainOf)).toBe(false);
    expect(covers(categories[0], "keycity", freight.chainOf)).toBe(true);
  });
  it("finds the pallets and pounds a carrier covers", () => {
    const f = freightFor(categories[0], rates[0], freight);
    expect(f.pallets.map((p) => `${p.tag} ${p.boxes} ${p.lb}`)).toEqual(["P1 2 91040", "P2 1 87880", "P3 3 103965"]);
    expect(f.netLb).toBe(BigInt(282885)); // 2,828.85 lb
    expect(f.offPallet).toBe(1);
  });

  const p = weekPnl({ week: WEEK, pay: weekPay([]), income: [], expenses: [], categories, rates, freight, noProcessing: true });
  const line = (id: string) => p.categories.find((l) => l.categoryId === id)!;
  it("works out the week of Nov 9", () => {
    expect(line("ply").total).toBe(BigInt(16407)); // 2,828.85 × 0.058 = 164.0733
    expect(line("her").total).toBe(BigInt(7500)); // 3 PCC pallets × 25
    expect(line("pet").total).toBe(BigInt(30000)); // 3 × 100
    expect(p.freightCents).toBe(BigInt(16407 + 7500 + 30000));
    expect(p.freightPallets).toBe(3);
    expect(p.freightPerPallet).toBe(BigInt(17969)); // 539.07 / 3
  });
  it("adds lb per box and per pallet on gross weight, not on net", () => {
    const gross = [rate("ply", "0.058", { per_box_lb: "2", per_pallet_lb: "40" }), rates[1], rates[2]];
    // 2,828.85 + 6 boxes × 2 + 3 pallets × 40 = 2,960.85 lb × 0.058 = 171.7293
    const g = weekPnl({ week: WEEK, pay: weekPay([]), income: [], expenses: [], categories, rates: gross, freight, noProcessing: true });
    expect(g.categories.find((l) => l.categoryId === "ply")!.total).toBe(BigInt(17173));
    const netCats = categories.map((c) => (c.id === "ply" ? { ...c, weight_basis: "net" as const } : c));
    const n = weekPnl({ week: WEEK, pay: weekPay([]), income: [], expenses: [], categories: netCats, rates: gross, freight, noProcessing: true });
    expect(n.categories.find((l) => l.categoryId === "ply")!.total).toBe(BigInt(16407));
  });
  it("says how each pallet ships: freight, a truck run, or neither yet", () => {
    expect(p.shipping.pallets.map((x) => `${x.tag} ${x.byFreight ? "freight" : x.byTruck ? "truck" : "none"}`)).toEqual([
      "P1 freight",
      "P2 freight",
      "P3 freight",
      "P4 none",
      "P5 none",
    ]);
    const run = runPay(
      { id: "r", run_date: "2026-11-10", week_id: WEEK, driver_id: "d", fuel: "50", note: "", receipt_path: null, receipt_name: "" },
      [{ id: "s", run_id: "r", kind: "stop", customer_id: "newport", point_id: null, name: "Newport Ave", sort: 1 }],
      [{ id: "d", name: "Sam", active: true, maintenance: false, note: "" }],
      [],
    );
    const q = weekPnl({ week: WEEK, pay: weekPay([]), income: [], expenses: [], categories, rates, freight, runs: [run], noProcessing: true });
    expect(q.shipping.pallets.find((x) => x.tag === "P4")!.byTruck).toBe(true);
    expect(q.shipping.locations.filter((l) => !l.byFreight && !l.byTruck).map((l) => l.customerId)).toEqual(["emerson"]);
  });
});
