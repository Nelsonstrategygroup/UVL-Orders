// Reads and writes for the Packing screen (stage 3: packing by weight).
// The packing role may read orders, order lines, products, weeks, customers,
// distributors (Ships to), and names; and read and write packing_lines (marks and
// counts), packing_weights, and packing_orders (pallet). Nothing else.

import type { SupabaseClient } from "@supabase/supabase-js";
import { groupLead, packedWith } from "../calc/packTogether";
import { qtyText } from "../orders";
import { displayName, sortByDisplayName } from "../calc/customers";
import { labelCustomer, labelList, reportLabels, type LabelList } from "../calc/labels";
import { sheetRows, type SheetLabel, type SheetRow } from "../calc/packSheet";
import type { BoxSetup } from "../calc/boxes";
import { num } from "../calc/num";
import type { PackLine, Weight } from "../calc/packing";
import type { Qty } from "../calc/types";

export type PackProduct = {
  id: string;
  name: string;
  unit: string;
  sort: number;
  lb_per_unit: number | null;
  /** How many fit in one box; null if not known yet. */
  per_box: number | null;
  active: boolean;
  group_name: string;
  /** Packed in one box with the products of the same name (Organs); blank or missing: on its own. */
  packed_with?: string;
  /** Normal box weight in lb; a scanned box outside it gets a warning. */
  box_lb_min: number | null;
  box_lb_max: number | null;
  /** Printed on box labels; blank means the name. */
  label_name: string;
  /** Weight blanks on the packing sheet when the box count isn't known; null: the setting. */
  pack_blanks: number | null;
};

/** Marks on one line: an optional piece count, not filled, and a flag. */
export type LineMark = { count: number | null; shorted: boolean; flagged: boolean; flagNote: string };

export type PackWeight = Weight & {
  id: string;
  by: string | null;
  at: string;
  /** weigh (the weigh panel), scan, or manual (a label typed in). */
  source: string;
  gtin: string | null;
  serial: string | null;
  lot: string | null;
  case_no: string | null;
  pallet_id: string | null;
  /** Made on the phone; set for weights saved through the outbox. */
  client_id: string | null;
  /** Which box of the customer's product (its place on the packing sheet), and its label number (change request 10/26/26). */
  slot: number | null;
  label_no: number | null;
  /** The box type it went in (scan-to-pallet routing). */
  box_type_id?: string | null;
  /** A product not on the customer's order, and when (and by whom) it was checked as correct for the shipment (10/26/26). */
  off_order?: boolean;
  extra_ok_at?: string | null;
  extra_ok_by_name?: string | null;
};

export type PackOrder = {
  id: string;
  customerId: string;
  customerName: string;
  /** Box label line 1: "PCC #02 Kirkland". */
  labelCustomer: string;
  /** On a printed label: the customer ("PCC", or the business), and the location ("#02 Kirkland", or ""). */
  labelName: string;
  labelLocation: string;
  /** Distributor, then name. */
  sortKey: string;
  /** The customer's standing notes (delivery times and so on). */
  standingNotes: string;
  /** Notes on this week's order. */
  orderNotes: string;
  /** The distributor it ships through ("PCC distributor"), or null for Direct (Ships to; change request 10/26/26). */
  group: string | null;
  spot: string;
  /** Its shipment: "point:<id>" through a distributor, "customer:<id>" for Direct. */
  shipKey: string;
  /** Ships to: the distributor's id, or null for Direct. */
  shipsToPointId: string | null;
  lines: Qty;
  /** Lines taken in another unit than the product's own ("lb" for a piece product). */
  units: Record<string, string>;
  marks: Record<string, LineMark>;
  weights: PackWeight[];
  pallet: string;
  /** Who last weighed or marked something, and when. */
  lastBy: string | null;
  lastAt: string | null;
};

