import { describe, expect, it } from "vitest";
import type { Customer, Order } from "./db/types";
import { bandOf, orderGridReportPrint, printName, type GridReportProduct } from "./orderGridReportPrint";

const cust = (id: string, name: string, parent: string | null = null) => ({ id, name, parent_customer_id: parent, active: true }) as unknown as Customer;
const order = (lines: Record<string, number>, units: Record<string, string> = {}) => ({ lines, units }) as unknown as Order;
const p = (id: string, name: string, group_name: string, extra: Partial<GridReportProduct> = {}): GridReportProduct => ({
  id,
  name,
  unit: "each",
  group_name,
  ...extra,
});

const products = [
  p("wl", "Whole Lamb", "Whole lambs"),
  p("loin", "Short Loin", "Loins and chops"),
  p("rack", "Racks", "Racks"),
  p("fs", "Front Shanks", "Shanks", { unit: "pack", pieces_per_pack: 2 }),
  p("sh", "BNLS Shoulder", "Shoulders", { lb_per_unit: 4.5 }),
  p("stew", "Stew Meat", "Shoulders", { unit: "lb" }),
  p("ground", "Ground Lamb 1 lb", "Ground and trim", { unit: "pack" }),
  p("heart", "Heart", "Byproducts", { unit: "pack", packed_with: "Organs" }),
  p("liver", "Liver", "Byproducts", { unit: "pack", packed_with: "Organs" }),
  p("necks", "Necks", "Byproducts"),
  p("pep", "Jalapeno Honey Pepper Sticks", "Byproducts", { unit: "case", not_lamb: true, short_name: "JH Pepper Sticks" }),
  p("bones", "Bones", "Byproducts", { unit: "lb" }),
];

describe("the Order grid report on paper (11/13/26)", () => {
  const pcc = cust("pcc", "PCC");
  const all = [pcc, cust("vr", "#05 View Ridge", "pcc"), cust("bur", "#17 Burien", "pcc"), cust("kc", "Key City"), cust("sf", "Seven Feathers")];
  const byId = new Map(all.map((c) => [c.id, c]));
  const orders = new Map([
    ["vr", order({ wl: 1, fs: 4, heart: 3, pep: 1 })],
    ["bur", order({ loin: 6, sh: 2, stew: 10, liver: 2 })],
    ["kc", order({ sh: 20, ground: 12 }, { sh: "lb" })],
    ["sf", order({})],
  ]);
  const g = orderGridReportPrint(all.slice(1), byId, orders, products);

  it("only customers with an order, names shortened to read in one piece", () => {
    expect(g.rows.map((r) => r.name)).toEqual(["PCC 05 View Ridge", "PCC 17 Burien", "Key City"]);
    expect(printName("PCC: #24 Central District")).toBe("PCC 24 Central District");
  });

  it("only products with a total, main cuts first, then the rest on a new section", () => {
    expect(g.sections.map((s) => s.columns.map((c) => c.id))).toEqual([
      ["wl", "loin", "fs", "sh"],
      ["stew", "ground", "heart", "liver", "pep"],
    ]);
    expect(g.slots).toBe(5);
  });

  it("a band for each group: Stew meat on its own, organs and other byproducts and not lamb apart", () => {
    expect(g.sections[0].bands).toEqual([
      { label: "Whole lamb", span: 1 },
      { label: "Loins", span: 1 },
      { label: "Shanks", span: 1 },
      { label: "Shoulders", span: 1 },
    ]);
    expect(g.sections[1].bands.map((b) => b.label)).toEqual(["Stew meat", "Ground and trim", "Organs", "Not lamb"]);
    expect(g.sections[1].columns.map((c) => c.bandStart)).toEqual([false, true, true, false, true]);
    expect(bandOf(products.find((x) => x.id === "necks")!).band).toBe("Other");
    // Other byproducts on either side of the organs still print as one band, after Organs.
    const mixed = orderGridReportPrint(
      [cust("kc", "Key City")],
      new Map(),
      new Map([["kc", order({ necks: 2, heart: 1, bones: 5 })]]),
      [products.find((x) => x.id === "necks")!, products.find((x) => x.id === "heart")!, products.find((x) => x.id === "bones")!],
    );
    expect(mixed.sections[0].bands).toEqual([
      { label: "Organs", span: 1 },
      { label: "Other", span: 2 },
    ]);
    expect(bandOf(products.find((x) => x.id === "bones")!).band).toBe("Other");
  });

  it("short headers with the usual unit; a line in another unit says so; totals in the column's unit", () => {
    const shoulder = g.sections[0].columns.find((c) => c.id === "sh")!;
    expect([shoulder.head, shoulder.unit]).toEqual(["BNLS Shoulder", "pcs"]);
    expect(g.sections[1].columns.find((c) => c.id === "pep")!.head).toBe("JH Pepper Sticks");
    // In another unit: the column's unit, with what was ordered under it (11/14/26).
    expect(g.rows.find((r) => r.name === "Key City")!.cells.sh).toEqual({ n: "4", was: "(20 lb)" });
    expect(g.rows.find((r) => r.name === "PCC 17 Burien")!.cells.sh).toEqual({ n: "2" });
    // 2 pieces + 20 lb at 4.5 lb a piece: 4 pieces (pounds become whole pieces, 11/7/26).
    expect(g.totals.sh).toBe("6");
    expect(g.totals.fs).toBe("4");
  });

  it("more main cuts than fit: the extras start the next section", () => {
    const many = Array.from({ length: 20 }, (_, i) => p(`m${i}`, `Cut ${i}`, "Legs"));
    const o = new Map([["kc", order(Object.fromEntries(many.map((x) => [x.id, 1])))]]);
    const r = orderGridReportPrint([cust("kc", "Key City")], new Map(), o, [...many, ...products]);
    expect(r.sections.map((s) => s.columns.length)).toEqual([16, 4]);
    expect(r.slots).toBe(16);
  });
});

describe("the Order grid report on paper, second pass (11/14/26)", () => {
  it("Jalapeno Honey Pepper Sticks prints as Pepper Sticks, unless plain Pepper Sticks print too", () => {
    const jh = p("jh", "Jalapeno Honey Pepper Sticks", "Byproducts", { unit: "case", not_lamb: true });
    const plain = p("ps", "Pepper Sticks", "Byproducts", { unit: "case", not_lamb: true });
    const run = (lines: Record<string, number>) =>
      orderGridReportPrint([cust("kc", "Key City")], new Map(), new Map([["kc", order(lines)]]), [plain, jh]).sections[0].columns.map((c) => c.head);
    expect(run({ jh: 1 })).toEqual(["Pepper Sticks"]);
    expect(run({ jh: 1, ps: 2 })).toEqual(["Pepper Sticks", "Jalapeno Honey Pepper Sticks"]);
  });

  it("Key City's 60 lb of 5 lb packs reads 12, with (60 lb) under it", () => {
    const g5 = p("g5", "Ground Lamb 5 lb", "Ground and trim", { unit: "pack", lb_per_unit: 5 });
    const r = orderGridReportPrint([cust("kc", "Key City")], new Map(), new Map([["kc", order({ g5: 60 }, { g5: "lb" })]]), [g5]);
    expect(r.rows[0].cells.g5).toEqual({ n: "12", was: "(60 lb)" });
    expect(r.totals.g5).toBe("12");
  });
});
