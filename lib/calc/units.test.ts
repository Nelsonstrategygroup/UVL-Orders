import { describe, expect, it } from "vitest";
import { countUnit, inProductUnits, notWholePacks, toProductUnit, unitWord } from "./units";

const parts = [
  { id: "fshank", name: "Front shank" },
  { id: "leg", name: "Leg" },
  { id: "rack", name: "Rack" },
  { id: "loin", name: "Short loin" },
];
const product = (name: string, unit: string, uses: { part_id: string; qty: number }[]) => ({ name, unit, uses });

describe("count unit", () => {
  it("counts pack products by the piece", () => {
    expect(countUnit(product("Front Shanks 2/pack", "each", [{ part_id: "fshank", qty: 1 }]), parts)).toBe(
      "front shanks (not packs)",
    );
    expect(countUnit(product('Legs, 1" Steaks 2/pack', "leg", [{ part_id: "leg", qty: 1 }]), parts)).toBe("legs (not packs)");
    expect(
      countUnit(product("Short Loins to 1 1/4 inch chops 4/pak, sirloins out!", "each", [{ part_id: "loin", qty: 1 }]), parts),
    ).toBe("short loins (not packs)");
  });

  it("falls back to the product's unit when it uses more than one part", () => {
    expect(
      countUnit(
        product("whole loin to 1.25 inch chops 2/pak", "each", [
          { part_id: "rack", qty: 1 },
          { part_id: "loin", qty: 1 },
        ]),
        parts,
      ),
    ).toBe("pcs (not packs)");
  });

  it("leaves other products alone", () => {
    expect(countUnit(product("UVL racks to Vac (SINGLE PACK)", "each", [{ part_id: "rack", qty: 1 }]), parts)).toBe("pcs");
    expect(countUnit(product("Ground lamb", "lb", [{ part_id: "trim", qty: 1 }]), parts)).toBe("lb");
  });
});

describe("order units", () => {
  const shoulder = { unit: "each", lb_per_unit: 4 };
  const chops = { unit: "lb", lb_per_unit: null };
  it("turns pounds into pieces and pieces into pounds with the piece weight", () => {
    expect(toProductUnit(12, "lb", shoulder)).toBe(3);
    expect(toProductUnit(3, undefined, shoulder)).toBe(3);
    expect(toProductUnit(2, "pack", { unit: "lb", lb_per_unit: 5 })).toBe(10);
  });
  it("can't convert without a piece weight, so the line counts as 0", () => {
    expect(toProductUnit(6, "each", chops)).toBe(0);
  });
  it("converts a whole order and names units", () => {
    const byId = new Map<string, { unit: string; lb_per_unit: number | null }>([["sh", shoulder], ["ch", chops]]);
    expect(inProductUnits({ sh: 8, ch: 15 }, { sh: "lb" }, byId)).toEqual({ sh: 2, ch: 15 });
    expect(unitWord("lb", 15)).toBe("lb");
    expect(unitWord("each", 1)).toBe("pc");
    expect(unitWord("pack", 3)).toBe("packs");
  });
});

describe("whole pieces from pounds (Lucas, 11/7/26)", () => {
  const sh = { unit: "each", lb_per_unit: 4.5 };
  it("rounds to the nearest piece, at least 1", () => {
    expect(toProductUnit(20, "lb", sh)).toBe(4);
    expect(toProductUnit(120, "lb", sh)).toBe(27);
    expect(toProductUnit(1, "lb", sh)).toBe(1);
    expect(toProductUnit(0, "lb", sh)).toBe(0);
    // Pieces into pounds stay exact.
    expect(toProductUnit(3, "each", { unit: "lb", lb_per_unit: 4.5 })).toBe(13.5);
  });
});

describe("packs and pieces (Mixed Shanks, 11/10/26)", () => {
  const mixedPieces = { name: "Mixed Shanks", unit: "each", lb_per_unit: null, pieces_per_pack: 2 };
  const mixedPacks = { name: "Mixed Shanks", unit: "pack", lb_per_unit: null, pieces_per_pack: 2 };

  it("a pack line on a product counted in pieces is 2 pieces a pack, not 1", () => {
    // Edmonds 8 packs, Bellevue 12, Kirkland 12, Bothell 15 pieces: 79 pieces, not 47.
    expect(toProductUnit(8, "pack", mixedPieces)).toBe(16);
    expect([8, 12, 12].reduce((s, q) => s + toProductUnit(q, "pack", mixedPieces), 0) + toProductUnit(15, undefined, mixedPieces)).toBe(79);
  });

  it("once the product is counted in packs, everything totals in packs", () => {
    expect(toProductUnit(8, undefined, mixedPacks)).toBe(8);
    expect(toProductUnit(8, "pack", mixedPacks)).toBe(8);
    expect(toProductUnit(16, "each", mixedPacks)).toBe(8);
    expect(toProductUnit(15, "each", mixedPacks)).toBe(7.5);
  });

  it("no pack size set: left as it was", () => {
    expect(toProductUnit(8, "pack", { unit: "each", lb_per_unit: null })).toBe(8);
  });

  it("pieces that don't make whole packs are flagged", () => {
    const byId = new Map<string, { name: string; unit: string; lb_per_unit: null; pieces_per_pack: number | null }>([["mixed", mixedPieces], ["front", { name: "Front Shanks", unit: "pack", lb_per_unit: null, pieces_per_pack: 2 }], ["rack", { name: "Racks", unit: "each", lb_per_unit: null, pieces_per_pack: null }]]);
    // Bothell's 15 single shanks.
    expect(notWholePacks({ mixed: 15 }, {}, byId)).toEqual([{ name: "Mixed Shanks", qty: 15, per: 2 }]);
    expect(notWholePacks({ mixed: 16 }, {}, byId)).toEqual([]);
    // In packs: nothing to flag, whatever the number.
    expect(notWholePacks({ mixed: 15 }, { mixed: "pack" }, byId)).toEqual([]);
    expect(notWholePacks({ front: 15 }, {}, byId)).toEqual([]);
    // A pack product taken in single pieces.
    expect(notWholePacks({ front: 7 }, { front: "each" }, byId)).toEqual([{ name: "Front Shanks", qty: 7, per: 2 }]);
    // Not sold in packs.
    expect(notWholePacks({ rack: 7 }, {}, byId)).toEqual([]);
  });
});
