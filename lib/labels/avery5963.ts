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
  /** How many ("6", "10"), its unit ("packs", "lb", or "" for pieces), and the product's label name. */
  qty: string;
  unit: string;
  product: string;
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

// ---------------------------------------------------------------------------
// The label layout (change request 10/24/26). Worked out on its own, in points
// from the label's top left corner (y down), so tests can check where
// everything lands; drawLabel then paints it.
// ---------------------------------------------------------------------------

/** Text widths, from the fonts the PDF uses. */
export type Measure = { bold: (t: string, size: number) => number; regular: (t: string, size: number) => number };

export type Rect = { x: number; y: number; w: number; h: number };
export type TextLine = { text: string; x: number; y: number; size: number };

export type LabelLayout = {
  /** Customer and location, bold, one or two lines, sitting just above the rule. */
  dest: TextLine[];
  ruleY: number;
  /** Black box with the quantity (and its unit underneath, smaller). */
  qtyBox: Rect;
  qtyLines: TextLine[];
  /** Green band with the product name, one or two lines. */
  band: Rect;
  productLines: TextLine[];
  /** "BOX 2 OF 3" in a red tag when there's more than one box; plain "Box 1 of 1" otherwise. */
  boxTag: Rect | null;
  boxText: TextLine;
  /** "label 14", small and gray, in the middle. */
  labelNo: TextLine & { w: number };
  /** The box type in an outlined tag on the right. */
  typeTag: Rect;
  typeText: TextLine;
};

const W = SHEET.labelW * IN; // 288
const H = SHEET.labelH * IN; // 144
const PAD = SHEET.padding * IN; // 12.96
const ASCENT = 0.718; // Helvetica cap height and descent, as a share of the size
const DESCENT = 0.207;
export const LAYOUT = {
  destMax: 22,
  destMin: 14,
  qtyW: 0.85 * IN,
  itemH: 0.66 * IN,
  bandGap: 0.07 * IN,
  productMax: 19,
  productMin: 11,
  tagH: 0.21 * IN,
  radius: 5,
  tagRadius: 4,
} as const;

