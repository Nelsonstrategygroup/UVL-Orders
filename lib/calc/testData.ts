// Real catalog from reference/seed-data.json, shaped for the calculations.
// Used by the unit tests.

import seed from "../../reference/seed-data.json";
import type { Part, Product } from "./types";

export const seedParts: Part[] = seed.parts.map((p) => ({
  id: p.id,
  name: p.name,
  per_lamb: p.per_lamb,
  unit: p.unit as Part["unit"],
  balance_check: p.balance_check,
  confirmed: p.confirmed,
  sort: p.sort,
}));

export const seedProducts: Product[] = seed.products.map((p) => ({
  id: p.id,
  name: p.name,
  short_name: p.short_name,
  unit: p.unit,
  group_name: p.group_name,
  cut_spec_id: p.cut_spec_id,
  fresh_only: p.fresh_only,
  active: p.active,
  sort: p.sort,
  uses: p.part_uses.map((u) => ({ part_id: u.part, qty: u.qty })),
}));

export const seedSizes = seed.size_classes;
export const sampleSheet = seed.sample_cut_sheet;
