import { describe, expect, it } from "vitest";
import { readable } from "./readable";

const weekOrders = {
  header: ["Week of", "Customer", "Phone", "Answer", "Product", "Quantity", "Unit", "Packed (lb)"],
  rows: [
    ["2026-10-19", "Key City", "541-555-0100", "Ordered", "Chops", 20, "lb", ""],
    ["2026-10-19", "Key City", "541-555-0100", "Ordered", "BI Legs", 6, "each", ""],
    ["2026-10-19", "Newport Ave", "", "No order", "", "", "", ""],
  ],
};

describe("a report as a page", () => {
  it("shows a column with one value for the whole report once, and drops columns that are empty everywhere", () => {
    const r = readable(weekOrders, { constant: ["Week of"] });
    expect(r.constants).toEqual([{ label: "Week of", value: "2026-10-19" }]);
    expect(r.columns).toEqual(["Customer", "Phone", "Answer", "Product", "Quantity", "Unit"]);
    expect(r.rows[0]).toEqual(["Key City", "541-555-0100", "Ordered", "Chops", "20", "lb"]);
  });

  it("one card per customer, with their products inside", () => {
    const r = readable(weekOrders, { constant: ["Week of"], groupBy: "Customer", items: ["Product", "Quantity", "Unit"] });
    expect(r.cards).toEqual([
      {
        title: "Key City",
        fields: [
          { label: "Phone", value: "541-555-0100" },
          { label: "Answer", value: "Ordered" },
        ],
        items: [
          { title: "Chops", fields: [{ label: "", value: "20 lb" }] },
          { title: "BI Legs", fields: [{ label: "", value: "6 each" }] },
        ],
      },
      { title: "Newport Ave", fields: [{ label: "Answer", value: "No order" }], items: [] },
    ]);
  });

  it("without grouping, one card per row titled by its first column", () => {
    const r = readable({ header: ["Product", "On hand"], rows: [["Necks", 4]] });
    expect(r.cards).toEqual([{ title: "Necks", fields: [{ label: "On hand", value: "4" }], items: [] }]);
  });
});
