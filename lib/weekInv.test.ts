import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { invFileName, invFilePrefix, invLabel, invRangeFilePrefix, invRangeLabel } from "./weekInv";
import { tableCsv } from "./reports";
import { xlsxFile } from "./xlsx";

describe("the week's invoice number on printouts and downloads (10/31/26)", () => {
  it("prints the week's number, or a blank to write in (never a worked-out one)", () => {
    expect(invLabel(3001)).toBe("INV# 3001");
    expect(invLabel("3001")).toBe("INV# 3001");
    expect(invLabel(null)).toBe("INV# ______");
    expect(invLabel(" ")).toBe("INV# ______");
  });

  it("starts a file name: INV3001 Order Grid 2026-10-26", () => {
    expect(invFilePrefix(3001)).toBe("INV3001");
    expect(invFilePrefix(null)).toBe("INV____");
    expect(invFileName(3001, "Order grid", "2026-10-26")).toBe("INV3001 Order Grid 2026-10-26");
    expect(invFileName(null, "This week's orders", "2026-11-02")).toBe("INV____ This Week's Orders 2026-11-02");
  });

  it("over many weeks: the range, lowest to highest, weeks without one left out", () => {
    expect(invRangeLabel([3002, 2998, null, 3000])).toBe("INV# 2998 to 3002");
    expect(invRangeLabel([3001, 3001])).toBe("INV# 3001");
    expect(invRangeLabel([null, ""])).toBe("INV# ______");
    expect(invRangeFilePrefix([3002, 2998])).toBe("INV2998-3002");
    expect(invRangeFilePrefix([])).toBe("INV____");
  });

  it("puts the title row on top of a CSV, above the column names", () => {
    const csv = tableCsv({ header: ["Customer", "Qty"], rows: [["Key City", 2]], title: "INV# 3001 · Order grid · Packing Mon Oct 26" });
    expect(csv.replace(/^﻿/, "").split("\r\n").slice(0, 3)).toEqual(["INV# 3001 · Order grid · Packing Mon Oct 26", "Customer,Qty", "Key City,2"]);
  });

  it("puts it on top of an Excel sheet, with INV# and page X of Y at the foot of every printed page", async () => {
    const zip = await JSZip.loadAsync(
      await xlsxFile([{ name: "Orders", header: ["Customer"], rows: [["Key City"]], title: "INV# 3001 · Order grid", footer: "INV# 3001", freezeFirstColumn: true }]),
    );
    const s = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(s).toContain('<c r="A1" s="3" t="inlineStr"><is><t xml:space="preserve">INV# 3001 · Order grid</t></is></c>');
    expect(s).toContain('<c r="A2" s="1" t="inlineStr"><is><t xml:space="preserve">Customer</t></is></c>');
    expect(s).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">Key City</t></is></c>');
    expect(s).toContain('ySplit="2" topLeftCell="B3"');
    expect(s).toContain("<oddFooter>&amp;CINV# 3001, page &amp;P of &amp;N</oddFooter>");
    const wb = await zip.file("xl/workbook.xml")!.async("string");
    expect(wb).toContain("'Orders'!$A:$A,'Orders'!$1:$2");
  });
});
