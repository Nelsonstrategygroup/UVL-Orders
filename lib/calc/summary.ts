// Text and totals shown on This week (SPEC 5.4, 6.5).

import { longDate } from "../dates";
import { lambSourceLine, type WeekCalc } from "./week";
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
 * The message for the producer, for the week's one lamb count. Pass the cut
 * sheet only when that count came from it, so the sizes add up to it.
 */
export function producerMessage(opts: {
  lambs: number;
  processDate: string | null;
  cutSheet?: { total: number; bySize: SizeTotal[] } | null;
}): string {
  const when = opts.processDate ? ` for processing on ${longDate(opts.processDate)}` : "";
  const cs = opts.cutSheet;
  // Sizes only when they add up to the count; the count is always opts.lambs.
  if (cs && cs.total > 0 && cs.total === opts.lambs) {
    return `Please bring ${opts.lambs} lambs${when}: ${cs.bySize.map((s) => `${s.lambs} ${s.label}`).join(", ")}. Thank you!`;
  }
  return `Please bring ${opts.lambs} lamb${opts.lambs === 1 ? "" : "s"}${when}. Thank you!`;
}

/**
 * Every lamb number This week shows, from the week's one count. The screen
 * reads its numbers only from here, so the headline, the message, and the
 * carcass balance can't disagree (see the "one lamb count" tests).
 */
export function weekNumbers(
  c: WeekCalc,
  cutSheet: { total: number; bySize: SizeTotal[] },
  processDate: string | null,
): { headline: number; sourceLine: string | null; message: string; balanceLambs: number } {
  return {
    headline: c.final,
    sourceLine: lambSourceLine(c),
    message: producerMessage({
      lambs: c.final,
      processDate,
      cutSheet: c.source === "cut sheet" ? cutSheet : null,
    }),
    balanceLambs: c.final,
  };
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
    // Leg products: the old "Legs" group, or anything made only from legs
    // (and the hind shank left on).
    const legOnly = p.uses.some((u) => u.part_id === "leg") && p.uses.every((u) => u.part_id === "leg" || u.part_id === "hshank");
    if (p.group_name !== "Legs" && !legOnly) continue;
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
