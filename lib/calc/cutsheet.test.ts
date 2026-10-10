import { describe, expect, it } from "vitest";
import seed from "../../reference/seed-data.json";
import {
  carcassBySize,
  chipText,
  cutSheetText,
  fillSet,
  hashText,
  hasCountedLines,
  isBlankLine,
  isOneTime,
  lambsFromLines,
  lineText,
  lineType,
  lineUse,
  printLines,
  printSets,
  sentStatus,
  setAddsUp,
  setBalance,
  type CutLine,
  type CutSet,
  type CutSpecLite,
} from "./cutsheet";
import { cutSheetTotals } from "./summary";

const specs = new Map<string, CutSpecLite>(seed.cut_specs.map((s) => [s.id, s]));
const perLamb = Object.fromEntries(seed.parts.map((p) => [p.id, p.per_lamb]));
const sheet: CutSet[] = seed.sample_cut_sheet.sets.map((s) => ({
  name: s.name,
  lambs: s.lambs,
  size_class_id: s.size_class_id,
  headline: s.headline,
  lines: s.lines as CutLine[],
}));
const setNamed = (name: string) => sheet.find((s) => s.name === name)!;
const chips = (s: CutSet) => Object.fromEntries(setBalance(s, specs, perLamb).map((c) => [c.id, c]));

describe("SPEC 9: Kathy's 9/30/2026 cut sheet", () => {
  it("1. totals 144 lambs: 40 XL, 81 Large, 16 Medium, 2 Small, 5 XS", () => {
    const t = cutSheetTotals(sheet, seed.size_classes);
    expect(t.total).toBe(144);
    expect(t.bySize.map((s) => `${s.lambs} ${s.label}`)).toEqual(["40 XL", "81 Large", "16 Medium", "2 Small", "5 XS"]);
  });

  it("2. every set adds up except the unnamed 40 XL set, which shows front shanks 160 of 80", () => {
    const bad = sheet.filter((s) => !setAddsUp(s, specs, perLamb));
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ name: "", lambs: 40, size_class_id: "XL" });
    const wrong = setBalance(bad[0], specs, perLamb).filter((c) => !c.ok);
    expect(wrong.map(chipText)).toEqual(["Front shanks 160 of 80"]);
    expect(chipText(chips(bad[0]).leg)).toBe("Legs 80 ✓");
  });

  it("3. Parts NEW Mid (30 Large): 8 loin saddles count as 16 short loins, short loins total 60", () => {
    const s = setNamed("Parts NEW Mid");
    expect(s).toMatchObject({ lambs: 30, size_class_id: "Large" });
    const saddleOnly: CutSet = { ...s, lines: s.lines.filter((l) => l.cut_spec_id === "s26") };
    expect(chips(saddleOnly).loin.used).toBe(16);
    expect(chips(s).loin).toMatchObject({ used: 60, expected: 60, ok: true });
  });

  it("4. PCC (2 Small): whole loins count toward racks and short loins; bone-in legs with shank on make hind shanks 4 of 4", () => {
    const s = setNamed("PCC");
    expect(s).toMatchObject({ lambs: 2, size_class_id: "Small" });
    const c = chips(s);
    expect(c.rack).toMatchObject({ used: 4, ok: true });
    expect(c.loin).toMatchObject({ used: 4, ok: true });
    expect(chipText(c.hshank)).toBe("Hind shanks 4 ✓");
    expect(setAddsUp(s, specs, perLamb)).toBe(true);
    // Without "shank on", hind shanks would come up short.
    const off: CutSet = { ...s, lines: s.lines.map((l) => ({ ...l, shank_on: false })) };
    expect(chipText(chips(off).hshank)).toBe("Hind shanks 0 of 4");
  });

  it("5. Port Townsend (1 Large): All shanks to Osso Bucco at 4 gives 2 front and 2 hind", () => {
    const c = chips(setNamed("Port Townsend"));
    expect(c.fshank).toMatchObject({ used: 2, ok: true });
    expect(c.hshank).toMatchObject({ used: 2, ok: true });
  });
});

