import { describe, expect, it } from "vitest";
import { parseCsv } from "./import/csv";
import {
  customerHistoryCsv,
  customerListCsv,
  fileSafe,
  freezerCsv,
  packingRecordCsv,
  productTotalsCsv,
  salesCsv,
  weekOrdersCsv,
} from "./reports";
import type { Customer, Order } from "./db/types";

const products = [
  { id: "leg", name: "legs Bone In to VAC", unit: "each", sort: 1 },
  { id: "rack", name: "French Rack to Vac", unit: "each", sort: 2 },
];
const rows = (csv: string) => {
  expect(csv.startsWith("﻿")).toBe(true); // Excel reads it as UTF-8
  return parseCsv(csv.slice(1));
};

const cust = (id: string, name: string, extra: Partial<Customer> = {}): Customer => ({
  id,
  name,
  type: "Retail",
  call_day: null,
  notes: "",
  active: true,
  parent_customer_id: null,
  bills_for_locations: false,
  pallet_group_id: null,
  pallet_spot: "",
  pallet_sort: 0,
  contacts: [],
  ...extra,
});

describe("customer order history download", () => {
  it("has a row per product per week, newest first, and a row for a no-order week", () => {
    const r = rows(
      customerHistoryCsv(
        "Key City",
        [
          { week: "2026-10-05", status: "none", notes: "", lines: {}, packed: {} },
          { week: "2026-10-12", status: "ordered", notes: "Before 10, please", lines: { rack: 4, leg: 2 }, packed: { leg: 2 } },
        ],
        products,
      ),
    );
    expect(r[0]).toEqual(["Customer", "Week of", "Answer", "Product", "Quantity", "Unit", "Packed (lb)", "Order notes"]);
    expect(r.slice(1)).toEqual([
      ["Key City", "2026-10-12", "Ordered", "legs Bone In to VAC", "2", "each", "2", "Before 10, please"],
      ["Key City", "2026-10-12", "Ordered", "French Rack to Vac", "4", "each", "", "Before 10, please"],
      ["Key City", "2026-10-05", "No order", "", "", "", "", ""],
    ]);
  });

  it("makes a safe file name", () => {
    expect(fileSafe("PCC Community Markets: Fremont #11")).toBe("PCC-Community-Markets-Fremont-11");
  });
});

describe("week's orders download", () => {
  const pcc = cust("p", "PCC", { bills_for_locations: true, contacts: [{ id: "k0", customer_id: "p", name: "Ana", roles: ["billing"], phone: "", email: "ap@pcc.test", sort: 0 }] });
  const fremont = cust("f", "Fremont #11", {
    parent_customer_id: "p",
    call_day: "Tuesday",
    notes: "Dock in back",
    contacts: [{ id: "k1", customer_id: "f", name: "Phil", roles: ["orders"], phone: "206-632-6811", email: "phil@pcc.test", sort: 0 }],
  });
  const deli = cust("d", "Abe's Deli");
  const byId = new Map([pcc, fremont, deli].map((c) => [c.id, c]));
  const orders = new Map<string, Order>([["f", { id: "o1", customer_id: "f", status: "ordered", notes: "", lines: { leg: 6 }, units: {} }]]);

  it("lists every customer with their details, a row per product, and a row for no products", () => {
    const r = rows(weekOrdersCsv("2026-10-05", [fremont, deli], byId, orders, new Map([["o1", { leg: 5 }]]), products));
    expect(r[0].slice(0, 4)).toEqual(["Week of", "Customer", "Chain", "Type"]);
    const col = (row: string[], name: string) => row[r[0].indexOf(name)];
    expect(r.length).toBe(3);
    expect(col(r[1], "Customer")).toBe("Abe's Deli");
    expect(col(r[1], "Answer")).toBe("Not called");
    expect(col(r[2], "Customer")).toBe("Fremont #11");
    expect(col(r[2], "Chain")).toBe("PCC");
    expect(col(r[2], "Contact")).toBe("Phil");
    expect(col(r[2], "Phone")).toBe("206-632-6811");
    expect(col(r[2], "Email")).toBe("phil@pcc.test");
    expect(col(r[2], "Bill to")).toBe("PCC");
    expect(col(r[2], "Product")).toBe("legs Bone In to VAC");
    expect(col(r[2], "Quantity")).toBe("6");
    expect(col(r[2], "Packed (lb)")).toBe("5");
    expect(col(r[2], "Standing notes")).toBe("Dock in back");
  });
});

// Shared customers for the reports below.
const chain = cust("p", "PCC", { bills_for_locations: true });
const store = cust("f", "Fremont #11", {
  parent_customer_id: "p",
  contacts: [
    { id: "k1", customer_id: "f", name: "Phil", roles: ["orders", "receiving"], phone: "206-632-6811", email: "", sort: 0 },
    { id: "k2", customer_id: "f", name: "Ana", roles: ["billing"], phone: "", email: "ap@pcc.test", sort: 1 },
  ],
});
const deli = cust("d", "Abe's Deli", { active: false });
const all = new Map([chain, store, deli].map((c) => [c.id, c]));
const withGroup = products.map((x) => ({ ...x, group_name: x.id === "leg" ? "Legs" : "Racks" }));
const col = (r: string[][], row: number, name: string) => r[row][r[0].indexOf(name)];

