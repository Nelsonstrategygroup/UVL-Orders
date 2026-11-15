import { describe, expect, it } from "vitest";
import {
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
