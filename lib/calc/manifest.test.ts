import { describe, expect, it } from "vitest";
import { boxEntry, boxIdOf, buildManifest, duplicateBoxIds, lbText, manifestTable, netWeight, oneLot, productRows, productTotalText, type ManifestBox } from "./manifest";

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

describe("the manifest by product (11/2/26)", () => {
  const b = (product: string, boxId: string, lb: number | null, lot = "103026"): ManifestBox => ({ id: boxId, customer: "PCC #19 West Seattle", product, boxId, lot, lb });

  it("one row per product, sorted by name, every box ID with its own weight, the product's total", () => {
    const rows = productRows([b("Le Trim", "2630610105", 21), b("BNLS Legs", "2630610200", 30.5), b("Le Trim", "2630610100", 40.9)]);
    expect(rows.map((r) => [r.product, r.boxes.length, r.boxes.map((x) => boxEntry(x, false)).join(", "), productTotalText(r)])).toEqual([
      ["BNLS Legs", 1, "2630610200 (30.50)", "30.50 lb"],
      ["Le Trim", 2, "2630610100 (40.90), 2630610105 (21.00)", "61.90 lb"],
    ]);
  });

  it("a box with no weight shows MISSING in the list and the total", () => {
    const [r] = productRows([b("Racks", "1", null), b("Racks", "2", 20)]);
    expect(r.boxes.map((x) => boxEntry(x, false))).toEqual(["1 (MISSING)", "2 (20.00)"]);
    expect(productTotalText(r)).toBe("20.00 lb + 1 MISSING");
  });

  it("one lot for the whole pallet goes in the header; when lots differ, each box ID carries its lot", () => {
    expect(oneLot(buildManifest([b("Racks", "1", 1), b("Le Trim", "2", 2)]))).toBe("103026");
    expect(oneLot(buildManifest([b("Racks", "1", 1), b("Le Trim", "2", 2, "092426")]))).toBeNull();
    expect(boxEntry(b("Racks", "2628720009", 10, "092426"), true)).toBe("092426-2628720009 (10.00)");
  });

  it("finds a box ID used more than once in the week, and where", () => {
    expect(
      duplicateBoxIds([
        { boxId: "2630610046", where: "#13 Edmonds · Racks · P2" },
        { boxId: "2630610046", where: "#14 GL Village · Short Loin · P1" },
        { boxId: "2630610100", where: "#19 West Seattle · Le Trim · P1" },
        { boxId: "", where: "typed in" },
        { boxId: "", where: "typed in" },
      ]),
    ).toEqual([{ boxId: "2630610046", where: ["#13 Edmonds · Racks · P2", "#14 GL Village · Short Loin · P1"] }]);
  });

  it("the CSV is still one row per box", () => {
    const t = manifestTable([{ tag: "P1", manifest: buildManifest([b("Le Trim", "2630610100", 40.9), b("Le Trim", "2630610105", 21)]) }]);
    expect(t.rows).toHaveLength(2);
  });
});
