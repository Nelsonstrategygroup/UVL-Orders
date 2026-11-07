// The two packing printouts (Lucas, 11/1/26), replacing the paper packing
// copy that ran about 13 pages:
//
// - Weigh Sheet: for writing each box's weight. Boxes come off the line on
//   carts by box size, products and customers mixed, so it's by product (the
//   name as on the box label, A to Z), then one row per store (as on the
//   label, in the usual customer order): what was ordered, a cell per box, a
//   Total lbs. No label numbers. "Type in from paper" is laid out the same.
// - Pallet Sheet: for building pallets. By store: a checkbox, the product,
//   what was ordered and how many boxes; Pallet and Initials once per store.
//
// Both are laid out in pages here (lib/calc/printPages.ts), with every height
// fixed, so the index and "page 2 of 5" are exact. The pages draw them with
// the same heights.

import { paginate, type Block, type Page } from "./calc/printPages";
import type { SheetLabel, SheetRow } from "./calc/packSheet";
import { orderSheet, packLines, sheetRowText, type PackingData, type PackOrder } from "./db/packing";
import { orderedWords } from "./calc/packing";
import type { Cell, Table } from "./reports";
import { weekName } from "./dates";
import { invLabel } from "./weekInv";

// --- Sizes, in inches. The pages use these, so what's drawn matches what's counted. ---

/** Weigh Sheet: Letter landscape, 0.4 in margins, two columns. */
export const WEIGH = {
  pageW: 10.2,
  pageH: 7.7,
  pageHead: 0.55,
  index: 0.5,
  colGap: 0.3,
  /** A section's heading: a gap, the product name, then the column names. */
  head: 0.6,
  /** One line of weight cells (at least 0.3 in, for writing with gloves on). */
  rowH: 0.32,
  /** Weight cells on one line; a row with more boxes takes another line. */
  perLine: 3,
  spareRows: 5,
} as const;

/** Pallet Sheet: Letter portrait, 0.4 in margins, two columns. */
export const PALLET = {
  pageW: 7.7,
  pageH: 10.2,
  pageHead: 0.62,
  colGap: 0.3,
  /** A store's heading: a gap, the name, then ships to and the Pallet and Initials blanks. */
  head: 0.66,
  lineH: 0.25,
} as const;

// --- Weigh Sheet ---

export type WeighRow = {
  order: PackOrder;
  row: SheetRow;
  /** As on the box label: "PCC #24 Central District". */
  customer: string;
  /** "8 packs", "45 lb", "H 8, L 8, K 6"; "not ordered" for a box packed anyway. */
  ordered: string;
};

export type WeighSection = {
  /** The row's product (for Heart, Liver, Kidney: the group's first product). */
  productId: string;
  /** As on the box label: its label name, or "Heart, Liver, Kidney". */
  name: string;
  rows: WeighRow[];
};

/** Lines of weight cells a row takes. */
export const weighLines = (r: WeighRow) => Math.max(1, Math.ceil(r.row.blanks.length / WEIGH.perLine));

/** "8 Heart, 8 Liver, 6 Kidney" -> "H 8, L 8, K 6": short enough for the column; the heading names them. */
export function shortGroup(text: string): string {
  return text
    .split(", ")
    .map((part) => {
      const m = part.match(/^(\S+(?: \S+)?) (.+)$/);
      if (!m) return part;
      const [, amount, name] = m;
      const n = amount.replace(/ (packs?|each)$/, "");
      return `${name.trim()[0]} ${n}`;
    })
    .join(", ");
}

/**
 * The Weigh Sheet's sections: every product being packed, A to Z by the name
 * on its label, and in each one a row per store in the usual customer order.
 * `extra` adds cells ("Add a box" on screen), by order|product.
 */
