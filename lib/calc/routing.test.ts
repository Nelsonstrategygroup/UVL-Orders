import { describe, expect, it } from "vitest";
import { candidates, needFor, needWords, nextTag, palletFor, palletTotals, shipmentPallets, stillNeeds, type RouteOrder, type RoutePallet } from "./routing";
import type { SheetRow } from "./packSheet";

const row = (known: boolean, boxCount: number, filled: number, blanks = boxCount + 2): SheetRow => ({
  productId: "p",
  known,
  boxCount,
  total: 0,
  blanks: Array.from({ length: blanks }, (_, i) => ({
    slot: i + 1,
    labelNo: null,
    planned: i < boxCount,
    boxTypeId: null,
    weight: i < filled ? { id: `w${i}`, weight: 10, slot: i + 1, label_no: null } : null,
  })),
});
const line = (over: Partial<{ ordered: number; unit: string; weight: number; shorted: boolean; count: number | null }> = {}) => ({
  ordered: 10,
  unit: "each",
  weight: 0,
  shorted: false,
  count: null,
  ...over,
});
const order = (name: string, over: Partial<RouteOrder> = {}): RouteOrder => ({
  orderId: `o-${name}`,
  customerId: `c-${name}`,
  name,
  shipKey: `customer:c-${name}`,
  shipName: name,
  via: null,
  shipDate: null,
  need: { kind: "boxes", done: 0, total: 2 },
  progress: 0,
  ...over,
});
const pallet = (id: string, over: Partial<RoutePallet> = {}): RoutePallet => ({
  id,
  tag: id.toUpperCase(),
  status: "open",
  shipKeys: [],
  createdAt: "2026-10-26T15:00:00Z",
  plan: [],
  boxes: [],
  ...over,
});

describe("what a customer still needs", () => {
  it("in boxes when the box count is known", () => {
    const n = needFor(row(true, 3, 1), line(), null);
    expect(n).toEqual({ kind: "boxes", done: 1, total: 3 });
    expect(needWords(n)).toBe("needs 2 of 3 boxes");
    expect(stillNeeds(needFor(row(true, 3, 3), line(), null))).toBe(false);
  });

  it("in pounds when there's no box size but a weight is known", () => {
    expect(needFor(row(false, 0, 1, 6), line({ unit: "lb", ordered: 120, weight: 80 }), null)).toEqual({ kind: "lb", done: 80, total: 120 });
    const each = needFor(row(false, 0, 1, 6), line({ ordered: 10, weight: 30 }), 4);
    expect(each).toEqual({ kind: "lb", done: 30, total: 40 });
    expect(needWords(each)).toBe("needs 10 of 40 lb");
    expect(stillNeeds({ kind: "lb", done: 119.6, total: 120 })).toBe(false);
  });

  it("open until the line is marked done when nothing is known (Heart today)", () => {
    expect(stillNeeds(needFor(row(false, 0, 2, 6), line(), null))).toBe(true);
    expect(stillNeeds(needFor(row(false, 0, 2, 6), line({ shorted: true }), null))).toBe(false);
    expect(stillNeeds(needFor(row(false, 0, 2, 6), line({ count: 4 }), null))).toBe(false);
  });
});

describe("who the box is for", () => {
  it("soonest ship date, then furthest behind, then by name; done customers left out", () => {
    const list = candidates([
      order("Kirkland", { progress: 0.5 }),
      order("Bellevue", { progress: 0.1 }),
      order("Aardvark", { progress: 0.1 }),
      order("Done Co", { need: { kind: "boxes", done: 2, total: 2 } }),
      order("Not ordered", { need: null }),
      order("Ships Tuesday", { progress: 0.9, shipDate: "2026-10-27" }),
    ]);
    expect(list.map((o) => o.name)).toEqual(["Ships Tuesday", "Aardvark", "Bellevue", "Kirkland"]);
  });
});

describe("which pallet", () => {
  const kirkland = order("Kirkland", { shipKey: "point:pcc" });
  it("a pallet with a planned box still to fill comes first", () => {
    const planned = pallet("p9", { status: "planned", plan: [{ customerId: "c-Kirkland", productId: "rack", boxes: 1 }] });
    const open = pallet("p1", { shipKeys: ["point:pcc"], createdAt: "2026-10-26T16:00:00Z" });
    expect(palletFor(kirkland, "rack", [open, planned])?.id).toBe("p9");
    // Once its planned box is on it, the open pallet for the shipment.
    const filled = { ...planned, boxes: [{ customerId: "c-Kirkland", productId: "rack" }] };
    expect(palletFor(kirkland, "rack", [open, filled])?.id).toBe("p1");
  });

  it("the newest open pallet for the shipment; full and other shipments' pallets are skipped", () => {
    const pallets = [
      pallet("old", { shipKeys: ["point:pcc"], createdAt: "2026-10-26T15:00:00Z" }),
      pallet("new", { shipKeys: ["point:pcc"], createdAt: "2026-10-26T17:00:00Z" }),
      pallet("full", { shipKeys: ["point:pcc"], status: "full", createdAt: "2026-10-26T18:00:00Z" }),
      pallet("other", { shipKeys: ["customer:x"], createdAt: "2026-10-26T19:00:00Z" }),
    ];
    expect(palletFor(kirkland, "rack", pallets)?.id).toBe("new");
  });

  it("a store goes back to the pallet that already has its boxes, not the newest", () => {
    const pallets = [
      pallet("p1", { shipKeys: ["point:pcc"], createdAt: "2026-10-26T15:00:00Z", boxes: [{ customerId: "c-Kirkland", productId: "loin" }] }),
      pallet("p2", { shipKeys: ["point:pcc"], createdAt: "2026-10-26T17:00:00Z", boxes: [{ customerId: "c-Other", productId: "loin" }] }),
    ];
    expect(palletFor(kirkland, "rack", pallets)?.id).toBe("p1");
    // A store with nothing packed yet: the newest.
    expect(palletFor(order("New", { shipKey: "point:pcc" }), "rack", pallets)?.id).toBe("p2");
    expect(shipmentPallets(kirkland, pallets).map((p) => p.id)).toEqual(["p2", "p1"]);
  });

  it("a store planned onto a pallet goes there first, even a planned one, until it's full", () => {
    const pallets = [
      pallet("p1", { shipKeys: ["point:pcc"], createdAt: "2026-10-26T15:00:00Z", boxes: [{ customerId: "c-Kirkland", productId: "loin" }] }),
      pallet("p2", { shipKeys: ["point:pcc"], status: "planned", customers: ["c-Kirkland"] }),
    ];
    expect(palletFor(kirkland, "rack", pallets)?.id).toBe("p2");
    expect(palletFor(kirkland, "rack", [pallets[0], { ...pallets[1], status: "full" }])?.id).toBe("p1");
  });

  it("none: start one", () => {
    expect(palletFor(kirkland, "rack", [pallet("full", { shipKeys: ["point:pcc"], status: "full" })])).toBeNull();
  });

  it("offers the next tag", () => {
    expect(nextTag([])).toBe("P1");
    expect(nextTag([{ tag: "P3" }, { tag: "p7" }, { tag: "Left" }])).toBe("P8");
  });

  it("adds up a pallet, and by customer for a distributor's pallet", () => {
    const t = palletTotals([
      { customerId: "a", weight: 20.5 },
      { customerId: "a", weight: 10 },
      { customerId: "b", weight: 5.25 },
    ]);
    expect(t.boxes).toBe(3);
    expect(t.lb).toBe(35.75);
    expect(t.byCustomer.get("a")).toEqual({ boxes: 2, lb: 30.5 });
  });
});
