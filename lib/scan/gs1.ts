// Reads a GS1-128 box label (SPEC 11.2): Mohawk prints one on every box when
// it is weighed. The text is a run of Application Identifiers (AIs), each a
// short code followed by its data:
//
//   ]C1 01 10698746488816 11 261014 3202 002215 21 2628710066
//       GTIN               pack date  net 22.15 lb  serial
//
// Parsed by AI, never by position. Fixed-length fields have a known length;
// a variable-length field runs to a GS character (ASCII 29) or the end.
// Pure functions, no database: Packing calls parseLabel() on every scan.

const GS = "\u001d";

/** A box label, read. Dates are YYYY-MM-DD. */
export type Gs1Box = {
  /** AI 01: the 14-digit GTIN, check digit already verified. */
  gtin: string;
  /** AI 11: the pack date. */
  packDate: string | null;
  /** Net weight in pounds (converted from kg when the label is in kg). */
  weightLb: number | null;
  /** The weight as printed: which AI, the number, and its unit. */
  weight: { ai: string; value: number; unit: "lb" | "kg" } | null;
  /** AI 21, all of it. GTIN + serial is the box's unique ID. */
  serial: string | null;
  /** From Mohawk's serial (YY + day of year + case number): the day the label printed. */
  serialDate: string | null;
  /** From Mohawk's serial: the case number. */
  caseNo: string | null;
  /** AI 10, when present. It overrides any stored lot. */
  lot: string | null;
  /** Every AI found, as printed, in order. */
  fields: { ai: string; value: string }[];
};

export type Gs1Error =
  | "empty"
  | "no-gtin"
  | "bad-check-digit"
  | "unknown-code"
  | "too-short"
  | "bad-date"
  | "bad-number";

export type ParseResult = { ok: true; box: Gs1Box } | { ok: false; error: Gs1Error; message: string };

/** What to say to the packer when a label won't read. All of them mean: scan again. */
const MESSAGES: Record<Gs1Error, string> = {
  empty: "Nothing was read. Scan again.",
  "no-gtin": "That isn't a Mohawk box label. Scan the barcode on the box label.",
  "bad-check-digit": "The label didn't read right. Scan again.",
  "unknown-code": "The label didn't read right. Scan again.",
  "too-short": "The label didn't read right. Scan again.",
  "bad-date": "The label didn't read right. Scan again.",
  "bad-number": "The label didn't read right. Scan again.",
};

// Fixed-length AIs (data length after the AI). From the GS1 General
// Specifications; anything not listed here or in VARIABLE is unknown.
const FIXED: Record<string, number> = {
  "00": 18, // SSCC
  "01": 14, // GTIN
  "02": 14, // GTIN of contained items
  "11": 6, // production date
  "12": 6, // due date
  "13": 6, // pack date (some printers use 13)
  "15": 6, // best before
  "16": 6, // sell by
  "17": 6, // expiration
  "20": 2, // variant
};
// Variable-length AIs and their longest data.
const VARIABLE: Record<string, number> = {
  "10": 20, // batch / lot
  "21": 20, // serial
  "22": 20, // consumer product variant
  "30": 8, // count of items
  "37": 8, // count of trade items
  "240": 30, // additional product id
  "241": 30, // customer part number
  "250": 30, // secondary serial
  "251": 30, // reference to source entity
  "400": 30, // customer's purchase order
  "90": 30, // company internal
  "91": 90,
  "92": 90,
  "93": 90,
  "94": 90,
  "95": 90,
  "96": 90,
  "97": 90,
  "98": 90,
  "99": 90,
};

/** GS1 mod-10 check digit: the last digit of a GTIN. */
export function gtinCheckDigitOk(gtin: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(gtin)) return false;
  const digits = gtin.split("").map(Number);
  const check = digits.pop()!;
  let sum = 0;
  // From the right: weights 3, 1, 3, 1...
  for (let i = 0; i < digits.length; i++) sum += digits[digits.length - 1 - i] * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === check;
}

/** YYMMDD to YYYY-MM-DD. Day 00 means the last day of the month (GS1). Null if it isn't a real date. */
export function gs1Date(yymmdd: string): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const year = 2000 + Number(yymmdd.slice(0, 2));
  const month = Number(yymmdd.slice(2, 4));
  let day = Number(yymmdd.slice(4, 6));
  if (month < 1 || month > 12) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day === 0) day = last;
  if (day > last) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Mohawk's serial: YY + day of year (3 digits) + case number. Returns the
 * label date and the case number, or nulls if it doesn't look like one.
 * "2628710066" -> 2026-10-14 (day 287), case "10066".
 */