export function weighSections(data: PackingData, labels: SheetLabel[], extra: Record<string, number> = {}): WeighSection[] {
  const byProduct = new Map<string, WeighSection>();
  for (const o of data.orders) {
    const lines = new Map(packLines(o, data.products));
    const mine = Object.fromEntries(
      Object.entries(extra)
        .filter(([k]) => k.startsWith(`${o.id}|`))
        .map(([k, n]) => [k.slice(o.id.length + 1), n]),
    );
    for (const row of orderSheet(o, data, labels, mine)) {
      const t = sheetRowText(o, data, row.productId);
      const p = data.products.get(row.productId);
      const name = t.members.length > 1 ? t.name : (p?.label_name ?? "").trim() || t.name;
      const line = lines.get(row.productId);
      const ordered = t.ordered ? shortGroup(t.ordered) : line ? orderedWords(line) : "not ordered";
      let s = byProduct.get(row.productId);
      if (!s) byProduct.set(row.productId, (s = { productId: row.productId, name, rows: [] }));
      s.rows.push({ order: o, row, customer: o.labelCustomer, ordered });
    }
  }
  return [...byProduct.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export type WeighLayout = { sections: WeighSection[]; pages: Page[]; /** Page each section starts on, by section; the spare rows are the last block. */ pageOf: number[] };

/** The Weigh Sheet in pages: the sections, then the spare rows at the very end. */
export function weighLayout(sections: WeighSection[]): WeighLayout {
  const colH = WEIGH.pageH - WEIGH.pageHead;
  const blocks: Block[] = [
    ...sections.map((s) => ({ head: WEIGH.head, rows: s.rows.map((r) => weighLines(r) * WEIGH.rowH) })),
    { head: WEIGH.head, rows: Array.from({ length: WEIGH.spareRows }, () => WEIGH.rowH) },
  ];
  const pages = paginate(blocks, { colH, firstColH: colH - WEIGH.index, cols: 2 });
  const pageOf: number[] = [];
  pages.forEach((pg, i) => pg.cols.forEach((c) => c.forEach((x) => pageOf[x.block] ?? (pageOf[x.block] = i + 1))));
  return { sections, pages, pageOf };
}

// --- Pallet Sheet ---

export type PalletLine = {
  productId: string;
  name: string;
  ordered: string;
  /** How many boxes ("2"), or "?" when the box count isn't known. */
  boxes: string;
};

export type PalletCustomer = {
  order: PackOrder;
  customer: string;
  /** "PCC distributor" or "Direct". */
  shipsTo: string;
  lines: PalletLine[];
};

/** The Pallet Sheet: each store in the usual order, a line per product ordered. */
export function palletCustomers(data: PackingData, labels: SheetLabel[]): PalletCustomer[] {
  return data.orders.map((o) => {
    const lines = new Map(packLines(o, data.products));
    const out: PalletLine[] = [];
    for (const row of orderSheet(o, data, labels)) {
      const t = sheetRowText(o, data, row.productId);
      const line = lines.get(row.productId);
      // Only what's on the order (a box packed anyway isn't something to put on the pallet from here).
      if (!t.ordered && !line) continue;
      const p = data.products.get(row.productId);
      out.push({
        productId: row.productId,
        name: t.members.length > 1 ? t.name : (p?.label_name ?? "").trim() || t.name,
        ordered: t.ordered ?? (line ? orderedWords(line) : ""),
        boxes: row.known ? String(row.boxCount) : "?",
      });
    }
    return { order: o, customer: o.labelCustomer, shipsTo: o.group ? `${o.group}${o.spot ? `, ${o.spot}` : ""}` : "Direct", lines: out };
  });
}

/** The Pallet Sheet in pages. */
export function palletLayout(customers: PalletCustomer[]): Page[] {
  const colH = PALLET.pageH - PALLET.pageHead;
  return paginate(
    customers.map((c) => ({ head: PALLET.head, rows: c.lines.map(() => PALLET.lineH) })),
    { colH, firstColH: colH, cols: 2 },
  );
}

// --- Downloads: the same rows as a spreadsheet, the INV# on top. ---

/** The Weigh Sheet as rows: product, customer, ordered, boxes, each box's weight (blank to fill), total. */
export function weighTable(sections: WeighSection[], inv: string | null, week: string): Table {
  const most = Math.max(1, ...sections.flatMap((s) => s.rows.map((r) => r.row.blanks.length)));
  const header = ["Product", "Customer", "Ordered", "Boxes", ...Array.from({ length: most }, (_, i) => `Box ${i + 1} (lb)`), "Total lbs"];
  const rows: Cell[][] = sections.flatMap((s) =>
    s.rows.map((r) => [
      s.name,
      r.customer,
      r.ordered,
      r.row.known ? r.row.boxCount : "?",
      ...Array.from({ length: most }, (_, i) => r.row.blanks[i]?.weight?.weight ?? ""),
      r.row.total > 0 ? r.row.total : "",
    ]),
  );
  return { header, rows, title: `${invLabel(inv)} · Weigh Sheet · Packing ${weekName(week)}` };
}

/** The Pallet Sheet as rows: customer, ships to, product, ordered, boxes. */
export function palletTable(customers: PalletCustomer[], inv: string | null, week: string): Table {
  return {
    header: ["Customer", "Ships to", "Product", "Ordered", "Boxes"],
    rows: customers.flatMap((c) => c.lines.map((l) => [c.customer, c.shipsTo, l.name, l.ordered, l.boxes])),
    title: `${invLabel(inv)} · Pallet Sheet · Packing ${weekName(week)}`,
  };
}
