import { describe, expect, it } from "vitest";
import { freightLine, freightRateFor, priceLines, type FreightChargeRow } from "./invoice";
import { weekPay } from "./lambCost";
import { invoiceIncome, weekPnl, type PackedLine } from "./pnl";

const rows: FreightChargeRow[] = [
  { id: "a", customer_id: "solo", method: "per_lb", amount: "0.25", effective_from: "2099-01-01", note: "" },
  { id: "b", customer_id: "chain", method: "per_pallet", amount: "30", effective_from: "2099-01-01", note: "" },
  { id: "c", customer_id: "store2", method: "none", amount: "0", effective_from: "2099-01-01", note: "" },
  { id: "d", customer_id: "solo", method: "per_delivery", amount: "45", effective_from: "2099-06-01", note: "" },
];
const boxes = [
  { customer_id: "solo", weight: "10", pallet_id: "p1" },
  { customer_id: "solo", weight: "10.5", pallet_id: "p1" },
  { customer_id: "store", weight: "12", pallet_id: "p1" },
  { customer_id: "store", weight: "8", pallet_id: "p2" },
];
const mine = (id: string) => boxes.filter((b) => b.customer_id === id);

describe("freight on invoices", () => {
  it("takes the location's own setting, else its chain's; none when not set", () => {
    expect(freightRateFor(rows, "solo", "2099-03-01", null)!.method).toBe("per_lb");
    expect(freightRateFor(rows, "solo", "2099-07-01", null)!.method).toBe("per_delivery");
    expect(freightRateFor(rows, "store", "2099-03-01", "chain")!.method).toBe("per_pallet");
    expect(freightRateFor(rows, "store2", "2099-03-01", "chain")!.method).toBe("none");
    expect(freightRateFor(rows, "other", "2099-03-01", null)).toBeNull();
  });
  it("works the line out as finalizing stores it", () => {
    expect(freightLine(freightRateFor(rows, "solo", "2099-03-01", null), mine("solo"), "i")).toMatchObject({
      kind: "freight",
      description: "Freight",
      quantity: "20.50",
      price_unit: "lb",
      unit_price: "0.25",
      sort: 100000,
    });
    expect(freightLine(freightRateFor(rows, "store", "2099-03-01", "chain"), mine("store"), "i")).toMatchObject({ quantity: "2", price_unit: "each" });
    expect(freightLine(freightRateFor(rows, "solo", "2099-07-01", null), mine("solo"), "i")).toMatchObject({ quantity: "1", unit_price: "45" });
    expect(freightLine(freightRateFor(rows, "store2", "2099-03-01", "chain"), mine("store"), "i")).toBeNull();
    expect(freightLine(null, mine("solo"), "i")).toBeNull();
  });
  it("prices it as its own line at the end", () => {
    const fl = freightLine(freightRateFor(rows, "solo", "2099-03-01", null), mine("solo"), "i")!;
    const [line] = priceLines([fl], [], "solo", "2099-03-01");
    expect(line.totalCents).toBe(BigInt(513)); // 20.5 × 0.25 = 5.125 → 5.13
  });
  it("counts as freight income on the P&L, taken off delivery, not in sales", () => {
    const packed: PackedLine[] = [
      {
        customer_id: "solo",
        kind: "packed",
        product_id: "chops",
        description: "Chops",
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
      week: "2099-03-02",
      locations: [{ id: "solo", name: "Solo", chainId: null }],
      invoices: [],
      packed,
      prices: [{ id: "p", product_id: "chops", customer_id: null, price: "10", effective_from: "2099-01-01", note: "" }],
      charges: [],
      productName: (id) => id,
      freight: rows,
      boxes,
    });
    expect(ii.packedCents).toBe(BigInt(20500 + 513));
    expect(ii.freightCents).toBe(BigInt(513));
    const p = weekPnl({
      week: "2099-03-02",
      pay: weekPay([]),
      income: [],
      expenses: [],
      categories: [
        {
          id: "ins",
          name: "Truck, insurance",
          active: true,
          sort: 140,
          group_name: "Delivery",
          method: "fixed_weekly",
          income_base: "all",
          base_category_ids: [],
          note: "",
        },
      ],
      rates: [{ id: "r", category_id: "ins", effective_from: "2099-01-01", amount: null, percent: null, parts: [{ label: "W", amount: 100, per: "week" }], note: "" }],
      invoices: ii,
      noProcessing: true,
    });
    expect(p.freightIncome).toBe(BigInt(513));
    expect(p.netDelivery).toBe(BigInt(10000 - 513));
    expect(p.salesCents).toBe(BigInt(20500));
    expect(p.incomeCents).toBe(BigInt(21013));
  });
});
