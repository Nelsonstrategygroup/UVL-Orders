// "Export all data" (SPEC 5.10): every table as a CSV file, in one zip.
// The owners must always be able to take their records with them.

import { csvCell } from "./import/csv";

/**
 * Every table, in the order to load them into a new database (README,
 * "Moving to new accounts"), with the columns that keep paging stable.
 */
export const EXPORT_TABLES: { table: string; order: string[] }[] = [
  { table: "app_settings", order: ["id"] },
  { table: "profiles", order: ["id"] },
  { table: "parts", order: ["id"] },
  { table: "size_classes", order: ["id"] },
  { table: "cut_specs", order: ["id"] },
  { table: "products", order: ["id"] },
  { table: "product_part_uses", order: ["product_id", "part_id"] },
  { table: "customers", order: ["id"] },
  { table: "customer_contacts", order: ["id"] },
  { table: "contact_log", order: ["id"] },
  { table: "weeks", order: ["id"] },
  { table: "orders", order: ["id"] },
  { table: "order_lines", order: ["order_id", "product_id"] },
  { table: "packing_lines", order: ["order_id", "product_id"] },
  { table: "packing_orders", order: ["order_id"] },
  { table: "cut_sheets", order: ["week_id"] },
  { table: "cut_sheet_banners", order: ["id"] },
  { table: "saving_goals", order: ["id"] },
  { table: "cut_sets", order: ["id"] },
  { table: "cut_set_lines", order: ["id"] },
  { table: "cut_set_customers", order: ["set_id", "customer_id"] },
  { table: "half_whole_orders", order: ["id"] },
  { table: "half_whole_choices", order: ["order_id", "part_id", "slot"] },
  { table: "freezer_log", order: ["id"] },
  { table: "audit_log", order: ["id"] },
];

/** Rows to CSV. Columns come from the first row's keys plus any later ones. */
export function toCsv(rows: Record<string, unknown>[]): string {
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const cell = (v: unknown) =>
    v == null ? "" : typeof v === "object" ? csvCell(JSON.stringify(v)) : csvCell(v as string | number | boolean);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

export function exportReadme(date: string, counts: { table: string; rows: number }[]): string {
  return [
    "Umpqua Valley Lamb Orders: all data",
    `Exported ${date}.`,
    "",
    "One CSV file per table. Load them into a new database in the order below so links line up",
    "(see the README in the code, \"Moving to new accounts\"). Login emails and passwords are not",
    "included; people are added again from the Users screen.",
    "",
    ...counts.map((c, i) => `${String(i + 1).padStart(2)}. ${c.table}.csv  (${c.rows} row${c.rows === 1 ? "" : "s"})`),
    "",
  ].join("\r\n");
}

/** Rows to an Excel sheet. Objects become JSON text; true/false become TRUE/FALSE. */
export function toSheet(name: string, rows: Record<string, unknown>[]): { name: string; header: string[]; rows: (string | number | null)[][] } {
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const cell = (v: unknown): string | number | null =>
    v == null
      ? null
      : typeof v === "number"
        ? v
        : typeof v === "boolean"
          ? v
            ? "TRUE"
            : "FALSE"
          : typeof v === "object"
            ? JSON.stringify(v)
            : String(v);
  return { name, header: cols, rows: rows.map((r) => cols.map((c) => cell(r[c]))) };
}
