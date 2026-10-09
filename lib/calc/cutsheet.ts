// The cut sheet (SPEC 5.5, 6.3 to 6.5). Ported from the prototype's
// lineUse, setBalance, csProblems, csTotals, csText, and csStatus.

import { EPS, fmt, num } from "./num";

/** The six parts every set must add up to (6.3). */
export const BALANCE_PARTS: { id: string; label: string }[] = [
  { id: "leg", label: "Legs" },
  { id: "shoulder", label: "Shoulders" },
  { id: "rack", label: "Racks" },
  { id: "loin", label: "Short loins" },
  { id: "fshank", label: "Front shanks" },
  { id: "hshank", label: "Hind shanks" },
];

export type UseType =
  | "leg"
  | "legshank"
  | "shoulder"
  | "rack"
  | "loin"
  | "wholeloin"
  | "saddle"
  | "fshank"
  | "hshank"
  | "allshank"
  | "carcass"
  | "none";

/** What one of each kind of instruction uses (SPEC 6.3 table). */
export const USES: Record<UseType, { label: string; parts: Record<string, number> }> = {
  leg: { label: "Leg", parts: { leg: 1 } },
  legshank: { label: "Leg, hind shank stays on", parts: { leg: 1, hshank: 1 } },
  shoulder: { label: "Shoulder", parts: { shoulder: 1 } },
  rack: { label: "Rack", parts: { rack: 1 } },
  loin: { label: "Short loin", parts: { loin: 1 } },
  wholeloin: { label: "Whole loin (rack and short loin)", parts: { rack: 1, loin: 1 } },
  saddle: { label: "Loin saddle (both short loins)", parts: { loin: 2 } },
  fshank: { label: "Front shank", parts: { fshank: 1 } },
  hshank: { label: "Hind shank", parts: { hshank: 1 } },
  allshank: { label: "Any shank (half front, half hind)", parts: { fshank: 0.5, hshank: 0.5 } },
  carcass: {
    label: "Whole lamb",
    parts: { leg: 2, shoulder: 2, rack: 2, loin: 2, fshank: 2, hshank: 2 },
  },
  none: { label: "Nothing to count (necks, bellies, bones)", parts: {} },
};

/** The instruction picker's groups, by part (5.5). */
export const USE_GROUPS: [string, UseType[]][] = [
  ["Legs", ["leg", "legshank"]],
  ["Shoulders", ["shoulder"]],
  ["Racks", ["rack"]],
  ["Loins", ["loin", "wholeloin", "saddle"]],
  ["Shanks", ["fshank", "hshank", "allshank"]],
  ["Whole lambs", ["carcass"]],
  ["Other", ["none"]],
];

export function isUseType(v: string): v is UseType {
  return v in USES;
}

export type CutSpecLite = { id: string; text: string; use_type: string };

export type CutLine = {
  kind: "line" | "note";
  cut_spec_id: string | null;
  qty: number | null;
  text: string | null;
  side_note: string;
  highlight: "yellow" | "blue" | "green" | null;
  shank_on: boolean;
};

export type CutSet = {
  name: string;
  lambs: number;
  size_class_id: string | null;
  headline: string;
  lines: CutLine[];
};

/** Parts one unit of a line uses. Plain leg lines with "shank on" also use a hind shank. */
export function lineUse(line: CutLine, spec: CutSpecLite | undefined): Record<string, number> {
  if (line.kind === "note" || !spec || !isUseType(spec.use_type)) return {};
  const parts = { ...USES[spec.use_type].parts };
  if (line.shank_on && spec.use_type === "leg") parts.hshank = (parts.hshank ?? 0) + 1;
  return parts;
}

export type BalanceChip = { id: string; label: string; used: number; expected: number; ok: boolean };

