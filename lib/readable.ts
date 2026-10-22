// A download table as a page people read (change request 10/21/26): the
// same rows as the spreadsheet, so the two always agree. On a phone, one card
// per customer, product or week; on a wide screen and on paper, a table.
// Pure, so the shape of each report is tested.

import type { Table } from "./reports";

type Cell = Table["rows"][number][number];

export type ReadableShape = {
  /** Columns with one value for the whole report ("Week of"): shown once at the top. */
  constant?: string[];
  /** One card per value of this column (a customer, a week); otherwise one card per row. */
  groupBy?: string;
  /** With groupBy: the columns that differ row to row inside a card (the products). */
  items?: string[];
  /** Columns kept even when empty everywhere (a blank Notes column to write on). */
  keep?: string[];
};

export type Field = { label: string; value: string };
export type CardItem = { title: string; fields: Field[] };
export type Card = { title: string; fields: Field[]; items: CardItem[] };

export type Readable = {
  /** "Week of: 2026-10-19", shown under the title. */
  constants: Field[];
  /** The table: every column that isn't constant and isn't empty in every row. */
  columns: string[];
  rows: string[][];
  /** Group headings and the totals line, by row (see Table.rowKinds). */
  kinds: ("section" | "total" | undefined)[];
  cards: Card[];
};

const text = (v: Cell): string => (v == null ? "" : String(v));

/**
 * Item fields as people say them: a quantity reads bare ("20"), and a unit
 * joins the number before it ("20 lb", "Ordered 6 each").
 */
function tidyItem(fields: Field[]): Field[] {
  const out: Field[] = [];
  for (const f of fields) {
    const prev = out[out.length - 1];
    if (f.label === "Unit" && prev) prev.value = `${prev.value} ${f.value}`;
    else out.push(f.label === "Quantity" ? { label: "", value: f.value } : { ...f });
  }
  return out;
}

export function readable(t: Table, shape: ReadableShape = {}): Readable {
  const constantSet = new Set(shape.constant ?? []);
  const keepSet = new Set(shape.keep ?? []);
  const keep = t.header
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => !constantSet.has(h) && (keepSet.has(h) || t.rows.some((r) => text(r[i]) !== "")));
  const kinds = t.rows.map((_, i) => t.rowKinds?.[i]);
  const constants = t.header
    .map((h, i) => ({ label: h, value: text(t.rows[0]?.[i]) }))
    .filter((f) => constantSet.has(f.label) && f.value !== "");
  const rows = t.rows.map((r) => keep.map(({ i }) => text(r[i])));
  const columns = keep.map(({ h }) => h);
  const col = (name: string) => columns.indexOf(name);
  const fieldsOf = (r: string[], skip: Set<number>): Field[] =>
    columns.map((label, i) => ({ label, value: r[i] })).filter((f, i) => !skip.has(i) && f.value !== "");

  const cards: Card[] = [];
  const g = shape.groupBy ? col(shape.groupBy) : -1;
  if (g < 0) {
    rows.forEach((r, i) => kinds[i] !== "section" && cards.push({ title: r[0] ?? "", fields: fieldsOf(r, new Set([0])), items: [] }));
    return { constants, columns, rows, kinds, cards };
  }

  const itemCols = (shape.items ?? []).map(col).filter((i) => i >= 0);
  const byKey = new Map<string, Card>();
  for (const r of rows) {
    const key = r[g];
    let card = byKey.get(key);
    if (!card) {
      card = { title: key, fields: fieldsOf(r, new Set([g, ...itemCols])), items: [] };
      byKey.set(key, card);
      cards.push(card);
    }
    const [first, ...rest] = itemCols;
    if (first == null || r[first] === "") continue;
    card.items.push({ title: r[first], fields: tidyItem(rest.map((i) => ({ label: columns[i], value: r[i] })).filter((f) => f.value !== "")) });
  }
  return { constants, columns, rows, kinds, cards };
}
