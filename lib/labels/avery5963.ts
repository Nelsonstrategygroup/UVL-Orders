// Box labels on Avery 5963 sheets (change request 10/23/26): 4" x 2", ten
// per US Letter sheet, 2 columns x 5 rows. The PDF is drawn here, at exact
// sizes, so browser scaling can't shift it (print at Actual size / 100%).
// Positions are numbered 1 to 10, left to right, top to bottom.

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

const IN = 72; // points per inch
export const PAGE = { w: 8.5 * IN, h: 11 * IN };
export const SHEET = {
  top: 0.5,
  left: 0.15625,
  labelW: 4,
  labelH: 2,
  gapX: 0.1875,
  cols: 2,
  rows: 5,
  /** Space inside each label, all round. */
  padding: 0.18,
} as const;
export const PER_SHEET = SHEET.cols * SHEET.rows;

/** Printer offset in inches (My account), added to every label. */
export type Offset = { x: number; y: number };

/**
 * Where a position (1 to 10) is on the page, in PDF points from the bottom
 * left corner, after the printer offset (+x right, +y down).
 */
export function slotBox(slot: number, offset: Offset = { x: 0, y: 0 }): { x: number; y: number; w: number; h: number } {
  const i = slot - 1;
  const col = i % SHEET.cols;
  const row = Math.floor(i / SHEET.cols);
  const left = (SHEET.left + col * (SHEET.labelW + SHEET.gapX) + offset.x) * IN;
  const top = (SHEET.top + row * SHEET.labelH + offset.y) * IN;
  return { x: left, y: PAGE.h - top - SHEET.labelH * IN, w: SHEET.labelW * IN, h: SHEET.labelH * IN };
}

/**
 * The sheet and position for each of `count` labels, starting at position
 * `start` (1 to 10) on the first sheet so a partly used sheet can be reused.
 */
export function placeLabels(count: number, start = 1): { page: number; slot: number }[] {
  const first = Math.min(Math.max(1, Math.floor(start)), PER_SHEET) - 1;
  return Array.from({ length: count }, (_, i) => {
    const n = first + i;
    return { page: Math.floor(n / PER_SHEET), slot: (n % PER_SHEET) + 1 };
  });
}

/** "14-20, 25" -> the label numbers 14 to 20 and 25. Ignores anything else. */
export function parseRange(text: string): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(/[,\s]+/)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b) && n - Math.min(a, b) < 1000; n++) out.add(n);
  }
  return out;
}

/** What goes on one label. */
export type PrintLabel = {
  number: number;
  name: string;
  location: string;
  /** "6 BLS Legs", "6 packs Front Shanks". */
  what: string;
  boxNo: number;
  boxCount: number;
  /** "MVM", "White", or "?" when the box size isn't worked out. */
  boxType: string;
};

// The standard PDF fonts only have Western characters: swap the common
// others, drop anything they can't draw.
function plain(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

/** The largest size up to `max` at which the text fits `width` on one line (never wrapped or cut off). */
function fitSize(font: PDFFont, text: string, max: number, width: number): number {
  const w = font.widthOfTextAtSize(text, max);
  return w <= width ? max : Math.max(1, (max * width) / w);
}

function drawLabel(page: PDFPage, box: ReturnType<typeof slotBox>, l: PrintLabel, f: { regular: PDFFont; bold: PDFFont }) {
  const pad = SHEET.padding * IN;
  const left = box.x + pad;
  const right = box.x + box.w - pad;
  const width = right - left;
  const top = box.y + box.h - pad; // PDF y grows upward
  const ink = rgb(0, 0, 0);

  // Top right, small: the label number.
  const num = `#${l.number}`;
  const numSize = 8;
  const numW = f.regular.widthOfTextAtSize(num, numSize);
  page.drawText(num, { x: right - numW, y: top - numSize, size: numSize, font: f.regular, color: ink });

  // Customer, bold and large, shrunk to fit one line beside the number.
  const name = plain(l.name);
  const nameSize = fitSize(f.bold, name, 20, width - numW - 6);
  page.drawText(name, { x: left, y: top - nameSize * 0.85, size: nameSize, font: f.bold, color: ink });

  // Location underneath, smaller.
  const loc = plain(l.location);
  if (loc) {
    const locSize = fitSize(f.regular, loc, 12, width);
    page.drawText(loc, { x: left, y: top - 20 - 4 - locSize * 0.85, size: locSize, font: f.regular, color: ink });
  }

  // A thin rule across the middle.
  const mid = box.y + box.h / 2;
  page.drawLine({ start: { x: left, y: mid }, end: { x: right, y: mid }, thickness: 0.6, color: ink });

  // How many and what, bold and large.
  const what = plain(l.what);
  const whatSize = fitSize(f.bold, what, 20, width);
  page.drawText(what, { x: left, y: mid - 6 - whatSize * 0.85, size: whatSize, font: f.bold, color: ink });

  // Bottom: "Box 1 of 2" on the left, the box type on the right.
  const bottom = box.y + pad;
  page.drawText(`Box ${l.boxNo} of ${l.boxCount}`, { x: left, y: bottom, size: 12, font: f.regular, color: ink });
  const type = plain(l.boxType);
  const typeSize = 13;
  page.drawText(type, { x: right - f.bold.widthOfTextAtSize(type, typeSize), y: bottom, size: typeSize, font: f.bold, color: ink });
}

/** The labels as a PDF: US Letter, exact sizes, starting at a position on the first sheet. */
export async function labelsPdf(labels: PrintLabel[], opts: { start?: number; offset?: Offset } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Box labels (Avery 5963)");
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const pages: PDFPage[] = [];
  placeLabels(labels.length, opts.start).forEach(({ page, slot }, i) => {
    while (pages.length <= page) pages.push(doc.addPage([PAGE.w, PAGE.h]));
    drawLabel(pages[page], slotBox(slot, opts.offset), labels[i], fonts);
  });
  if (!pages.length) doc.addPage([PAGE.w, PAGE.h]);
  return doc.save();
}

/** The alignment test: dashed outlines of all ten positions, numbered, to print on plain paper. */
export async function alignmentPdf(offset: Offset = { x: 0, y: 0 }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Avery 5963 alignment test");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([PAGE.w, PAGE.h]);
  for (let slot = 1; slot <= PER_SHEET; slot++) {
    const b = slotBox(slot, offset);
    page.drawRectangle({ x: b.x, y: b.y, width: b.w, height: b.h, borderColor: rgb(0, 0, 0), borderWidth: 0.75, borderDashArray: [5, 4] });
    const t = String(slot);
    page.drawText(t, { x: b.x + b.w / 2 - font.widthOfTextAtSize(t, 28) / 2, y: b.y + b.h / 2 - 10, size: 28, font, color: rgb(0.6, 0.6, 0.6) });
  }
  const note = "Hold this over a label sheet against the light: each dashed box should sit on a label. Adjust the offset in My account.";
  page.drawText(note, { x: 0.3 * IN, y: 0.2 * IN, size: 8, font, color: rgb(0.3, 0.3, 0.3) });
  return doc.save();
}