/** Greedy word wrap; null if a single word is wider than the line. */
function wrap(text: string, size: number, width: number, measure: (t: string, s: number) => number): string[] | null {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next, size) <= width) line = next;
    else {
      if (!line || measure(word, size) > width) return null;
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The biggest size from `max` down that fits in at most `maxLines` lines,
 * wrapping before shrinking. Below `min` it keeps shrinking rather than cut
 * anything off.
 */
function fitLines(text: string, max: number, min: number, width: number, height: number, maxLines: number, measure: (t: string, s: number) => number) {
  const tall = (n: number, s: number) => (n - 1) * s * 1.05 + s * (ASCENT + DESCENT);
  for (let s = max; s >= 4; s -= 0.5) {
    const lines = wrap(text, s, width, measure);
    if (lines && lines.length <= maxLines && tall(lines.length, s) <= height) return { size: s, lines };
  }
  return { size: 4, lines: [text] };
}

export function layoutLabel(l: PrintLabel, m: Measure): LabelLayout {
  const inner = W - 2 * PAD;

  // Bottom line: tags sit on the bottom padding.
  const tagTop = H - PAD - LAYOUT.tagH;
  const midTag = (size: number) => tagTop + (LAYOUT.tagH + ASCENT * size) / 2;

  // Item: the quantity box and the product band, above the bottom line.
  const itemTop = tagTop - 4 - LAYOUT.itemH;
  const ruleY = itemTop - 4;

  // Destination: "PCC #10 Issaquah", wrapped to two lines before shrinking, sitting just above the rule.
  const destText = plain([l.name, l.location].filter((x) => x.trim()).join(" "));
  const destRoom = ruleY - 3 - PAD;
  const d = fitLines(destText, LAYOUT.destMax, LAYOUT.destMin, inner, destRoom, 2, m.bold);
  const lastBase = ruleY - 3 - DESCENT * d.size;
  const dest = d.lines.map((text, i) => ({ text, x: PAD, y: lastBase - (d.lines.length - 1 - i) * d.size * 1.05, size: d.size }));

  // Quantity: a big white number, its unit smaller underneath.
  const qtyBox = { x: PAD, y: itemTop, w: LAYOUT.qtyW, h: LAYOUT.itemH };
  const qtyText = plain(l.qty);
  const unitText = plain(l.unit);
  const unitSize = 10;
  const numRoom = qtyBox.h - 8 - (unitText ? unitSize * ASCENT + 5 : 0);
  let numSize = Math.min(36, numRoom / ASCENT);
  const numW = (s: number) => m.bold(qtyText, s);
  if (numW(numSize) > qtyBox.w - 8) numSize = (numSize * (qtyBox.w - 8)) / numW(numSize);
  const blockH = numSize * ASCENT + (unitText ? 5 + unitSize * ASCENT : 0);
  const numBase = qtyBox.y + (qtyBox.h - blockH) / 2 + numSize * ASCENT;
  const qtyLines: TextLine[] = [{ text: qtyText, x: qtyBox.x + (qtyBox.w - numW(numSize)) / 2, y: numBase, size: numSize }];
  if (unitText) {
    const us = Math.min(unitSize, (unitSize * (qtyBox.w - 8)) / m.bold(unitText, unitSize));
    qtyLines.push({ text: unitText, x: qtyBox.x + (qtyBox.w - m.bold(unitText, us)) / 2, y: numBase + 5 + us * ASCENT, size: us });
  }

  // Product: the green band to the right edge, up to two lines, centered.
  const bandX = qtyBox.x + qtyBox.w + LAYOUT.bandGap;
  const band = { x: bandX, y: itemTop, w: W - PAD - bandX, h: LAYOUT.itemH };
  const p = fitLines(plain(l.product), LAYOUT.productMax, LAYOUT.productMin, band.w - 12, band.h - 8, 2, m.bold);
  const pBlock = (p.lines.length - 1) * p.size * 1.05 + p.size * ASCENT;
  const pFirst = band.y + (band.h - pBlock) / 2 + p.size * ASCENT;
  const productLines = p.lines.map((text, i) => ({ text, x: band.x + 6, y: pFirst + i * p.size * 1.05, size: p.size }));

  // Bottom left: the box count, in a red tag only when the order takes more than one box.
  let boxTag: Rect | null = null;
  let boxText: TextLine;
  if (l.boxCount > 1) {
    const t = `BOX ${l.boxNo} OF ${l.boxCount}`;
    boxTag = { x: PAD, y: tagTop, w: m.bold(t, 10) + 14, h: LAYOUT.tagH };
    boxText = { text: t, x: PAD + 7, y: midTag(10), size: 10 };
  } else boxText = { text: `Box ${l.boxNo} of ${l.boxCount}`, x: PAD, y: midTag(9), size: 9 };

  // Bottom right: the box type in an outlined tag.
  const type = plain(l.boxType).toUpperCase();
  const typeW = m.bold(type, 9) + 12;
  const typeTag = { x: W - PAD - typeW, y: tagTop, w: typeW, h: LAYOUT.tagH };
  const typeText = { text: type, x: typeTag.x + 6, y: midTag(9), size: 9 };

  // Middle: the label number, for the office only.
  const no = `label ${l.number}`;
  const noW = m.regular(no, 6.5);
  const labelNo = { text: no, x: (W - noW) / 2, y: midTag(6.5), size: 6.5, w: noW };

  return { dest, ruleY, qtyBox, qtyLines, band, productLines, boxTag, boxText, labelNo, typeTag, typeText };
}

/** A rounded rectangle as an SVG path from its top left corner (pdf-lib draws SVG paths y-down). */
function roundRect(w: number, h: number, r: number): string {
  const k = 0.5523 * r;
  return [
    `M ${r} 0 H ${w - r}`,
    `C ${w - r + k} 0 ${w} ${r - k} ${w} ${r}`,
    `V ${h - r}`,
    `C ${w} ${h - r + k} ${w - r + k} ${h} ${w - r} ${h}`,
    `H ${r}`,
    `C ${r - k} ${h} 0 ${h - r + k} 0 ${h - r}`,
    `V ${r}`,
    `C 0 ${r - k} ${r - k} 0 ${r} 0 Z`,
  ].join(" ");
}

const FOREST = rgb(0x3b / 255, 0x5e / 255, 0x27 / 255);
const BARN = rgb(0x7a / 255, 0x33 / 255, 0x27 / 255);

function drawLabel(page: PDFPage, box: ReturnType<typeof slotBox>, l: PrintLabel, f: { regular: PDFFont; bold: PDFFont }) {
  const m: Measure = { bold: (t, s) => f.bold.widthOfTextAtSize(t, s), regular: (t, s) => f.regular.widthOfTextAtSize(t, s) };
  const L = layoutLabel(l, m);
  // Layout is y-down from the label's top left; the page is y-up from the bottom left.
  const X = (x: number) => box.x + x;
  const Y = (y: number) => box.y + box.h - y;
  const black = rgb(0, 0, 0);
  const white = rgb(1, 1, 1);
  const text = (t: TextLine, font: PDFFont, color = black) => page.drawText(t.text, { x: X(t.x), y: Y(t.y), size: t.size, font, color });
  const rounded = (r: Rect, radius: number, opts: { color?: ReturnType<typeof rgb>; borderColor?: ReturnType<typeof rgb>; borderWidth?: number }) =>
    page.drawSvgPath(roundRect(r.w, r.h, radius), { x: X(r.x), y: Y(r.y), ...opts });

  for (const t of L.dest) text(t, f.bold);
  page.drawLine({ start: { x: X(PAD), y: Y(L.ruleY) }, end: { x: X(W - PAD), y: Y(L.ruleY) }, thickness: 0.6, color: black });

  rounded(L.qtyBox, LAYOUT.radius, { color: black });
  for (const t of L.qtyLines) text(t, f.bold, white);
  rounded(L.band, LAYOUT.radius, { color: FOREST });
  for (const t of L.productLines) text(t, f.bold, white);

  if (L.boxTag) {
    rounded(L.boxTag, LAYOUT.tagRadius, { color: BARN });
    text(L.boxText, f.bold, white);
  } else text(L.boxText, f.regular);
  text(L.labelNo, f.regular, rgb(0.45, 0.45, 0.45));
  rounded(L.typeTag, LAYOUT.tagRadius, { borderColor: black, borderWidth: 0.75 });
  text(L.typeText, f.bold);
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
