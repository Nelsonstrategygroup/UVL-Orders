import { describe, expect, it } from "vitest";
import { cleanCode, invoiceNumberText, isInvoiceCode, parseWeekNumber, suggestWeekNumber } from "./invoiceNumbers";

describe("invoice numbers", () => {
  it("joins the week number and the location code, with -R for reissues", () => {
    expect(invoiceNumberText(3001, "NEWP")).toBe("3001-NEWP");
    expect(invoiceNumberText(3001, "PCC07", 1)).toBe("3001-PCC07-R1");
    expect(invoiceNumberText(3001, "PCC07", 2)).toBe("3001-PCC07-R2");
  });
  it("checks codes: 3 to 5 capitals or digits", () => {
    expect(isInvoiceCode("NEWP")).toBe(true);
    expect(isInvoiceCode("PCC07")).toBe(true);
    expect(isInvoiceCode("BEL")).toBe(true);
    expect(isInvoiceCode("AB")).toBe(false);
    expect(isInvoiceCode("PCC107")).toBe(false);
    expect(isInvoiceCode("newp")).toBe(false);
    expect(cleanCode(" pcc-07 ")).toBe("PCC07");
  });
  it("suggests one more than the highest week number", () => {
    expect(suggestWeekNumber([{ invoice_number: 3000 }, { invoice_number: null }, { invoice_number: 3001 }])).toBe(3002);
    expect(suggestWeekNumber([{ invoice_number: null }])).toBeNull();
  });
  it("reads a typed week number", () => {
    expect(parseWeekNumber(" 3002 ")).toBe(3002);
    expect(parseWeekNumber("")).toBeNull();
    expect(parseWeekNumber("30.5")).toBeNull();
    expect(parseWeekNumber("0")).toBeNull();
  });
});