/** Used versus expected for each balance part (6.3). Expected = lambs * per_lamb. */
export function setBalance(
  set: CutSet,
  specs: Map<string, CutSpecLite>,
  perLamb: Record<string, number>,
): BalanceChip[] {
  const used: Record<string, number> = {};
  for (const l of set.lines) {
    const u = lineUse(l, l.cut_spec_id ? specs.get(l.cut_spec_id) : undefined);
    for (const k in u) used[k] = (used[k] ?? 0) + num(l.qty) * u[k];
  }
  return BALANCE_PARTS.map(({ id, label }) => {
    const expected = num(set.lambs) * num(perLamb[id]);
    const u = used[id] ?? 0;
    return { id, label, used: u, expected, ok: Math.abs(u - expected) < EPS };
  });
}

/** Only sets with at least one counted line are checked. */
export function hasCountedLines(set: CutSet): boolean {
  return set.lines.some((l) => l.kind !== "note");
}

export function setAddsUp(set: CutSet, specs: Map<string, CutSpecLite>, perLamb: Record<string, number>): boolean {
  return !hasCountedLines(set) || setBalance(set, specs, perLamb).every((c) => c.ok);
}

/** "Legs 80 ✓" or "Front shanks 160 of 80". */
export function chipText(c: BalanceChip): string {
  return c.ok ? `${c.label} ${fmt(c.used)} ✓` : `${c.label} ${fmt(c.used)} of ${fmt(c.expected)}`;
}

/**
 * The size block at the top right of the printed sheet (6.5, OPEN): lambs in
 * sets that contain a whole-carcass line, by size.
 */
export function carcassBySize(sets: CutSet[], specs: Map<string, CutSpecLite>): Record<string, number> {
  const by: Record<string, number> = {};
  for (const s of sets) {
    const hasCarcass = s.lines.some((l) => l.kind !== "note" && l.cut_spec_id && specs.get(l.cut_spec_id)?.use_type === "carcass");
    if (hasCarcass && s.size_class_id) by[s.size_class_id] = (by[s.size_class_id] ?? 0) + num(s.lambs);
  }
  return by;
}

/** Lambs needed for a set from what its lines use: ceil(most of any part / 2) (6.4). */
export function lambsFromLines(set: CutSet, specs: Map<string, CutSpecLite>): number {
  const used: Record<string, number> = {};
  for (const l of set.lines) {
    const u = lineUse(l, l.cut_spec_id ? specs.get(l.cut_spec_id) : undefined);
    for (const k in u) used[k] = (used[k] ?? 0) + num(l.qty) * u[k];
  }
  const most = Math.max(0, ...BALANCE_PARTS.map((p) => used[p.id] ?? 0));
  return most > 0 ? Math.ceil(most / 2 - EPS) : 0;
}

// ----- The plain-text sheet (6.5): email body, "Copy as text", and sent tracking -----

export type SheetForText = {
  week: string;
  processDate: string | null;
  inv: string;
  notes: string;
  pulled: { large: number | null; medium: number | null; small: number | null };
  goals: string[];
  banners: string[];
  standing: string;
  sets: CutSet[];
  sizes: { id: string; label: string }[];
};

function slashDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

/** The canonical plain-text version of the sheet. Also what gets hashed for "sent". */
export function cutSheetText(s: SheetForText, specs: Map<string, CutSpecLite>, opts?: { updated?: boolean }): string {
  const total = s.sets.reduce((a, x) => a + num(x.lambs), 0);
  const label = (id: string | null) => s.sizes.find((z) => z.id === id)?.label ?? id ?? "";
  const L: string[] = [];
  L.push(`UVL CUT SHEET${opts?.updated ? " (UPDATED)" : ""}`);
  L.push(`Date: ${slashDate(s.processDate ?? s.week)}   INV# ${s.inv || "____"}   Total lamb: ${total}`);
  L.push("");
  for (const g of s.goals) if (g.trim()) L.push(`** ${g.trim()}`);
  for (const b of s.banners) if (b.trim()) L.push(`** ${b.trim()}`);
  for (const line of s.standing.split("\n")) if (line.trim()) L.push(line.trim());
  L.push("");
  for (const set of s.sets) {
    L.push(`${(set.name || "Set").toUpperCase()}: ${num(set.lambs)} ${label(set.size_class_id)}`.trimEnd());
    if (set.headline.trim()) L.push(`  >> ${set.headline.trim()}`);
    for (const l of set.lines) {
      const text = l.kind === "note" ? (l.text ?? "") : (l.cut_spec_id ? specs.get(l.cut_spec_id)?.text : "") || "?";
      const qty = l.kind === "note" ? "    " : (l.qty == null ? "" : fmt(l.qty)).padStart(4);
      L.push(`  ${qty}  ${text}${l.side_note.trim() ? `   [${l.side_note.trim()}]` : ""}`);
    }
    L.push("");
  }
  const p = s.pulled;
  if (num(p.large) || num(p.medium) || num(p.small))
    L.push(`Lambs pulled from inventory: Large ${num(p.large)}, Medium ${num(p.medium)}, Small ${num(p.small)}`);
  if (s.notes.trim()) L.push(`UVL notes: ${s.notes.trim()}`);
  L.push(`TOTAL ${total}`);
  return L.join("\n");
}

