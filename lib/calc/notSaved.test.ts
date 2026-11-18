import { describe, expect, it } from "vitest";
import { notSavedLine, notSavedScans, notSavedTitle, notSavedWarning, notSavedWhy, type DuplicateScanRow } from "./notSaved";

const row = (id: string, at: string, details: Record<string, unknown>, over: Partial<DuplicateScanRow> = {}): DuplicateScanRow => ({
  id,
  message: "Box 2631310052 was scanned twice. It is already recorded for Emerson.",
  order_id: null,
  product_id: "shanks",
  gtin: "111",
  serial: "2631310052",
  created_at: at,
  details: { weight: "32.6", lot: "110626", case_no: "10052", ...details },
  ...over,
});
const orders = [{ id: "o1", labelCustomer: "PCC #16 Bothell" }];

describe("scans not saved (11/17/26)", () => {
  it("shows one entry per label, keeping every try and the last store chosen", () => {
    const [s, ...rest] = notSavedScans(
      [row("c", "2026-11-16T23:47:00Z", { week_id: "2026-11-16", route: "unassigned" }), row("a", "2026-11-16T23:14:00Z", {}, { order_id: "o1" }), row("b", "2026-11-16T23:17:00Z", { order_id: "o1" })],
      "2026-11-16",
      orders,
    );
    expect(rest).toEqual([]);
    expect(s.ids).toEqual(["a", "b", "c"]);
    expect(notSavedLine(s, "Front Shanks")).toBe("Front Shanks · 32.60 lb · Lot 110626 · Case 10052");
    expect(notSavedWhy(s)).toBe("Label already used for Emerson. Scanned for PCC #16 Bothell.");
  });

  it("leaves out other weeks' scans", () => {
    expect(notSavedScans([row("a", "2026-11-09T10:00:00Z", { week_id: "2026-11-09" }), row("b", "2026-11-09T10:00:00Z", {}, { order_id: "old" })], "2026-11-16", orders)).toEqual([]);
  });

  it("drops a label once its box is recorded this week (11/18/26)", () => {
    const refused = [row("a", "2026-11-16T10:00:00Z", {}, { order_id: "o1" })];
    expect(notSavedScans(refused, "2026-11-16", [{ ...orders[0], weights: [{ gtin: "111", serial: "2631310052" }] }])).toEqual([]);
    expect(notSavedScans(refused, "2026-11-16", orders, [{ gtin: "111", serial: "2631310052" }])).toEqual([]);
    expect(notSavedScans(refused, "2026-11-16", [{ ...orders[0], weights: [{ gtin: "111", serial: "other" }] }])).toHaveLength(1);
  });

  it("copes with a scan missing its details", () => {
    const [s] = notSavedScans([row("a", "2026-11-16T10:00:00Z", {}, { order_id: "o1", details: null, message: "Refused." })], "2026-11-16", orders);
    expect(notSavedLine(s, "Racks")).toBe("Racks · No lot · No case number");
    expect(notSavedWhy(s)).toBe("Label already used. Scanned for PCC #16 Bothell.");
  });

  it("names the count, and warns before paperwork prints", () => {
    expect([notSavedTitle(1), notSavedTitle(2)]).toEqual(["1 scan not saved", "2 scans not saved"]);
    const scans = notSavedScans([row("a", "2026-11-16T10:00:00Z", {}, { order_id: "o1" })], "2026-11-16", orders);
    expect(notSavedWarning(scans, () => "Front Shanks")).toEqual(["1 scan not saved: Front Shanks (case 10052). That box isn't on any paperwork unless typed in."]);
    expect(notSavedWarning([], () => "")).toEqual([]);
  });
});
