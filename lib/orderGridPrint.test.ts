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
    expect(pages.map((p) => [p.from, p.to, p.of, p.page, p.pages])).toEqual([
      [1, 14, 22, 1, 2],
      [15, 22, 22, 2, 2],
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
