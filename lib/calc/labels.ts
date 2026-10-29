// The box label list (SPEC 12.5): one label per planned box, so Kathy can
// print every customer label before packing day. Pure: the print page and the
// "Orders changed since you printed labels" check on Packing and This week
// all build the list here, so they always agree.

import { planBoxes, type BoxSetup } from "./boxes";
import { fmt, num } from "./num";
import { packedWith } from "./packTogether";
import { groupProducts } from "./products";
import type { Qty } from "./types";
import { toProductUnit, unitWord } from "./units";

export type LabelProduct = {
  id: string;
  name: string;
  /** Printed on the label; blank means the name. */
  label_name?: string | null;
  unit: string;
  lb_per_unit?: number | null;
  group_name: string;
  sort: number;
  /** Packed in one box with the products of the same name (Organs); blank: on its own. */
  packed_with?: string | null;
};

export type LabelOrder = {
  /** Report line 1: "PCC #02 Kirkland". */
  customer: string;
  /** For printed labels: the customer (keeps label numbers stable), its name ("PCC"), and location ("#02 Kirkland", or ""). */
  customerId?: string;
  name?: string;
  location?: string;
  /** Pallet group order, then name: customers sort by this. */
  sortKey: string;
  lines: Qty;
  units?: Record<string, string>;
};

export type LabelRow = {
  customer: string;
  /** Label line 2: "10 Single Pack Rack (Cap ON)", "45 lb Le Trim", "6 packs Front Shanks". */
  line2: string;
  /** The same, in parts for the printed label: "6", "packs" (or "lb", or ""), and the product's label name. */
  qty: string;
  unit: string;
  product: string;
  boxType: string;
  /** The box type id (box_types.id); null when no box size is worked out. */
  boxTypeId: string | null;
  /** "1 of 2" when the customer gets more than one box of this product; "" for one. */
  ofN: string;
  /** No box size worked out (no usable box limit): one label for the customer, box "?". */
  noBox?: boolean;
  /** Which box of this customer's order of this product, and how many boxes ("Box 1 of 2"). */
  boxNo: number;
  boxCount: number;
  /** customer|product|box: what a label number belongs to, so numbers survive order changes. */
  key: string;
  /** The printed label's customer name and location ("PCC" / "#02 Kirkland"). */
  name: string;
  location: string;
  /** Fingerprint of what the label says, to tell when it changed after printing. */
  print: string;
};

export type LabelTable = {
  product: LabelProduct;
  group: string;
  rows: LabelRow[];
  /** Pieces or packs with no weight per piece: the 45 lb limit can't be checked. */
  weightUnknown: boolean;
  /** Some rows have no box size yet (shown with "?" and a note under the heading). */
  noBox: boolean;
};

export type LabelList = {
  tables: LabelTable[];
  /** Products with at least one line that has no box size yet, in table order. */
  noBoxProducts: string[];
  /** Every label, including one per customer for lines with no box size. */
  total: number;
  /** Any table where the 45 lb limit can't be checked (no weight per piece). */
  weightUnknown: boolean;
  /** Fingerprint of every label, to tell when orders change after printing. */
  hash: string;
};

/** Line 1 for a chain store: the chain and the store, store number kept ("PCC #02 Kirkland"; Lucas, 10/21/26). */
export function labelCustomer(name: string, parentName: string | null | undefined): string {
  if (!parentName) return name.trim();
  return `${parentName.trim()} ${name.trim()}`;
}

/** "45 lb Le Trim", "6 packs Front Shanks" (shanks count in packs), "10 Single Pack Rack". */
const amountText = (n: number, unit: string, name: string) =>
  unit === "lb" ? `${fmt(n)} lb ${name}` : unit === "pack" ? `${fmt(n)} ${unitWord("pack", n)} ${name}` : `${fmt(n)} ${name}`;

