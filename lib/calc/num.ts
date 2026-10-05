// Small number helpers shared by the calculations.

/** Tolerance for comparing quantities that went through multiplication. */
export const EPS = 1e-9;

/** Parse anything into a finite number, or 0. */
export function num(v: unknown): number {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
}

/**
 * Up to three decimals, no trailing zeros: 2 -> "2", 0.5 -> "0.5", 0.125 -> "0.125".
 * (The prototype rounded to one decimal, which showed Le trim's 0.125 shoulder as 0.1.)
 */
export function fmt(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return (Math.abs(r - Math.round(r)) < EPS ? Math.round(r) : r).toString();
}

/** Round up, ignoring floating point dust (e.g. 50.0000000001 -> 50). */
export function ceilSafe(v: number): number {
  return Math.ceil(v - EPS);
}

export function addInto(target: Record<string, number>, key: string, qty: number) {
  target[key] = (target[key] ?? 0) + qty;
}
