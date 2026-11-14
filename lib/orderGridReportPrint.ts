// The Order grid report on paper (/print/report/order-grid; Lucas, 11/13/26).
// The screen keeps its table; paper gets its own layout, because one table
// with every product was about 21 inches wide and the browser cut off
// everything past the page edge (Trim 5 lb through the pepper sticks).
//
// On paper:
// - Two sections, each starting on a new page with the customer column: the
//   main cuts (Whole Lamb through BI Shoulder), then stew meat, ground and
//   trim, organs, other byproducts and what isn't lamb. A section never has
//   more than MAX_COLUMNS products; the main cuts' extras move to the start of
//   the next section.
// - Only customers with an order and products with a total that week.
// - A band above the headers names each group (Loins, Racks, Shanks...).
//   Byproducts split into Organs (packed in one box: Heart, Liver, Kidney),
//   Other, and Not lamb; Stew Meat has its own band in the second section.
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
  rows: { name: string; cells: Record<string, GridReportCell> }[];
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
  if (p.not_lamb) return { band: "Not lamb", main: false };
  if (MAIN_GROUPS.includes(g)) return { band: BAND[g] ?? g, main: true };
  if (g === "Byproducts") return { band: (p.packed_with ?? "").trim() ? "Organs" : "Other", main: false };
  return { band: BAND[g] ?? g, main: false };
}

/** The second section's bands in this order, whatever the products' order: one "Other" band, not two. */
const REST_ORDER = ["Stew meat", "Ground and trim", "Organs", "Other", "Not lamb"];
const restRank = (band: string) => {
  const i = REST_ORDER.indexOf(band);
  return i < 0 ? REST_ORDER.length - 1.5 : i; // another Setup group: before Not lamb
};

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
    if (Object.keys(cells).length) rows.push({ name: printName(displayName(c, byId)), cells });
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
