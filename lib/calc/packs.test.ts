// Shanks shown in packs on This week (change request 10/21/26).

import { describe, expect, it } from "vitest";
import { packPartIncludes, packsText, partPackSizes, type PackProduct } from "./packs";
import { shortParts } from "./summary";

const products: PackProduct[] = [
  { id: "cp-front-shanks", name: "Front Shanks", unit: "pack", active: true, pieces_per_pack: 2, uses: [{ part_id: "fshank", qty: 2 }] },
  { id: "cp-hind-shanks", name: "Hind Shanks", unit: "pack", active: true, pieces_per_pack: 2, uses: [{ part_id: "hshank", qty: 2 }] },
  { id: "s27", name: "Front Shanks 2/pack", unit: "each", active: false, uses: [{ part_id: "fshank", qty: 1 }] },
  {
    id: "cp-whole-lamb",
    name: "Whole Lamb",
    unit: "each",
    active: true,
    uses: [
      { part_id: "leg", qty: 2 },
      { part_id: "shoulder", qty: 2 },
      { part_id: "wholeloin", qty: 2 },
      { part_id: "fshank", qty: 2 },
    ],
  },
  { id: "legs", name: "BNLS Legs", unit: "each", active: true, uses: [{ part_id: "leg", qty: 1 }] },
];

describe("parts shown in packs", () => {
  it("front and hind shanks come in packs of 2, from the shank products", () => {
    const sizes = partPackSizes(products);
    expect(sizes.get("fshank")).toBe(2);
    expect(sizes.get("hshank")).toBe(2);
    expect(sizes.has("leg")).toBe(false);
  });

  it("week of Oct 19: 106 packs + 4 whole lambs need 220 shanks, which is 110 packs; 82 lambs give 82 packs; short 28", () => {
    const need = 106 * 2 + 4 * 2;
    const supply = 82 * 2;
    expect(need / 2).toBe(110);
    expect(supply / 2).toBe(82);
    const row = { part: { id: "fshank", name: "Front shank", unit: "each" } as never, left: supply - need, status: "short" as const };
    expect(shortParts([row], new Map([["fshank", 2]]))).toEqual(["Front shanks short 28 packs"]);
    expect(packsText(1)).toBe("1 pack");
  });

  it("says what the whole lambs add", () => {
    expect(packPartIncludes("fshank", "Front shank", 2, products, { "cp-whole-lamb": 4, "cp-front-shanks": 106 })).toEqual([
      "Includes 8 front shanks (4 packs) for 4 whole lambs.",
    ]);
    expect(packPartIncludes("fshank", "Front shank", 2, products, { "cp-front-shanks": 106 })).toEqual([]);
  });
});
