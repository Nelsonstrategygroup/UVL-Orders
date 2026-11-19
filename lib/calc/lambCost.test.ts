import { describe, expect, it } from "vitest";
import {
  killMathText,
  rateChangeImpact,
  rateImpactLines,
  rateOriginText,
  repay,
  type RateBook,
  averageLbText,
  carcassText,
  centsText,
  fixedRounded,
  gridPlace,
  liveText,
  moneyText,
  parseCarcass,
  parseSizeRange,
  roundToCents,
  sheetPay,
  sizeCounts,
  sizeFor,
  weekPay,
  type KillAdjustment,
  type KillLamb,
  type KillSheet,
  type SizeClass,
  factorText,
  newestFirst,
  parseFactor,
  parseRate,
  producerRateFor,
  rateFor,
  rateText,
  settingFor,
  type LambCostSetting,
  type ProducerRate,
} from "./lambCost";

const settings: LambCostSetting[] = [
  { id: "s1", effective_from: "2026-01-01", base_rate: "3.0000", live_factor: "2.0200", note: "" },
  { id: "s2", effective_from: "2026-12-01", base_rate: "3.2500", live_factor: "2.0500", note: "" },
];
const rates: ProducerRate[] = [{ id: "r1", producer_id: "p1", effective_from: "2026-06-01", rate: "3.4000", note: "" }];

describe("settingFor", () => {
  it("uses the newest setting on or before the date", () => {
    expect(settingFor(settings, "2026-11-14")?.id).toBe("s1");
    expect(settingFor(settings, "2026-12-01")?.id).toBe("s2");
    expect(settingFor(settings, "2027-03-01")?.id).toBe("s2");
  });
  it("is null before the first setting", () => {
    expect(settingFor(settings, "2025-12-31")).toBeNull();
    expect(settingFor([], "2026-11-14")).toBeNull();
  });
  it("doesn't depend on the order rows come in", () => {
    expect(settingFor([...settings].reverse(), "2027-01-01")?.id).toBe("s2");
  });
});

describe("producerRateFor", () => {
  it("finds a producer's own rate from its date on", () => {
    expect(producerRateFor(rates, "p1", "2026-05-31")).toBeNull();
    expect(producerRateFor(rates, "p1", "2026-06-01")?.id).toBe("r1");
    expect(producerRateFor(rates, "p2", "2026-07-01")).toBeNull();
  });
});

describe("rateFor", () => {
  it("uses the base rate when the producer has no rate of their own", () => {
    expect(rateFor(settings, rates, "p2", "2026-11-14")).toEqual({ rate: "3.0000", factor: "2.0200", source: "base" });
    expect(rateFor(settings, rates, null, "2026-11-14")).toEqual({ rate: "3.0000", factor: "2.0200", source: "base" });
  });
  it("uses the producer's own rate when one applies, with the setting's factor", () => {
    expect(rateFor(settings, rates, "p1", "2026-11-14")).toEqual({ rate: "3.4000", factor: "2.0200", source: "override" });
    expect(rateFor(settings, rates, "p1", "2026-12-07")).toEqual({ rate: "3.4000", factor: "2.0500", source: "override" });
  });
  it("uses the base rate before the producer's rate starts", () => {
    expect(rateFor(settings, rates, "p1", "2026-05-01")?.source).toBe("base");
  });
  it("is null with no pricing setting yet, even with a producer rate", () => {
    expect(rateFor([], rates, "p1", "2026-11-14")).toBeNull();
  });
  it("a new setting never changes an earlier date", () => {
    const later = [...settings, { id: "s3", effective_from: "2027-01-04", base_rate: "4", live_factor: "2.1", note: "" }];
    expect(rateFor(later, rates, null, "2026-11-14")).toEqual(rateFor(settings, rates, null, "2026-11-14"));
  });
});

// ----- Stage 2 -----

const sheet = (id: string, producer = "p1", over: Partial<KillSheet> = {}): KillSheet => ({
  id,
  producer_id: producer,
  kill_date: "2026-10-23",
  week_id: "2026-10-26",
  base_rate: "3.0000",
  live_factor: "2.0200",
  rate_source: "base",
  notes: "",
  ...over,
});
const lamb = (id: string, sheetId: string, position: number, lb: string): KillLamb => ({ id, sheet_id: sheetId, position, carcass_lb: lb });
const adj = (over: Partial<KillAdjustment>): KillAdjustment => ({
  id: "a",
  sheet_id: "s1",
  lamb_id: null,
  kind: "dollars",
  amount: "0",
  reason: "premium",
  note: "",
  ...over,
});