export type PackingData = {
  week: string;
  processDate: string | null;
  /** When box labels were printed for this week, and their fingerprint. */
  labelsHash: string | null;
  labelsPrintedAt: string | null;
  /** The cut sheet's INV#, if set (printed on the box label list). */
  invNumber: string | null;
  products: Map<string, PackProduct>;
  /** Orders with something on them, by distributor, then by name. */
  orders: PackOrder[];
  /** Boxes scanned this week that no open order needed (no customer yet). */
  unassigned: PackWeight[];
  /** Distributors (Ships to), by id. */
  points: Map<string, string>;
  /** For the pallet manifest: the company name and the ship-from address (blank: a line to write it on). */
  company: string;
  shipFrom: string;
  /** Box label numbers given out for the week, by box (customer|product|box). Empty until the Box Label Report or the packing sheet hands them out. */
  labelNumbers: Map<string, number>;
  /** Weight blanks on the packing sheet: when the box count isn't known, and spares after known boxes. */
  blanks: { unknown: number; spare: number };
};

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

/** Each line of an order as the packing rules see it. */
export function packLines(o: PackOrder, products: Map<string, PackProduct>): [string, PackLine][] {
  return Object.entries(o.lines)
    .filter(([, q]) => q > 0)
    .sort(([a], [b]) => (products.get(a)?.sort ?? 1e9) - (products.get(b)?.sort ?? 1e9))
    .map(([pid, q]) => {
      const m = o.marks[pid];
      // Packed together (Organs): a box of any of them counts for each.
      const group = packedWith(pid, products);
      const weight = o.weights.filter((w) => group.includes(w.product_id)).reduce((s, w) => s + w.weight, 0);
      const others = group.filter((id) => id !== pid).map((id) => products.get(id)?.name ?? id);
      return [
        pid,
        {
          ordered: q,
          unit: o.units[pid] ?? products.get(pid)?.unit ?? "each",
          weight,
          count: m?.count ?? null,
          shorted: m?.shorted ?? false,
          flagged: m?.flagged ?? false,
          flagNote: m?.flagNote ?? "",
          together: others.length ? others.join(", ") : undefined,
        },
      ];
    });
}

type WeightRow = {
  id: string;
  product_id: string;
  weight: number;
  box_no: number | null;
  slot: number | null;
  label_no: number | null;
  box_type_id: string | null;
  off_order?: boolean;
  extra_ok_by?: string | null;
  extra_ok_at?: string | null;
  created_by: string | null;
  created_at: string;
  source: string;
  gtin: string | null;
  serial: string | null;
  lot: string | null;
  case_no: string | null;
  pallet_id: string | null;
  client_id: string | null;
};

