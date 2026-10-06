// Text and totals shown on This week (SPEC 5.4, 6.5).

import { longDate } from "../dates";
import { fmt, num } from "./num";
import type { Product, Qty } from "./types";

export type SizeTotal = { id: string; label: string; lambs: number };

/** Total lambs on a cut sheet and the breakdown by size, in size order (6.5). */
export function cutSheetTotals(
  sets: { lambs: number; size_class_id: string | null }[],
  sizes: { id: string; label: string; sort: number }[],
): { total: number; bySize: SizeTotal[] } {
  const by: Record<string, number> = {};
  for (const s of sets) {
    const k = s.size_class_id ?? "";
    by[k] = (by[k] ?? 0) + num(s.lambs);
  }
  const bySize = [...sizes]
    .sort((a, b) => a.sort - b.sort)
    .filter((z) => by[z.id])
    .map((z) => ({ id: z.id, label: z.label, lambs: by[z.id] }));
  if (by[""]) bySize.push({ id: "", label: "size not set", lambs: by[""] });
  return { total: sets.reduce((a, s) => a + num(s.lambs), 0), bySize };
}

/**
 * The one lamb count to show at the top of This week, and where it came from.
 * It always matches the producer message: the cut sheet's total when the week
 * has one, otherwise "Your number" or the count from orders. When the cut
 * sheet disagrees with the others, `note` says so, for example
 * "144 from the cut sheet (orders suggest 0)".
 */
export function lambHeadline(opts: {
  /** From the orders (calcWeek's recommended). */
  recommended: number;
  /** "Your number" (weeks.lamb_override). */
  override: number | null;
  cutSheetTotal: number;
}): { lambs: number; from: "cut sheet" | "your number" | "orders"; note: string | null } {
  const { recommended, override, cutSheetTotal } = opts;
  if (cutSheetTotal > 0) {
    const others: string[] = [];
    if (override != null && override !== cutSheetTotal) others.push(`your number is ${override}`);
    if (recommended !== cutSheetTotal) others.push(`orders suggest ${recommended}`);
    return {
      lambs: cutSheetTotal,
      from: "cut sheet",
      note: others.length ? `${cutSheetTotal} from the cut sheet (${others.join(", ")})` : null,
    };
  }
  if (override != null) return { lambs: override, from: "your number", note: null };
  return { lambs: recommended, from: "orders", note: null };
}

/**
 * The message for the producer. Uses the cut sheet's totals by size when the
 * week has a cut sheet, otherwise the order-based count.
 */
export function producerMessage(opts: {
  lambs: number;
  processDate: string | null;
  cutSheet?: { total: number; bySize: SizeTotal[] } | null;
}): string {
  const when = opts.processDate ? ` for processing on ${longDate(opts.processDate)}` : "";
  const cs = opts.cutSheet;
  if (cs && cs.total > 0) {
    return `Please bring ${cs.total} lambs${when}: ${cs.bySize.map((s) => `${s.lambs} ${s.label}`).join(", ")}. Thank you!`;
  }
  return `Please bring ${opts.lambs} lamb${opts.lambs === 1 ? "" : "s"}${when}. Thank you!`;
}

// Kathy summarizes legs as bone-in, AO, boneless, then everything else.
// Each leg product is sorted into one of these by its name, first match wins.
// Products named in no other way count as "other".
export const LEG_KINDS: { key: string; label: string; test: RegExp }[] = [
  { key: "bonein", label: "bone-in", test: /\bbone[ -]?in\b|\bBI\b/i },
  { key: "ao", label: "AO", test: /\bAO\b/ },
  { key: "boneless", label: "boneless", test: /\bBLS\b|\bboneless\b/i },
];

export type LegBreakdown = { parts: { label: string; qty: number }[]; total: number };

/** Leg products (group "Legs") this week, by kind, then the total. */
export function legBreakdown(withShort: Qty, products: Product[]): LegBreakdown {
  const sums: Record<string, number> = { other: 0 };
  for (const k of LEG_KINDS) sums[k.key] = 0;
  let total = 0;
  for (const p of products) {
    if (p.group_name !== "Legs") continue;
    const q = withShort[p.id] ?? 0;
    if (!q) continue;
    const kind = LEG_KINDS.find((k) => k.test.test(p.name) || k.test.test(p.short_name));
    sums[kind ? kind.key : "other"] += q;
    total += q;
  }
  const parts = [...LEG_KINDS.map((k) => ({ label: k.label, qty: sums[k.key] })), { label: "other", qty: sums.other }];
  return { parts: parts.filter((p) => p.qty > 0), total };
}

export function legBreakdownText(b: LegBreakdown): string {
  if (!b.total) return "";
  return `Legs: ${b.parts.map((p) => `${fmt(p.qty)} ${p.label}`).join(", ")}. ${fmt(b.total)} total.`;
}