/** A short, stable fingerprint of the text (djb2, as in the prototype). */
export function hashText(t: string): string {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

export type SentStatus = { kind: "notsent" | "sent" | "changed"; sentAt: string | null };

/** Not sent, sent, or changed after it was sent (6.5). */
export function sentStatus(sentAt: string | null, sentHash: string | null, currentText: string): SentStatus {
  if (!sentAt) return { kind: "notsent", sentAt: null };
  return { kind: sentHash === hashText(currentText) ? "sent" : "changed", sentAt };
}

/** The email subject. "(UPDATED)" when it changed after it was sent. */
export function emailSubject(inv: string, updated: boolean, niceWeek: string): string {
  return `UVL cut sheet${updated ? " (UPDATED)" : ""}, ${inv ? `INV# ${inv}, ` : ""}week of ${niceWeek}`;
}

// ----- "Put these on this set" (6.4) -----

/** A product and the Mohawk lines it comes from (units_per_cut of its unit per line). */
export type FillProduct = { id: string; links: { cut_spec_id: string; units_per_cut: number }[] };

/**
 * Add the linked customers' orders to a set. orderTotals are in each
 * product's own unit. Each product adds (quantity / units_per_cut) to every
 * Mohawk line it links to (Chops: 16 lb / 2.5 = 6.4 short loins); each line's
 * total is rounded up to whole. Products with no Mohawk line are listed in
 * `notOnSheet` (ground lamb, organs). If the set has 0 lambs, it becomes
 * ceil(most of any part / 2). The database does the same in fill_cut_set.
 */
export function fillSet(
  set: CutSet,
  orderTotals: Record<string, number>,
  products: FillProduct[],
  specs: Map<string, CutSpecLite>,
): { set: CutSet; added: number; notOnSheet: string[] } {
  const lines = set.lines.map((l) => ({ ...l }));
  const perSpec = new Map<string, number>();
  const notOnSheet: string[] = [];
  for (const p of products) {
    const q = orderTotals[p.id] ?? 0;
    if (q <= 0) continue;
    if (!p.links.length) {
      notOnSheet.push(p.id);
      continue;
    }
    for (const l of p.links) perSpec.set(l.cut_spec_id, (perSpec.get(l.cut_spec_id) ?? 0) + q / (num(l.units_per_cut) || 1));
  }
  let added = 0;
  for (const [specId, raw] of perSpec) {
    const q = Math.ceil(raw - EPS);
    if (q <= 0) continue;
    const existing = lines.find((l) => l.kind !== "note" && l.cut_spec_id === specId);
    if (existing) existing.qty = num(existing.qty) + q;
    else
      lines.push({ kind: "line", cut_spec_id: specId, qty: q, text: null, side_note: "", highlight: null, shank_on: false });
    added++;
  }
  const next = { ...set, lines };
  if (!num(set.lambs)) next.lambs = lambsFromLines(next, specs);
  return { set: next, added, notOnSheet };
}