describe("sheetPay", () => {
  const lambs = [lamb("l2", "s1", 2, "58.50"), lamb("l1", "s1", 1, "62.40"), lamb("x", "other", 1, "70")];

  it("works out each lamb: carcass x factor = live, live x rate = base pay", () => {
    const p = sheetPay(sheet("s1"), lambs, []);
    expect(p.count).toBe(2);
    expect(p.lambs.map((l) => l.lamb.id)).toEqual(["l1", "l2"]);
    expect(liveText(p.lambs[0].live)).toBe("126.05"); // 62.4 x 2.02 = 126.048
    expect(fixedRounded(p.lambs[0].live, 6, 3)).toBe("126.048");
    expect(moneyText(p.lambs[0].base)).toBe("$378.14"); // 378.144
    expect(carcassText(p.carcass)).toBe("120.90");
    expect(centsText(p.cents)).toBe("$732.65"); // 378.144 + 354.51 = 732.654
  });

  it("adds lamb and sheet adjustments, dollars and $ per live lb", () => {
    const p = sheetPay(sheet("s1"), lambs, [
      adj({ id: "a1", lamb_id: "l1", amount: "-10", reason: "dock" }),
      adj({ id: "a2", kind: "per_live_lb", amount: "0.05" }),
      adj({ id: "a3", sheet_id: "other", amount: "99" }),
    ]);
    expect(moneyText(p.lambs[0].pay)).toBe("$368.14");
    expect(moneyText(p.sheetAdjustments[0].money)).toBe("$12.21"); // 0.05 x 244.218
    expect(p.sheetAdjustments).toHaveLength(1);
    expect(centsText(p.cents)).toBe("$734.86"); // 732.654 - 10 + 12.2109 = 734.8649
  });

  it("a $/live lb adjustment on one lamb uses that lamb's live lb", () => {
    const p = sheetPay(sheet("s1"), lambs, [adj({ lamb_id: "l2", kind: "per_live_lb", amount: "-0.10", reason: "dock" })]);
    expect(moneyText(p.lambs[1].pay - p.lambs[1].base)).toBe("-$11.82"); // -0.10 x 118.17 = -11.817
  });

  it("rounds only the sheet total, never each lamb", () => {
    // 10.25 x 2.02 x 3.00 = 62.115 each: rounded one by one it would be 124.24.
    const p = sheetPay(sheet("s1"), [lamb("a", "s1", 1, "10.25"), lamb("b", "s1", 2, "10.25")], []);
    expect(centsText(p.cents)).toBe("$124.23");
  });

  it("uses the rate and factor stored on the sheet", () => {
    const p = sheetPay(sheet("s1", "p1", { base_rate: "3.25", live_factor: "2.05" }), [lamb("a", "s1", 1, "60")], []);
    expect(liveText(p.live)).toBe("123.00");
    expect(centsText(p.cents)).toBe("$399.75");
  });

  it("an empty sheet is $0.00", () => {
    expect(centsText(sheetPay(sheet("s1"), [], []).cents)).toBe("$0.00");
  });
});

describe("weekPay", () => {
  it("adds up each producer and the week, rounding the week once", () => {
    const one = sheetPay(sheet("s1", "p1"), [lamb("a", "s1", 1, "10.25")], []);
    const two = sheetPay(sheet("s2", "p1", { kill_date: "2026-10-24" }), [lamb("b", "s2", 1, "10.25")], []);
    const three = sheetPay(sheet("s3", "p2"), [lamb("c", "s3", 1, "60"), lamb("d", "s3", 2, "64")], []);
    expect(centsText(one.cents)).toBe("$62.12");
    const w = weekPay([one, two, three]);
    expect(w.head).toBe(4);
    const p1 = w.producers.find((p) => p.producerId === "p1")!;
    expect(p1.sheets).toBe(2);
    expect(p1.head).toBe(2);
    expect(centsText(p1.cents)).toBe("$124.23"); // not 62.12 + 62.12
    expect(averageLbText(w.producers.find((p) => p.producerId === "p2")!.carcass, 2)).toBe("62.0");
    expect(carcassText(w.carcass)).toBe("144.50");
    expect(centsText(w.cents)).toBe("$875.67"); // 124.23 + 124 x 2.02 x 3 = 751.44
  });
  it("no sheets: nothing", () => {
    const w = weekPay([]);
    expect(w.head).toBe(0);
    expect(centsText(w.cents)).toBe("$0.00");
    expect(averageLbText(w.carcass, 0)).toBe("");
  });
});

