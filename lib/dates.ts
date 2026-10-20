// Calendar dates as "YYYY-MM-DD" strings, in Pacific time.
//
// The order week (Lucas, 10/20/26) runs Thursday through Wednesday: orders
// are taken Thursday, Mohawk processes and staff pack on Monday, invoices go
// out Tuesday, and boxes ship Tuesday or Thursday. Each week is named and
// stored by its packing Monday (weeks.id is that Monday).

import { TIME_ZONE, zonedParts } from "./auth/session";

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type DayName = (typeof DAYS)[number];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today's date in Pacific time. */
export function todayISO(now: Date = new Date()): string {
  const p = zonedParts(now, TIME_ZONE);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Today's weekday name in Pacific time, e.g. "Tuesday". */
export function todayName(now: Date = new Date()): DayName {
  return DAYS[parse(todayISO(now)).getUTCDay()];
}

export function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

/** The Monday of the week containing `date`. */
export function mondayOf(date: string): string {
  const k = (parse(date).getUTCDay() + 6) % 7;
  return addDays(date, -k);
}

/**
 * The packing Monday of the order week containing `date` (Thursday through
 * Wednesday): Thursday to Sunday look ahead to the coming Monday; Monday to
 * Wednesday belong to that Monday.
 */
export function packingMonday(date: string): string {
  const day = parse(date).getUTCDay(); // 0 Sunday ... 6 Saturday
  return addDays(date, day >= 4 || day === 0 ? (8 - day) % 7 : 1 - day);
}

/** The order week we're in today, by its packing Monday. */
export function currentWeek(now: Date = new Date()): string {
  return packingMonday(todayISO(now));
}

/** The seven days of an order week, Thursday through Wednesday. */
export function weekDays(week: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(week, i - 4));
}

/** "Mon Oct 26": how a week is named everywhere. */
export function weekName(week: string): string {
  return `Mon ${niceDate(week)}`;
}

/** "Oct 5" */
export function niceDate(date: string | null | undefined): string {
  if (!date) return "";
  const d = parse(date);
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Wednesday, Oct 7" */
export function longDate(date: string | null | undefined): string {
  if (!date) return "";
  return `${DAYS[parse(date).getUTCDay()]}, ${niceDate(date)}`;
}

/** "today", "yesterday", "5 days ago", or "Sep 2" for older. */
export function ago(at: string | Date | null | undefined, now: Date = new Date()): string {
  if (!at) return "";
  const then = todayISO(new Date(at));
  const days = Math.round((parse(todayISO(now)).getTime() - parse(then).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return niceDate(then);
}

export function isISODate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && iso(parse(v)) === v;
}
