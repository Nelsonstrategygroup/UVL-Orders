// Small number helpers shared by the calculations.

/** Tolerance for comparing quantities that went through multiplication. */
export const EPS = 1e-9;

/** Parse anything into a finite number, or 0. */
export function num(v: unknown): number {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
}

/** One decimal at most, no trailing ".0": 2 -> "2", 2.25 -> "2.3", 0.5 -> "0.5". */
export function fmt(v: number): string {
  const r = Math.round(v * 10) / 10;
  return (Math.abs(r - Math.round(r)) < EPS ? Math.round(r) : r).toString();
}

/** Round up, ignoring floating point dust (e.g. 50.0000000001 -> 50). */
export function ceilSafe(v: number): number {
  return Math.ceil(v - EPS);
}

export function addInto(target: Record<string, number>, key: string, qty: number) {
  target[key] = (target[key] ?? 0) + qty;
}
