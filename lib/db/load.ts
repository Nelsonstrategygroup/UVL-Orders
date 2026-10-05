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
  Qty,
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
    db.from("parts").select("id, name, per_lamb, unit, balance_check, confirmed, sort, source_note").order("sort"),
    db
      .from("products")
      .select("id, name, short_name, unit, group_name, cut_spec_id, fresh_only, active, sort, note")
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

  const prodList = (must(products) as Omit<CatalogProduct, "uses">[]).map((p) => ({
    ...p,
    uses: usesBy.get(p.id) ?? [],
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
      db.from("customers").select("id, name, type, call_day, notes, active, parent_customer_id").order("name").range(a, b),
    ),
    fetchAll<Contact>((a, b) =>
      db.from("customer_contacts").select("id, customer_id, name, role, phone, email, sort").order("sort").range(a, b),
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
  order_lines: { product_id: string; qty: number }[];
};

function toOrders(rows: OrderRow[]): Map<string, Order> {
  const m = new Map<string, Order>();
  for (const o of rows) {
    const lines: Qty = {};
    for (const l of o.order_lines ?? []) lines[l.product_id] = num(l.qty);
    m.set(o.customer_id, { id: o.id, customer_id: o.customer_id, status: o.status, notes: o.notes, lines });
  }
  return m;
}

const ORDER_SELECT = "id, customer_id, status, notes, order_lines(product_id, qty)";

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
  | { type: "order"; at: string; week: string; status: Order["status"]; notes: string; lines: Qty };

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
      .select("week_id, status, notes, order_lines(product_id, qty)")
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
    order_lines: { product_id: string; qty: number }[];
  }[]) {
    const lines: Qty = {};
    for (const l of o.order_lines ?? []) lines[l.product_id] = num(l.qty);
    // Weekly answers sort at the start of their week.
    out.push({ type: "order", at: `${o.week_id}T12:00:00Z`, week: o.week_id, status: o.status, notes: o.notes, lines });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export async function loadWeek(db: SupabaseClient, week: string): Promise<WeekData> {
  const [weekRow, orders, packed, hw, freezer, sets, sheet] = await Promise.all([
    db.from("weeks").select("id, process_date, producer, lamb_override, notes").eq("id", week).maybeSingle(),
    loadOrders(db, week),
    fetchAll<{ order_id: string; product_id: string; packed_qty: number }>((a, b) =>
      db
        .from("packing_lines")
        .select("order_id, product_id, packed_qty, orders!inner(week_id)")
        .eq("orders.week_id", week)
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

  const packedMap = new Map<string, Qty>();
  for (const p of packed) {
    const q = packedMap.get(p.order_id) ?? {};
    q[p.product_id] = num(p.packed_qty);
    packedMap.set(p.order_id, q);
  }

  const wr = must(weekRow) as WeekData["weekRow"];
  return {
    week,
    weekRow: wr ? { ...wr, lamb_override: wr.lamb_override == null ? null : num(wr.lamb_override) } : null,
    orders: orders.orders,
    lastWeek: orders.lastWeek,
    packed: packedMap,
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
