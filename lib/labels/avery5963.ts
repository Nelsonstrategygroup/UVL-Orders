// Box labels on Avery 5963 sheets (change request 10/23/26): 4" x 2", ten
// per US Letter sheet, 2 columns x 5 rows. The PDF is drawn here, at exact
// sizes, so browser scaling can't shift it (print at Actual size / 100%).
// Positions are numbered 1 to 10, left to right, top to bottom.

import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { invLabel } from "@/lib/weekInv";

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
  /** Packed together (Hearts, Livers, Kidneys): a blank for each, counts written in at Mohawk. */
  writeIn?: { name: string; ordered: string }[];
  /** The week's invoice number ("3001"), top right on every label; a blank to write in when the week has none. */
  inv?: string | null;
  /** The store's planned pallet (Pallets > Plan pallets), top left: "P3"; blank prints "P___" to write in. */
  pallet?: string | null;
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
  /** Black box with the quantity (and its unit underneath, smaller); none on a write-in label. */
  qtyBox: Rect | null;
  qtyLines: TextLine[];
  /** Green band with the product name, one or two lines; none on a write-in label. */
  band: Rect | null;
  productLines: TextLine[];
  /** Write-in label: on the green band, each organ's name in white, a white box under it to write the count in, what was ordered under that. */
  writeBoxes: Rect[];
  writeText: TextLine[];
  orderedText: TextLine[];
  /** Lines to write on: "Box ___ of ___" on a write-in label. */
  blanks: { x: number; y: number; w: number }[];
  /** "BOX 2 OF 3" in a red tag when there's more than one box; plain "Box 1 of 1" otherwise; "Box ___ of ___" on a write-in label. */
  boxTag: Rect | null;
  boxText: TextLine;
  boxMore: TextLine[];
  /** "label 14", small and gray, in the middle. */
  labelNo: TextLine & { w: number };
  /** "INV# 3001" (or "INV# ______" to write in), bold, on its own in the top right corner (Lucas, 10/31/26). */
  inv: TextLine & { w: number };
  /** The store's planned pallet ("P3", or "P___" to write in), bold, top left, the same size (Lucas, 11/6/26). */
  pallet: TextLine & { w: number };
  /** The box type in an outlined tag on the right; left off when the box type isn't known ("?"). */
  typeTag: Rect | null;
  typeText: TextLine | null;
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
  /** The INV# in the top right corner: bold, readable at arm's length. */
  invSize: 12,
  /** Write-in label: a taller green band, names up to 18 pt, white write-in boxes up to 1.2 in wide. */
  writeH: 0.9 * IN,
  writeMax: 18,
  writeMin: 10,
  writeBoxMaxW: 1.2 * IN,
  boxBlankW: 0.3 * IN,
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

  // Item: the quantity box and the product band, above the bottom line (taller on a write-in label).
  const itemTop = tagTop - 4 - (l.writeIn?.length ? LAYOUT.writeH : LAYOUT.itemH);
  const ruleY = itemTop - 4;

  // Top right: the week's invoice number, on its own line, inside the padding.
  const invText = plain(invLabel(l.inv));
  const invSize = LAYOUT.invSize;
  const invW = m.bold(invText, invSize);
  const inv = { text: invText, x: W - PAD - invW, y: PAD + invSize * ASCENT, size: invSize, w: invW };
  const invBottom = inv.y + DESCENT * invSize;
  // Top left, mirroring it: the store's planned pallet ("P3"), or "P___" to write in (Lucas, 11/6/26).
  const palletText = plain(l.pallet?.trim() || "P___");
  const palletW = m.bold(palletText, invSize);
  const pallet = { text: palletText, x: PAD, y: inv.y, size: invSize, w: palletW };

  // Destination: "PCC #10 Issaquah", wrapped to two lines before shrinking, sitting just above the rule.
  const destText = plain([l.name, l.location].filter((x) => x.trim()).join(" "));
  const destRoom = ruleY - 3 - PAD;
  const place = (width: number) => {
    const d = fitLines(destText, LAYOUT.destMax, LAYOUT.destMin, width, destRoom, 2, m.bold);
    const lastBase = ruleY - 3 - DESCENT * d.size;
    return d.lines.map((text, i) => ({ text, x: PAD, y: lastBase - (d.lines.length - 1 - i) * d.size * 1.05, size: d.size }));
  };
  let dest = place(inner);
  // The pallet sits top left, where the name starts: a name reaching up into the top line fits below it instead.
  const clash = dest.some((t) => t.y - t.size * ASCENT < invBottom + 2);
  if (clash) {
    const room = ruleY - 3 - (invBottom + 2);
    const d = fitLines(destText, LAYOUT.destMax, LAYOUT.destMin, inner, room, 2, m.bold);
    const lastBase = ruleY - 3 - DESCENT * d.size;
    dest = d.lines.map((text, i) => ({ text, x: PAD, y: lastBase - (d.lines.length - 1 - i) * d.size * 1.05, size: d.size }));
  }

  const no = `label ${l.number}`;
  const noW = m.regular(no, 6.5);
  const labelNo = { text: no, x: (W - noW) / 2, y: midTag(6.5), size: 6.5, w: noW };

  if (l.writeIn?.length) return { dest, ruleY, labelNo, inv, pallet, ...writeInLayout(l.writeIn, itemTop, midTag, inner, m) };

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
  // A label never shows a question mark: with no box size worked out, the tag is left off (Lucas, 10/24/26).
  const known = type !== "" && type !== "?";
  const typeTag = known ? { x: W - PAD - typeW, y: tagTop, w: typeW, h: LAYOUT.tagH } : null;
  const typeText = typeTag ? { text: type, x: typeTag.x + 6, y: midTag(9), size: 9 } : null;

  // Middle: the label number, for the office only (worked out above).
  return { dest, ruleY, qtyBox, qtyLines, band, productLines, writeBoxes: [], writeText: [], orderedText: [], blanks: [], boxTag, boxText, boxMore: [], labelNo, inv, pallet, typeTag, typeText };
}

