// Row shapes as the screens use them (SPEC 4).

import type { Part, Product, Qty, OrderStatus, HalfWholeOrder, FreezerEntry } from "../calc/types";
import type { CustomerType } from "../import/customers";
import type { ContactRole } from "../calc/contacts";

export type { Part, Product, Qty, OrderStatus };

export type CutSpec = { id: string; text: string; use_type: string; active: boolean; sort: number };
export type SizeClass = { id: string; label: string; weight_range: string; sort: number };

export type AppSettings = {
  processor_name: string;
  processor_email: string;
  standing_instructions: string;
  company_name: string;
};

export type CatalogPart = Part & { source_note: string };
export type CatalogProduct = Product & { note: string };

export type Catalog = {
  parts: CatalogPart[];
  /** Every product, active or not, in sort order. */
  products: CatalogProduct[];
  productById: Map<string, CatalogProduct>;
  cutSpecs: CutSpec[];
  sizes: SizeClass[];
  settings: AppSettings | null;
};

export type Contact = {
  id: string;
  customer_id: string;
  name: string;
  roles: ContactRole[];
  phone: string;
  email: string;
  sort: number;
};

export type Customer = {
  id: string;
  name: string;
  type: CustomerType;
  call_day: string | null;
  notes: string;
  active: boolean;
  parent_customer_id: string | null;
  bills_for_locations: boolean;
  contacts: Contact[];
};

export type LastContact = { customer_id: string; kind: string; summary: string; created_at: string };

export type CustomersData = {
  list: Customer[];
  byId: Map<string, Customer>;
  lastContact: Map<string, LastContact>;
  openFollowUps: Map<string, number>;
  /** customer id -> products they have ever ordered */
  usual: Map<string, Set<string>>;
};

export type WeekRow = {
  id: string;
  process_date: string | null;
  producer: string;
  lamb_override: number | null;
  notes: string;
};

export type Order = {
  id: string;
  customer_id: string;
  status: OrderStatus;
  notes: string;
  lines: Qty;
};

export type WeekData = {
  week: string;
  weekRow: WeekRow | null;
  /** customer id -> order this week */
  orders: Map<string, Order>;
  /** customer id -> order last week */
  lastWeek: Map<string, Order>;
  /** order id -> product id -> packed qty */
  packed: Map<string, Qty>;
  halfWhole: HalfWholeOrder[];
  freezer: FreezerEntry[];
  cutSets: { lambs: number; size_class_id: string | null }[];
  cutSheet: { sent_at: string | null } | null;
};
