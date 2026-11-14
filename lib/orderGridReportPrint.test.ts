import { describe, expect, it } from "vitest";
import type { Customer, Order } from "./db/types";
import { bandOf, flowItems, flowPages, orderGridReportPrint, printName, type FlowItem, type GridReportProduct } from "./orderGridReportPrint";

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

  it("only customers with an order, names shortened to read in one piece, in their group", () => {
    expect(g.rows.map((r) => r.name)).toEqual(["PCC 05 View Ridge", "PCC 17 Burien", "Key City"]);
    expect(g.rows.map((r) => r.group)).toEqual(["PCC", "PCC", "Other customers"]);
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
    expect(g.sections[1].bands.map((b) => b.label)).toEqual(["Stew meat", "Ground and trim", "Organs", "Prepared"]);
    expect(g.sections[1].columns.map((c) => c.bandStart)).toEqual([false, true, true, false, true]);
    expect(bandOf(products.find((x) => x.id === "necks")!).band).toBe("Byproducts");
    // Byproducts on either side of the organs still print as one band, after Organs.
    const mixed = orderGridReportPrint(
      [cust("kc", "Key City")],
      new Map(),
      new Map([["kc", order({ necks: 2, heart: 1, bones: 5 })]]),
      [products.find((x) => x.id === "necks")!, products.find((x) => x.id === "heart")!, products.find((x) => x.id === "bones")!],
    );
    expect(mixed.sections[0].bands).toEqual([
      { label: "Organs", span: 1 },
      { label: "Byproducts", span: 2 },
    ]);
    expect(bandOf(products.find((x) => x.id === "bones")!).band).toBe("Byproducts");
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

describe("printed sections flow onto more pages (11/14/26)", () => {
  const rows = (pcc: number, other: number) => [
    ...Array.from({ length: pcc }, (_, i) => ({ name: `PCC ${i + 1}`, group: "PCC" })),
    ...Array.from({ length: other }, (_, i) => ({ name: `Other ${i + 1}`, group: "Other customers" })),
  ];
  const show = (it: FlowItem<{ name: string }>) => (it.kind === "label" ? `[${it.label}]` : `${it.row.name}${it.gapAfter ? " /" : ""}`);

  it("a label over each group, a gap after every 4 rows of a group but not after its last", () => {
    expect(flowItems(rows(9, 4)).map(show)).toEqual([
      "[PCC]", "PCC 1", "PCC 2", "PCC 3", "PCC 4 /", "PCC 5", "PCC 6", "PCC 7", "PCC 8 /", "PCC 9",
      "[Other customers]", "Other 1", "Other 2", "Other 3", "Other 4",
    ]);
  });

  const z = { room: 100, row: 10, label: 8, gap: 4, total: 12, more: 10 };
  const height = (p: FlowItem<{ name: string }>[]) => p.reduce((s, it) => s + (it.kind === "label" ? 8 : 10 + (it.gapAfter ? 4 : 0)), 0);

  it("45 customers: every page within its room, Continued's room kept on all but the last, totals' room on the last", () => {
    const pages = flowPages(flowItems(rows(30, 15)), { ...z, room: 300 });
    expect(pages.length).toBeGreaterThan(1);
    pages.slice(0, -1).forEach((p) => expect(height(p)).toBeLessThanOrEqual(300 - 10));
    expect(height(pages[pages.length - 1]) + 12).toBeLessThanOrEqual(300);
    // Every row printed once, in order.
    expect(pages.flat().filter((it) => it.kind === "row").length).toBe(45);
    expect(pages.flat().map(show)).toEqual(flowItems(rows(30, 15)).map(show));
  });

  it("never a label alone at the foot of a page", () => {
    for (let room = 40; room < 200; room += 3) {
      const pages = flowPages(flowItems(rows(6, 5)), { ...z, room });
      for (const p of pages) expect(p[p.length - 1].kind).toBe("row");
    }
  });

  it("all on one page when it fits", () => {
    expect(flowPages(flowItems(rows(3, 2)), z)).toHaveLength(1);
  });
});
