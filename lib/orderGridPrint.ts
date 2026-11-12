// The printed order grid (Lucas, 11/10/26). The grid on Orders scrolls
// sideways, so printing it cut off every product past the page edge (Necks,
// Bones, Tongue, Heart, Liver, Kidney and the pepper sticks on 11/9). On
// paper: only products with something ordered that week, a set number of
// product columns per landscape Letter page, the customer column repeated on
// every page, and each page saying which products it holds. Every product
// with an order prints.

export type GridPrintProduct = { id: string; head: string; unit: string };
export type GridPrintRow = {
  /** A chain's name above its stores: no cells. */
  heading?: boolean;
  name: string;
  /** A store under the chain heading above it. */
  under?: boolean;
  /** Product id -> what's in the cell ("12", "8 pk", "20 lb"). */
  cells: Record<string, string>;
};
export type GridPrintPage = {
  products: GridPrintProduct[];
  /** 1-based: "Products 1 to 14 of 22". */
  from: number;
  to: number;
  of: number;
  page: number;
  pages: number;
};

/** Product columns on one landscape Letter page, beside the customer column. */
export const GRID_PRINT_COLUMNS = 14;

/**
 * The products to print (those with a quantity in any row or in the totals),
 * in the grid's order, split into pages.
 */
export function gridPrintPages(
  products: GridPrintProduct[],
  rows: GridPrintRow[],
  totals: Record<string, number>,
  perPage = GRID_PRINT_COLUMNS,
): GridPrintPage[] {
  const used = products.filter((p) => (totals[p.id] ?? 0) > 0 || rows.some((r) => !r.heading && r.cells[p.id]));
  const pages: GridPrintPage[] = [];
  const count = Math.ceil(used.length / perPage);
  for (let i = 0; i < count; i++) {
    const slice = used.slice(i * perPage, (i + 1) * perPage);
    pages.push({ products: slice, from: i * perPage + 1, to: i * perPage + slice.length, of: used.length, page: i + 1, pages: count });
  }
  return pages;
}

/** Rows worth printing: customers with something ordered, and a chain heading only when one of its stores follows. */
export function gridPrintRows(rows: GridPrintRow[]): GridPrintRow[] {
  const out: GridPrintRow[] = [];
  let heading: GridPrintRow | null = null;
  for (const r of rows) {
    if (r.heading) {
      heading = r;
      continue;
    }
    // A customer with no chain ends the chain above it.
    if (!r.under) heading = null;
    if (!Object.values(r.cells).some(Boolean)) continue;
    if (heading) out.push(heading);
    heading = null;
    out.push(r);
  }
  return out;
}