describe("cut sheet rules", () => {
  it("doesn't check a set with only notes", () => {
    const notes: CutSet = {
      name: "x",
      lambs: 3,
      size_class_id: "Large",
      headline: "",
      lines: [{ kind: "note", cut_spec_id: null, qty: null, text: "hi", side_note: "", highlight: null, shank_on: false }],
    };
    expect(hasCountedLines(notes)).toBe(false);
    expect(setAddsUp(notes, specs, perLamb)).toBe(true);
  });

  it("counts whole-carcass sets by size for the top-right block", () => {
    expect(carcassBySize(sheet, specs)).toEqual({ Large: 2, XS: 5 });
  });

  it("works out lambs from what the lines use", () => {
    expect(lambsFromLines(setNamed("Parts 2A"), specs)).toBe(48);
  });
});

describe("Put these on this set (6.4)", () => {
  const products = seed.products.map((p) => ({
    id: p.id,
    links: p.cut_spec_id ? [{ cut_spec_id: p.cut_spec_id, units_per_cut: 1 }] : [],
  }));
  const empty: CutSet = { name: "PCC", lambs: 0, size_class_id: "Small", headline: "", lines: [] };

  it("adds order quantities as lines and sets the lamb count when it was 0", () => {
    const { set, added, notOnSheet } = fillSet(empty, { s1: 4, s11: 4, s20: 4, s27: 4, ground: 10 }, products, specs);
    expect(added).toBe(4);
    expect(notOnSheet).toEqual(["ground"]);
    expect(set.lines.map((l) => `${l.qty} ${l.cut_spec_id}`)).toEqual(["4 s1", "4 s11", "4 s20", "4 s27"]);
    expect(set.lambs).toBe(2);
  });

  it("adds to an existing line with the same instruction and keeps a set lamb count", () => {
    const start: CutSet = {
      ...empty,
      lambs: 5,
      lines: [{ kind: "line", cut_spec_id: "s1", qty: 2, text: null, side_note: "keep", highlight: "yellow", shank_on: true }],
    };
    const { set } = fillSet(start, { s1: 4 }, products, specs);
    expect(set.lines).toHaveLength(1);
    expect(set.lines[0]).toMatchObject({ qty: 6, side_note: "keep", highlight: "yellow", shank_on: true });
    expect(set.lambs).toBe(5);
  });
});

describe("Put these on this set: customer products", () => {
  it("turns pounds into whole Mohawk lines, adding products that share a line", () => {
    const chopLine = { cut_spec_id: "s25", units_per_cut: 2.5 };
    const products = [
      { id: "chops", links: [chopLine] },
      { id: "labeled", links: [chopLine] },
      { id: "liver", links: [] },
    ];
    const empty: CutSet = { name: "", lambs: 3, size_class_id: "Large", headline: "", lines: [] };
    // 10 lb + 6 lb = 16 lb of chops at 2.5 lb per short loin = 6.4, so 7.
    const { set, notOnSheet } = fillSet(empty, { chops: 10, labeled: 6, liver: 2 }, products, specs);
    expect(set.lines.map((l) => `${l.qty} ${l.cut_spec_id}`)).toEqual(["7 s25"]);
    expect(notOnSheet).toEqual(["liver"]);
  });
});

describe("sent tracking (6.5)", () => {
  const base = {
    week: "2026-09-28",
    processDate: "2026-09-30",
    inv: "2403",
    notes: "",
    pulled: { large: null, medium: null, small: null },
    goals: ["Bones: Need to gather 2,000 lbs bones. Can save all types..."],
    banners: seed.sample_cut_sheet.banners,
    standing: "",
    sets: sheet,
    sizes: seed.size_classes,
  };

  it("builds the plain-text sheet", () => {
    const t = cutSheetText(base, specs);
    expect(t.split("\n").slice(0, 2)).toEqual(["UVL CUT SHEET", "Date: 9/30/2026   INV# 2403   Total lamb: 144"]);
    expect(t).toContain("PORT TOWNSEND: 1 Large");
    expect(t).toContain("     4  All shanks to Osso Bucco");
    expect(t).toContain("    14  BLS Shoulder to Grind (TO TUBS FOR NANCY)   [Save Coppa Please]");
    expect(t.endsWith("TOTAL 144")).toBe(true);
  });

  it("is sent until something changes", () => {
    const text = cutSheetText(base, specs);
    const hash = hashText(text);
    expect(sentStatus(null, null, text).kind).toBe("notsent");
    expect(sentStatus("2026-09-29T17:00:00Z", hash, text).kind).toBe("sent");
    const changed = cutSheetText({ ...base, inv: "2404" }, specs);
    expect(sentStatus("2026-09-29T17:00:00Z", hash, changed).kind).toBe("changed");
  });
});

