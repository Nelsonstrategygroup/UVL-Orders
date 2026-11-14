import { describe, expect, it } from "vitest";
import { gridPrintPages, gridPrintRows, type GridPrintProduct, type GridPrintRow } from "./orderGridPrint";

const products: GridPrintProduct[] = Array.from({ length: 30 }, (_, i) => ({ id: `p${i + 1}`, head: `Product ${i + 1}`, unit: "each" }));
const row = (name: string, cells: Record<string, string>): GridPrintRow => ({ name, cells });

describe("the printed order grid (11/10/26)", () => {
  it("every product with an order prints, however far across the grid it is", () => {
    // 22 products ordered, the last ones far to the right (Necks, Bones, Tongue, HLK, pepper sticks on 11/9).
    const cells = Object.fromEntries(products.slice(0, 20).map((p) => [p.id, "2"]));
    const rows = [row("Burien", cells), row("Port Townsend", { p29: "1", p30: "3" })];
    const pages = gridPrintPages(products, rows, {});
    expect(pages.flatMap((p) => p.products.map((x) => x.id))).toEqual([...products.slice(0, 20).map((p) => p.id), "p29", "p30"]);
    expect(pages.map((p) => [p.from, p.to, p.of, p.page, p.pages, p.slots])).toEqual([
      [1, 11, 22, 1, 2, 11],
      [12, 22, 22, 2, 2, 11],
    ]);
  });

  it("shared out evenly, the same column slots on every sheet (11/13/26)", () => {
    const all = (n: number) => gridPrintPages(products.slice(0, n), [row("Burien", Object.fromEntries(products.slice(0, n).map((p) => [p.id, "1"])))], {});
    // 29 ordered (Nov 16): 10, 10, 9, not 14, 14, 1.
    expect(all(29).map((p) => [p.products.length, p.slots])).toEqual([
      [10, 10],
      [10, 10],
      [9, 10],
    ]);
    // 27 (Nov 9): three sheets of 9. 26: two of 13. 13 or fewer: one sheet.
    expect(all(27).map((p) => p.products.length)).toEqual([9, 9, 9]);
    expect(all(26).map((p) => p.products.length)).toEqual([13, 13]);
    expect(all(13).map((p) => p.products.length)).toEqual([13]);
  });

  it("every other column shaded, and a thicker line where a new group starts (11/13/26)", () => {
    const g = (id: string, group: string): GridPrintProduct => ({ id, head: id, unit: "each", group });
    const list = [g("loin", "Loins"), g("chops", "Loins"), g("rack", "Racks"), g("hind", "Shanks"), g("front", "Shanks")];
    const [page] = gridPrintPages(list, [row("Burien", { loin: "1", chops: "1", rack: "1", hind: "1", front: "1" })], {});
    expect(page.products.map((p) => [p.id, p.shaded, p.groupStart])).toEqual([
      ["loin", false, false],
      ["chops", true, false],
      ["rack", false, true],
      ["hind", true, true],
      ["front", false, false],
    ]);
  });

  it("products nobody ordered are left off; one only in the totals (half and whole) still prints", () => {
    const pages = gridPrintPages(products, [row("Burien", { p3: "5" })], { p7: 2 });
    expect(pages).toHaveLength(1);
    expect(pages[0].products.map((p) => p.id)).toEqual(["p3", "p7"]);
  });

  it("nothing ordered: no pages", () => {
    expect(gridPrintPages(products, [row("Burien", {})], {})).toEqual([]);
  });

  it("only customers with an order, and a chain's heading only when one of its stores has one", () => {
    const rows: GridPrintRow[] = [
      { heading: true, name: "PCC", cells: {} },
      { ...row("#10 Issaquah", { p1: "4" }), under: true },
      { ...row("#11 Fremont", {}), under: true },
      { heading: true, name: "Corfini", cells: {} },
      { ...row("Corfini SF", {}), under: true },
      row("Emerson", { p2: "11" }),
    ];
    expect(gridPrintRows(rows).map((r) => r.name)).toEqual(["PCC", "#10 Issaquah", "Emerson"]);
  });
});
