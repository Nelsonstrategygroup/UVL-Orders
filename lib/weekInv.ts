// The week's invoice number on every printout and download (Lucas, 10/31/26).
// Kathy tells weeks apart by it ("INV# 3001"), not by date. It's the WEEK
// number from weeks.invoice_number (Setup > Invoicing or the cut sheet), never
// a customer's invoice number (3001-NEWP), and never worked out here: a week
// without one prints a blank to write it in.

export const INV_BLANK = "______";

type Inv = string | number | null | undefined;

const clean = (n: Inv): string => (n == null ? "" : String(n).trim());

/** "INV# 3001", or "INV# ______" to write in. */
export function invLabel(n: Inv): string {
  return `INV# ${clean(n) || INV_BLANK}`;
}

/** The start of a file name: "INV3001", or "INV____" when the week has none. */
export function invFilePrefix(n: Inv): string {
  return `INV${clean(n) || "____"}`;
}

/**
 * More than one week: "INV# 2998 to 3002", lowest to highest. One number:
 * "INV# 3001". Weeks without a number are left out of the range; none at all
 * prints the blank.
 */
export function invRangeLabel(list: Inv[]): string {
  const nums = [...new Set(list.map(clean).filter(Boolean))];
  if (!nums.length) return invLabel(null);
  const sorted = nums.sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
  return sorted.length === 1 ? invLabel(sorted[0]) : `INV# ${sorted[0]} to ${sorted[sorted.length - 1]}`;
}

/** "Order grid" -> "Order Grid": the report name in a file name. */
function titleWords(s: string): string {
  return s.replace(/(^|\s)([a-z])/g, (_, sp: string, c: string) => sp + c.toUpperCase());
}

/** "INV3001 Order Grid 2026-10-26": the invoice number first, then what it is, then the date. Characters files can't hold are dropped. */
export function invFileName(n: Inv, title: string, date: string, prefix = invFilePrefix(n)): string {
  return `${prefix} ${titleWords(title)} ${date}`.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
}

/** The same for a report over several weeks: "INV2998-3002 Sales 2026-08-10 to 2026-10-26". */
export function invRangeFilePrefix(list: Inv[]): string {
  const label = invRangeLabel(list);
  return label === invLabel(null) ? invFilePrefix(null) : `INV${label.slice(5).replace(" to ", "-")}`;
}
