// The Carcass balance report (Lucas, 10/29/26): a summary (lambs to bring,
// what sets the count, what's short or tight, starting guesses, one table),
// then each part as a subtraction: from the lambs, minus each product, minus
// Le Trim, = left over. Whole loins end at "cut into racks and short loins",
// and racks and short loins start from those. Shanks read in packs with the
// shanks in brackets, trim in pounds, everything else in whole pieces.
// Built from the same balance as This week (calcWeek with Le Trim in it); the
// numbers are the same, only laid out to read.

import { EPS, fmt, num } from "./num";
import type { Part, Product } from "./types";
import type { PartRow, WeekCalc } from "./week";
import { partBalances } from "./working";

export type ReportUnit = { kind: "lb" } | { kind: "packs"; size: number } | { kind: "pieces" };

/** "40 packs (80 shanks)", "18 lb", "31". */
export function qtyWords(pieces: number, unit: ReportUnit, part: Pick<Part, "name">): string {
  if (unit.kind === "lb") return `${fmt(round2(pieces))} lb`;
  if (unit.kind === "packs") {
    const packs = round2(pieces / unit.size);
    // "40 packs (80 shanks)": the last word of the part ("Front shank" -> shanks).
    const word = part.name.trim().split(" ").pop()!.toLowerCase();
    return `${fmt(packs)} pack${packs === 1 ? "" : "s"} (${fmt(round2(pieces))} ${word}${pieces === 1 ? "" : "s"})`;
  }
  return fmt(round2(pieces));
}

/** "Ground Lamb 1 lb" reads "Ground Lamb (1 lb packs)". */
export const productWords = (name: string) => name.replace(/^(.*?)\s+(\d+(?:\.\d+)?)\s*lb$/i, "$1 ($2 lb packs)");

const round2 = (v: number) => Math.round(v * 100) / 100;

export type ReportLine = { label: string; pieces: number };

export type ReportSection = {
  part: Part;
  unit: ReportUnit;
  /** "From 69 lambs" or "Cut from 113 whole loins". */
  from: ReportLine;
  /** Taken away, in order: products, Le Trim. */
  minus: ReportLine[];
  /** The bottom line: Left over / Short, or (whole loins) Cut into racks and short loins. */
  result: ReportLine & { kind: "left" | "short" | "cut" };
  note?: string;
};

export type CompactRow = { part: Part; unit: ReportUnit; from: number; fromCut: boolean; take: number; left: number | null; leftText?: string };

export type CarcassReport = {
  lambs: number;
  /** Lambs cut into parts (the count less carcass lambs). */
  cutLambs: number;
  /** "70 lambs to bring. 54 for orders + 15 extra for Le Trim + 1 carcass (goes out uncut, not counted below)." */
  lambsLine: string;
  /** Where the count came from when it isn't the orders ("Your number", "the cut sheet"). */
  sourceLine: string | null;
  setLine: string | null;
  statusLine: string;
  tightLine: string | null;
  guessLine: string | null;
  compact: { title: string; rows: CompactRow[] }[];
  sections: ReportSection[];
  notOrdered: string | null;
  leTrim: {
    planned: boolean;
    orderedLb: number;
    units: number;
    unitLb: number;
    shoulders: number;
    shoulderLb: number;
    halfLegs: number;
    halfLegLb: number;
    trimLb: number;
    totalLb: number;
    /** totalLb - orderedLb: positive over, negative short. */
    diffLb: number;
  } | null;
};

export type CarcassReportInput = {
  c: WeekCalc;
  products: Product[];
  parts: Part[];
  packSizes: Map<string, number>;
  extraLambs: { lambs: number; reason: string }[];
  /** Le Trim as it's used in `c`: the saved plan or the worked-out mix. */
  leTrim: { planned: boolean; orderedLb: number; shoulders: number; halfLegs: number; trimLb: number; shoulderLb: number; legLb: number } | null;
};