export function mohawkSerial(serial: string): { serialDate: string | null; caseNo: string | null } {
  const m = /^(\d{2})(\d{3})(\d+)$/.exec(serial);
  if (!m) return { serialDate: null, caseNo: null };
  const year = 2000 + Number(m[1]);
  const dayOfYear = Number(m[2]);
  const daysInYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
  if (dayOfYear < 1 || dayOfYear > daysInYear) return { serialDate: null, caseNo: null };
  const d = new Date(Date.UTC(year, 0, dayOfYear));
  return { serialDate: d.toISOString().slice(0, 10), caseNo: m[3] };
}

/** Which AI starts here, and how long its data is (null length: variable). */
function readAi(s: string, i: number): { ai: string; length: number | null; max: number } | null {
  // Weights and other measures: 31nn to 36nn, 6 digits.
  const four = s.slice(i, i + 4);
  if (/^3[1-6]\d\d$/.test(four)) return { ai: four, length: 6, max: 6 };
  const three = s.slice(i, i + 3);
  if (three in VARIABLE) return { ai: three, length: null, max: VARIABLE[three] };
  const two = s.slice(i, i + 2);
  if (two in FIXED) return { ai: two, length: FIXED[two], max: FIXED[two] };
  if (two in VARIABLE) return { ai: two, length: null, max: VARIABLE[two] };
  return null;
}

/** Tidy what a camera or scanner sent: symbology ID, stray spaces, line ends. */
export function cleanScan(raw: string): string {
  let s = raw.replace(/[\r\n]+/g, "").trim();
  // "]C1" says "this is GS1-128"; it isn't part of the data.
  if (s.startsWith("]C1")) s = s.slice(3);
  // A leading GS (FNC1 sent as a character) means the same.
  while (s.startsWith(GS)) s = s.slice(1);
  return s;
}

const fail = (error: Gs1Error): ParseResult => ({ ok: false, error, message: MESSAGES[error] });

/** Read one scan. Anything that doesn't read cleanly is rejected so the packer scans again. */
export function parseLabel(raw: string): ParseResult {
  const s = cleanScan(raw);
  if (!s) return fail("empty");

  // Labels typed by hand as printed: "(01)10698746488816(11)261014..."
  const fields: { ai: string; value: string }[] = [];
  if (s.startsWith("(")) {
    const re = /\((\d{2,4})\)([^(]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) fields.push({ ai: m[1], value: m[2].replace(new RegExp(GS, "g"), "").trim() });
  } else {
    let i = 0;
    while (i < s.length) {
      if (s[i] === GS) {
        i++;
        continue;
      }
      const ai = readAi(s, i);
      if (!ai) return fail(fields.some((f) => f.ai === "01") ? "unknown-code" : "no-gtin");
      i += ai.ai.length;
      let value: string;
      if (ai.length != null) {
        value = s.slice(i, i + ai.length);
        if (value.length < ai.length) return fail("too-short");
        i += ai.length;
      } else {
        const end = s.indexOf(GS, i);
        value = s.slice(i, end === -1 ? s.length : end);
        i = end === -1 ? s.length : end + 1;
        if (!value || value.length > ai.max) return fail("too-short");
      }
      fields.push({ ai: ai.ai, value });
    }
  }

  const get = (ai: string) => fields.find((f) => f.ai === ai)?.value ?? null;
  const gtin = get("01");
  if (!gtin) return fail("no-gtin");
  if (!/^\d{14}$/.test(gtin) || !gtinCheckDigitOk(gtin)) return fail("bad-check-digit");

  // AI 11 is the production (pack) date; fall back to 13 (packaging date).
  const dateRaw = get("11") ?? get("13");
  const packDate = dateRaw == null ? null : gs1Date(dateRaw);
  if (dateRaw != null && !packDate) return fail("bad-date");

  // Net weight: 320x is pounds, 310x is kilograms; x is the number of decimals.
  let weight: Gs1Box["weight"] = null;
  const w = fields.find((f) => /^3[12]0\d$/.test(f.ai));
  if (w) {
    if (!/^\d{6}$/.test(w.value)) return fail("bad-number");
    const value = Number(w.value) / 10 ** Number(w.ai[3]);
    weight = { ai: w.ai, value, unit: w.ai.startsWith("320") ? "lb" : "kg" };
  }
  const weightLb = weight == null ? null : weight.unit === "lb" ? weight.value : Math.round(weight.value * 2.2046226218 * 1000) / 1000;

  const serial = get("21");
  const { serialDate, caseNo } = serial ? mohawkSerial(serial) : { serialDate: null, caseNo: null };
  const lot = get("10");

  return { ok: true, box: { gtin, packDate, weightLb, weight, serial, serialDate, caseNo, lot, fields } };
}

/** The box's unique ID: GTIN + full serial. Null when the label has no serial. */
export function boxKey(box: Pick<Gs1Box, "gtin" | "serial">): string | null {
  return box.serial ? `${box.gtin}:${box.serial}` : null;
}
