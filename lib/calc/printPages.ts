// Laying a printout out in pages and columns ourselves (Weigh Sheet and
// Pallet Sheet, Lucas 11/1/26), instead of leaving it to the browser: every
// row has a fixed height, so the app knows which page each section lands on
// (for the index on page 1) and how many pages there are ("page 2 of 5").
// A section stays in one column unless it's taller than a whole column; then
// it carries on in the next column with its heading repeated.

/** A section: its heading's height and each row's height, in inches. */
export type Block = { head: number; rows: number[] };

/** Part of a section in one column: rows from..to (to not included), and whether it carries on from the column before. */
export type Piece = { block: number; from: number; to: number; cont: boolean };

export type Page = { cols: Piece[][] };

export type PageSize = {
  /** How tall a column is (inches), and on page 1 (less the index line). */
  colH: number;
  firstColH: number;
  cols: number;
};

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
// Rounding in the sums shouldn't push a section that exactly fits to the next column.
const FUDGE = 1e-6;

export function paginate(blocks: Block[], size: PageSize): Page[] {
  const pages: Page[] = [{ cols: [[]] }];
  let used = 0;
  const cap = () => (pages.length === 1 ? size.firstColH : size.colH);
  const col = () => {
    const p = pages[pages.length - 1];
    return p.cols[p.cols.length - 1];
  };
  const next = () => {
    const p = pages[pages.length - 1];
    if (p.cols.length < size.cols) p.cols.push([]);
    else pages.push({ cols: [[]] });
    used = 0;
  };

  blocks.forEach((b, i) => {
    const total = b.head + sum(b.rows);
    if (total <= cap() - used + FUDGE) {
      col().push({ block: i, from: 0, to: b.rows.length, cont: false });
      used += total;
      return;
    }
    // Fits in a column of its own: start the next one.
    if (total <= size.colH + FUDGE && col().length) {
      next();
      if (total <= cap() - used + FUDGE) {
        col().push({ block: i, from: 0, to: b.rows.length, cont: false });
        used += total;
        return;
      }
    }
    // Too tall for one column: row by row, the heading again in each column.
    let from = 0;
    let cont = false;
    if (col().length && cap() - used < b.head + (b.rows[0] ?? 0) - FUDGE) next();
    while (from < b.rows.length || (from === 0 && !b.rows.length)) {
      let h = b.head;
      let to = from;
      while (to < b.rows.length && h + b.rows[to] <= cap() - used + FUDGE) h += b.rows[to++];
      if (to === from && b.rows.length) to = from + 1; // a row taller than a column still prints
      col().push({ block: i, from, to, cont });
      used += h;
      from = to;
      cont = true;
      if (from < b.rows.length) next();
      if (!b.rows.length) break;
    }
  });
  // No empty last column or page.
  const last = pages[pages.length - 1];
  if (!last.cols[last.cols.length - 1].length && (last.cols.length > 1 || pages.length > 1)) {
    last.cols.pop();
    if (!last.cols.length) pages.pop();
  }
  return pages;
}

/** The page (1, 2, ...) each section starts on. */
export function blockPages(pages: Page[]): Map<number, number> {
  const out = new Map<number, number>();
  pages.forEach((p, i) => p.cols.forEach((c) => c.forEach((x) => !out.has(x.block) && out.set(x.block, i + 1))));
  return out;
}
