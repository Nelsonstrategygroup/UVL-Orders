import { describe, expect, it } from "vitest";
import { lineBoxWeights } from "./invoice";
import {
  boxEntryText,
  crossDockGroups,
  customerManifests,
  customersLine,
  lbWords,
  looseBoxWarnings,
  palletCountWarnings,
  manifestPages,
  manifestRowLines,
  palletPoint,
  palletPointProblem,
  shortBoxId,
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

  it("separate ship dates are separate sheets, numbered across the week (11/10/26)", () => {
    const { groups } = crossDockGroups([pallet("P1", [box("PCC #10 Issaquah", "Racks", 1)], "2026-11-04"), pallet("P2", [box("PCC #13 Edmonds", "Racks", 1)], "2026-11-05")], points);
    expect(groups.map((g) => [g.shipDate, g.pallets[0].name, g.pallets[0].of])).toEqual([
      ["2026-11-04", "Plymouth 1", 2],
      ["2026-11-05", "Plymouth 2", 2],
    ]);
  });

  it("three pallets to Plymouth: P2 is 2 of 3 (it printed \"1 of 1\" when printed alone)", () => {
    const three = ["P1", "P2", "P3"].map((t) => pallet(t, [box("PCC #10 Issaquah", "Racks", 1)], "2026-11-10"));
    const p2 = crossDockGroups(three, points).groups[0].pallets.find((r) => r.pallet.tag === "P2")!;
    expect([p2.name, p2.n, p2.of]).toEqual(["Plymouth 2", 2, 3]);
  });

  it("the manifest: one customer each, one row per product, its boxes by box ID, with count and total", () => {
    const [bv] = customerManifests([
      box("PCC #20 Bellevue", "Racks", 35.25, { boxId: "2630610044" }),
      box("PCC #20 Bellevue", "Sticks", 10, { boxId: "2628720009" }),
      box("PCC #20 Bellevue", "Racks", 14.7, { boxId: "2630610081" }),
      box("PCC #20 Bellevue", "Racks", 34.85, { boxId: "2630610049" }),
    ]);
    expect(bv.rows.map((r) => [r.product, r.boxes, r.entries.map((e) => e.text), r.lb])).toEqual([
      ["Racks", 3, ["610044 - 35.25", "610049 - 34.85", "610081 - 14.70"], 84.8],
      ["Sticks", 1, ["720009 - 10.00"], 10],
    ]);
    // The footer still counts boxes, not product rows.
    expect([bv.boxes, bv.lb]).toEqual([4, 94.8]);
  });

  it("box entries: last 6 digits of a scanned ID, other IDs whole, no weight shows the ID alone", () => {
    expect(shortBoxId("2631310167")).toBe("310167");
    expect(shortBoxId("123456")).toBe("123456");
    expect(shortBoxId("Label 38")).toBe("Label 38");
    expect(shortBoxId("Case 1234567")).toBe("Case 1234567");
    expect(shortBoxId("")).toBe("No label number");
    expect(boxEntryText({ boxId: "No label number", lb: 32.6 })).toBe("No label number - 32.60");
    expect(boxEntryText({ boxId: "2631310167", lb: null })).toBe("310167");
  });

  it("a product whose boxes have no weight has no total; one missing weight still totals the rest", () => {
    const [c] = customerManifests([
      box("Emerson", "Necks", null),
      box("Emerson", "Racks", 12.5),
      box("Emerson", "Racks", null),
    ]);
    expect(c.rows.map((r) => [r.product, r.boxes, r.lb])).toEqual([
      ["Necks", 1, null],
      ["Racks", 2, 12.5],
    ]);
  });

  it("one lot for the customer goes in the header only", () => {
    const [c] = customerManifests([box("Emerson", "Racks", 1, { lot: " 111326" }), box("Emerson", "Necks", 1, { lot: "111326" })]);
    expect(c.lot).toBe("111326");
    expect(c.rows.map((r) => r.lot)).toEqual(["", ""]);
    expect(c.rows.flatMap((r) => r.entries.map((e) => e.lot))).toEqual(["", ""]);
  });

  it("more than one lot: on the product row when its boxes share it, else on each box", () => {
    const [c] = customerManifests([
      box("Emerson", "Necks", 1, { lot: "111326", boxId: "2631310001" }),
      box("Emerson", "Necks", 1, { lot: "111326", boxId: "2631310002" }),
      box("Emerson", "Racks", 1, { lot: "111326", boxId: "2631310003" }),
      box("Emerson", "Racks", 1, { lot: "110926", boxId: "2631310004" }),
    ]);
    expect(c.lot).toBe("");
    expect(c.rows.map((r) => [r.product, r.lot, r.entries.map((e) => e.lot)])).toEqual([
      ["Necks", "111326", ["", ""]],
      ["Racks", "", ["111326", "110926"]],
    ]);
  });

  it("a box with no lot: nothing in the header, and the other boxes keep theirs", () => {
    const [c] = customerManifests([
      box("Emerson", "Necks", 1, { lot: "111326" }),
      box("Emerson", "Racks", 1, { lot: "", boxId: "2631310003" }),
      box("Emerson", "Racks", 1, { lot: "111326", boxId: "2631310004" }),
    ]);
    expect(c.lot).toBe("");
    expect(c.rows.map((r) => [r.product, r.lot, r.entries.map((e) => e.lot)])).toEqual([
      ["Necks", "111326", [""]],
      ["Racks", "", ["", "111326"]],
    ]);
    const [none] = customerManifests([box("Key City", "Racks", 1, { lot: "" })]);
    expect([none.lot, none.rows[0].lot, none.rows[0].entries[0].lot]).toEqual(["", "", ""]);
  });

  it("a row takes one line per 3 boxes, and more for a long product name", () => {
    const row = (product: string, n: number, lot = "") => ({ product, lot, entries: Array.from({ length: n }, (_, i) => ({ id: String(i), text: "x", lot: "" })) });
    expect([1, 3, 4, 6, 7].map((n) => manifestRowLines(row("Racks", n)))).toEqual([1, 1, 2, 2, 3]);
    expect(manifestRowLines(row("Jalapeno Honey Pepper Sticks", 1))).toBe(2);
    expect(manifestRowLines(row("Racks and Shanks", 1, "111326"))).toBe(2);
  });

  it("a long customer splits into pages by lines, the last leaving room for the total, no row split", () => {
    // Products A to F, 4 boxes each: 2 lines a row, 12 lines in all.
    const boxes = Array.from({ length: 24 }, (_, i) => box("PCC #20 Bellevue", "ABCDEF"[Math.floor(i / 4)], 1));
    const [{ rows }] = customerManifests(boxes);
    expect(rows).toHaveLength(6);
    const pages = manifestPages(rows, 5, 4);
    expect(pages.map((p) => p.map((r) => r.product).join(""))).toEqual(["AB", "CD", "EF"]);
    expect(manifestPages(rows.slice(0, 2), 5, 4)).toHaveLength(1);
    // Fits a full page but not the last one: the total goes on a page of its own.
    expect(manifestPages(rows.slice(0, 2), 5, 3).map((p) => p.length)).toEqual([2, 0]);
    // A row taller than a page still prints.
    expect(manifestPages(rows.slice(0, 1), 1, 1).map((p) => p.length)).toEqual([1, 0]);
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

  it("a box with no store is not assigned, on a pallet or not (11/17/26)", () => {
    expect(looseBoxWarnings([bx(null, "Unassigned", "Racks", "2631310099", null), bx(null, "Unassigned", "Necks", "No label number", "p1")])).toEqual([
      "2 boxes not assigned: Racks (2631310099); Necks. Assign them at the top of Packing.",
    ]);
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
