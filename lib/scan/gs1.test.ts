// SPEC 11.2: the GS1-128 parser, checked against real Mohawk labels.

import { describe, expect, it } from "vitest";
import { boxKey, gs1Date, gtinCheckDigitOk, mohawkSerial, parseLabel, type Gs1Box } from "./gs1";

const GS = "\u001d";

function read(raw: string): Gs1Box {
  const r = parseLabel(raw);
  if (!r.ok) throw new Error(`expected a good read, got ${r.error}`);
  return r.box;
}

describe("real Mohawk labels", () => {
  it("1. raw scan with ]C1: snack stick, packed 10/13, label printed 10/14", () => {
    const b = read("]C10110602581209420112610133202001000212628720003");
    expect(b).toMatchObject({
      gtin: "10602581209420",
      packDate: "2026-10-13",
      weightLb: 10,
      weight: { ai: "3202", value: 10, unit: "lb" },
      serial: "2628720003",
      serialDate: "2026-10-14", // day 287: differs from the pack date, and both are kept
      caseNo: "20003",
      lot: null,
    });
  });

  it("2. French rack, 22.15 lb", () => {
    const b = read("0110698746488816112610143202002215212628710066");
    expect(b).toMatchObject({
      gtin: "10698746488816",
      packDate: "2026-10-14",
      weightLb: 22.15,
      serial: "2628710066",
      serialDate: "2026-10-14",
      caseNo: "10066",
    });
  });

  it("3. lamb fat, 2.40 lb (small vacuum-packed weights are normal)", () => {
    const b = read("0110698746489288112610143202000240212628720063");
    expect(b).toMatchObject({
      gtin: "10698746489288",
      packDate: "2026-10-14",
      weightLb: 2.4,
      serial: "2628720063",
      serialDate: "2026-10-14",
      caseNo: "20063",
    });
  });

  it("the unique box ID is GTIN + full serial", () => {
    expect(boxKey(read("0110698746488816112610143202002215212628710066"))).toBe("10698746488816:2628710066");
    // Same serial on a different product is a different box.
    expect(boxKey(read("0110698746489288112610143202000240212628710066"))).toBe("10698746489288:2628710066");
  });
});

describe("what scanners send", () => {
  const label = "0110698746488816112610143202002215212628710066";

  it("reads the same with or without ]C1", () => {
    expect(read(`]C1${label}`)).toEqual(read(label));
  });

  it("reads a leading FNC1 sent as a GS character, and stray line ends", () => {
    expect(read(`${GS}${label}\r\n`)).toEqual(read(label));
  });

  it("uses a GS to end a variable-length field", () => {
    // Serial first, ended by GS, then the fixed fields.
    const b = read(`]C1212628710066${GS}0110698746488816112610143202002215`);
    expect(b).toMatchObject({ gtin: "10698746488816", serial: "2628710066", weightLb: 22.15, packDate: "2026-10-14" });
  });

  it("parses by code, not by position: the same fields in another order", () => {
    const b = read("11261014320200221501106987464888162126287" + "10066");
    expect(b).toMatchObject({ gtin: "10698746488816", packDate: "2026-10-14", weightLb: 22.15, serial: "2628710066" });
  });

  it("reads a label typed as printed, with brackets", () => {
    expect(read("(01)10698746488816(11)261014(3202)002215(21)2628710066")).toEqual(
      read("0110698746488816112610143202002215212628710066"),
    );
  });
});

describe("lot (AI 10)", () => {
  it("is read when present, ended by GS, and overrides a stored lot", () => {
    const b = read(`]C1011069874648881611261014320200221510123456${GS}212628710066`);
    expect(b).toMatchObject({ lot: "123456", serial: "2628710066", gtin: "10698746488816" });
  });

  it("is read when it comes last", () => {
    expect(read("011069874648881611261014320200221510654321").lot).toBe("654321");
  });

  it("is null when the label has none (the lot is entered from the printed label)", () => {
    expect(read("0110698746488816112610143202002215212628710066").lot).toBeNull();
  });
});

describe("misreads are rejected so the packer scans again", () => {
  it("a bad GTIN check digit", () => {
    // Last digit of the GTIN changed from 6 to 7.
    const r = parseLabel("0110698746488817112610143202002215212628710066");
    expect(r).toMatchObject({ ok: false, error: "bad-check-digit" });
    if (!r.ok) expect(r.message).toMatch(/scan again/i);
  });

  it("a dropped digit (field runs short)", () => {
    expect(parseLabel("01106987464888161126101432020022")).toMatchObject({ ok: false });
  });

  it("no GTIN", () => {
    expect(parseLabel("112610143202002215212628710066")).toMatchObject({ ok: false, error: "no-gtin" });
  });

  it("not a GS1 label at all", () => {
    expect(parseLabel("HELLO")).toMatchObject({ ok: false, error: "no-gtin" });
    expect(parseLabel("   ")).toMatchObject({ ok: false, error: "empty" });
    expect(parseLabel("]C1")).toMatchObject({ ok: false, error: "empty" });
  });

  it("an impossible date", () => {
    expect(parseLabel("0110698746488816112613403202002215212628710066")).toMatchObject({ ok: false, error: "bad-date" });
  });
});

describe("other weight codes", () => {
  it("320x is pounds with x decimals", () => {
    expect(read("0110698746488816112610143201022150").weight).toEqual({ ai: "3201", value: 2215, unit: "lb" });
    expect(read("0110698746488816112610143203022150").weightLb).toBeCloseTo(22.15);
  });

  it("310x is kilograms, converted to pounds and the original kept", () => {
    const b = read("0110698746488816112610143102001000");
    expect(b.weight).toEqual({ ai: "3102", value: 10, unit: "kg" });
    expect(b.weightLb).toBeCloseTo(22.046, 3);
  });

  it("a label with no weight still reads (weight entered by hand)", () => {
    expect(read("011069874648881611261014212628710066").weightLb).toBeNull();
  });
});

describe("helpers", () => {
  it("GS1 mod-10 check digit", () => {
    for (const g of ["10602581209420", "10698746488816", "10698746489288"]) expect(gtinCheckDigitOk(g)).toBe(true);
    expect(gtinCheckDigitOk("10698746489289")).toBe(false);
    expect(gtinCheckDigitOk("4006381333931")).toBe(true); // a 13-digit EAN
    expect(gtinCheckDigitOk("abc")).toBe(false);
  });

  it("YYMMDD dates, day 00 meaning the end of the month", () => {
    expect(gs1Date("261014")).toBe("2026-10-14");
    expect(gs1Date("260200")).toBe("2026-02-28");
    expect(gs1Date("280200")).toBe("2028-02-29");
    expect(gs1Date("261301")).toBeNull();
    expect(gs1Date("260231")).toBeNull();
  });

  it("Mohawk serials: YY + day of year + case number", () => {
    expect(mohawkSerial("2628710066")).toEqual({ serialDate: "2026-10-14", caseNo: "10066" });
    expect(mohawkSerial("2600100001")).toEqual({ serialDate: "2026-01-01", caseNo: "00001" });
    expect(mohawkSerial("2836600001")).toEqual({ serialDate: "2028-12-31", caseNo: "00001" }); // leap year
    expect(mohawkSerial("2636600001")).toEqual({ serialDate: null, caseNo: null }); // 2026 has 365 days
    expect(mohawkSerial("ABC123")).toEqual({ serialDate: null, caseNo: null });
  });
});
