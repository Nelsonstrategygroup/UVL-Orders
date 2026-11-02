import { describe, expect, it } from "vitest";
import { blockPages, paginate } from "./calc/printPages";
import type { SheetLabel } from "./calc/packSheet";
import type { PackingData, PackOrder, PackProduct } from "./db/packing";
import { palletCustomers, palletLayout, palletTable, PALLET, shortGroup, WEIGH, weighLayout, weighLines, weighSections, weighTable } from "./packSheets";

describe("laying a printout out in pages and columns", () => {
  const size = { colH: 10, firstColH: 8, cols: 2 };

  it("keeps a section in one column, starting the next column when it doesn't fit", () => {
    const pages = paginate(
      [
        { head: 1, rows: [1, 1, 1] }, // 4
        { head: 1, rows: [1, 1, 1] }, // 4: fills page 1's first column (8)
        { head: 1, rows: [1, 1] }, // 3: next column
        { head: 1, rows: [1, 1, 1, 1, 1, 1] }, // 7: doesn't fit after it, so page 2
      ],
      size,
    );
    expect(pages.map((p) => p.cols.map((c) => c.map((x) => x.block)))).toEqual([[[0, 1], [2]], [[3]]]);
    expect([...blockPages(pages)]).toEqual([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 2],
    ]);
  });

  it("splits a section only when it's taller than a whole column, with its heading again", () => {
    const pages = paginate([{ head: 1, rows: Array(15).fill(1) }], size);
    const pieces = pages.flatMap((p) => p.cols.flat());
    expect(pieces.map((x) => [x.from, x.to, x.cont])).toEqual([
      [0, 7, false], // page 1's columns are 8 tall: heading + 7 rows
      [7, 14, true],
      [14, 15, true],
    ]);
    expect(pages).toHaveLength(2);
  });
});

const product = (id: string, name: string, sort: number, over: Partial<PackProduct> = {}): PackProduct => ({
  id,
  name,
  unit: "each",
  sort,
  lb_per_unit: null,
  per_box: null,
  active: true,
  group_name: "",
  box_lb_min: null,
  box_lb_max: null,
  label_name: "",
  pack_blanks: null,
  ...over,
});
const order = (id: string, customer: string, lines: Record<string, number>, over: Partial<PackOrder> = {}): PackOrder => ({
  id,
  customerId: `c-${id}`,
  customerName: customer,
  labelCustomer: customer,
  labelName: customer,
  labelLocation: "",
  sortKey: customer,
  standingNotes: "",
  orderNotes: "",
  group: "PCC distributor",
  spot: "",
  shipKey: "point:p",
  shipsToPointId: "p",
  lines,
  units: {},
  marks: {},
  weights: [],
  pallet: "",
  lastBy: null,
  lastAt: null,
  ...over,
});

