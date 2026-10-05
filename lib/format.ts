import { TIME_ZONE } from "./auth/session";

/** "Thu, Oct 1, 7:42 AM" in Pacific time. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** "9:42 AM" today, otherwise "Mon, Oct 5, 9:42 AM", in Pacific time. */
export function formatWhen(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const day = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(x);
  if (day(d) !== day(now)) return formatDateTime(d);
  return new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(d);
}
