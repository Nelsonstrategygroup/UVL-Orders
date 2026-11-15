// Lamb cost (SPEC 16): what UVL pays producers for lambs. Stage 1 is the
// settings: the base rate and live weight factor from a date on, and a
// producer's own rate from a date on. A kill date uses the newest of each
// dated on or before it. Values stay decimal strings, never floats.

import { parsePrice } from "./prices";

/** Base $ per lb live and the live weight factor, from a date on. */
export type LambCostSetting = {
  id: string;
  effective_from: string;
  base_rate: string | number;
  live_factor: string | number;
  note: string;
};

/** A producer's own $ per lb live, from a date on, instead of the base rate. */
export type ProducerRate = {
  id: string;
  producer_id: string;
  effective_from: string;
  rate: string | number;
  note: string;
};

export type Producer = {
  id: string;
  name: string;
  ranch_name: string;
  contact: string;
  active: boolean;
};

const newestOnOrBefore = <T extends { effective_from: string }>(rows: T[], date: string): T | null =>
  rows.filter((r) => r.effective_from <= date).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;

/** The pricing setting in effect on a date, or null if none starts on or before it. */
export function settingFor(settings: LambCostSetting[], date: string): LambCostSetting | null {
  return newestOnOrBefore(settings, date);
}

/** A producer's own rate in effect on a date, or null. */
export function producerRateFor(rates: ProducerRate[], producerId: string, date: string): ProducerRate | null {
  return newestOnOrBefore(
    rates.filter((r) => r.producer_id === producerId),
    date,
  );
}

/** The rate and factor for a producer's lambs on a date, and where the rate came from. */
export type RateUsed = {
  rate: string;
  factor: string;
  source: "override" | "base";
};

/**
 * What a lamb killed on `date` is paid at: the producer's own rate if one
 * applies that day, else the base rate; the factor always comes from the
 * pricing setting. Null when no pricing setting starts on or before the date.
 */
export function rateFor(
  settings: LambCostSetting[],
  rates: ProducerRate[],
  producerId: string | null,
  date: string,
): RateUsed | null {
  const s = settingFor(settings, date);
  if (!s) return null;
  const own = producerId ? producerRateFor(rates, producerId, date) : null;
  return own
    ? { rate: String(own.rate), factor: String(s.live_factor), source: "override" }
    : { rate: String(s.base_rate), factor: String(s.live_factor), source: "base" };
}

/** Newest first, for a history list. */
export function newestFirst<T extends { effective_from: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.effective_from.localeCompare(a.effective_from));
}

/** A typed rate, "$3.00" or "3": a plain decimal string, or null. */
export function parseRate(text: string): string | null {
  return parsePrice(text);
}

/** A typed live weight factor, "2.02": a decimal above 0 with at most 4 places, or null. */
export function parseFactor(text: string): string | null {
  const v = parsePrice(text);
  return v != null && Number(v) > 0 ? v : null;
}

/** "$3.00", "$3.125": at least two decimals, as typed beyond that. */
export function rateText(v: string | number): string {
  const [w, f = ""] = String(v).split(".");
  return `$${w}.${f.replace(/0+$/, "").padEnd(2, "0")}`;
}

/** "2.02": the factor without trailing zeros. */
export function factorText(v: string | number): string {
  const s = String(v);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}