describe("blank sheets and one-time instructions", () => {
  const line = (over: Partial<CutLine>): CutLine => ({
    kind: "line",
    cut_spec_id: null,
    qty: null,
    text: null,
    side_note: "",
    highlight: null,
    shank_on: false,
    ...over,
  });
  const blank = line({});
  const once = line({ text: "Legs to 2 inch steaks, this week only", use_type: "leg", qty: 6 });
  const set = (over: Partial<CutSet>): CutSet => ({ name: "", lambs: 0, size_class_id: null, headline: "", lines: [], ...over });

  it("a new line is blank: no instruction, counts as nothing", () => {
    expect(isBlankLine(blank)).toBe(true);
    expect(isOneTime(blank)).toBe(false);
    expect(lineType(blank, undefined)).toBeNull();
    expect(lineUse(blank, undefined)).toEqual({});
    expect(hasCountedLines(set({ lines: [blank] }))).toBe(false);
  });

  it("one-time wording prints its own words and counts as what Kathy picked", () => {
    expect(isOneTime(once)).toBe(true);
    expect(lineText(once, specs)).toBe("Legs to 2 inch steaks, this week only");
    expect(lineType(once, undefined)).toBe("leg");
    expect(lineUse(once, undefined)).toEqual({ leg: 1 });
    expect(lineUse({ ...once, shank_on: true }, undefined)).toEqual({ leg: 1, hshank: 1 });
    expect(lineType({ ...once, use_type: null }, undefined)).toBe("none");
    expect(chipText(setBalance(set({ lambs: 3, lines: [once] }), specs, perLamb).find((c) => c.id === "leg")!)).toBe("Legs 6 ✓");
  });

  it("lines with no count stay off the sheet; notes with words stay on", () => {
    const lines = [
      blank,
      line({ cut_spec_id: "s1", qty: null }),
      line({ cut_spec_id: "s1", qty: 0 }),
      line({ cut_spec_id: "s1", qty: 4 }),
      line({ text: "One-time, no count yet", use_type: "none" }),
      once,
      line({ kind: "note", text: "Keep separate" }),
      line({ kind: "note", text: "  " }),
    ];
    expect(printLines({ lines }).map((l) => lineText(l, specs))).toEqual([
      specs.get("s1")!.text,
      "Legs to 2 inch steaks, this week only",
      "Keep separate",
    ]);
  });

  it("sets with no lambs and nothing to show stay off the sheet", () => {
    const empty = set({ name: "Empty" });
    const onlyBlank = set({ name: "Blank lines", lines: [blank, line({ cut_spec_id: "s1" })] });
    const lambsOnly = set({ name: "Lambs only", lambs: 2 });
    const counted = set({ name: "Counted", lines: [once] });
    expect(printSets([empty, onlyBlank, lambsOnly, counted]).map((x) => x.name)).toEqual(["Lambs only", "Counted"]);

    const text = cutSheetText(
      {
        week: "2026-10-12",
        processDate: "2026-10-14",
        inv: "",
        notes: "",
        pulled: { large: null, medium: null, small: null },
        goals: [],
        banners: [],
        standing: "",
        sets: [empty, onlyBlank, set({ name: "Counted", lambs: 3, size_class_id: "Large", lines: [blank, once] })],
        sizes: seed.size_classes,
      },
      specs,
    );
    expect(text).not.toContain("EMPTY");
    expect(text).not.toContain("BLANK LINES");
    expect(text).not.toContain("?");
    expect(text).toContain("COUNTED: 3 Large");
    expect(text).toContain("     6  Legs to 2 inch steaks, this week only");
  });
});