describe("sizes", () => {
  // Setup > Lamb sizes as they are today (11/14/26), overlaps and gaps included.
  const sizes: SizeClass[] = [
    { id: "XL", label: "XL", weight_range: "90+ Lbs", sort: 0 },
    { id: "Large", label: "Large", weight_range: "70-80 Lbs", sort: 1 },
    { id: "Medium", label: "Medium", weight_range: "60-65 Lbs", sort: 2 },
    { id: "Small", label: "Small", weight_range: "50-60 Lbs", sort: 3 },
    { id: "XS", label: "XS", weight_range: "50-55 Lbs", sort: 4 },
  ];
  it("reads the ranges", () => {
    expect(parseSizeRange("50-60 Lbs")).toEqual([50, 60]);
    expect(parseSizeRange("90+ Lbs")).toEqual([90, Infinity]);
    expect(parseSizeRange("70 to 80")).toEqual([70, 80]);
    expect(parseSizeRange("big")).toBeNull();
  });
  it("gives the one size that holds the weight", () => {
    expect(sizeFor(57, sizes)?.id).toBe("Small");
    expect(sizeFor(62.3, sizes)?.id).toBe("Medium");
    expect(sizeFor(75, sizes)?.id).toBe("Large");
    expect(sizeFor(90, sizes)?.id).toBe("XL");
    expect(sizeFor(104, sizes)?.id).toBe("XL");
  });
  it("is unassigned where ranges overlap or leave a gap", () => {
    expect(sizeFor(52, sizes)).toBeNull(); // XS and Small
    expect(sizeFor(60, sizes)).toBeNull(); // Small and Medium
    expect(sizeFor(67, sizes)).toBeNull(); // gap 65-70
    expect(sizeFor(85, sizes)).toBeNull(); // gap 80-90
    expect(sizeFor(45, sizes)).toBeNull();
  });
  it("counts lambs per size, then Unassigned", () => {
    expect(sizeCounts([57, 52, 75, 95, 67], sizes)).toEqual([
      { label: "XL", count: 1 },
      { label: "Large", count: 1 },
      { label: "Medium", count: 0 },
      { label: "Small", count: 1 },
      { label: "XS", count: 0 },
      { label: "Unassigned", count: 2 },
    ]);
  });
});

describe("the paper grid", () => {
  it("places lambs in columns of 20", () => {
    expect(gridPlace(1)).toEqual({ column: 1, row: 1 });
    expect(gridPlace(20)).toEqual({ column: 1, row: 20 });
    expect(gridPlace(21)).toEqual({ column: 2, row: 1 });
    expect(gridPlace(45)).toEqual({ column: 3, row: 5 });
  });
  it("reads a typed carcass weight", () => {
    expect(parseCarcass("62.4")).toBe("62.4");
    expect(parseCarcass("62.")).toBe("62");
    expect(parseCarcass(" 58 ")).toBe("58");
    expect(parseCarcass("62.456")).toBeNull();
    expect(parseCarcass("0")).toBeNull();
    expect(parseCarcass("abc")).toBeNull();
    expect(parseCarcass("")).toBeNull();
  });
});

describe("rounding helpers", () => {
  it("rounds half up, away from zero", () => {
    expect(roundToCents(BigInt(1234500), 5)).toBe(BigInt(1235)); // 12.345 -> 12.35
    expect(roundToCents(BigInt(-1234500), 5)).toBe(BigInt(-1235));
    expect(roundToCents(BigInt(1234499), 5)).toBe(BigInt(1234));
  });
});

describe("typing and showing values", () => {
  it("reads a rate", () => {
    expect(parseRate("$3.00")).toBe("3");
    expect(parseRate("3.125")).toBe("3.125");
    expect(parseRate("three")).toBeNull();
    expect(parseRate("-1")).toBeNull();
  });
  it("reads a factor above 0", () => {
    expect(parseFactor("2.02")).toBe("2.02");
    expect(parseFactor("0")).toBeNull();
    expect(parseFactor("")).toBeNull();
    expect(parseFactor("2.02.1")).toBeNull();
  });
  it("shows a rate in dollars and a factor plainly", () => {
    expect(rateText("3.0000")).toBe("$3.00");
    expect(rateText("3.125")).toBe("$3.125");
    expect(rateText(3)).toBe("$3.00");
    expect(factorText("2.0200")).toBe("2.02");
    expect(factorText("2")).toBe("2");
  });
  it("lists newest first", () => {
    expect(newestFirst(settings).map((s) => s.id)).toEqual(["s2", "s1"]);
  });
});

