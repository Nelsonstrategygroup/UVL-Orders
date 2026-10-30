import { describe, expect, it } from "vitest";
import { carcassReport, productWords, qtyWords } from "./carcassReport";
import type { Part, Product } from "./types";
import { calcWeek } from "./week";

const part = (id: string, name: string, per_lamb: number, drives: boolean, sort: number, made_from: string | null = null, unit: "each" | "lb" = "each", confirmed = true): Part => ({
  id,
  name,
  per_lamb,
  unit,
  balance_check: true,
  confirmed,
  sort,
  drives_count: drives,
  made_from,
});
const parts: Part[] = [
  part("leg", "Leg", 2, true, 0),
  part("shoulder", "Shoulder", 2, true, 1),
  part("wholeloin", "Whole loin", 2, true, 2),
  part("rack", "Rack", 2, false, 3, "wholeloin"),
  part("loin", "Short loin", 2, false, 4, "wholeloin"),
  part("fshank", "Front shank", 2, false, 5),
  part("trim", "Trim", 5, false, 6, null, "lb"),
  part("denver", "Denver ribs", 2, false, 7, null, "each", false),
];
const prod = (id: string, name: string, uses: Record<string, number>, extra: Partial<Product> = {}): Product => ({
  id,
  name,
  short_name: "",
  unit: "each",
  group_name: "",
  cut_spec_id: null,
  fresh_only: false,
  active: true,
  sort: 0,
  uses: Object.entries(uses).map(([part_id, qty]) => ({ part_id, qty })),
  ...extra,
});
const products: Product[] = [
  prod("whole", "Whole Lamb", { leg: 2, shoulder: 2, wholeloin: 2, fshank: 2 }),
  prod("bnls", "BNLS Legs", { leg: 1 }),
  prod("bis", "BI Shoulder", { shoulder: 1 }),
  prod("wl", "Whole Loin", { wholeloin: 1 }),
  prod("rack", "Racks", { rack: 1 }),
  prod("sl", "Short Loin", { loin: 1 }),
  prod("fs", "Front Shanks", { fshank: 2 }, { unit: "pack" }),
  prod("g1", "Ground Lamb 1 lb", { trim: 1 }, { unit: "pack" }),
  prod("carc", "Carcass Lamb", {}, { carcass: true }),
  prod("le", "Le Trim", {}, { fill_note: "From extras" }),
];

describe("the Carcass balance report", () => {
  // Whole loins set 54 (8 in Whole Lambs + 17 whole + 82 racks = 107); 15 extra; 1 carcass: 70.
  const orders = [{ whole: 4, bnls: 90, bis: 30, wl: 17, rack: 82, sl: 76, fs: 25, g1: 2, carc: 1, le: 720 }];
  const c = calcWeek({ parts, products, orders, extraLambs: 15, leTrim: { shoulders: 50, legs: 30, trimLb: 325 } });
  const r = carcassReport({
    c,
    products,
    parts,
    packSizes: new Map([["fshank", 2]]),
    extraLambs: [{ lambs: 15, reason: "le_trim" }],
    leTrim: { planned: true, orderedLb: 720, shoulders: 50, halfLegs: 60, trimLb: 325, shoulderLb: 5, legLb: 6.5 },
  });
  const section = (id: string) => r.sections.find((s) => s.part.id === id)!;

  it("sums up the lambs: for orders, extra by reason, carcass; what sets the count; the guesses", () => {
    expect(r.lambsLine).toBe("70 lambs to bring. 54 for orders + 15 extra for Le Trim + 1 carcass (goes out uncut, not counted below).");
    expect(r.cutLambs).toBe(69);
    expect(r.setLine).toBe("Set by whole loin: 107 needed, 2 per lamb. Average-size lambs: smaller or bigger lambs need more or fewer.");
    expect(r.statusLine).toBe("Every part covers its orders.");
    expect(r.tightLine).toBe("Tightest: leg (10 left over), rack (31 left over).");
    expect(r.guessLine).toBe("Still starting guesses (Setup > Parts per lamb): denver ribs (2 per lamb).");
  });

  it("shows each part as a subtraction; Le Trim is Kathy's plan", () => {
    const leg = section("leg");
    expect(leg.from).toEqual({ label: "From 69 lambs", pieces: 138 });
    expect(leg.minus).toEqual([
      { label: "Whole Lamb (4 × 2)", pieces: 8 },
      { label: "BNLS Legs", pieces: 90 },
      { label: "Le Trim (Kathy's plan)", pieces: 30 },
    ]);
    expect(leg.result).toEqual({ kind: "left", label: "Left over", pieces: 10 });
  });

  it("whole loins end at what's cut; racks and short loins start from it; one note", () => {
    const wl = section("wholeloin");
    expect(wl.minus.map((m) => m.pieces)).toEqual([8, 17]);
    expect(wl.result).toEqual({ kind: "cut", label: "Cut into racks and short loins", pieces: 113 });
    expect(section("rack").from).toEqual({ label: "Cut from 113 whole loins", pieces: 113 });
    expect(section("rack").result.pieces).toBe(31);
    expect(section("loin").result.pieces).toBe(37);
    expect(section("loin").note).toBe("To keep a whole loin uncut, take 1 off both rack and short loin left over.");
    expect(r.compact[0].rows.find((x) => x.part.id === "wholeloin")!.leftText).toBe("113 cut into racks and short loins");
  });

  it("shanks in packs with the shanks in brackets, product sizes read clearly, parts not ordered on one line", () => {
    expect(qtyWords(section("fshank").result.pieces, section("fshank").unit, section("fshank").part)).toBe("40 packs (80 shanks)");
    expect(section("trim").minus[0].label).toBe("Ground Lamb (1 lb packs)");
    expect(productWords("BNLS Legs")).toBe("BNLS Legs");
    expect(r.notOrdered).toBe("Not ordered this week: Denver ribs 138.");
  });

  it("Le Trim: the units, and what fills them by weight, with the difference shown", () => {
    expect(r.leTrim).toMatchObject({ units: 72, orderedLb: 720, totalLb: 770, diffLb: 50 });
  });
});

describe("the Carcass balance download", () => {
  it("has the summary, each part as a subtraction (packs with the shanks), and Le Trim", async () => {
    const { carcassBalanceTable } = await import("../reports");
    const c = calcWeek({ parts, products, orders: [{ whole: 4, bnls: 90, bis: 30, wl: 17, rack: 82, sl: 76, fs: 25 }] });
    const r = carcassReport({ c, products, parts, packSizes: new Map([["fshank", 2]]), extraLambs: [], leTrim: null });
    const t = carcassBalanceTable("2026-11-02", r);
    expect(t.rows[0].slice(1, 3)).toEqual(["Summary", r.lambsLine]);
    const fs = t.rows.filter((x) => x[1] === "Front shank");
    expect(fs.map((x) => x.slice(2))).toEqual([
      ["From 54 lambs", 54, "packs", 108],
      ["minus Whole Lamb", 4, "packs", 8],
      ["minus Front Shanks", 25, "packs", 50],
      ["Left over", 25, "packs", 50],
    ]);
  });
});