const REASON: Record<string, string> = {
  le_trim: "Le Trim",
  freezer: "freezer stock",
  small_lambs: "small lambs",
  half_whole: "half/whole orders",
  other: "other reasons",
};

export function carcassReport(x: CarcassReportInput): CarcassReport {
  const { c } = x;
  const unitOf = (p: Part): ReportUnit => {
    if (p.unit === "lb") return { kind: "lb" };
    const size = x.packSizes.get(p.id);
    return size && size > 1 ? { kind: "packs", size } : { kind: "pieces" };
  };
  // Pieces are whole: a use rounds up, what's left rounds down.
  const whole = (p: Part, v: number, up: boolean) => (p.unit === "lb" ? round2(v) : up ? Math.ceil(v - EPS) : Math.floor(v + EPS));
  const balances = partBalances(c, x.products);
  const rowOf = new Map<string, PartRow>(c.rows.map((r) => [r.part.id, r]));
  const leLabel = x.leTrim?.planned ? "Le Trim (Kathy's plan)" : "Le Trim (worked out)";

  // --- The count ---
  const extras = new Map<string, number>();
  for (const e of x.extraLambs) extras.set(e.reason, (extras.get(e.reason) ?? 0) + e.lambs);
  const bits = [`${c.orderLambs} for orders`];
  for (const [reason, n] of extras) bits.push(`${n} extra for ${REASON[reason] ?? reason}`);
  if (c.carcass) bits.push(`${c.carcass} carcass (goes out uncut, not counted below)`);
  const lambsLine =
    c.source === "orders"
      ? `${c.final} lambs to bring.${bits.length > 1 ? ` ${bits.join(" + ")}.` : ""}`
      : `${c.final} lambs to bring.`;
  const sourceLine =
    c.source === "your number"
      ? `That's the number typed in Your number. From orders it would be ${c.recommended} (${bits.join(" + ")}).`
      : c.source === "cut sheet"
        ? `That's the lambs on the cut sheet. From orders it would be ${c.recommended} (${bits.join(" + ")}).`
        : null;
  const d = c.driver;
  const setLine = d
    ? `Set by ${d.part.name.toLowerCase()}: ${fmt(whole(d.part, d.need, true))}${d.part.unit === "lb" ? " lb" : ""} needed, ${fmt(num(d.part.per_lamb))} per lamb. Average-size lambs: smaller or bigger lambs need more or fewer.`
    : null;

  // --- Sections ---
  const sections: ReportSection[] = [];
  const notOrdered: string[] = [];
  for (const b of balances) {
    const unit = unitOf(b.part);
    const hasUse = b.uses.length > 0 || b.leTrim > EPS || !!b.cut;
    if (!hasUse) {
      if (b.supply > EPS) notOrdered.push(`${b.part.name} ${qtyWords(b.supply, unit, b.part)}`);
      continue;
    }
    const minus: ReportLine[] = b.uses.map((u) => ({
      label: u.each !== 1 && unit.kind !== "packs" ? `${productWords(u.product)} (${fmt(u.qty)} × ${fmt(u.each)})` : productWords(u.product),
      pieces: whole(b.part, u.total, true),
    }));
    if (b.leTrim > EPS) minus.push({ label: leLabel, pieces: whole(b.part, b.leTrim, true) });
    const from: ReportLine = b.parent
      ? { label: `Cut from ${fmt(b.supply)} ${b.parent.name.toLowerCase()}s`, pieces: b.supply }
      : { label: `From ${c.partsLambs} lambs`, pieces: b.supply };
    if (b.cut) {
      // Whole loins: what goes out whole comes off; the rest is cut.
      const cut = round2(b.supply - minus.reduce((s, l) => s + l.pieces, 0));
      sections.push({
        part: b.part,
        unit,
        from,
        minus,
        result: { kind: "cut", label: `Cut into ${b.cut.into.map((p) => p.name.toLowerCase() + "s").join(" and ")}`, pieces: cut },
      });
      continue;
    }
    const left = b.part.unit === "lb" ? round2(b.left) : Math.floor(b.left + EPS);
    sections.push({
      part: b.part,
      unit,
      from,
      minus,
      result: left < -EPS ? { kind: "short", label: "Short", pieces: -left } : { kind: "left", label: "Left over", pieces: left },
    });
  }
  // One note after the parts cut from whole loins.
  const lastCut = [...sections].reverse().find((s) => rowOf.get(s.part.id)?.parent);
  if (lastCut) lastCut.note = "To keep a whole loin uncut, take 1 off both rack and short loin left over.";

  // --- Status ---
  const short = sections.filter((s) => s.result.kind === "short");
  const statusLine = short.length
    ? `Short: ${short.map((s) => `${s.part.name.toLowerCase()} ${qtyWords(s.result.pieces, s.unit, s.part)}`).join(", ")}.`
    : "Every part covers its orders.";
  const tight = sections
    .filter((s) => s.result.kind === "left" && s.unit.kind === "pieces" && rowOf.get(s.part.id)?.planned)
    .sort((a, b) => a.result.pieces - b.result.pieces)
    .slice(0, 2);
  const tightLine = tight.length ? `Tightest: ${tight.map((s) => `${s.part.name.toLowerCase()} (${fmt(s.result.pieces)} left over)`).join(", ")}.` : null;
  const guesses = x.parts.filter((p) => p.confirmed === false);
  const guessLine = guesses.length
    ? `Still starting guesses (Setup > Parts per lamb): ${guesses.map((p) => `${p.name.toLowerCase()} (${fmt(num(p.per_lamb))}${p.unit === "lb" ? " lb" : ""} per lamb)`).join(", ")}.`
    : null;

  // --- The compact table, grouped like This week's balance ---
  const compactRow = (s: ReportSection): CompactRow => ({
    part: s.part,
    unit: s.unit,
    from: s.from.pieces,
    fromCut: !!rowOf.get(s.part.id)?.parent,
    take: round2(s.minus.reduce((t, l) => t + l.pieces, 0)),
    left: s.result.kind === "cut" ? null : s.result.kind === "short" ? -s.result.pieces : s.result.pieces,
    leftText: s.result.kind === "cut" ? `${fmt(s.result.pieces)} cut into racks and short loins` : undefined,
  });
  const planned = (s: ReportSection) => !!rowOf.get(s.part.id)?.planned;
  const compact = [
    { title: "Main cuts", rows: sections.filter(planned).map(compactRow) },
    { title: "Comes with every lamb", rows: sections.filter((s) => !planned(s)).map(compactRow) },
  ].filter((g) => g.rows.length);

  // --- Le Trim ---
  const lt = x.leTrim;
  const leTrim =
    lt && lt.orderedLb > 0
      ? (() => {
          const halfLegLb = lt.legLb / 2;
          const totalLb = round2(lt.trimLb + lt.shoulders * lt.shoulderLb + lt.halfLegs * halfLegLb);
          return {
            planned: lt.planned,
            orderedLb: lt.orderedLb,
            unitLb: 10,
            units: Math.ceil(lt.orderedLb / 10 - EPS),
            shoulders: lt.shoulders,
            shoulderLb: lt.shoulderLb,
            halfLegs: lt.halfLegs,
            halfLegLb,
            trimLb: round2(lt.trimLb),
            totalLb,
            diffLb: round2(totalLb - lt.orderedLb),
          };
        })()
      : null;

  return {
    lambs: c.final,
    cutLambs: c.partsLambs,
    lambsLine,
    sourceLine,
    setLine,
    statusLine,
    tightLine,
    guessLine,
    compact,
    sections,
    notOrdered: notOrdered.length ? `Not ordered this week: ${notOrdered.join(", ")}.` : null,
    leTrim,
  };
}
