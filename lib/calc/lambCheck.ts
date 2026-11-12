// The Lamb count check (Lucas, 11/7/26): a two-page printout so Kathy can
// check by hand that the week's lamb count matches the orders. Page 1 adds up
// the orders, grouped by the part each product comes from, with the sums
// written out; page 2 goes from parts to lambs and back: lambs for each
// part, the extras, then what the lambs give against what the orders take.
//
// Nothing is worked out here that isn't already worked out for This week:
// the numbers come from calcWeek (lib/calc/week.ts, through lib/weekCalc.ts),
// countWorking and partBalances (lib/calc/working.ts), so they match "How N
// was worked out" and the full balance. This file only writes them out.

import { productWords } from "./carcassReport";
import { EPS, fmt, num } from "./num";
import type { Part, Product, Qty, Units } from "./types";
import { toProductUnit, unitWord } from "./units";
import type { PartRow, WeekCalc } from "./week";
import { wholeLeft } from "./week";
import { countWorking, partBalances } from "./working";

const round2 = (v: number) => Math.round(v * 100) / 100;
/** "51.11": up to two decimals, never more. */
const dec = (v: number) => fmt(round2(v));

/** "legs", "short loins", "Denver ribs", "lb trim". */
export function partWord(p: Pick<Part, "name" | "unit">, n = 2): string {
  if (p.unit === "lb") return `lb ${p.name.toLowerCase()}`;
  // Lower case, as This week writes parts ("set by whole loin").
  const lower = p.name.trim().toLowerCase();
  if (n === 1 || /s$/i.test(lower)) return lower;
  return `${lower}s`;
}

