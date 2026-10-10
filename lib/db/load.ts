// Reads for the office screens. Each runs as the logged-in person, so Row
// Level Security applies.

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "../dates";
import { num } from "../calc/num";
import type { HalfWholeOrder } from "../calc/types";
import type {
  Catalog,
  CatalogPart,
  CatalogProduct,
  Contact,
  Customer,
  CustomersData,
  LastContact,
  Order,
  OrderUnit,
  Qty,
  Units,
  WeekData,
} from "./types";

const PAGE = 1000; // Supabase returns at most 1000 rows per request.

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Fetch every row, a page at a time. */
async function fetchAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

function must<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

export async function loadCatalog(db: SupabaseClient): Promise<Catalog> {
  const [parts, products, uses, cutSpecs, sizes, settings] = await Promise.all([
    db.from("parts").select("id, name, per_lamb, unit, balance_check, confirmed, sort, source_note, drives_count").order("sort"),
    db
      .from("products")
      .select(
        "id, name, short_name, unit, group_name, cut_spec_id, fresh_only, active, sort, note, alt_unit, lb_per_unit, pieces_per_pack, order_step, billed_by_weight, counts_toward_lambs, not_lamb, confirmed, product_cut_specs(cut_spec_id, units_per_cut, sort)",
      )
      .order("sort")
      .order("name"),
    db.from("product_part_uses").select("product_id, part_id, qty"),
    db.from("cut_specs").select("id, text, use_type, active, sort").order("sort"),
    db.from("size_classes").select("id, label, weight_range, sort").order("sort"),
    db.from("app_settings").select("processor_name, processor_email, standing_instructions, company_name").maybeSingle(),
  ]);

  const usesBy = new Map<string, { part_id: string; qty: number }[]>();
  for (const u of must(uses) as { product_id: string; part_id: string; qty: number }[]) {
    const list = usesBy.get(u.product_id) ?? [];
    list.push({ part_id: u.part_id, qty: num(u.qty) });
    usesBy.set(u.product_id, list);
  }

  type ProductRow = Omit<CatalogProduct, "uses" | "links"> & {
    product_cut_specs: { cut_spec_id: string; units_per_cut: number; sort: number }[] | null;
  };
  const prodList: CatalogProduct[] = (must(products) as ProductRow[]).map(({ product_cut_specs, ...p }) => ({
    ...p,
    lb_per_unit: p.lb_per_unit == null ? null : num(p.lb_per_unit),
    pieces_per_pack: p.pieces_per_pack == null ? null : num(p.pieces_per_pack),
    order_step: num(p.order_step) || 1,
    uses: usesBy.get(p.id) ?? [],
    links: (product_cut_specs ?? [])
      .map((l) => ({ ...l, units_per_cut: num(l.units_per_cut) || 1 }))
      .sort((a, b) => a.sort - b.sort),
  }));

  return {
    parts: (must(parts) as CatalogPart[]).map((p) => ({ ...p, per_lamb: num(p.per_lamb) })),
    products: prodList,
    productById: new Map(prodList.map((p) => [p.id, p])),
    cutSpecs: must(cutSpecs) ?? [],
    sizes: must(sizes) ?? [],
    settings: settings.error ? null : settings.data,
  };
}

