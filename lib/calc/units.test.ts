import { describe, expect, it } from "vitest";
import { countUnit } from "./units";

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
    expect(countUnit(product("Ground lamb", "lb", [{ part_id: "trim", qty: 1 }]), parts)).toBe("lb");
  });
});