describe("pay follows the dated settings (11/18/26)", () => {
  const setting = (id: string, from: string, factor: string): LambCostSetting => ({ id, effective_from: from, base_rate: "3", live_factor: factor, note: "" });
  const kill = (id: string, date: string, week: string, extra: Partial<KillSheet> = {}): KillSheet => ({
    id,
    producer_id: "eric",
    kill_date: date,
    week_id: week,
    base_rate: "3",
    live_factor: "2.02",
    rate_source: "base",
    notes: "",
    ...extra,
  });
  const lb = (sheet: string, n: string): KillLamb => ({ id: `${sheet}-l`, sheet_id: sheet, position: 1, carcass_lb: n });
  const now: RateBook = { settings: [setting("a", "2026-10-01", "2.02")], rates: [] };
  const next: RateBook = { settings: [...now.settings, setting("b", "2026-11-01", "2")], rates: [] };
  const sheets = [kill("oct", "2026-10-23", "2026-10-26"), kill("nov6", "2026-11-06", "2026-11-09"), kill("nov13", "2026-11-13", "2026-11-16")];
  const lambs = [lb("oct", "400"), lb("nov6", "470.5"), lb("nov13", "450")];
  const name = () => "Eric Freepons";

  it("lists the kills a new setting changes, old pay to new", () => {
    const i = rateChangeImpact(sheets, lambs, [], next, new Set());
    expect(i.changes.map((c) => c.sheet.id)).toEqual(["nov6", "nov13"]);
    expect(rateImpactLines(i, name)).toEqual(["This changes 2 kills:", "Eric Freepons, Nov 6: $2,851.23 → $2,823.00", "Eric Freepons, Nov 13: $2,727.00 → $2,700.00"]);
  });
  it("kills in closed weeks are listed apart and stay", () => {
    const i = rateChangeImpact(sheets, lambs, [], next, new Set(["2026-11-09"]));
    expect(i.changes.map((c) => c.sheet.id)).toEqual(["nov13"]);
    expect(i.closed.map((c) => c.sheet.id)).toEqual(["nov6"]);
    expect(rateImpactLines(i, name)[2]).toBe("\nIn closed weeks, so these stay as they are:");
  });
  it("an override never changes, and nothing to say when nothing changes", () => {
    const over = [kill("nov13", "2026-11-13", "2026-11-16", { rate_source: "override", override_reason: "Premium" })];
    expect(rateImpactLines(rateChangeImpact(over, lambs, [], next, new Set()), name)).toEqual([]);
  });
  it("says where the rate came from, and shows the math", () => {
    const s = kill("nov13", "2026-11-13", "2026-11-16", { live_factor: "2" });
    const pay = sheetPay(s, [lb("nov13", "7185")].map((l) => ({ ...l, carcass_lb: "99.99" })), []);
    expect(rateOriginText(s, next)).toBe("setting from Nov 1");
    expect(rateOriginText(kill("x", "2026-11-13", "2026-11-16"), next)).toBe("kept from before; the setting now differs");
    expect(rateOriginText(kill("x", "2026-11-13", "2026-11-16", { rate_source: "override", override_reason: "Premium" }), next)).toBe("override: Premium");
    expect(killMathText(pay, next)).toBe("99.99 lb × 2.00 × $3.00 = $599.94, setting from Nov 1");
  });
  it("what if: the same weights at another factor, nothing else changes", () => {
    const pay = sheetPay(kill("nov13", "2026-11-13", "2026-11-16"), [lb("nov13", "450")], [
      { id: "a", sheet_id: "nov13", lamb_id: null, kind: "dollars", amount: "10", reason: "premium", note: "" },
    ]);
    expect(centsText(pay.cents)).toBe("$2,737.00");
    expect(centsText(repay(pay, { factor: "2" }).cents)).toBe("$2,710.00");
    expect(centsText(repay(pay, { rate: "3.10" }).cents)).toBe("$2,827.90");
  });
});
