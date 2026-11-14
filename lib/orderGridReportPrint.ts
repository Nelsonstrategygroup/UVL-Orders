// The Order grid report on paper (/print/report/order-grid; Lucas, 11/13/26).
// The screen keeps its table; paper gets its own layout, because one table
// with every product was about 21 inches wide and the browser cut off
// everything past the page edge (Trim 5 lb through the pepper sticks).
//
// On paper:
// - Two sections, each starting on a new page with the customer column: the
//   main cuts (Whole Lamb through BI Shoulder), then stew meat, ground and
//   trim, organs, byproducts and prepared (not lamb: pepper sticks). A section never has
//   more than MAX_COLUMNS products; the main cuts' extras move to the start of
//   the next section.
// - Only customers with an order and products with a total that week.
// - A band above the headers names each group (Loins, Racks, Shanks...).
//   Setup's Byproducts split into Organs (packed in one box: Heart, Liver,
//   Kidney), Byproducts (the rest), and Prepared (not lamb); Stew Meat has its
//   own band in the second section (names 11/14/26).
// - Customers under a light label for their group: "PCC" over its stores,
//   "Other customers" over the rest. A small gap after every 4 rows of a group.
// - A long section flows onto more pages (flowPages): both header rows on
//   every page, no row split, "Continued" at the foot of every page but the
//   section's last, totals once at its end.
// - Short headers with the product's usual unit under them, words never
//   broken ("Jalapeno Honey Pepper Sticks" prints "Pepper Sticks").
// - A line taken in another unit shows in the column's unit with what was
//   ordered small under it ("12" over "(60 lb)"), so it adds up to the total.
// - Totals at the bottom (11/14/26: not repeated under the headers).
// - The customer name on the left, never wrapped, shortened: "PCC: #05 View
//   Ridge" prints "PCC 05 View Ridge". A customer with nothing in a section
//   isn't in it.
// - Every product column the same width, the same on both sections.

import { lineUnit, toProductUnit, unitWord } from "./calc/units";
import { displayName } from "./calc/customers";
import type { Customer, Order } from "./db/types";

/** The most product columns in one section beside the two name columns (about 0.42 in each on landscape Letter). */
export const MAX_COLUMNS = 16;

/** Setup groups that make up the main cuts, the first section. */
const MAIN_GROUPS = ["Whole lambs", "Loins and chops", "Racks", "Shanks", "Legs", "Shoulders"];

/** The band names for Setup's groups. */
const BAND: Record<string, string> = {
  "Whole lambs": "Whole lamb",
  "Loins and chops": "Loins",
  Racks: "Racks",
  Shanks: "Shanks",
  Legs: "Legs",
  Shoulders: "Shoulders",
  "Ground and trim": "Ground and trim",
};

export type GridReportProduct = {
  id: string;
  name: string;
  short_name?: string | null;
  unit: string;
  group_name: string;
  packed_with?: string | null;
  not_lamb?: boolean | null;
  lb_per_unit?: number | null;
  pieces_per_pack?: number | null;
};

export type GridReportColumn = { id: string; head: string; unit: string; band: string; bandStart: boolean };
export type GridReportSection = { columns: GridReportColumn[]; bands: { label: string; span: number }[] };
/** A cell: in the column's unit; `was` is what was ordered when it was in another unit ("(60 lb)"). */
export type GridReportCell = { n: string; was?: string };
export type GridReportPrint = {
  sections: GridReportSection[];
  /** The widest section's column count: every section's product columns are this wide. */
  slots: number;
  /** `group`: the chain a store belongs to ("PCC"), or "Other customers". */
  rows: { name: string; group: string; cells: Record<string, GridReportCell> }[];
  totals: Record<string, string>;
};

/** "PCC: #05 View Ridge" -> "PCC 05 View Ridge": no colon or number sign, so it reads in one piece. */
export function printName(name: string): string {
  return name.replace(/:\s*/g, " ").replace(/#/g, "").replace(/\s+/g, " ").trim();
}

/**
 * A product's header on paper: its short name, else its name. "Jalapeno
 * Honey Pepper Sticks" prints "Pepper Sticks" (Lucas, 11/14/26), unless plain
 * Pepper Sticks are on the same printout, where that would read twice.
 */
function printHead(p: GridReportProduct, all: GridReportProduct[]): string {
  const head = (p.short_name ?? "").trim() || p.name;
  const short = head.replace(/^jalape(n|ñ)o honey /i, "");
  if (short === head) return head;
  const clash = all.some((x) => x.id !== p.id && ((x.short_name ?? "").trim() || x.name).toLowerCase() === short.toLowerCase());
  return clash ? head : short;
}

/** Which band a product prints under, and whether it's a main cut. */
export function bandOf(p: GridReportProduct): { band: string; main: boolean } {
  const g = p.group_name || "Other";
  if (/stew/i.test(p.name)) return { band: "Stew meat", main: false };
  if (p.not_lamb) return { band: "Prepared", main: false };
  if (MAIN_GROUPS.includes(g)) return { band: BAND[g] ?? g, main: true };
  if (g === "Byproducts") return { band: (p.packed_with ?? "").trim() ? "Organs" : "Byproducts", main: false };
  return { band: BAND[g] ?? g, main: false };
}

/** The second section's bands in this order, whatever the products' order: one "Other" band, not two. */
const REST_ORDER = ["Stew meat", "Ground and trim", "Organs", "Byproducts", "Prepared"];
const restRank = (band: string) => {
  const i = REST_ORDER.indexOf(band);
  return i < 0 ? REST_ORDER.length - 1.5 : i; // another Setup group: before Prepared
};

/** The label over customers who aren't one of a chain's stores. */
export const OTHER_CUSTOMERS = "Other customers";

const round2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: number) => String(round2(v));

