// Parts customers order in packs (shanks, 2 per pack; SPEC 12.4). The
// carcass balance works in shanks; This week shows those parts in packs so
// the numbers match the orders (change request 10/21/26). Display only.

import { fmt, num } from "./num";
import type { PartUse, Qty } from "./types";

export type PackProduct = {
  id: string;
  name: string;
  unit: string;
  active: boolean;
  pieces_per_pack?: number | null;
  uses: PartUse[];
};

/**
 * part id -> pieces per pack, for parts whose active pack products (one part,
 * one pack of it) all agree on the pack size. Front and hind shanks: 2.
 */
export function partPackSizes(products: PackProduct[]): Map<string, number> {
  const seen = new Map<string, Set<number>>();
  for (const p of products) {
    const size = num(p.pieces_per_pack ?? 0);
    if (!p.active || p.unit !== "pack" || !(size > 1) || p.uses.length !== 1) continue;
    const u = p.uses[0];
    if (num(u.qty) !== size) continue;
    seen.set(u.part_id, (seen.get(u.part_id) ?? new Set()).add(size));
  }
  const out = new Map<string, number>();
  for (const [part, sizes] of seen) if (sizes.size === 1) out.set(part, [...sizes][0]);
  return out;
}

/** "28 packs", "1 pack", "27.5 packs". */
export function packsText(n: number): string {
  return `${fmt(n)} pack${n === 1 ? "" : "s"}`;
}

/**
 * What other products add to a pack part, in plain words: "Includes 8 front
 * shanks (4 packs) for 4 whole lambs." One line per product, for products
 * other than the packs themselves.
 */
export function packPartIncludes(
  partId: string,
  partName: string,
  packSize: number,
  products: PackProduct[],
  ordered: Qty,
): string[] {
  const out: string[] = [];
  for (const p of products) {
    const q = num(ordered[p.id] ?? 0);
    if (!(q > 0) || (p.unit === "pack" && p.uses.length === 1)) continue;
    const use = p.uses.find((u) => u.part_id === partId);
    if (!use || !(num(use.qty) > 0)) continue;
    const pieces = q * num(use.qty);
    const name = p.name.toLowerCase();
    out.push(
      `Includes ${fmt(pieces)} ${partName.toLowerCase()}${pieces === 1 ? "" : "s"} (${packsText(pieces / packSize)}) for ${fmt(q)} ${name}${q === 1 ? "" : "s"}.`,
    );
  }
  return out;
}
