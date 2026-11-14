// The printed order grid (Lucas, 11/10/26). The grid on Orders scrolls
// sideways, so printing it cut off every product past the page edge (Necks,
// Bones, Tongue, Heart, Liver, Kidney and the pepper sticks on 11/9). On
// paper: only products with something ordered that week, a set number of
// product columns per landscape Letter page, the customer column repeated on
// every page, and each page saying which products it holds. Every product
// with an order prints.
//
// Kathy follows a column down to its total (Lucas, 11/13/26): the totals sit
// right under the column headers; every other column is shaded; a thicker
// line marks where one product group ends and the next begins; and every
// sheet has the same number of column slots, so columns are the same width
// and in the same places on each. A busy week prints on three sheets with
// wider columns rather than two cramped ones.

export type GridPrintProduct = { id: string; head: string; unit: string; group?: string };
/** A product on a sheet: shaded every other column, and whether a new group starts with it. */
export type GridPrintColumn = GridPrintProduct & { shaded: boolean; groupStart: boolean };
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
  products: GridPrintColumn[];
  /** Column slots on every sheet (the most products on any one), so widths match from sheet to sheet. */
  slots: number;
  /** 1-based: "Products 1 to 14 of 22". */
  from: number;
  to: number;
  of: number;
  page: number;
  pages: number;
};

/**
 * The most product columns on one landscape Letter sheet beside the customer
 * column: 13 keeps them about 0.6 in wide. A week with more products gets
 * another sheet, and the products are shared out evenly (27 products: three
 * sheets of 9, about 0.85 in each), not 13, 13 and 1.
 */
export const GRID_PRINT_COLUMNS = 13;

/**
 * The products to print (those with a quantity in any row or in the totals),
 * in the grid's order, split evenly into sheets.
 */
export function gridPrintPages(
  products: GridPrintProduct[],
  rows: GridPrintRow[],
  totals: Record<string, number>,
  perPage = GRID_PRINT_COLUMNS,
): GridPrintPage[] {
  const used = products.filter((p) => (totals[p.id] ?? 0) > 0 || rows.some((r) => !r.heading && r.cells[p.id]));
  if (!used.length) return [];
  const count = Math.ceil(used.length / perPage);
  const slots = Math.ceil(used.length / count);
  const pages: GridPrintPage[] = [];
  for (let i = 0, at = 0; i < count; i++) {
    // Even shares, the bigger ones first: 29 is 10, 10, 9.
    const n = Math.floor(used.length / count) + (i < used.length % count ? 1 : 0);
    const slice = used.slice(at, at + n);
    pages.push({
      products: slice.map((p, j) => ({
        ...p,
        shaded: j % 2 === 1,
        groupStart: j > 0 && (p.group ?? "") !== (slice[j - 1].group ?? ""),
      })),
      slots,
      from: at + 1,
      to: at + slice.length,
      of: used.length,
      page: i + 1,
      pages: count,
    });
    at += n;
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
