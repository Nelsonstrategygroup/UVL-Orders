// What one unit of a product is, in words, so freezer counts match the cut
// sheet. Products sold in packs ("Front Shanks 2/pack") are counted by the
// piece, not by the pack: one unit uses one shank.

import type { Part, Product } from "./types";

const PACK = /\b\d+\s*\/\s*pa(?:c)?k\b/i;

/** "front shanks (not packs)" for a pack product; otherwise the product's unit. */
export function countUnit(p: Pick<Product, "name" | "unit" | "uses">, parts: Pick<Part, "id" | "name">[]): string {
  if (!PACK.test(p.name)) return p.unit;
  const only = p.uses.length === 1 && p.uses[0].qty === 1 ? parts.find((x) => x.id === p.uses[0].part_id) : undefined;
  const what = only ? `${only.name.toLowerCase()}s` : p.unit;
  return `${what} (not packs)`;
}
