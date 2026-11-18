import { describe, expect, it } from "vitest";
import { notAssignedBoxes, notAssignedLine, notAssignedTitle, nothingToPackWords } from "./notAssigned";

const box = (id: string, over: Partial<{ pallet_id: string | null; source: string; at: string }> = {}) => ({
  id,
  pallet_id: "p1" as string | null,
  source: "scan",
  at: "2026-11-16T10:00:00Z",
  ...over,
});

describe("boxes not assigned (11/17/26)", () => {
  it("lists boxes with no store first, then scanned boxes with no pallet, oldest first", () => {
    const list = notAssignedBoxes(
      [
        {
          id: "o1",
          labelCustomer: "PCC #16 Bothell",
          lines: {},
          weights: [box("on-pallet"), box("late", { pallet_id: null, at: "2026-11-16T12:00:00Z" }), box("typed-label", { pallet_id: null, source: "manual", at: "2026-11-16T09:00:00Z" })],
        },
      ],
      [box("loose-2", { pallet_id: null, at: "2026-11-16T11:00:00Z" }), box("loose-1", { pallet_id: null, source: "weigh", at: "2026-11-16T08:00:00Z" })],
    );
    expect(list.map((b) => [b.w.id, b.orderId, b.customer])).toEqual([
      ["loose-1", null, null],
      ["loose-2", null, null],
      ["typed-label", "o1", "PCC #16 Bothell"],
      ["late", "o1", "PCC #16 Bothell"],
    ]);
  });

  it("leaves out a box typed from paper that has a store: Pallets lists it", () => {
    expect(notAssignedBoxes([{ id: "o1", labelCustomer: "Emerson", lines: {}, weights: [box("paper", { pallet_id: null, source: "weigh" })] }], [])).toEqual([]);
  });

  it("says the count, and each box's product, weight, lot and case number", () => {
    expect([notAssignedTitle(1), notAssignedTitle(3)]).toEqual(["1 box not assigned", "3 boxes not assigned"]);
    expect(notAssignedLine({ product: "Racks", weight: 33.3, lot: "111326", caseNo: "10052", customer: null })).toBe("Racks · 33.30 lb · Lot 111326 · Case 10052");
    expect(notAssignedLine({ product: "Necks", weight: 20, lot: null, caseNo: " ", customer: "Emerson" })).toBe("Necks · 20.00 lb · No lot · No case number · Emerson, no pallet");
  });

  it("Packing says Everything is packed only when nothing is left unassigned", () => {
    expect(nothingToPackWords(0)).toBe("Everything is packed.");
    expect(nothingToPackWords(1)).toBe("All orders are packed, but 1 box not assigned. Assign it at the top of this page.");
    expect(nothingToPackWords(2)).toBe("All orders are packed, but 2 boxes not assigned. Assign them at the top of this page.");
    expect(nothingToPackWords(0, 1)).toBe("All orders are packed, but 1 scan not saved. See the top of this page.");
    expect(nothingToPackWords(1, 2)).toBe("All orders are packed, but 1 box not assigned and 2 scans not saved. See the top of this page.");
  });
});