describe("product totals", () => {
  it("adds up each product across customers, with half and whole, packed, and short", () => {
    const orders: Order[] = [
      { id: "o1", customer_id: "f", status: "ordered", notes: "", lines: { leg: 6, rack: 2 }, units: {} },
      { id: "o2", customer_id: "d", status: "ordered", notes: "", lines: { leg: 4 }, units: {} },
    ];
    const r = rows(productTotalsCsv("2026-10-05", withGroup, orders, new Map([["o1", { leg: 6, rack: 1 }]]), { leg: 2 }));
    expect(r.length).toBe(3);
    // Pounds packed; short only for products ordered by the pound (these are pieces).
    expect([col(r, 1, "Product"), col(r, 1, "Customers"), col(r, 1, "Ordered"), col(r, 1, "For half and whole"), col(r, 1, "Total to cut"), col(r, 1, "Packed (lb)"), col(r, 1, "Short (lb)")]).toEqual(
      ["legs Bone In to VAC", "2", "10", "2", "12", "6", ""],
    );
    expect([col(r, 2, "Product"), col(r, 2, "Short (lb)")]).toEqual(["French Rack to Vac", ""]);
  });
});

describe("customer list", () => {
  it("has a row per contact with roles, and a row for customers without contacts", () => {
    const r = rows(customerListCsv([chain, store, deli], all));
    expect(r.slice(1).map((x) => [x[0], x[r[0].indexOf("Contact")]])).toEqual([
      ["Abe's Deli", ""],
      ["PCC", ""],
      ["Fremont #11", "Phil"],
      ["Fremont #11", "Ana"],
    ]);
    expect(col(r, 1, "Active")).toBe("No");
    expect(col(r, 2, "Bills for all locations")).toBe("Yes");
    expect(col(r, 3, "Handles")).toBe("Orders, Receiving");
    expect(col(r, 3, "Bill to")).toBe("PCC");
    expect(col(r, 4, "Email")).toBe("ap@pcc.test");
  });
});

describe("sales over a date range", () => {
  it("totals each customer's products with weeks ordered and first and last week", () => {
    const r = rows(
      salesCsv(
        "2026-10-05",
        "2026-10-19",
        [
          { customer_id: "f", week: "2026-10-05", lines: { leg: 6 } },
          { customer_id: "f", week: "2026-10-19", lines: { leg: 4, rack: 2 } },
          { customer_id: "d", week: "2026-10-12", lines: { leg: 1 } },
        ],
        all,
        products,
      ),
    );
    expect(r.slice(1).map((x) => [x[2], x[4], x[6], x[7], x[8], x[9]])).toEqual([
      ["Abe's Deli", "legs Bone In to VAC", "1", "1", "2026-10-12", "2026-10-12"],
      ["Fremont #11", "legs Bone In to VAC", "10", "2", "2026-10-05", "2026-10-19"],
      ["Fremont #11", "French Rack to Vac", "2", "1", "2026-10-19", "2026-10-19"],
    ]);
  });
});

describe("packing record", () => {
  it("shows pounds and pieces packed, short or over, not filled, flags, boxes, and who weighed", () => {
    const lb = [{ id: "trim", name: "Le Trim", unit: "lb", sort: 0 }, ...products];
    const r = rows(
      packingRecordCsv(
        "2026-10-05",
        [
          {
            customer_id: "f",
            status: "ordered",
            lines: { trim: 20, leg: 6, rack: 2 },
            weights: [
              { product_id: "trim", weight: 9.8, box_no: 1, by: "Chris", at: "2026-10-07T17:00:00Z" },
              { product_id: "trim", weight: 5.4, box_no: 2, by: "Chris", at: "2026-10-07T17:05:00Z" },
              { product_id: "leg", weight: 30.2, box_no: 3, by: "Chris", at: "2026-10-07T17:06:00Z" },
            ],
            marks: {
              leg: { count: 5, shorted: false, flagged: true, flagNote: "One leg bruised" },
              rack: { count: null, shorted: true, flagged: false, flagNote: "" },
            },
            pallet: "A",
          },
          { customer_id: "d", status: "none", lines: {}, weights: [], marks: {}, pallet: "" },
        ],
        all,
        lb,
        (iso) => iso.slice(11, 16),
      ),
    );
    expect(r.length).toBe(4); // the no-order customer is left out
    const byProduct = (n: string) => r.find((x) => x[r[0].indexOf("Product")] === n)!;
    const c = (row: string[], name: string) => row[r[0].indexOf(name)];
    const trim = byProduct("Le Trim");
    expect([c(trim, "Packed (lb)"), c(trim, "Short"), c(trim, "Boxes"), c(trim, "Weighed by"), c(trim, "Last weighed")]).toEqual(
      ["15.2", "4.8", "1, 2", "Chris", "17:05"],
    );
    const leg = byProduct("legs Bone In to VAC");
    expect([c(leg, "Packed (lb)"), c(leg, "Pieces packed"), c(leg, "Short"), c(leg, "Flag")]).toEqual(["30.2", "5", "1", "One leg bruised"]);
    const rack = byProduct("French Rack to Vac");
    expect([c(rack, "Packed (lb)"), c(rack, "Not filled"), c(rack, "Pallet")]).toEqual(["", "Yes", "A"]);
  });
});

describe("freezer on hand", () => {
  it("lists on hand, held, and free with the counting unit", () => {
    const r = rows(
      freezerCsv("2026-10-08", withGroup.map((x) => ({ ...x, countUnit: x.id === "leg" ? "legs (not packs)" : "each" })), { leg: 5 }, { leg: 2, rack: 1 }),
    );
    expect(r.slice(1).map((x) => x.slice(1))).toEqual([
      ["legs Bone In to VAC", "Legs", "legs (not packs)", "5", "2", "3"],
      ["French Rack to Vac", "Racks", "each", "0", "1", "-1"],
    ]);
  });
});
