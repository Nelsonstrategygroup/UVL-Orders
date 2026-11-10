import { describe, expect, it } from "vitest";
import { lineBoxWeights } from "./invoice";
import {
  crossDockGroups,
  customerManifests,
  customersLine,
  lbWords,
  looseBoxWarnings,
  palletCountWarnings,
  manifestPages,
  palletPoint,
  palletPointProblem,
  type PwBox,
  type PwDistributor,
  type PwPallet,
} from "./paperwork";

const PP: PwDistributor = { id: "pp", name: "Plymouth Poultry", shortName: "Plymouth", code: "PP", carrier: "Peterson", crossDock: "", color: "#3B5E27" };
const CG: PwDistributor = { id: "cg", name: "Corfini Gourmet", shortName: "Corfini", code: "CG", carrier: "", crossDock: "", color: "#7A3327" };
const points = new Map([PP, CG].map((d) => [d.id, d]));

let n = 0;
const box = (customer: string, product: string, lb: number | null, over: Partial<PwBox> = {}): PwBox => {
  const m = customer.match(/^(PCC) (#\d+ .*)$/);
  return {
    id: `b${++n}`,
    customerId: customer,
    customer,
    labelName: m ? m[1] : customer,
    labelLocation: m ? m[2] : "",
    pointId: customer.startsWith("PCC") || customer === "Key City" ? "pp" : customer === "Newport Ave" ? "cg" : null,
    product,
    boxId: String(2630610000 + n),
    lot: "103026",
    lb,
    at: "",
    ...over,
  };
};
const pallet = (tag: string, boxes: PwBox[], shipDate: string | null = null): PwPallet => ({ id: tag, tag, shipDate, boxes, planned: [] });

describe("the pallet paperwork (11/2/26)", () => {
  it("lists the stores on a pallet: PCC by number, others by name", () => {
    expect(customersLine({ boxes: [box("PCC #19 West Seattle", "Le Trim", 1), box("PCC #10 Issaquah", "Racks", 1), box("Key City", "Necks", 1), box("PCC #10 Issaquah", "Le Trim", 1)], planned: [] })).toBe(
      "PCC #10, 19, Key City",
    );
    expect(customersLine({ boxes: [box("PCC #05 View Ridge", "Racks", 1)], planned: [] })).toBe("PCC #05");
  });

  it("a pallet takes its customers' distributor; none set, or mixed, is a problem to fix in Setup", () => {
    const names = new Map([["pp", "Plymouth Poultry"], ["cg", "Corfini Gourmet"]]);
    expect(palletPoint({ boxes: [box("PCC #10 Issaquah", "Racks", 1)], planned: [] }).pointId).toBe("pp");
    const mixed = palletPoint({ boxes: [box("PCC #10 Issaquah", "Racks", 1), box("Newport Ave", "Racks", 1)], planned: [] });
    expect(palletPointProblem(mixed, names)).toBe("This pallet mixes distributors (Plymouth Poultry and Corfini Gourmet).");
    const none = palletPoint({ boxes: [box("Emerson", "Racks", 1)], planned: [] });
    expect(palletPointProblem(none, names)).toBe("Emerson needs a distributor in Setup > Ships to.");
    // An unassigned box has no store yet: it doesn't decide the distributor.
    expect(palletPoint({ boxes: [box("PCC #10 Issaquah", "Racks", 1), box("Unassigned", "Racks", 1, { customerId: null, pointId: null })], planned: [] }).pointId).toBe("pp");
  });

  it("numbers pallets within the distributor and ship date by tag, with cases and weight from the boxes", () => {
    const { groups, blocked } = crossDockGroups(
      [
        pallet("P3", [box("PCC #13 Edmonds", "Racks", 10)]),
        pallet("P1", [box("PCC #10 Issaquah", "Racks", 20.5), box("PCC #10 Issaquah", "Le Trim", null)]),
        pallet("P4", [box("Newport Ave", "Racks", 7.25)]),
        pallet("P2", [box("Key City", "Necks", 1.25)]),
        pallet("P5", [box("Emerson", "Racks", 3)]),
      ],
      points,
    );
    expect(groups.map((g) => [g.point.code, g.pallets.map((r) => `${r.pallet.tag}=${r.name} ${r.n} of ${r.of}`), g.cases, g.lb, g.missing])).toEqual([
      ["CG", ["P4=Corfini 1 1 of 1"], 1, 7.25, 0],
      ["PP", ["P1=Plymouth 1 1 of 3", "P2=Plymouth 2 2 of 3", "P3=Plymouth 3 3 of 3"], 4, 31.75, 1],
    ]);
    expect(blocked.map((b) => [b.pallet.tag, b.problem])).toEqual([["P5", "Emerson needs a distributor in Setup > Ships to."]]);
    expect(lbWords(2770.05)).toBe("2,770.05 lb");
  });

  it("separate ship dates are separate sheets", () => {
    const { groups } = crossDockGroups([pallet("P1", [box("PCC #10 Issaquah", "Racks", 1)], "2026-11-04"), pallet("P2", [box("PCC #13 Edmonds", "Racks", 1)], "2026-11-05")], points);
    expect(groups.map((g) => [g.shipDate, g.pallets[0].name, g.pallets[0].of])).toEqual([
      ["2026-11-04", "Plymouth 1", 1],
      ["2026-11-05", "Plymouth 1", 1],
    ]);
  });

  it("the manifest: one customer each, a row per box by product then box ID, a subtotal under 2 or more boxes", () => {
    const [bv] = customerManifests([
      box("PCC #20 Bellevue", "Racks", 35.25, { boxId: "2630610044" }),
      box("PCC #20 Bellevue", "Jalapeno Honey Pepper Sticks", 10, { boxId: "2628720009", lot: "092426" }),
      box("PCC #20 Bellevue", "Racks", 14.7, { boxId: "2630610081" }),
      box("PCC #20 Bellevue", "Racks", 34.85, { boxId: "2630610049" }),
    ]);
    expect(bv.rows.map((r) => (r.kind === "box" ? `${r.box.product} ${r.box.boxId}` : `SUB ${r.product} · ${r.boxes} boxes · ${lbWords(r.lb)}`))).toEqual([
      "Jalapeno Honey Pepper Sticks 2628720009",
      "Racks 2630610044",
      "Racks 2630610049",
      "Racks 2630610081",
      "SUB Racks · 3 boxes · 84.80 lb",
    ]);
    expect([bv.boxes, bv.lb]).toEqual([4, 94.8]);
  });

  it("a long customer splits into pages, the last leaving room for the total, a subtotal kept with its boxes", () => {
    const rows = customerManifests(Array.from({ length: 12 }, (_, i) => box("PCC #20 Bellevue", i < 6 ? "A" : "B", 1))).flatMap((c) => c.rows);
    expect(rows).toHaveLength(14);
    const pages = manifestPages(rows, 6, 4);
    expect(pages.map((p) => p.length).reduce((a, b) => a + b, 0)).toBe(14);
    expect(pages.at(-1)!.length).toBeLessThanOrEqual(4);
    for (const p of pages.slice(1)) expect(p[0].kind).toBe("box");
    expect(manifestPages(rows.slice(0, 3), 6, 4)).toHaveLength(1);
  });
});

describe("box weights on invoices (11/2/26)", () => {
  const lines = [
    { id: "l1", kind: "packed" as const, product_id: "le-trim", price_unit: "lb" as const },
    { id: "l2", kind: "packed" as const, product_id: "sticks", price_unit: "case" as const },
    { id: "l3", kind: "shorted" as const, product_id: "racks", price_unit: "lb" as const },
    { id: "l4", kind: "packed" as const, product_id: "heart", price_unit: "lb" as const },
  ];
  const boxes = [
    { product_id: "le-trim", weight: "21.7", serial: "2630610106", label_no: 2 },
    { product_id: "le-trim", weight: 41.35, serial: "2630610092", label_no: 1 },
    { product_id: "sticks", weight: 10, serial: "2628720009", label_no: null },
    { product_id: "racks", weight: 12, serial: "1", label_no: null },
    { product_id: "kidney", weight: 6.1, serial: "2630610152", label_no: null },
  ];
  const lead = (id: string) => (["heart", "liver", "kidney"].includes(id) ? "heart" : id);
  const w = lineBoxWeights(lines, boxes, lead);

  it("lists each box's weight in the order packed, under its line; one box too", () => {
    expect(w.get("l1")).toEqual([41.35, 21.7]);
    expect(w.get("l4")).toEqual([6.1]);
  });

  it("no weights for a per-case line or a line that didn't ship", () => {
    expect(w.has("l2")).toBe(false);
    expect(w.has("l3")).toBe(false);
  });
});

describe("warnings before pallet paperwork prints (11/10/26)", () => {
  const bx = (customerId: string | null, customer: string, product: string, boxId: string, palletId: string | null) => ({ customerId, customer, product, boxId, palletId });
  const week = [
    bx("burien", "PCC #17 Burien", "Front Shanks", "2631310042", "p2"),
    bx("redmond", "PCC #12 Redmond", "Front Shanks", "Label 38", null),
    bx("redmond", "PCC #12 Redmond", "Racks", "2631310050", "p2"),
    bx("kirkland", "PCC #23 Kirkland", "Racks", "2631310060", "p1"),
  ];
  const pallets = [
    { id: "p1", tag: "P1", customers: ["kirkland"] },
    { id: "p2", tag: "P2", customers: ["burien", "redmond"] },
  ];

  it("every box on no pallet, by customer and product", () => {
    expect(looseBoxWarnings(week)).toEqual([
      "1 box is on no pallet, so not on any manifest: PCC #12 Redmond, Front Shanks (Label 38). Put it on a pallet on the Pallets page.",
    ]);
    expect(looseBoxWarnings(week.filter((b) => b.palletId))).toEqual([]);
  });

  it("names six, then counts the rest", () => {
    const many = Array.from({ length: 8 }, (_, i) => bx("x", "Emerson", "Racks", `S${i}`, null));
    expect(looseBoxWarnings(many)[0]).toContain("Emerson, Racks (S5); and 2 more.");
  });

  it("a pallet's boxes against the stores planned onto it, saying where the difference is", () => {
    expect(palletCountWarnings(week, pallets)).toEqual([
      "P2: 3 boxes packed for its stores, 2 on its manifest. Not on P2: PCC #12 Redmond, Front Shanks (Label 38), on no pallet.",
    ]);
  });

  it("a box on another pallet, and a box from a store not planned onto it", () => {
    const moved = [bx("kirkland", "PCC #23 Kirkland", "Racks", "2631310060", "p2"), bx("burien", "PCC #17 Burien", "Racks", "1", "p2")];
    expect(palletCountWarnings(moved, pallets)).toEqual([
      "P1: 1 box packed for its stores, 0 on its manifest. Not on P1: PCC #23 Kirkland, Racks (2631310060), on P2.",
      "P2: 1 box packed for its stores, 2 on its manifest. On P2 but not one of its stores: PCC #23 Kirkland, Racks (2631310060).",
    ]);
  });

  it("matching pallets, and pallets with no stores planned, say nothing", () => {
    expect(palletCountWarnings(week.filter((b) => b.palletId), pallets)).toEqual([]);
    expect(palletCountWarnings(week, [{ id: "p5", tag: "P5", customers: [] }])).toEqual([]);
  });
});
