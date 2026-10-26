import { describe, expect, it } from "vitest";
import { boxIdOf, buildManifest, lbText, manifestTable, netWeight, type ManifestBox } from "./manifest";

const box = (customer: string, product: string, lb: number | null, boxId = `${customer}-${product}-${lb}`): ManifestBox => ({
  id: boxId,
  customer,
  product,
  boxId,
  lot: "528801",
  lb,
});

describe("the pallet manifest", () => {
  it("groups by customer, stores sorted by number, rows by product, with totals", () => {
    const m = buildManifest([
      box("PCC #10 Issaquah", "Racks", 20.5),
      box("PCC #9 Green Lake", "Le Trim", 44.6),
      box("PCC #10 Issaquah", "BNLS Legs", 30.25),
      box("Key City", "Short Loin", 18),
    ]);
    expect(m.groups.map((g) => g.customer)).toEqual(["Key City", "PCC #9 Green Lake", "PCC #10 Issaquah"]);
    expect(m.groups[2].rows.map((r) => r.product)).toEqual(["BNLS Legs", "Racks"]);
    expect([m.groups[2].boxes, m.groups[2].lb]).toEqual([2, 50.75]);
    expect([m.boxes, m.lb, m.missing]).toEqual([4, 113.35, 0]);
  });

  it("a box with no weight is MISSING, counted as a box but not in the weight", () => {
    const m = buildManifest([box("A", "Racks", null), box("A", "Racks", 10)]);
    expect([m.boxes, m.lb, m.missing]).toEqual([2, 10, 1]);
    expect(lbText(null)).toBe("MISSING");
    expect(lbText(22.4)).toBe("22.40 lb");
    expect(netWeight(0)).toBeNull();
    expect(netWeight(Number.NaN)).toBeNull();
  });

  it("box IDs: the barcode serial, else the label number", () => {
    expect(boxIdOf({ serial: "2628710066", label_no: 14 })).toBe("2628710066");
    expect(boxIdOf({ serial: null, label_no: 14 })).toBe("Label 14");
    expect(boxIdOf({ serial: null, label_no: null })).toBe("");
  });

  it("the CSV has one row per box, the recorded weight, blank when missing", () => {
    const t = manifestTable([{ tag: "P1", manifest: buildManifest([box("A", "Racks", 20.456, "S1"), box("A", "Le Trim", null, "S2")]) }]);
    expect(t.header).toEqual(["Pallet", "Customer", "Box ID", "Lot", "Product", "Net weight (lb)"]);
    expect(t.rows).toEqual([
      ["P1", "A", "S2", "528801", "Le Trim", ""],
      ["P1", "A", "S1", "528801", "Racks", 20.46],
    ]);
  });
});