export function orderGridReportPrint(
  customers: Customer[],
  byId: Map<string, Customer>,
  orders: Map<string, Order>,
  /** In the screen's order (order-form groups). */
  products: GridReportProduct[],
  max = MAX_COLUMNS,
): GridReportPrint {
  // Rows: customers with something ordered; totals in each product's own unit.
  const total: Record<string, number> = {};
  const rows: GridReportPrint["rows"] = [];
  for (const c of customers) {
    const o = orders.get(c.id);
    if (!o) continue;
    const cells: Record<string, GridReportCell> = {};
    for (const p of products) {
      const q = o.lines[p.id] ?? 0;
      if (!(q > 0)) continue;
      total[p.id] = (total[p.id] ?? 0) + toProductUnit(q, o.units?.[p.id], p);
      const unit = lineUnit(p.id, p, o.units);
      cells[p.id] = unit === p.unit ? { n: num(q) } : { n: num(toProductUnit(q, unit, p)), was: `(${num(q)} ${unitWord(unit, q)})` };
    }
    const chain = c.parent_customer_id ? byId.get(c.parent_customer_id)?.name : undefined;
    if (Object.keys(cells).length) rows.push({ name: printName(displayName(c, byId)), group: chain ?? OTHER_CUSTOMERS, cells });
  }

  // Columns: products with a total, main cuts first, the rest after; the bands in the order they come.
  const used = products.filter((p) => (total[p.id] ?? 0) > 0);
  const col = (p: GridReportProduct): GridReportColumn => ({
    id: p.id,
    head: printHead(p, used),
    unit: unitWord(p.unit),
    band: bandOf(p).band,
    bandStart: false,
  });
  const main = used.filter((p) => bandOf(p).main).map(col);
  const rest = used
    .filter((p) => !bandOf(p).main)
    .map(col)
    .map((c, i) => ({ c, i }))
    .sort((a, b) => restRank(a.c.band) - restRank(b.c.band) || a.i - b.i)
    .map(({ c }) => c);
  // Too many main cuts for one page: the extras start the next section.
  const lists = [main.slice(0, max), [...main.slice(max), ...rest]];
  const sections: GridReportSection[] = [];
  for (const list of lists) {
    for (let i = 0; i < list.length; i += max) {
      const columns = list.slice(i, i + max).map((c, j, a) => ({ ...c, bandStart: j > 0 && c.band !== a[j - 1].band }));
      const bands: GridReportSection["bands"] = [];
      for (const c of columns) {
        const last = bands[bands.length - 1];
        if (last && last.label === c.band) last.span++;
        else bands.push({ label: c.band, span: 1 });
      }
      sections.push({ columns, bands });
    }
  }
  const totals = Object.fromEntries(used.map((p) => [p.id, num(total[p.id])]));
  return { sections, slots: Math.max(0, ...sections.map((s) => s.columns.length)), rows, totals };
}

/** One line of a printed section: a group's label, or a customer's row (a small gap after it ends a block of 4). */
export type FlowItem<R> = { kind: "label"; label: string } | { kind: "row"; row: R; gapAfter: boolean };

/**
 * A section's lines in print order: each group's label, then its rows, a gap
 * after every 4th row of a group (not after its last).
 */
export function flowItems<R extends { group: string }>(rows: R[]): FlowItem<R>[] {
  const out: FlowItem<R>[] = [];
  let group: string | null = null;
  let n = 0;
  rows.forEach((row, i) => {
    if (row.group !== group) {
      group = row.group;
      n = 0;
      out.push({ kind: "label", label: row.group });
    }
    n++;
    const last = rows[i + 1]?.group !== row.group;
    out.push({ kind: "row", row, gapAfter: n % 4 === 0 && !last });
  });
  return out;
}

export type FlowSizes = {
  /** Room for lines on a page, under the page heading and the column headers (px). */
  room: number;
  row: number;
  label: number;
  gap: number;
  /** The totals row, on the section's last page. */
  total: number;
  /** The "Continued" line at the foot of a page that isn't the section's last. */
  more: number;
};

const heightOf = <R,>(it: FlowItem<R>, z: FlowSizes) => (it.kind === "label" ? z.label : z.row + (it.gapAfter ? z.gap : 0));

/**
 * Lines onto pages: as many as fit, never a label alone at the foot of a page,
 * room for "Continued" on every page but the last, and the totals on the last.
 */
export function flowPages<R>(items: FlowItem<R>[], z: FlowSizes): FlowItem<R>[][] {
  const pages: FlowItem<R>[][] = [[]];
  let used = 0;
  items.forEach((it, i) => {
    const h = heightOf(it, z);
    // A label needs its first row with it.
    const next = it.kind === "label" && items[i + 1] ? heightOf(items[i + 1], z) : 0;
    if (pages[pages.length - 1].length && used + h + next > z.room - z.more) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(it);
    used += h;
  });
  // The last page also holds the totals: when they don't fit, its last row (and a label left alone) goes on.
  const last = pages[pages.length - 1];
  if (used + z.total > z.room && last.length > 1) {
    const moved = [last.pop()!];
    if (last[last.length - 1]?.kind === "label") moved.unshift(last.pop()!);
    pages.push(moved);
  }
  return pages;
}

