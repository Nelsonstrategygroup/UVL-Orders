import { describe, expect, it } from "vitest";
import seedJson from "../../reference/seed-data.json";
import { buildSeed, type SeedData } from "./build-seed";

const plan = buildSeed(seedJson as SeedData);

describe("buildSeed", () => {
  it("loads the catalog", () => {
    expect(plan.catalog.parts).toHaveLength(8);
    expect(plan.catalog.cut_specs).toHaveLength(34);
    expect(plan.catalog.products).toHaveLength(36);
    expect(plan.catalog.size_classes.map((s) => s.id)).toEqual(["XL", "Large", "Medium", "Small", "XS"]);
  });

  it("splits product part uses into their own rows", () => {
    expect(plan.catalog.products[0]).not.toHaveProperty("part_uses");
    const letrim = plan.catalog.product_part_uses.filter((u) => u.product_id === "letrim");
    expect(letrim).toEqual([
      { product_id: "letrim", part_id: "trim", qty: 0.5 },
      { product_id: "letrim", part_id: "shoulder", qty: 0.125 },
    ]);
  });

  it("puts the sample cut sheet on the week of 2026-09-28", () => {
    const s = plan.sample;
    expect(s.week).toEqual({ id: "2026-09-28", process_date: "2026-09-30" });
    expect(s.cut_sheet.inv_number).toBe("2403");
    expect(s.banners).toHaveLength(3);
    expect(s.sets).toHaveLength(8);
    expect(s.sets.reduce((sum, x) => sum + x.lambs, 0)).toBe(144);
  });

  it("links every line to its set", () => {
    const ids = new Set(plan.sample.sets.map((s) => s.id));
    expect(plan.sample.lines.every((l) => ids.has(l.set_id))).toBe(true);
    const xl = plan.sample.sets.find((s) => s.size_class_id === "XL")!;
    expect(plan.sample.lines.filter((l) => l.set_id === xl.id)).toHaveLength(14);
  });
});