/** "Legs", "Short loins", "Trim": a part's name as a heading. */
export function partTitle(p: Pick<Part, "name" | "unit">): string {
  const w = p.unit === "lb" ? p.name.trim().toLowerCase() : partWord(p);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** "58", "8 packs", "45 lb", "1 case": an amount in a unit, as on the order grid. */
export function amountWords(q: number, unit: string): string {
  return unit === "each" ? dec(q) : `${dec(q)} ${unitWord(unit, q)}`;
}

export type CheckOrder = { customer: string; lines: Qty; units?: Units };
export type CheckRequested = { product_id: string; qty: number; unit: string | null };

export type CheckInput = {
  /** "Nov 9" */
  weekName: string;
  c: WeekCalc;
  parts: Part[];
  products: Product[];
  /** The week's orders, with each customer's name. */
  orders: CheckOrder[];
  /** Lines asked for this week, not confirmed yet (they count). */
  requested: CheckRequested[];
  /** Half and whole lambs the freezer can't cover (they count). */
  short: Qty;
  extraLambs: { lambs: number; reason: string; note?: string }[];
  /** Le Trim as it's used in the balance. */
  leTrim: { orderedLb: number; planned: boolean; trimLb: number; shoulders: number; halfLegs: number; legs: number } | null;
  /** Customers who order: how many, who hasn't answered, who said no order. */
  answers: { ordered: number; total: number; waiting: string[]; noOrder: string[] };
  /** Parts sold in packs (shanks): pieces per pack, to show packs as This week does. */
  packSizes?: Map<string, number>;
};

export type CheckProduct = {
  name: string;
  /** The order grid's bottom row: every order added up, in the product's own unit. */
  total: string;
  /** Orders taken in another unit, written out: "Key City 20 lb ÷ 4.5 lb per shoulder = 4.44, rounded to 4". */
  converted: string[];
  /** Also counted: asked for, not confirmed; half and whole lambs. */
  plus: string[];
};

export type CheckGroup = { title: string; products: CheckProduct[]; math: string[]; note?: string };

export type CheckBalance = {
  name: string;
  /** "74 × 2 = 148", or "144 cut from whole loins". */
  give: string;
  /** "Orders take 96", "Le Trim takes 25", "Sold whole 4". */
  take: string[];
  /** "Left over 27", "Short 3", "Cut into racks and short loins 144". */
  result: string;
  short: boolean;
};

export type LambCheck = {
  answersLine: string;
  waitingLine: string | null;
  noOrderLine: string | null;
  groups: CheckGroup[];
  leTrim: { ordered: string; madeFrom: string } | null;
  /** Page 2: lambs for each part that can set the count. */
  lambs: { text: string; sets: boolean }[];
  /** Parts that never set the count, in one line. */
  neverLine: string | null;
  /** The count: each piece of it, then the total. */
  countParts: string[];
  countTotal: string;
  replaced: string | null;
  balanceLambs: string;
  balance: CheckBalance[];
  check: { ok: boolean; text: string };
  guesses: string | null;
};

const REASON: Record<string, string> = {
  le_trim: "for Le Trim",
  freezer: "for freezer stock",
  small_lambs: "for small lambs",
  half_whole: "for half and whole orders",
  other: "for other reasons",
};

export function lambCheck(x: CheckInput): LambCheck {
  const { c } = x;
  const parts = [...x.parts].sort((a, b) => a.sort - b.sort);
  const partById = new Map(parts.map((p) => [p.id, p]));
  const parentOf = (p: Part) => (p.made_from && p.made_from !== p.id && partById.has(p.made_from) ? partById.get(p.made_from)! : null);
  const products = [...x.products].sort((a, b) => a.sort - b.sort);

  // --- Who has ordered ---
  const a = x.answers;
  const answersLine = `Week of ${x.weekName} · ${a.ordered} of ${a.total} customers have ordered.`;
  const waitingLine = a.waiting.length
    ? `Not answered yet, so the count could still change: ${a.waiting.join(", ")}.`
    : null;
  const noOrderLine = a.noOrder.length ? `No order this week: ${a.noOrder.join(", ")}.` : null;

  // --- Page 1: products grouped by the part they come from ---
  // A part's group: its own, or the part it's cut from; parts sharing a last word (front and hind shank) share one.
  const lastWord = (p: Part) => p.name.trim().split(/\s+/).pop()!.toLowerCase();
  const groupKey = (p: Part): string => {
    const top = parentOf(p) ?? p;
    const sameWord = parts.filter((q) => !parentOf(q) && lastWord(q) === lastWord(top));
    return sameWord.length > 1 ? `word:${lastWord(top)}` : `part:${top.id}`;
  };
  const groupTitle = (key: string): string => {
    if (key.startsWith("word:")) {
      const w = key.slice(5);
      return `${w[0].toUpperCase()}${w.slice(1)}s`;
    }
    const p = partById.get(key.slice(5))!;
    const kids = parts.filter((k) => parentOf(k)?.id === p.id);
    const title = p.unit === "lb" ? p.name : partWord(p).replace(/^./, (ch) => ch.toUpperCase());
    return kids.length ? `${title} and what's cut from them` : title;
  };
  const groupOrder: string[] = [];
  for (const p of parts) {
    const k = groupKey(p);
    if (!groupOrder.includes(k)) groupOrder.push(k);
  }

  // Each product's numbers: the orders (the grid's bottom row), what's converted, what's added.
  const productLine = (p: Product): CheckProduct | null => {
    let total = 0;
    const converted: string[] = [];
    for (const o of x.orders) {
      const q = num(o.lines[p.id] ?? 0);
      if (!(q > 0)) continue;
      const taken = o.units?.[p.id];
      const inUnit = toProductUnit(q, taken, p);
      total += inUnit;
      if (taken && taken !== p.unit && (taken === "lb" || p.unit === "lb")) {
        const w = num(p.lb_per_unit);
        if (!(w > 0)) converted.push(`${o.customer} ${amountWords(q, taken)}: no weight per piece set, so not counted`);
        else if (taken === "lb") converted.push(`${o.customer} ${dec(q)} lb ÷ ${dec(w)} lb each = ${dec(q / w)}, rounded to ${dec(inUnit)}`);
        else converted.push(`${o.customer} ${amountWords(q, taken)} × ${dec(w)} lb = ${dec(inUnit)} lb`);
      }
    }
    let asked = 0;
    for (const r of x.requested) if (r.product_id === p.id) asked += toProductUnit(num(r.qty), r.unit ?? undefined, p);
    const hw = num(x.short[p.id] ?? 0);
    if (!(total > EPS) && !(asked > EPS) && !(hw > EPS)) return null;
    const plus: string[] = [];
    if (asked > EPS) plus.push(`plus ${amountWords(asked, p.unit)} asked for, not confirmed yet`);
    if (hw > EPS) plus.push(`plus ${amountWords(hw, p.unit)} for half and whole lambs the freezer can't cover`);
    return { name: p.name, total: amountWords(total, p.unit), converted, plus };
  };

  const groups = new Map<string, CheckGroup>();
  const ensure = (key: string, title: string) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { title, products: [], math: [] }));
    return g;
  };
  const leTrimProduct = products.find((p) => (p.fill_note ?? "").trim());
  for (const p of products) {
    if ((p.fill_note ?? "").trim()) continue; // Le Trim: its own section
    const line = productLine(p);
    if (!line) continue;
    if (p.carcass) {
      ensure("carcass", "Carcass lambs (sent uncut)").products.push(line);
      continue;
    }
    // A product cut from any of several parts (Mixed Shanks: hind, then front) goes with those parts (11/12/26).
    const from = p.uses.filter((u) => num(u.qty) && partById.has(u.part_id)).map((u) => u.part_id);
    const ids = from.length ? from : (p.draws_from ?? []).filter((id) => partById.has(id));
    const keys = [...new Set(ids.map((id) => groupKey(partById.get(id)!)))];
    if (!keys.length) {
      if (p.not_lamb) ensure("notlamb", "Not from the lamb").products.push(line);
      else ensure("other", "Other lamb products (they don't change the count)").products.push(line);
      continue;
    }
    for (const k of keys) ensure(k, groupTitle(k)).products.push(line);
  }

  // The sums: each part's products, written out, from the same lines as the full balance.
  const balances = partBalances(c, x.products);
  const balById = new Map(balances.map((b) => [b.part.id, b]));
  const partSum = (id: string) => round2((balById.get(id)?.uses ?? []).reduce((s, l) => s + l.total, 0));
  const sumText = (id: string) => {
    const b = balById.get(id);
    if (!b || !b.uses.length) return null;
    const bits = b.uses.map((l) => (l.each !== 1 ? `${productWords(l.product)} ${dec(l.qty)} × ${dec(l.each)}` : `${productWords(l.product)} ${dec(l.qty)}`));
    return `${bits.join(" + ")} = ${dec(partSum(id))} ${partWord(b.part, partSum(id))}`;
  };
  for (const k of groupOrder) {
    const g = groups.get(k);
    if (!g) continue;
    const members = parts.filter((p) => groupKey(p) === k);
    for (const p of members) {
      const t = sumText(p.id);
      if (t) g.math.push(t);
    }
    // Whole loins: sold whole, plus the larger of the parts cut from them.
    const top = members.find((p) => parts.some((q) => parentOf(q)?.id === p.id));
    if (top) {
      const kids = parts.filter((q) => parentOf(q)?.id === top.id);
      const whole = partSum(top.id);
      const most = kids.reduce((m, q) => Math.max(m, partSum(q.id)), 0);
      if (whole > EPS || most > EPS) {
        const larger = kids.map((q) => `${dec(partSum(q.id))} ${partWord(q, partSum(q.id))}`).join(" and ");
        g.math.push(`${partWord(top).replace(/^./, (ch) => ch.toUpperCase())} needed: ${dec(whole)} sold whole + the larger of ${larger} = ${dec(whole + most)} ${partWord(top, whole + most)}`);
        g.note = `${kids.map((q) => partWord(q)).join(" and ").replace(/^./, (ch) => ch.toUpperCase())} are cut from ${partWord(top)}: one ${partWord(top, 1)} gives one of each.`;
      }
    }
  }
  const ordered = [
    ...groupOrder.map((k) => groups.get(k)).filter((g): g is CheckGroup => !!g),
    ...["carcass", "other", "notlamb"].map((k) => groups.get(k)).filter((g): g is CheckGroup => !!g),
  ];

  // --- Le Trim ---
  const lt = x.leTrim;
  const leTrim =
    lt && lt.orderedLb > 0
      ? {
          ordered: `${leTrimProduct?.name ?? "Le Trim"}: ${dec(lt.orderedLb)} lb ordered`,
          madeFrom: `Made from what's left after the other orders${lt.planned ? " (Kathy's plan)" : " (worked out, not planned yet)"}: ${[
            `${dec(lt.trimLb)} lb trim`,
            lt.shoulders ? `${lt.shoulders} shoulders` : "",
            lt.halfLegs ? `${lt.halfLegs} half legs (${lt.legs} legs)` : "",
          ]
            .filter(Boolean)
            .join(", ")}. It never sets the count.`,
        }
      : null;

  // --- Page 2: lambs for each part ---
  const w = countWorking(c, x.parts, x.products);
  const lambs = w.parts
    .filter((p) => p.need > EPS)
    .map((p) => {
      const exact = p.perLamb > 0 ? p.need / p.perLamb : 0;
      const whole = Math.abs(exact - Math.round(exact)) < EPS;
      const unit = p.part.unit === "lb" ? "lb" : partWord(p.part, p.need);
      const per = p.part.unit === "lb" ? `${dec(p.perLamb)} lb per lamb` : `${dec(p.perLamb)} per lamb`;
      return {
        text: `${dec(p.need)} ${unit} ÷ ${per} = ${whole ? `${p.lambs} lambs` : `${dec(exact)}, rounded up to ${p.lambs} lambs`}`,
        sets: p.sets,
      };
    });
  const neverParts = w.never.map((n) => partTitle(n.part).toLowerCase());
  const neverLine = neverParts.length
    ? `${neverParts.join(", ").replace(/^./, (ch) => ch.toUpperCase())} never set the count: they come with the lambs.`
    : null;

  // --- The count ---
  const countParts = [`${c.orderLambs} lambs for the parts`];
  if (c.carcass > 0) countParts.push(`${c.carcass} carcass lamb${c.carcass === 1 ? "" : "s"}, sent uncut`);
  for (const e of x.extraLambs) {
    const n = Math.round(num(e.lambs));
    if (!n) continue;
    countParts.push(`${n} extra ${REASON[e.reason] ?? "for other reasons"}${e.note?.trim() ? ` (${e.note.trim()})` : ""}`);
  }
  const plusBits = [String(c.orderLambs), c.carcass ? `${c.carcass} carcass` : "", c.extra ? `${c.extra} extra` : ""].filter(Boolean);
  const countTotal = plusBits.length > 1 ? `${plusBits.join(" + ")} = ${c.recommended} lambs` : `${c.recommended} lambs`;
  const replaced =
    c.source === "your number"
      ? `${c.final} lambs was typed in on the week page. It replaced the worked-out count of ${c.recommended}.`
      : c.source === "cut sheet"
        ? `The cut sheet has ${c.final} lambs. It replaced the worked-out count of ${c.recommended}.`
        : null;

  // --- What the lambs give against what the orders take ---
  const cutLambs = c.partsLambs;
  const balanceLambs =
    c.carcass > 0
      ? `${c.final} lambs, less ${c.carcass} carcass sent uncut: ${cutLambs} lambs are cut into parts.`
      : `${cutLambs} lambs are cut into parts.`;
  const rowById = new Map<string, PartRow>(c.rows.map((r) => [r.part.id, r]));
  const balance: CheckBalance[] = [];
  const shorts: string[] = [];
  for (const b of balances) {
    const r = rowById.get(b.part.id)!;
    const orders = partSum(b.part.id);
    if (!(b.supply > EPS) && !(orders > EPS) && !(b.leTrim > EPS)) continue;
    const lb = b.part.unit === "lb" ? " lb" : "";
    const name = partTitle(b.part);
    const pack = x.packSizes?.get(b.part.id) ?? 1;
    const packs = (n: number) => (pack > 1 ? ` (${dec(n / pack)} pack${n / pack === 1 ? "" : "s"})` : "");
    const give = b.parent
      ? `${dec(b.supply)} cut from ${partWord(b.parent)}`
      : `${cutLambs} × ${dec(num(b.part.per_lamb))}${lb} = ${dec(b.supply)}${lb}${packs(b.supply)}`;
    const take: string[] = [];
    if (b.cut) {
      take.push(`Sold whole ${dec(orders)}`);
      balance.push({
        name,
        give,
        take,
        result: `Cut into ${b.cut.into.map((p) => partWord(p)).join(" and ")} ${dec(round2(b.supply - orders))}`,
        short: false,
      });
      continue;
    }
    const took = b.part.unit === "lb" ? orders : Math.ceil(orders - EPS);
    take.push(`Orders take ${dec(took)}${lb}${packs(took)}`);
    if (b.leTrim > EPS) take.push(`Le Trim takes ${dec(b.part.unit === "lb" ? b.leTrim : Math.ceil(b.leTrim - EPS))}${lb}`);
    const left = wholeLeft(r);
    const short = left < -EPS;
    if (short) shorts.push(`${partWord(b.part, -left)} short ${dec(-left)}${lb}`);
    balance.push({ name, give, take, result: short ? `Short ${dec(-left)}${lb}${packs(-left)}` : `Left over ${dec(left)}${lb}${packs(left)}`, short });
  }
  const check = shorts.length
    ? { ok: false, text: `Not every part covers its orders: ${shorts.join(", ")}.` }
    : { ok: true, text: "Every part covers its orders." };

  const guesses = x.parts.filter((p) => p.confirmed === false);
  const guessLine = guesses.length
    ? `Still starting guesses, not checked yet: ${guesses
        .map((p) => `${partWord(p)} (${dec(num(p.per_lamb))}${p.unit === "lb" ? " lb" : ""} per lamb)`)
        .join(", ")}.`
    : null;

  return {
    answersLine,
    waitingLine,
    noOrderLine,
    groups: ordered,
    leTrim,
    lambs,
    neverLine,
    countParts,
    countTotal,
    replaced,
    balanceLambs,
    balance,
    check,
    guesses: guessLine,
  };
}
