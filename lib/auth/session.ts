// Daily sign-out rule (SPEC 2): once logged in, a person stays logged in for
// the rest of the day. They are signed out at 3:00 AM Pacific the next
// morning and log in once again.

export const TIME_ZONE = "America/Los_Angeles";

/** Hour of the day (Pacific time, 24-hour clock) when everyone is signed out. */
export const DAILY_SIGN_OUT_HOUR = 3;

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

/** Wall-clock date and time in the given time zone. */
export function zonedParts(date: Date, timeZone: string = TIME_ZONE): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const { type, value } of fmt.formatToParts(date)) {
    if (type !== "literal") p[type] = Number(value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

/** Milliseconds the zone is ahead of UTC at the given instant. */
function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant when the wall clock in `timeZone` reads the given date and hour. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string = TIME_ZONE,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  let result = guess - offsetMs(new Date(guess), timeZone);
  // Re-check once in case the guess and the result fall on different sides of a DST change.
  result = guess - offsetMs(new Date(result), timeZone);
  return new Date(result);
}

/** The most recent daily sign-out time at or before `now`. */
export function mostRecentCutoff(now: Date = new Date()): Date {
  const p = zonedParts(now);
  const today = zonedTimeToUtc(p.year, p.month, p.day, DAILY_SIGN_OUT_HOUR);
  if (now.getTime() >= today.getTime()) return today;
  // Before 3 AM: the cutoff was yesterday morning.
  const y = new Date(Date.UTC(p.year, p.month - 1, p.day - 1));
  return zonedTimeToUtc(y.getUTCFullYear(), y.getUTCMonth() + 1, y.getUTCDate(), DAILY_SIGN_OUT_HOUR);
}

/** True when the person last logged in before this morning's sign-out time. */
export function needsDailyLogin(lastLoginAt: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!lastLoginAt) return true;
  const t = new Date(lastLoginAt).getTime();
  if (Number.isNaN(t)) return true;
  return t < mostRecentCutoff(now).getTime();
}