export async function loadPacking(db: SupabaseClient, week: string): Promise<PackingData> {
  const [weekRow, orders, customers, groups, products, people, sheet, labels, settings, loose] = await Promise.all([
    db.from("weeks").select("process_date, labels_hash, labels_printed_at").eq("id", week).maybeSingle(),
    db
      .from("orders")
      .select(
        "id, customer_id, notes, order_lines(product_id, qty, unit), packing_lines(product_id, packed_qty, shorted, flagged, flag_note, packed_by, packed_at), packing_weights(id, product_id, weight, box_no, slot, label_no, box_type_id, off_order, extra_ok_by, extra_ok_at, created_by, created_at, source, gtin, serial, lot, case_no, pallet_id, client_id), packing_orders(pallet, updated_by, updated_at, created_at)",
      )
      .eq("week_id", week),
    db.from("customers").select("id, name, active, call_day, parent_customer_id, notes, ships_to_point_id"),
    db.from("consolidation_points").select("id, name"),
    db.from("products").select("id, name, unit, sort, lb_per_unit, per_box, active, group_name, box_lb_min, box_lb_max, label_name, pack_blanks, packed_with").order("sort"),
    db.from("profiles").select("id, display_name"),
    // The INV#: the week's invoice number (the same on the cut sheet, manifest and invoices).
    db.from("weeks").select("invoice_number").eq("id", week).maybeSingle(),
    db.from("box_labels").select("number, key").eq("week_id", week),
    // Everything, so a setting added later (ship_from_address) can't break Packing before its migration runs.
    db.from("app_settings").select("*").maybeSingle(),
    db
      .from("packing_weights")
      .select("id, product_id, weight, box_no, slot, label_no, box_type_id, off_order, extra_ok_by, extra_ok_at, created_by, created_at, source, gtin, serial, lot, case_no, pallet_id, client_id")
      .eq("week_id", week)
      .is("order_id", null),
  ]);

  const custList = must(customers) as {
    id: string;
    name: string;
    active: boolean;
    call_day: string | null;
    parent_customer_id: string | null;
    notes: string;
    ships_to_point_id: string | null;
  }[];
  const byId = new Map(custList.map((c) => [c.id, c]));
  const pointList = (must(groups) ?? []) as { id: string; name: string }[];
  const pointName = new Map(pointList.map((g) => [g.id, g.name]));
  // Distributors in name order, for sorting.
  const pointRank = new Map([...pointList].sort((a, b) => a.name.localeCompare(b.name)).map((g, i) => [g.id, i]));
  const names = new Map((must(people) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  const toWeight = (w: WeightRow): PackWeight => ({
    id: w.id,
    product_id: w.product_id,
    weight: num(w.weight),
    box_no: w.box_no,
    slot: w.slot,
    label_no: w.label_no,
    box_type_id: w.box_type_id ?? null,
    off_order: !!w.off_order,
    extra_ok_at: w.extra_ok_at ?? null,
    extra_ok_by_name: w.extra_ok_by ? (names.get(w.extra_ok_by) ?? "Someone") : null,
    by: w.created_by ? (names.get(w.created_by) ?? "Someone") : null,
    at: w.created_at,
    source: w.source ?? "weigh",
    gtin: w.gtin,
    serial: w.serial,
    lot: w.lot,
    case_no: w.case_no,
    pallet_id: w.pallet_id,
    client_id: w.client_id,
  });

  type Row = {
    id: string;
    customer_id: string;
    notes: string;
    order_lines: { product_id: string; qty: number; unit: string | null }[];
    packing_lines: {
      product_id: string;
      packed_qty: number | null;
      shorted: boolean;
      flagged: boolean;
      flag_note: string;
      packed_by: string | null;
      packed_at: string;
    }[];
    packing_weights: WeightRow[];
    packing_orders:
      | { pallet: string; updated_by: string | null; updated_at: string | null; created_at: string }
      | { pallet: string; updated_by: string | null; updated_at: string | null; created_at: string }[]
      | null;
  };

  const list: (PackOrder & { rank: [number, number, string] })[] = [];
  for (const o of must(orders) as Row[]) {
    const lines: Qty = {};
    const units: Record<string, string> = {};
    for (const l of o.order_lines ?? []) {
      if (num(l.qty) <= 0) continue;
      lines[l.product_id] = num(l.qty);
      if (l.unit) units[l.product_id] = l.unit;
    }
    if (!Object.keys(lines).length) continue;

    let lastAt: string | null = null;
    let lastBy: string | null = null;
    const touch = (at: string | null, by: string | null) => {
      if (at && (!lastAt || at > lastAt)) {
        lastAt = at;
        lastBy = by;
      }
    };
    const marks: Record<string, LineMark> = {};
    for (const p of o.packing_lines ?? []) {
      marks[p.product_id] = {
        count: p.packed_qty == null ? null : num(p.packed_qty),
        shorted: p.shorted,
        flagged: p.flagged,
        flagNote: p.flag_note ?? "",
      };
      touch(p.packed_at, p.packed_by);
    }
    const weights: PackWeight[] = (o.packing_weights ?? [])
      .map((w) => toWeight(w))
      .sort((a, b) => a.at.localeCompare(b.at));
    for (const w of o.packing_weights ?? []) touch(w.created_at, w.created_by);
    // packing_orders is one-to-one with orders, so it may come back as an object or a one-item list.
    const po = Array.isArray(o.packing_orders) ? o.packing_orders[0] : o.packing_orders;
    if (po) touch(po.updated_at ?? po.created_at, po.updated_by);

    const cust = byId.get(o.customer_id);
    const pointId = cust?.ships_to_point_id ?? null;
    const group = pointId ? { name: pointName.get(pointId) ?? "Distributor", rank: pointRank.get(pointId) ?? 0 } : undefined;
    const name = cust ? displayName(cust, byId) : "Unknown customer";
    const parent = cust?.parent_customer_id ? byId.get(cust.parent_customer_id) : undefined;
    const labelName = cust ? labelCustomer(cust.name, parent?.name) : name;
    list.push({
      id: o.id,
      customerId: o.customer_id,
      customerName: name,
      labelCustomer: labelName,
      labelName: parent ? parent.name.trim() : (cust?.name ?? name).trim(),
      labelLocation: parent && cust ? cust.name.trim() : "",
      sortKey: group ? `0|${String(group.rank).padStart(6, "0")}|${name}` : `1|${name}`,
      standingNotes: (cust?.notes ?? "").trim(),
      orderNotes: (o.notes ?? "").trim(),
      group: group?.name ?? null,
      spot: "",
      shipKey: pointId ? `point:${pointId}` : `customer:${o.customer_id}`,
      shipsToPointId: pointId,
      lines,
      units,
      marks,
      weights,
      pallet: po?.pallet ?? "",
      lastBy: lastBy ? (names.get(lastBy) ?? "Someone") : null,
      lastAt,
      // Customers shipping through a distributor first, by distributor; then everyone else by name.
      rank: group ? [0, group.rank, name] : [1, 0, name],
    });
  }

  // Ungrouped customers: alphabetical, locations under their chain.
  const custOrder = new Map(sortByDisplayName(custList, byId).map((c, i) => [displayName(c, byId), i]));
  list.sort(
    (a, b) =>
      a.rank[0] - b.rank[0] ||
      a.rank[1] - b.rank[1] ||
      (custOrder.get(a.rank[2]) ?? 1e9) - (custOrder.get(b.rank[2]) ?? 1e9),
  );

  const prods = ((must(products) as PackProduct[]) ?? []).map((x) => ({
    ...x,
    lb_per_unit: x.lb_per_unit == null ? null : num(x.lb_per_unit),
    per_box: x.per_box == null ? null : num(x.per_box),
    box_lb_min: x.box_lb_min == null ? null : num(x.box_lb_min),
    box_lb_max: x.box_lb_max == null ? null : num(x.box_lb_max),
    pack_blanks: x.pack_blanks == null ? null : num(x.pack_blanks),
  }));
  const set = must(settings) as {
    pack_unknown_blanks: number;
    pack_spare_blanks: number;
    company_name?: string;
    ship_from_address?: string;
  } | null;
  const wr = must(weekRow) as { process_date: string | null; labels_hash: string | null; labels_printed_at: string | null } | null;
  const invN = sheet.error ? null : ((sheet.data as { invoice_number: number | null } | null)?.invoice_number ?? null);
  const inv = invN == null ? null : String(invN);
  return {
    week,
    processDate: wr?.process_date ?? null,
    labelsHash: wr?.labels_hash ?? null,
    labelsPrintedAt: wr?.labels_printed_at ?? null,
    invNumber: inv?.trim() || null,
    products: new Map(prods.map((p) => [p.id, p])),
    unassigned: ((loose.error ? [] : loose.data) as WeightRow[]).map((w) => toWeight(w)),
    points: pointName,
    company: set?.company_name?.trim() || "Umpqua Valley Lamb",
    shipFrom: set?.ship_from_address?.trim() ?? "",
    labelNumbers: new Map((must(labels) as { number: number; key: string }[]).map((l) => [l.key, l.number])),
    blanks: { unknown: set?.pack_unknown_blanks ?? 6, spare: set?.pack_spare_blanks ?? 2 },
    orders: list.map((o) => {
      const { rank, ...rest } = o;
      void rank;
      return rest;
    }),
  };
}

/** Record one weight (one box or case, or the whole line). Returns its id. */
export async function addWeight(
  db: SupabaseClient,
  orderId: string,
  productId: string,
  weight: number,
  boxNo: number | null,
  box: { slot: number | null; label_no: number | null } = { slot: null, label_no: null },
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await db
    .from("packing_weights")
    .insert({ order_id: orderId, product_id: productId, weight, box_no: boxNo, ...box })
    .select("id")
    .single();
  return { id: (data?.id as string | undefined) ?? null, error: error ? error.message : null };
}

export async function removeWeight(db: SupabaseClient, id: string): Promise<string | null> {
  const { error } = await db.from("packing_weights").delete().eq("id", id);
  return error ? error.message : null;
}

/** Save a line's marks: piece count, not filled, flag and note. */
export async function saveMark(
  db: SupabaseClient,
  orderId: string,
  productId: string,
  m: LineMark,
): Promise<string | null> {
  const { error } = await db.from("packing_lines").upsert(
    {
      order_id: orderId,
      product_id: productId,
      packed_qty: m.count,
      shorted: m.shorted,
      flagged: m.flagged,
      flag_note: m.flagNote,
    },
    { onConflict: "order_id,product_id" },
  );
  return error ? error.message : null;
}

/** Save the pallet a customer's order went on. */
export async function savePallet(db: SupabaseClient, orderId: string, pallet: string): Promise<string | null> {
  const { error } = await db.from("packing_orders").upsert({ order_id: orderId, pallet }, { onConflict: "order_id" });
  return error ? error.message : null;
}

/** The box label list for a week's packing data (SPEC 12.5). */
export function packingLabels(data: PackingData, boxes: BoxSetup): LabelList {
  return labelList(
    data.orders.map((o) => ({
      customer: o.labelCustomer,
      customerId: o.customerId,
      name: o.labelName,
      location: o.labelLocation,
      sortKey: o.sortKey,
      lines: o.lines,
      units: o.units,
    })),
    data.products,
    boxes,
  );
}

/** The box rows the packing sheet needs, from the week's box label list. */
export function sheetLabels(data: PackingData, boxes: BoxSetup): SheetLabel[] {
  return reportLabels(packingLabels(data, boxes)).map((r) => ({ key: r.key, boxNo: r.boxNo, boxCount: r.boxCount, noBox: r.noBox, boxTypeId: r.boxTypeId }));
}

/**
 * One customer's rows on the packing sheet (lib/calc/packSheet.ts): the
 * order's products in packing order, then any product boxed for them that
 * isn't on the order (scanned anyway).
 */
export function orderSheet(o: PackOrder, data: PackingData, labels: SheetLabel[], extra?: Record<string, number>): SheetRow[] {
  // Products packed together (Organs) are one row, under the group's first product, holding all their boxes.
  const lead = (pid: string) => groupLead(pid, data.products);
  const ids: string[] = [];
  for (const [pid] of packLines(o, data.products)) if (!ids.includes(lead(pid))) ids.push(lead(pid));
  for (const w of o.weights) if (!ids.includes(lead(w.product_id))) ids.push(lead(w.product_id));
  const weights = o.weights.map((w) => (lead(w.product_id) === w.product_id ? w : { ...w, product_id: lead(w.product_id) }));
  const perProduct = new Map([...data.products.values()].map((p) => [p.id, p.pack_blanks ?? null]));
  return sheetRows({ customerId: o.customerId, productIds: ids, weights }, labels, data.labelNumbers, { ...data.blanks, perProduct }, extra);
}

/** The sheet row a product's boxes go in: its own, or its group's (Organs) under the group's first product. */
export const sheetRowId = (pid: string, data: PackingData) => groupLead(pid, data.products);

/**
 * A sheet row's name, and for a group what each product ordered ("8 Heart,
 * 8 Liver, 6 Kidney"; null for a product on its own), and the products in it.
 */
export function sheetRowText(o: PackOrder, data: PackingData, pid: string): { name: string; ordered: string | null; members: string[] } {
  const members = packedWith(pid, data.products);
  const nameOf = (id: string) => data.products.get(id)?.name ?? id;
  if (members.length < 2) return { name: nameOf(pid), ordered: null, members: [pid] };
  const on = members.filter((id) => (o.lines[id] ?? 0) > 0);
  return {
    name: members.map(nameOf).join(", "),
    ordered: on.length ? on.map((id) => `${qtyText(o.lines[id], o.units[id] ?? data.products.get(id)?.unit ?? "each")} ${nameOf(id)}`).join(", ") : null,
    members,
  };
}

/** Give an unassigned box to a customer's order (Pallets, by Kathy). */
export async function assignBox(db: SupabaseClient, weightId: string, orderId: string): Promise<string | null> {
  const { error } = await db.from("packing_weights").update({ order_id: orderId, week_id: null, route: "picked" }).eq("id", weightId);
  return error ? error.message : null;
}