export async function loadCustomers(db: SupabaseClient): Promise<CustomersData> {
  const [customers, contacts, last, follow, usual] = await Promise.all([
    fetchAll<Omit<Customer, "contacts">>((a, b) =>
      db
        .from("customers")
        .select("id, name, type, call_day, notes, active, parent_customer_id, bills_for_locations, pallet_group_id, pallet_spot, pallet_sort")
        .order("name")
        .range(a, b),
    ),
    fetchAll<Contact>((a, b) =>
      db.from("customer_contacts").select("id, customer_id, name, roles, phone, email, sort").order("sort").range(a, b),
    ),
    fetchAll<LastContact>((a, b) =>
      db.from("customer_last_contact").select("customer_id, kind, summary, created_at").range(a, b),
    ),
    fetchAll<{ customer_id: string; open_count: number }>((a, b) =>
      db.from("customer_open_follow_ups").select("customer_id, open_count").range(a, b),
    ),
    fetchAll<{ customer_id: string; product_id: string }>((a, b) =>
      db.from("customer_usual_products").select("customer_id, product_id").range(a, b),
    ),
  ]);

  const contactsBy = new Map<string, Contact[]>();
  for (const k of contacts) {
    const list = contactsBy.get(k.customer_id) ?? [];
    list.push(k);
    contactsBy.set(k.customer_id, list);
  }
  const list: Customer[] = customers.map((c) => ({ ...c, contacts: contactsBy.get(c.id) ?? [] }));

  const usualMap = new Map<string, Set<string>>();
  for (const u of usual) {
    const s = usualMap.get(u.customer_id) ?? new Set<string>();
    s.add(u.product_id);
    usualMap.set(u.customer_id, s);
  }

  return {
    list,
    byId: new Map(list.map((c) => [c.id, c])),
    lastContact: new Map(last.map((l) => [l.customer_id, l])),
    openFollowUps: new Map(follow.map((f) => [f.customer_id, f.open_count])),
    usual: usualMap,
  };
}

type OrderRow = {
  id: string;
  customer_id: string;
  status: Order["status"];
  notes: string;
  order_lines: LineRow[];
};

type LineRow = { product_id: string; qty: number; unit?: OrderUnit | null };

/** Lines and the units of lines taken in another unit. */
function linesOf(rows: LineRow[] | null | undefined): { lines: Qty; units: Units } {
  const lines: Qty = {};
  const units: Units = {};
  for (const l of rows ?? []) {
    lines[l.product_id] = num(l.qty);
    if (l.unit) units[l.product_id] = l.unit;
  }
  return { lines, units };
}

function toOrders(rows: OrderRow[]): Map<string, Order> {
  const m = new Map<string, Order>();
  for (const o of rows) {
    m.set(o.customer_id, { id: o.id, customer_id: o.customer_id, status: o.status, notes: o.notes, ...linesOf(o.order_lines) });
  }
  return m;
}

const ORDER_SELECT = "id, customer_id, status, notes, order_lines(product_id, qty, unit)";

/** Just this week's and last week's orders (refreshed on every live change). */
export async function loadOrders(db: SupabaseClient, week: string) {
  const [orders, last] = await Promise.all([
    db.from("orders").select(ORDER_SELECT).eq("week_id", week),
    db.from("orders").select(ORDER_SELECT).eq("week_id", addDays(week, -7)),
  ]);
  return {
    orders: toOrders(must(orders) as OrderRow[]),
    lastWeek: toOrders(must(last) as OrderRow[]),
  };
}

export type HistoryEntry =
  | {
      type: "contact";
      at: string;
      id: string;
      kind: string;
      summary: string;
      follow_up_date: string | null;
      follow_up_note: string;
      follow_up_done: boolean;
      by: string;
      created_by: string;
    }
  | { type: "order"; at: string; week: string; status: Order["status"]; notes: string; lines: Qty; units: Units };