/**
 * The write-in label (Hearts, Livers, Kidneys; Lucas, 10/31/26): in place of
 * the quantity and product, a taller green band with a column for each one
 * ordered: its name in big white letters, a white box under it to write the
 * count in with a marker, and "ordered: 4 pk" small under that. "Box ___ of
 * ___" at the bottom; no box type.
 */
function writeInLayout(
  items: { name: string; ordered: string }[],
  itemTop: number,
  midTag: (size: number) => number,
  inner: number,
  m: Measure,
) {
  const band = { x: PAD, y: itemTop, w: inner, h: LAYOUT.writeH };
  const pad = 6;
  const colGap = 6;
  const n = items.length;
  const colW = (band.w - 2 * pad - (n - 1) * colGap) / n;
  const names = items.map((i) => plain(i.name));
  // One size for every name: the biggest that fits the widest in its column.
  let size: number = LAYOUT.writeMax;
  while (size > LAYOUT.writeMin && Math.max(...names.map((t) => m.bold(t, size))) > colW - 4) size -= 0.5;
  const nameBase = band.y + 5 + size * ASCENT;
  const oSize = 7.5;
  const boxTop = nameBase + 4;
  const boxH = band.y + band.h - 4 - oSize * ASCENT - 3 - boxTop;
  const boxW = Math.min(colW, LAYOUT.writeBoxMaxW);
  const writeBoxes: Rect[] = [];
  const writeText: TextLine[] = [];
  const orderedText: TextLine[] = [];
  names.forEach((t, i) => {
    const cx = band.x + pad + i * (colW + colGap) + colW / 2;
    writeText.push({ text: t, x: cx - m.bold(t, size) / 2, y: nameBase, size });
    writeBoxes.push({ x: cx - boxW / 2, y: boxTop, w: boxW, h: boxH });
    const o = plain(`ordered: ${items[i].ordered}`);
    orderedText.push({ text: o, x: cx - m.regular(o, oSize) / 2, y: boxTop + boxH + 3 + oSize * ASCENT, size: oSize });
  });
  // "Box ___ of ___" on the bottom line.
  const s = 9;
  const y = midTag(s);
  const boxText = { text: "Box", x: PAD, y, size: s };
  let bx = PAD + m.regular("Box ", s);
  const blanks = [{ x: bx, y: y + 1, w: LAYOUT.boxBlankW }];
  bx += LAYOUT.boxBlankW;
  const of = { text: "of", x: bx + m.regular(" ", s), y, size: s };
  bx += m.regular(" of ", s);
  blanks.push({ x: bx, y: y + 1, w: LAYOUT.boxBlankW });
  return {
    qtyBox: null,
    qtyLines: [],
    band,
    productLines: [],
    writeBoxes,
    writeText,
    orderedText,
    blanks,
    boxTag: null,
    boxText,
    boxMore: [of],
    typeTag: null,
    typeText: null,
  };
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
const PALE = rgb(0xe4 / 255, 0xee / 255, 0xdc / 255);
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

  if (L.qtyBox) rounded(L.qtyBox, LAYOUT.radius, { color: black });
  for (const t of L.qtyLines) text(t, f.bold, white);
  if (L.band) rounded(L.band, LAYOUT.radius, { color: FOREST });
  for (const t of L.productLines) text(t, f.bold, white);
  // Write-in label: white boxes to write in on the green band, the names in white, what was ordered in pale green.
  for (const r of L.writeBoxes) rounded(r, LAYOUT.tagRadius, { color: white });
  for (const t of L.writeText) text(t, f.bold, white);
  for (const t of L.orderedText) text(t, f.regular, PALE);
  for (const b of L.blanks) page.drawLine({ start: { x: X(b.x), y: Y(b.y) }, end: { x: X(b.x + b.w), y: Y(b.y) }, thickness: 1, color: black });
  for (const t of L.boxMore) text(t, f.regular);

  if (L.boxTag) {
    rounded(L.boxTag, LAYOUT.tagRadius, { color: BARN });
    text(L.boxText, f.bold, white);
  } else text(L.boxText, f.regular);
  text(L.labelNo, f.regular, rgb(0.45, 0.45, 0.45));
  text(L.inv, f.bold);
  text(L.pallet, f.bold);
  if (L.typeTag && L.typeText) {
    rounded(L.typeTag, LAYOUT.tagRadius, { borderColor: black, borderWidth: 0.75 });
    text(L.typeText, f.bold);
  }
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
