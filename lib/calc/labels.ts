// The box label list (SPEC 12.5): one label per planned box, so Kathy can
// print every customer label before packing day. Pure: the print page and the
// "Orders changed since you printed labels" check on Packing and This week
// all build the list here, so they always agree.

import { planBoxes, type BoxSetup } from "./boxes";
import { fmt, num } from "./num";
import { groupProducts } from "./products";
import type { Qty } from "./types";
import { toProductUnit } from "./units";

export type LabelProduct = {
  id: string;
  name: string;
  /** Printed on the label; blank means the name. */
  label_name?: string | null;
  unit: string;
  lb_per_unit?: number | null;
  group_name: string;
  sort: number;
};

export type LabelOrder = {
  /** Label line 1: "PCC #02 Kirkland". */
  customer: string;
  /** Pallet group order, then name: customers sort by this. */
  sortKey: string;
  lines: Qty;
  units?: Record<string, string>;
};

export type LabelRow = {
  customer: string;
  /** Label line 2: "10 Single Pack Rack (Cap ON)", "45 lb Le Trim". */
  line2: string;
  boxType: string;
  /** "1 of 2" when the customer gets more than one box of this product; "" for one. */
  ofN: string;
};

export type LabelTable = { product: LabelProduct; group: string; rows: LabelRow[]; weightUnknown: boolean };
export type LabelProblem = {
  product: string;
  customer: string;
  amount: string;
  why: string;
  /** blocked: no labels until it's fixed. unconfirmed: labeled, but a box isn't confirmed yet. */
  kind: "blocked" | "unconfirmed";
};

export type LabelList = {
  tables: LabelTable[];
  /** Shown in red at the top: nothing here gets a label until it's fixed. */
  problems: LabelProblem[];
  total: number;
  /** Fingerprint of every label, to tell when orders change after printing. */
  hash: string;
};

/** Line 1 for a chain store: the chain and the store, store number kept ("PCC #02 Kirkland"; Lucas, 10/21/26). */
export function labelCustomer(name: string, parentName: string | null | undefined): string {
  if (!parentName) return name.trim();
  return `${parentName.trim()} ${name.trim()}`;
}

const amountText = (n: number, unit: string, name: string) => (unit === "lb" ? `${fmt(n)} lb ${name}` : `${fmt(n)} ${name}`);

function hash(t: string): string {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

export function labelList(orders: LabelOrder[], products: Map<string, LabelProduct>, boxes: BoxSetup): LabelList {
  const sorted = [...orders].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const ordered = new Set(sorted.flatMap((o) => Object.keys(o.lines).filter((k) => num(o.lines[k]) > 0)));
  const tables: LabelTable[] = [];
  const problems: LabelProblem[] = [];

  for (const g of groupProducts([...products.values()].filter((p) => ordered.has(p.id)))) {
    for (const p of g.products) {
      const label = (p.label_name ?? "").trim() || p.name;
      const table: LabelTable = { product: p, group: g.group, rows: [], weightUnknown: false };
      for (const o of sorted) {
        const q = num(o.lines[p.id]);
        if (!(q > 0)) continue;
        const taken = o.units?.[p.id];
        const amount = toProductUnit(q, taken, { unit: p.unit, lb_per_unit: p.lb_per_unit ?? null });
        const asOrdered = taken && taken !== p.unit ? `${fmt(q)} ${taken}` : amountText(q, p.unit, "").trim();
        if (!(amount > 0)) {
          problems.push({ product: p.name, customer: o.customer, amount: asOrdered, why: "Ordered in pounds, but the product has no weight per piece", kind: "blocked" });
          continue;
        }
        const plan = planBoxes(amount, p, boxes.limits.get(p.id) ?? [], boxes.types, boxes.capLb);
        if (plan.notBoxed) continue; // never boxed (Carcass Lamb): no labels
        if (plan.problem) {
          problems.push({ product: p.name, customer: o.customer, amount: asOrdered, why: plan.problem, kind: "blocked" });
          continue;
        }
        if (plan.unconfirmed.length)
          problems.push({
            product: p.name,
            customer: o.customer,
            amount: asOrdered,
            why: `Box not confirmed in Setup (${plan.unconfirmed.join(", ")}); the labels below may change`,
            kind: "unconfirmed",
          });
        if (plan.weightUnknown) table.weightUnknown = true;
        plan.boxes.forEach((b, i) =>
          table.rows.push({
            customer: o.customer,
            line2: amountText(b.amount, p.unit, label),
            boxType: b.typeName,
            ofN: plan.boxes.length > 1 ? `${i + 1} of ${plan.boxes.length}` : "",
          }),
        );
      }
      if (table.rows.length) tables.push(table);
    }
  }

  const total = tables.reduce((n, t) => n + t.rows.length, 0);
  // Order-independent: the same labels give the same fingerprint on every screen.
  const canon = tables
    .flatMap((t) => t.rows.map((r) => `${t.product.id}|${r.customer}|${r.line2}|${r.boxType}|${r.ofN}`))
    .concat(problems.map((x) => `!${x.product}|${x.customer}|${x.amount}|${x.why}`))
    .sort()
    .join("\n");
  return { tables, problems, total, hash: hash(canon) };
}