/** Contact log entries and weekly answers for one customer, newest first. */
export async function loadCustomerHistory(db: SupabaseClient, customerId: string, limit = 40): Promise<HistoryEntry[]> {
  const [log, orders, people] = await Promise.all([
    db
      .from("contact_log")
      .select("id, kind, summary, follow_up_date, follow_up_note, follow_up_done, created_at, created_by")
      .eq("customer_id", customerId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit),
    db
      .from("orders")
      .select("week_id, status, notes, order_lines(product_id, qty, unit)")
      .eq("customer_id", customerId)
      .in("status", ["ordered", "none"])
      .order("week_id", { ascending: false })
      .limit(limit),
    db.from("profiles").select("id, display_name"),
  ]);
  const names = new Map(((must(people) ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));

  const out: HistoryEntry[] = [];
  for (const e of (must(log) ?? []) as {
    id: string;
    kind: string;
    summary: string;
    follow_up_date: string | null;
    follow_up_note: string;
    follow_up_done: boolean;
    created_at: string;
    created_by: string;
  }[]) {
    out.push({ type: "contact", at: e.created_at, ...e, by: names.get(e.created_by) ?? "Someone" });
  }
  for (const o of (must(orders) ?? []) as {
    week_id: string;
    status: Order["status"];
    notes: string;
    order_lines: LineRow[];
  }[]) {
    const { lines, units } = linesOf(o.order_lines);
    // Weekly answers sort at the start of their week.
    out.push({ type: "order", at: `${o.week_id}T12:00:00Z`, week: o.week_id, status: o.status, notes: o.notes, lines, units });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export async function loadWeek(db: SupabaseClient, week: string): Promise<WeekData> {
  const [weekRow, orders, weights, marks, hw, freezer, sets, sheet] = await Promise.all([
    db.from("weeks").select("id, process_date, producer, lamb_override, notes").eq("id", week).maybeSingle(),
    loadOrders(db, week),
    fetchAll<{ order_id: string; product_id: string; weight: number }>((a, b) =>
      db
        .from("packing_weights")
        .select("order_id, product_id, weight, orders!inner(week_id)")
        .eq("orders.week_id", week)
        .range(a, b),
    ),
    fetchAll<{ order_id: string; product_id: string; shorted: boolean }>((a, b) =>
      db
        .from("packing_lines")
        .select("order_id, product_id, shorted, orders!inner(week_id)")
        .eq("orders.week_id", week)
        .eq("shorted", true)
        .range(a, b),
    ),
    fetchAll<{
      id: string;
      size: "half" | "whole";
      status: HalfWholeOrder["status"];
      half_whole_choices: { part_id: string; slot: number; product_id: string | null }[];
    }>((a, b) =>
      db
        .from("half_whole_orders")
        .select("id, size, status, half_whole_choices(part_id, slot, product_id)")
        .in("status", ["pending", "filled"])
        .range(a, b),
    ),
    fetchAll<{ product_id: string; qty: number }>((a, b) =>
      db.from("freezer_log").select("product_id, qty").range(a, b),
    ),
    db.from("cut_sets").select("lambs, size_class_id").eq("week_id", week),
    db.from("cut_sheets").select("sent_at").eq("week_id", week).maybeSingle(),
  ]);

  // Pounds packed per line, and lines marked not filled.
  const packedMap = new Map<string, Qty>();
  for (const w of weights) {
    const q = packedMap.get(w.order_id) ?? {};
    q[w.product_id] = (q[w.product_id] ?? 0) + num(w.weight);
    packedMap.set(w.order_id, q);
  }
  const shortedMap = new Map<string, Set<string>>();
  for (const m of marks) {
    const set = shortedMap.get(m.order_id) ?? new Set<string>();
    set.add(m.product_id);
    shortedMap.set(m.order_id, set);
  }

  const wr = must(weekRow) as WeekData["weekRow"];
  return {
    week,
    weekRow: wr ? { ...wr, lamb_override: wr.lamb_override == null ? null : num(wr.lamb_override) } : null,
    orders: orders.orders,
    lastWeek: orders.lastWeek,
    packed: packedMap,
    shorted: shortedMap,
    halfWhole: hw.map((h) => ({ id: h.id, size: h.size, status: h.status, choices: h.half_whole_choices ?? [] })),
    freezer: freezer.map((f) => ({ product_id: f.product_id, qty: num(f.qty) })),
    cutSets: (must(sets) as { lambs: number; size_class_id: string | null }[]) ?? [],
    cutSheet: must(sheet) as WeekData["cutSheet"],
  };
}

export type DueFollowUp = {
  id: string;
  customer_id: string;
  follow_up_date: string;
  follow_up_note: string;
  summary: string;
};

/** Open follow-ups due on or before the last day of the week (SPEC 5.4). */
export async function loadDueFollowUps(db: SupabaseClient, week: string): Promise<DueFollowUp[]> {
  const { data, error } = await db
    .from("contact_log")
    .select("id, customer_id, follow_up_date, follow_up_note, summary")
    .is("deleted_at", null)
    .eq("follow_up_done", false)
    .not("follow_up_date", "is", null)
    .lte("follow_up_date", addDays(week, 6))
    .order("follow_up_date");
  if (error) throw new Error(error.message);
  return (data ?? []) as DueFollowUp[];
}

export type OrderHistoryRow = { week: string; status: Order["status"]; notes: string; lines: Qty; units: Units; packed: Qty };

/** Every week this customer answered (ordered or no order), newest first, for the history download. */
export async function loadCustomerOrders(db: SupabaseClient, customerId: string): Promise<OrderHistoryRow[]> {
  const rows = await fetchAll<{
    week_id: string;
    status: Order["status"];
    notes: string;
    order_lines: LineRow[];
    packing_weights: { product_id: string; weight: number }[];
  }>((a, b) =>
    db
      .from("orders")
      .select("week_id, status, notes, order_lines(product_id, qty, unit), packing_weights(product_id, weight)")
      .eq("customer_id", customerId)
      .in("status", ["ordered", "none"])
      .order("week_id", { ascending: false })
      .range(a, b),
  );
  return rows.map((o) => {
    const { lines, units } = linesOf(o.order_lines);
    // Pounds packed per product.
    const packed: Qty = {};
    for (const w of o.packing_weights ?? []) packed[w.product_id] = (packed[w.product_id] ?? 0) + num(w.weight);
    return { week: o.week_id, status: o.status, notes: o.notes, lines, units, packed };
  });
}

export type PackingRecord = {
  customer_id: string;
  status: Order["status"];
  lines: Qty;
  units: Units;
  weights: { product_id: string; weight: number; box_no: number | null; by: string; at: string }[];
  marks: Record<string, { count: number | null; shorted: boolean; flagged: boolean; flagNote: string }>;
  pallet: string;
};

/** A week's orders with what was weighed, by whom and when, for the packing record download. */
export async function loadPackingRecord(db: SupabaseClient, week: string): Promise<PackingRecord[]> {
  const [orders, people] = await Promise.all([
    fetchAll<{
      customer_id: string;
      status: Order["status"];
      order_lines: LineRow[];
      packing_weights: { product_id: string; weight: number; box_no: number | null; created_by: string | null; created_at: string }[];
      packing_lines: { product_id: string; packed_qty: number | null; shorted: boolean; flagged: boolean; flag_note: string }[];
      packing_orders: { pallet: string }[] | { pallet: string } | null;
    }>((a, b) =>
      db
        .from("orders")
        .select(
          "customer_id, status, order_lines(product_id, qty, unit), packing_weights(product_id, weight, box_no, created_by, created_at), packing_lines(product_id, packed_qty, shorted, flagged, flag_note), packing_orders(pallet)",
        )
        .eq("week_id", week)
        .order("id")
        .range(a, b),
    ),
    db.from("profiles").select("id, display_name"),
  ]);
  const names = new Map(((must(people) ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  return orders.map((o) => {
    const { lines, units } = linesOf(o.order_lines);
    const marks: PackingRecord["marks"] = {};
    for (const m of o.packing_lines ?? [])
      marks[m.product_id] = {
        count: m.packed_qty == null ? null : num(m.packed_qty),
        shorted: m.shorted,
        flagged: m.flagged,
        flagNote: m.flag_note ?? "",
      };
    const po = Array.isArray(o.packing_orders) ? o.packing_orders[0] : o.packing_orders;
    return {
      customer_id: o.customer_id,
      status: o.status,
      lines,
      units,
      weights: (o.packing_weights ?? []).map((w) => ({
        product_id: w.product_id,
        weight: num(w.weight),
        box_no: w.box_no,
        by: w.created_by ? (names.get(w.created_by) ?? "Someone") : "",
        at: w.created_at,
      })),
      marks,
      pallet: po?.pallet ?? "",
    };
  });
}

/** Ordered weeks from `from` to `to` (week start dates, inclusive), for the sales download. */
export async function loadOrdersBetween(
  db: SupabaseClient,
  from: string,
  to: string,
): Promise<{ customer_id: string; week: string; lines: Qty; units: Units }[]> {
  const rows = await fetchAll<{ customer_id: string; week_id: string; order_lines: { product_id: string; qty: number }[] }>(
    (a, b) =>
      db
        .from("orders")
        .select("customer_id, week_id, order_lines(product_id, qty, unit)")
        .eq("status", "ordered")
        .gte("week_id", from)
        .lte("week_id", to)
        .order("week_id")
        .order("id")
        .range(a, b),
  );
  return rows.map((o) => {
    const { lines, units } = linesOf(o.order_lines);
    return { customer_id: o.customer_id, week: o.week_id, lines, units };
  });
}
