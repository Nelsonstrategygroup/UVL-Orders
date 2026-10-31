// A small Excel (.xlsx) writer for the downloads. An .xlsx file is a zip of a
// few XML files; JSZip (already used for "Export all data") builds it. Header
// row bold, shaded and frozen, light grey on every other row so long tables
// are easy to follow, numbers as numbers, everything else as text, column
// widths sized to the content. Printing: landscape, one page wide, with the
// header row repeated on every page.

import JSZip from "jszip";

export type Cell = string | number | null | undefined;
export type Sheet = {
  name: string;
  header: string[];
  rows: Cell[][];
  /** Keep the first column on screen too (a grid with names down the side). */
  freezeFirstColumn?: boolean;
  /** A top row above the column names, bold and larger ("INV# 3001 · Order grid · Packing Mon Oct 26"). */
  title?: string;
  /** At the foot of every printed page, before "page X of Y" ("INV# 3001"). */
  footer?: string;
};

// Cell styles (cellXfs in STYLES): plain, header, every other row, the title row.
const PLAIN = 0;
const HEADER = 1;
const STRIPE = 2;
const TITLE = 3;

/** Excel's limit for one cell. */
const MAX_CELL = 32767;

/** Remove characters XML can't hold, then escape the rest. */
function xml(s: string): string {
  return s
    .replace(/[^\x09\x0A\x0D\x20-퟿-�]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function colName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Sheet names: at most 31 characters, none of []:*?/\, and unique. */
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base = (raw.replace(/[[\]:*?/\\]/g, " ").trim() || "Sheet").slice(0, 31);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function cellXml(ref: string, v: Cell, style = 0): string {
  const s = style ? ` s="${style}"` : "";
  // An empty cell is left out, unless it carries shading.
  if (v == null || v === "") return style ? `<c r="${ref}"${s}/>` : "";
  if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  const text = String(v).slice(0, MAX_CELL);
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const all = [sheet.header, ...sheet.rows];
  // The title row, when there is one, pushes everything down a row.
  const top = sheet.title ? 1 : 0;
  const widths = sheet.header.map((_, c) => {
    const longest = all.reduce((m, r) => Math.max(m, String(r[c] ?? "").length), 0);
    return Math.min(60, Math.max(8, longest + 2));
  });
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const width = Math.max(sheet.header.length, ...all.map((r) => r.length));
  const titleRow = sheet.title ? `<row r="1" ht="22" customHeight="1">${cellXml("A1", sheet.title, TITLE)}</row>` : "";
  const rows =
    titleRow +
    all
      .map((r, ri) => {
        // Header, then grey on every other row (the 2nd, 4th... data row).
        const style = ri === 0 ? HEADER : ri % 2 === 0 ? STRIPE : PLAIN;
        const n = ri + 1 + top;
        const cells = Array.from({ length: style ? width : r.length }, (_, ci) => cellXml(`${colName(ci)}${n}`, r[ci], style)).join("");
        return `<row r="${n}">${cells}</row>`;
      })
      .join("");
  const split = 1 + top;
  const pane = sheet.freezeFirstColumn
    ? `<pane xSplit="1" ySplit="${split}" topLeftCell="B${split + 1}" activePane="bottomRight" state="frozen"/>`
    : `<pane ySplit="${split}" topLeftCell="A${split + 1}" activePane="bottomLeft" state="frozen"/>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${rows}</sheetData>` +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    // Landscape, one page wide, as many pages tall as it needs.
    `<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>` +
    // "INV# 3001, page 2 of 3" at the foot of every printed page.
    (sheet.footer ? `<headerFooter><oddFooter>${xml(`&C${sheet.footer.replace(/&/g, "&&")}, page &P of &N`)}</oddFooter></headerFooter>` : "") +
    `</worksheet>`
  );
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>` +
  `<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFEEEEEE"/><bgColor indexed="64"/></patternFill></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFD9D9D9"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>` +
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

/** An Excel workbook with one sheet per table. */
export async function xlsxFile(sheets: Sheet[]): Promise<Uint8Array> {
  const list = sheets.length ? sheets : [{ name: "Sheet", header: [], rows: [] }];
  const names = sheetNames(list.map((s) => s.name));
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      list
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("") +
      `</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
      // The header row (and the name column of a grid) on every printed page.
      `<definedNames>${names
        .map((n, i) => {
          const q = `'${xml(n).replace(/'/g, "''")}'`;
          return `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${list[i].freezeFirstColumn ? `${q}!$A:$A,` : ""}${q}!$1:$${list[i].title ? 2 : 1}</definedName>`;
        })
        .join("")}</definedNames>` +
      `</workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      list
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("") +
      `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  );
  zip.file("xl/styles.xml", STYLES);
  list.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