function hash(t: string): string {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

export function labelList(orders: LabelOrder[], products: Map<string, LabelProduct>, boxes: BoxSetup): LabelList {
  const sorted = [...orders].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const ordered = new Set(sorted.flatMap((o) => Object.keys(o.lines).filter((k) => num(o.lines[k]) > 0)));
  const tables: LabelTable[] = [];

  for (const g of groupProducts([...products.values()].filter((p) => ordered.has(p.id)))) {
    for (const p of g.products) {
      // Packed together (Organs, Lucas 10/29/26): one box per store, one label, no box size.
      const members = packedWith(p.id, products);
      if (members.length > 1) {
        if (p.id !== members.find((id) => ordered.has(id))) continue;
        const lead = members[0];
        const groupLabel = members.map((id) => products.get(id)?.name ?? id).join(", ");
        const table: LabelTable = { product: { ...p, id: lead, name: groupLabel }, group: g.group, rows: [], weightUnknown: false, noBox: false };
        for (const o of sorted) {
          const parts = members
            .filter((id) => num(o.lines[id]) > 0)
            .map((id) => {
              const q = num(o.lines[id]);
              const pr = products.get(id);
              return (o.units?.[id] ?? pr?.unit) === "lb" ? `${fmt(q)} lb ${pr?.name ?? id}` : `${fmt(q)} ${pr?.name ?? id}`;
            });
          if (!parts.length) continue;
          const name = o.name ?? o.customer;
          const location = o.location ?? "";
          const line2 = parts.join(", ");
          table.rows.push({
            customer: o.customer,
            line2,
            qty: "",
            unit: "",
            product: groupLabel,
            boxType: "",
            boxTypeId: null,
            ofN: "",
            boxNo: 1,
            boxCount: 1,
            key: `${o.customerId ?? o.customer}|${lead}|1`,
            name,
            location,
            print: hash([name, location, line2, "", 1, 1].join("|")),
          });
        }
        if (table.rows.length) tables.push(table);
        continue;
      }
      const label = (p.label_name ?? "").trim() || p.name;
      const table: LabelTable = { product: p, group: g.group, rows: [], weightUnknown: false, noBox: false };
      const row = (
        o: LabelOrder,
        n: number,
        unit: string,
        boxType: string,
        boxNo: number,
        boxCount: number,
        noBox?: boolean,
        boxTypeId: string | null = null,
      ): LabelRow => {
        const name = o.name ?? o.customer;
        const location = o.location ?? "";
        const ofN = boxCount > 1 ? `${boxNo} of ${boxCount}` : "";
        const line2 = amountText(n, unit, label);
        return {
          customer: o.customer,
          line2,
          qty: fmt(n),
          unit: unit === "each" ? "" : unitWord(unit, n),
          product: label,
          boxType,
          boxTypeId,
          ofN,
          ...(noBox ? { noBox: true } : {}),
          boxNo,
          boxCount,
          key: `${o.customerId ?? o.customer}|${p.id}|${boxNo}`,
          name,
          location,
          print: hash([name, location, line2, boxType, boxNo, boxCount].join("|")),
        };
      };
      // A line no box can be worked out for still gets one label, with box "?" (Lucas, 10/21/26).
      const noBoxRow = (o: LabelOrder, n: number, unit: string) => {
        table.rows.push(row(o, n, unit, "?", 1, 1, true));
        table.noBox = true;
      };
      for (const o of sorted) {
        const q = num(o.lines[p.id]);
        if (!(q > 0)) continue;
        const taken = o.units?.[p.id];
        const amount = toProductUnit(q, taken, { unit: p.unit, lb_per_unit: p.lb_per_unit ?? null });
        if (!(amount > 0)) {
          noBoxRow(o, q, taken ?? p.unit);
          continue;
        }
        const plan = planBoxes(amount, p, boxes.limits.get(p.id) ?? [], boxes.types, boxes.capLb);
        if (plan.notBoxed) continue; // never boxed (Carcass Lamb): no labels
        if (plan.problem) {
          noBoxRow(o, amount, p.unit);
          continue;
        }
        if (plan.weightUnknown) table.weightUnknown = true;
        plan.boxes.forEach((b, i) => table.rows.push(row(o, b.amount, p.unit, b.typeName, i + 1, plan.boxes.length, false, b.typeId)));
      }
      if (table.rows.length) tables.push(table);
    }
  }

  const total = tables.reduce((n, t) => n + t.rows.length, 0);
  // Order-independent: the same labels give the same fingerprint on every screen.
  const canon = tables
    .flatMap((t) => t.rows.map((r) => `${t.product.id}|${r.customer}|${r.line2}|${r.boxType}|${r.ofN}`))
    .sort()
    .join("\n");
  return {
    tables,
    noBoxProducts: tables.filter((t) => t.noBox).map((t) => t.product.name),
    total,
    weightUnknown: tables.some((t) => t.weightUnknown),
    hash: hash(canon),
  };
}

/** A report row's label number and print state, from the database (box_labels). */
export type StoredLabel = { number: number; printed_at: string | null; printed_print: string | null; printed_by_name: string | null };

/** Printed, and not changed since: or changed since printed, so it needs printing again. */
export function labelState(row: Pick<LabelRow, "print">, stored: StoredLabel | undefined): { printed: boolean; changed: boolean } {
  const printed = !!stored?.printed_at;
  return { printed, changed: printed && stored!.printed_print !== row.print };
}

/** Every box row of the report, in report order (grouped by product), as the labels to print. */
export function reportLabels(list: LabelList): (LabelRow & { productId: string })[] {
  return list.tables.flatMap((t) => t.rows.map((r) => ({ ...r, productId: t.product.id })));
}
