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
};

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