describe("the Weigh Sheet and the Pallet Sheet (11/1/26)", () => {
  const products = new Map<string, PackProduct>([
    ["rack", product("rack", "Racks", 1, { label_name: "Single Pack Rack (Cap ON)" })],
    ["bis", product("bis", "BI Shoulder", 2)],
    ["heart", product("heart", "Heart", 3, { unit: "pack", packed_with: "Organs" })],
    ["liver", product("liver", "Liver", 4, { unit: "pack", packed_with: "Organs" })],
    ["kidney", product("kidney", "Kidney", 5, { unit: "pack", packed_with: "Organs" })],
  ]);
  const orders = [
    order("o1", "PCC #05 View Ridge", { rack: 10, heart: 8, liver: 8, kidney: 6 }),
    order("o2", "Key City", { rack: 2, bis: 4 }, { group: null, weights: [{ id: "w1", product_id: "rack", weight: 21.5, box_no: 1, by: null, at: "t", source: "weigh", gtin: null, serial: null, lot: null, case_no: null, pallet_id: null, client_id: null, slot: 1, label_no: null }] }),
  ];
  const data: PackingData = {
    week: "2026-11-02",
    processDate: null,
    labelsHash: null,
    labelsPrintedAt: null,
    invNumber: "3002",
    labelNumbers: new Map(),
    blanks: { unknown: 3, spare: 1 },
    unassigned: [],
    points: new Map(),
    company: "Umpqua Valley Lamb",
    shipFrom: "",
    products,
    orders,
  };
  // Racks: View Ridge 2 boxes, Key City 1; BI Shoulder: no box size; organs: one box.
  const labels: SheetLabel[] = [
    { key: "c-o1|rack|1", boxNo: 1, boxCount: 2 },
    { key: "c-o1|rack|2", boxNo: 2, boxCount: 2 },
    { key: "c-o1|heart|1", boxNo: 1, boxCount: 1 },
    { key: "c-o2|rack|1", boxNo: 1, boxCount: 1 },
    { key: "c-o2|bis|1", boxNo: 1, boxCount: 1, noBox: true },
  ];
  const sections = weighSections(data, labels);

  it("is by product, A to Z by the name on the label; Heart, Liver, Kidney is one product", () => {
    expect(sections.map((s) => s.name)).toEqual(["BI Shoulder", "Heart, Liver, Kidney", "Single Pack Rack (Cap ON)"]);
  });

  it("has a row per store in the usual order, as on the label, with a box per box plus one spare, or 3 when the box count isn't known", () => {
    const rack = sections.find((s) => s.productId === "rack")!;
    expect(rack.rows.map((r) => [r.customer, r.ordered, r.row.blanks.length])).toEqual([
      ["PCC #05 View Ridge", "10", 3],
      ["Key City", "2", 2],
    ]);
    expect(rack.rows[1].row.total).toBe(21.5);
    const bis = sections.find((s) => s.productId === "bis")!;
    expect(bis.rows.map((r) => [r.row.known, r.row.blanks.length])).toEqual([[false, 3]]);
    const organs = sections.find((s) => s.productId === "heart")!;
    expect(organs.rows.map((r) => [r.ordered, r.row.blanks.length])).toEqual([["H 8, L 8, K 6", 2]]);
  });

  it("a row with more boxes than fit on a line takes another line", () => {
    const four = { ...sections[0].rows[0], row: { ...sections[0].rows[0].row, blanks: Array(4).fill(sections[0].rows[0].row.blanks[0]) } };
    expect(weighLines(four)).toBe(2);
    expect(WEIGH.rowH).toBeGreaterThanOrEqual(0.3);
  });

  it("lays out pages with the spare rows last, and knows each product's page", () => {
    const l = weighLayout(sections);
    expect(l.pages).toHaveLength(1);
    expect(l.pageOf).toEqual([1, 1, 1, 1]);
    const lastCol = l.pages[0].cols[l.pages[0].cols.length - 1];
    expect(lastCol[lastCol.length - 1]).toMatchObject({ block: sections.length, from: 0, to: WEIGH.spareRows });
  });

  it("downloads the same rows with the INV# on top", () => {
    const t = weighTable(sections, "3002", "2026-11-02");
    expect(t.title).toBe("INV# 3002 · Weigh Sheet · Packing Mon Nov 2");
    expect(t.header).toEqual(["Product", "Customer", "Ordered", "Boxes", "Box 1 (lb)", "Box 2 (lb)", "Box 3 (lb)", "Total lbs"]);
    expect(t.rows.find((r) => r[1] === "Key City" && r[0] === "Single Pack Rack (Cap ON)")).toEqual(["Single Pack Rack (Cap ON)", "Key City", "2", 1, 21.5, "", "", 21.5]);
  });

  it("the Pallet Sheet: by store, a line per product ordered with its box count, ships to once", () => {
    const pc = palletCustomers(data, labels);
    expect(pc.map((c) => [c.customer, c.shipsTo, c.lines.map((l) => `${l.name} | ${l.boxes}`)])).toEqual([
      ["PCC #05 View Ridge", "PCC distributor", ["Single Pack Rack (Cap ON) | 2", "Heart, Liver, Kidney | 1"]],
      ["Key City", "Direct", ["Single Pack Rack (Cap ON) | 1", "BI Shoulder | ?"]],
    ]);
    expect(palletLayout(pc)).toHaveLength(1);
    expect(palletTable(pc, null, "2026-11-02").title).toBe("INV# ______ · Pallet Sheet · Packing Mon Nov 2");
    expect(PALLET.lineH).toBeGreaterThan(0.2);
  });

  it("shortens the organs for the column", () => {
    expect(shortGroup("8 packs Heart, 8 packs Liver, 6 packs Kidney")).toBe("H 8, L 8, K 6");
    expect(shortGroup("8 Heart, 2.5 lb Liver")).toBe("H 8, L 2.5 lb");
  });
});
