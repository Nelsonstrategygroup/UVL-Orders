import { describe, expect, it } from "vitest";
import { countUnit, inProductUnits, toProductUnit, unitWord } from "./units";

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
    ).toBe("each (not packs)");
  });

  it("leaves other products alone", () => {
    expect(countUnit(product("UVL racks to Vac (SINGLE PACK)", "each", [{ part_id: "rack", qty: 1 }]), parts)).toBe("each");
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
