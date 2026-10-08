import { describe, expect, it } from "vitest";
import { parseCsv } from "./import/csv";
import { customerHistoryCsv, fileSafe, weekOrdersCsv } from "./reports";
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
    expect(r[0]).toEqual(["Customer", "Week of", "Answer", "Product", "Quantity", "Unit", "Packed", "Order notes"]);
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
  const orders = new Map<string, Order>([["f", { id: "o1", customer_id: "f", status: "ordered", notes: "", lines: { leg: 6 } }]]);

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
    expect(col(r[2], "Packed")).toBe("5");
    expect(col(r[2], "Standing notes")).toBe("Dock in back");
  });
});
