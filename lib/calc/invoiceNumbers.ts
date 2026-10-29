// Invoice numbers (SPEC 15.1): one number per week plus the location's code,
// "3001-NEWP"; a reissue adds -R1, -R2. Codes and numbers can be changed
// any time; the database keeps them unique.

/** A location code: 3 to 5 capital letters or digits. */
export function isInvoiceCode(v: string): boolean {
  return /^[A-Z0-9]{3,5}$/.test(v);
}

/** What someone typed as a code, cleaned up: capitals, no spaces or dashes. */
export function cleanCode(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "3001-NEWP", or "3001-NEWP-R1" for the first reissue. */
export function invoiceNumberText(weekNumber: number, code: string, reissue = 0): string {
  return `${weekNumber}-${code}${reissue > 0 ? `-R${reissue}` : ""}`;
}

/** The number to suggest for a week with none: one more than the highest used. */
export function suggestWeekNumber(weeks: { invoice_number: number | null }[]): number | null {
  const used = weeks.map((w) => w.invoice_number).filter((n): n is number => n != null);
  return used.length ? Math.max(...used) + 1 : null;
}

/** A typed week number: a whole number above 0, or null (blank or not a number). */
export function parseWeekNumber(v: string): number | null {
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}
