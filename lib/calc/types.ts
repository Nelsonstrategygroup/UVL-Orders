// Shapes the calculations work on. They mirror the database rows (SPEC 4)
// but carry only what the math needs.

export type Part = {
  id: string;
  name: string;
  per_lamb: number;
  unit: "each" | "lb";
  balance_check: boolean;
  confirmed: boolean;
  sort: number;
  /** False for byproducts (neck, trim, Denver ribs): tracked per lamb, never sets the count. Missing means true. */
  drives_count?: boolean;
};

export type PartUse = { part_id: string; qty: number };

export type Product = {
  id: string;
  name: string;
  short_name: string;
  unit: string;
  group_name: string;
  cut_spec_id: string | null;
  fresh_only: boolean;
  active: boolean;
  sort: number;
  uses: PartUse[];
  /** A second unit customers may order in ("pieces or lb"). */
  alt_unit?: OrderUnit | null;
  /** About how much one unit weighs, to turn pounds into pieces and back. */
  lb_per_unit?: number | null;
  /** False for a product that never drives the lamb count. Missing means true. */
  counts_toward_lambs?: boolean;
  /** Not from a lamb at all (pepper sticks). */
  not_lamb?: boolean;
};

/** Units an order line can be taken in. */
export type OrderUnit = "each" | "pack" | "lb" | "case";

/** product id -> the unit a line was taken in, only where it differs from the product's own. */
export type Units = Record<string, OrderUnit>;

/** product id -> quantity */
export type Qty = Record<string, number>;

export type OrderStatus = "todo" | "ordered" | "none" | "callback";

export type HalfWholeOrder = {
  id: string;
  size: "half" | "whole";
  status: "pending" | "filled" | "cancelled";
  /** The product picked for each slot (one entry per filled slot). */
  choices: { part_id: string; slot: number; product_id: string | null }[];
};

export type FreezerEntry = { product_id: string; qty: number };
