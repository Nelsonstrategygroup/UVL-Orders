import type { BoxSetup } from "../calc/boxes";
// Row shapes as the screens use them (SPEC 4).

import type { Part, Product, Qty, OrderStatus, HalfWholeOrder, FreezerEntry, OrderUnit, Units } from "../calc/types";
import type { LastOrder } from "../calc/lastOrder";
import type { CustomerType } from "../import/customers";
import type { ContactRole } from "../calc/contacts";

export type { Part, Product, Qty, OrderStatus, OrderUnit, Units };

export type CutSpec = { id: string; text: string; use_type: string; active: boolean; sort: number };
export type SizeClass = { id: string; label: string; weight_range: string; sort: number };

export type AppSettings = {
  processor_name: string;
  processor_email: string;
  standing_instructions: string;
  company_name: string;
  /** No box is planned heavier (SPEC 12.3). */
  box_cap_lb: number;
  /** No longer used (10/29/26): trim per Le Trim component. Replaced by the two weights below. */
  le_trim_shoulder_trim_lb?: number;
  le_trim_half_leg_trim_lb?: number;
  /** Le Trim by weight (Setup > Le Trim): average boneless shoulder and boneless leg, lb. OPEN: 5 lb shoulder not confirmed. */
  le_trim_shoulder_lb?: number;
  le_trim_leg_lb?: number;
  /** Weight blanks on the paper packing copy: when the box count isn't known, and spares after known boxes (10/26/26). */
  pack_unknown_blanks?: number;
  pack_spare_blanks?: number;
  /** Printed as "Ship from" on pallet manifests (10/26/26). */
  ship_from_address?: string;
};

/** A week's saved Le Trim plan (change request 10/25/26). */
/** Why lambs were added to a week (week_extra_lambs.reason). */
export type ExtraLambReason = "le_trim" | "freezer" | "small_lambs" | "half_whole" | "other";

/** Lambs Kathy added to the week on top of the count from orders. */
export type ExtraLambRow = { id: string; lambs: number; reason: ExtraLambReason; note: string; created_at: string };

export type LeTrimPlanRow = {
  week_id: string;
  shoulders: number;
  half_legs: number;
  /** Whole legs halved (two half legs each). */
  legs: number;
  trim_lb: number;
  trim_estimated_lb: number | null;
  /** From the kill sheet; null while the trim spare is only estimated. */
  trim_actual_lb: number | null;
  saved_at: string;
  saved_by_name: string | null;
};

export type CatalogPart = Part & { source_note: string; drives_count: boolean };

/** A Mohawk line a product comes from: units_per_cut of the product's unit per line. */
export type CutLink = { cut_spec_id: string; units_per_cut: number; sort: number };

/** A customer product (SPEC change requests 10/2026) as Setup and the order screens use it. */
/** How a product is billed (SPEC 15). */
export type PriceUnit = "lb" | "case" | "each";

export type CatalogProduct = Product & {
  note: string;
  unit: string;
  alt_unit: OrderUnit | null;
  lb_per_unit: number | null;
  pieces_per_pack: number | null;
  order_step: number;
  /** How many fit in one box, in the product's own unit; null if not known yet. */
  per_box: number | null;
  /** Mohawk's item number (not in the barcode). */
  mohawk_item_no: string;
  /** Printed on box labels; blank means the name. */
  label_name: string;
  /** Normal box weight range in lb; a scanned box outside it is warned about. Null: no warning. */
  box_lb_min: number | null;
  box_lb_max: number | null;
  /** Weight blanks on the paper packing copy when its box count isn't known; null: the setting. */
  pack_blanks?: number | null;
  /** How it's billed: per lb (the boxes' net weight), per case (one per box), per each (pieces packed). */
  price_unit: PriceUnit;
  /** Products with the same name here are packed in one box (Organs): one box is the order for all, one price, one invoice line. Blank: on its own. */
  packed_with: string;
  counts_toward_lambs: boolean;
  not_lamb: boolean;
  confirmed: boolean;
  links: CutLink[];
};

export type Catalog = {
  parts: CatalogPart[];
  /** Every product, active or not, in sort order. */
  products: CatalogProduct[];
  productById: Map<string, CatalogProduct>;
  cutSpecs: CutSpec[];
  sizes: SizeClass[];
  settings: AppSettings | null;
  /** Box types, limits per product, and the cap (SPEC 12). */
  boxes: BoxSetup;
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
  /** Weekday the boxes are delivered; blank means the chain's day, if any (lib/calc/lastOrder.ts). */
  delivery_day: string | null;
  notes: string;
  active: boolean;
  parent_customer_id: string | null;
  bills_for_locations: boolean;
  /** Ships to: a distributor (consolidation_points), or null for Direct (change request 10/26/26). */
  ships_to_point_id: string | null;
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
  /** When box labels were printed, a fingerprint of the list, and by whom (SPEC 12.5). */
  labels_hash?: string | null;
  labels_printed_at?: string | null;
  labels_printed_by?: string | null;
};

export type Order = {
  id: string;
  customer_id: string;
  status: OrderStatus;
  notes: string;
  lines: Qty;
  /** Lines taken in a unit other than the product's own. */
  units: Units;
};

/**
 * A line a customer asked for in a later week, not confirmed yet (change
 * request 10/22/26). Counts toward the lamb count and the cut sheet; not on
 * Packing or the box labels until it's confirmed.
 */
export type OrderRequest = {
  id: string;
  week_id: string;
  customer_id: string;
  product_id: string;
  qty: number;
  /** Taken in another unit than the product's own, or null. */
  unit: OrderUnit | null;
  requested_at: string;
  requested_by_name: string;
  /** The week it was moved from ("Move to next week"), or null. */
  moved_from_week: string | null;
};

export type WeekData = {
  week: string;
  weekRow: WeekRow | null;
  /** customer id -> order this week */
  orders: Map<string, Order>;
  /** customer id -> order last week */
  lastWeek: Map<string, Order>;
  /** customer id -> their most recent order before this week ("Last order"); never ordered: missing. */
  lastOrder: Map<string, LastOrder>;
  /** customer id -> lines requested for this week, not confirmed yet. */
  requests: Map<string, OrderRequest[]>;
  /** customer id -> lines moved from this week to next week ("Moved to next week: ..."). */
  movedOut: Map<string, OrderRequest[]>;
  /** order id -> product id -> pounds packed */
  packed: Map<string, Qty>;
  /** order id -> products marked not filled */
  shorted: Map<string, Set<string>>;
  halfWhole: HalfWholeOrder[];
  freezer: FreezerEntry[];
  cutSets: { lambs: number; size_class_id: string | null }[];
  cutSheet: { sent_at: string | null; inv_number: string | null } | null;
  /** The saved Le Trim plan, or null while Le Trim isn't planned yet. */
  leTrim: LeTrimPlanRow | null;
  /** Extra lambs added to the week (empty before their migration). */
  extraLambs: ExtraLambRow[];
};
