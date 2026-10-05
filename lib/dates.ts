// Calendar dates as "YYYY-MM-DD" strings, in Pacific time. Weeks start on Monday.

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

export function currentWeek(now: Date = new Date()): string {
  return mondayOf(todayISO(now));
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
