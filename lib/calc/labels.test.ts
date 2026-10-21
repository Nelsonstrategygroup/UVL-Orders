// SPEC 12.5: the box label list.

import { describe, expect, it } from "vitest";
import type { BoxLimit, BoxType } from "./boxes";
import { labelCustomer, labelList, type LabelOrder, type LabelProduct } from "./labels";

const TYPES: BoxType[] = [
  { id: "mvm", name: "MVM", size_rank: 1 },
  { id: "roll-stock", name: "Roll Stock", size_rank: 2 },
  { id: "jerky", name: "Jerky", size_rank: 3 },
  { id: "white", name: "White", size_rank: 4 },
  { id: "baby", name: "Baby", size_rank: 5 },
];
const ok = (box_type_id: string, max_count: number | null, max_lb: number | null = null): BoxLimit => ({ box_type_id, max_count, max_lb, status: "ok" });
const no = (box_type_id: string): BoxLimit => ({ box_type_id, max_count: null, max_lb: null, status: "does_not_fit" });
const unsure = (box_type_id: string): BoxLimit => ({ box_type_id, max_count: null, max_lb: null, status: "needs_checking" });

const products = new Map<string, LabelProduct>([
  ["rack", { id: "rack", name: "Cap On Rack", label_name: "Single Pack Rack (Cap ON)", unit: "each", group_name: "Racks", sort: 300 }],
  ["legs", { id: "legs", name: "BNLS Legs", label_name: "", unit: "each", group_name: "Legs", sort: 500 }],
  ["letrim", { id: "letrim", name: "Le Trim", unit: "lb", group_name: "Ground and trim", sort: 620 }],
  ["denver", { id: "denver", name: "Denver Ribs", unit: "lb", group_name: "Byproducts", sort: 700 }],
  ["carcass", { id: "carcass", name: "Carcass Lamb", unit: "each", group_name: "Whole lambs", sort: 110 }],
  ["unordered", { id: "unordered", name: "Tongue", unit: "pack", group_name: "Byproducts", sort: 761 }],
]);
const boxes = {
  types: TYPES,
  capLb: 45,
  limits: new Map<string, BoxLimit[]>([
    ["rack", [ok("mvm", 10), ok("roll-stock", 6), ok("jerky", 6), ok("white", 2), no("baby")]],
    ["legs", [ok("mvm", 6), ok("roll-stock", 5), ok("jerky", 4), ok("white", 2), unsure("baby")]],
    ["letrim", [ok("mvm", null, 40), ok("roll-stock", null, 30), ok("jerky", null, 20), ok("white", null, 10), no("baby")]],
    ["denver", TYPES.map((t) => unsure(t.id))],
    ["carcass", TYPES.map((t) => no(t.id))],
  ]),
};
const orders: LabelOrder[] = [
  { customer: "PCC Kirkland", sortKey: "0|PCC Pallet 1|PCC Kirkland", lines: { rack: 12, letrim: 70 } },
  { customer: "Key City", sortKey: "1|Key City", lines: { rack: 2, legs: 8, denver: 10, carcass: 1 } },
];

describe("labels", () => {
  const list = labelList(orders, products, boxes);
  const table = (name: string) => list.tables.find((t) => t.product.name === name)!;

  it("one table per ordered product, in the order form's groups; none for products nobody ordered", () => {
    expect(list.tables.map((t) => t.product.name)).toEqual(["Cap On Rack", "BNLS Legs", "Le Trim"]);
  });

  it("one row per box: customer, count and label name, box type, 1 of 2", () => {
    expect(table("Cap On Rack").rows).toEqual([
      { customer: "PCC Kirkland", line2: "10 Single Pack Rack (Cap ON)", boxType: "MVM", ofN: "1 of 2" },
      { customer: "PCC Kirkland", line2: "2 Single Pack Rack (Cap ON)", boxType: "White", ofN: "2 of 2" },
      { customer: "Key City", line2: "2 Single Pack Rack (Cap ON)", boxType: "White", ofN: "" },
    ]);
  });

  it("pounds read '40 lb'; a blank label name prints the product name", () => {
    expect(table("Le Trim").rows.map((r) => r.line2)).toEqual(["40 lb Le Trim", "30 lb Le Trim"]);
    expect(table("BNLS Legs").rows.map((r) => r.line2)).toEqual(["6 BNLS Legs", "2 BNLS Legs"]);
  });

  it("customers sort by pallet group, then name", () => {
    expect(table("Cap On Rack").rows.map((r) => r.customer)).toEqual(["PCC Kirkland", "PCC Kirkland", "Key City"]);
  });

  it("in red: what can't be boxed, and splits that need an unconfirmed box", () => {
    expect(list.problems).toEqual([
      expect.objectContaining({ product: "BNLS Legs", customer: "Key City", why: expect.stringMatching(/Baby/) }),
      expect.objectContaining({ product: "Denver Ribs", customer: "Key City", amount: "10 lb", why: expect.stringMatching(/need checking/) }),
    ]);
  });

  it("Carcass Lamb goes out in a shroud: no labels and not a problem", () => {
    expect(list.tables.some((t) => t.product.name === "Carcass Lamb")).toBe(false);
    expect(list.problems.some((p) => p.product === "Carcass Lamb")).toBe(false);
  });

  it("counts labels and notices when orders change", () => {
    expect(list.total).toBe(7);
    const same = labelList([...orders].reverse(), products, boxes);
    expect(same.hash).toBe(list.hash);
    const changed = labelList([{ ...orders[0], lines: { rack: 13, letrim: 70 } }, orders[1]], products, boxes);
    expect(changed.hash).not.toBe(list.hash);
  });

  it("weight can't be checked for pieces with no weight per piece", () => {
    expect(table("BNLS Legs").weightUnknown).toBe(true);
    expect(table("Le Trim").weightUnknown).toBe(false);
  });

  it("names chain stores as the chain and the store, without its number", () => {
    expect(labelCustomer("#02 Kirkland", "PCC")).toBe("PCC Kirkland");
    expect(labelCustomer("SAC", "Corfini Gourmet")).toBe("Corfini Gourmet SAC");
    expect(labelCustomer("Key City", null)).toBe("Key City");
  });
});
