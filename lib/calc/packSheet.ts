// The packing sheet's weight blanks (change request 10/26/26). The paper copy
// is the backup for when the internet is down: one row per product per
// customer, one blank per box with that box's label number above it, so
// Chris writes each weight under the matching label, then Total lbs. The
// "Type in from paper" screen and the scan screen use the same rows, so the
// paper, the screen and the database agree on which box each weight is.
//
// Two different products never share a box (Kathy, 10/26/26), so a weight is
// one product's box.

import { num } from "./num";

/** A box row from the box label list (lib/calc/labels.ts), as the sheet needs it. */
export type SheetLabel = { key: string; boxNo: number; boxCount: number; noBox?: boolean; boxTypeId?: string | null };

/** A weight as the sheet needs it. */
export type SheetWeight = { id: string; weight: number; slot: number | null; label_no: number | null; client_id?: string | null; at?: string };

export type SheetBlank = {
  /** Its place in the row, 1, 2, 3... (packing_weights.slot). */
  slot: number;
  /** The box label number printed above it, or the one written in; null if none. */
  labelNo: number | null;
  /** A planned box: its label number is printed, not written in. */
  planned: boolean;
  /** The planned box type (spares take the last planned box's); null when not known. */
  boxTypeId: string | null;
  weight: SheetWeight | null;
};

export type SheetRow = {
  productId: string;
  /** The box count is known (the product has a box size and the boxes were worked out). */
  known: boolean;
  /** Planned boxes (0 when not known). */
  boxCount: number;
  blanks: SheetBlank[];
  total: number;
};

/** The box label key for a customer's product box: customer|product|box (lib/calc/labels.ts). */
export const boxKey = (customerId: string, productId: string, boxNo: number) => `${customerId}|${productId}|${boxNo}`;

/**
 * One row per product, in the order given. Known box count: one blank per
 * planned box (label number from `labelNumbers`), then `spare` blanks.
 * Unknown: the product's own number of blanks, or `unknown`. Weights go in
 * their own blank (slot), else the planned blank with their label number,
 * else the first empty one; blanks are added when there are more weights
 * than blanks, and `extra` adds empty ones ("Add a box").
 */
export function sheetRows(
  o: { customerId: string; productIds: string[]; weights: (SheetWeight & { product_id: string })[] },
  labels: SheetLabel[],
  labelNumbers: Map<string, number>,
  blanks: { unknown: number; spare: number; perProduct?: Map<string, number | null> },
  extra: Record<string, number> = {},
): SheetRow[] {
  return o.productIds.map((pid) => {
    const prefix = `${o.customerId}|${pid}|`;
    const mine = labels.filter((l) => l.key.startsWith(prefix)).sort((a, b) => a.boxNo - b.boxNo);
    const known = mine.length > 0 && !mine.some((l) => l.noBox);
    const row: SheetBlank[] = [];
    const spareType = known ? (mine[mine.length - 1].boxTypeId ?? null) : null;
    const empty = (planned = false, labelNo: number | null = null, boxTypeId: string | null = spareType): SheetBlank => ({
      slot: row.length + 1,
      labelNo,
      planned,
      boxTypeId,
      weight: null,
    });
    if (known) {
      for (const l of mine) row.push(empty(true, labelNumbers.get(l.key) ?? null, l.boxTypeId ?? null));
      for (let i = 0; i < blanks.spare; i++) row.push(empty());
    } else {
      const n = blanks.perProduct?.get(pid) ?? blanks.unknown;
      for (let i = 0; i < Math.max(1, n); i++) row.push(empty());
    }

    const weights = o.weights.filter((w) => w.product_id === pid).sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
    const put = (b: SheetBlank, w: SheetWeight) => {
      b.weight = w;
      if (!b.planned) b.labelNo = w.label_no;
    };
    const left: SheetWeight[] = [];
    // 1. Its own blank.
    for (const w of weights) {
      if (w.slot == null) {
        left.push(w);
        continue;
      }
      while (row.length < w.slot) row.push(empty());
      const b = row[w.slot - 1];
      if (b.weight) left.push(w);
      else put(b, w);
    }
    // 2. The planned box with its label number; 3. the first empty blank; 4. a new one.
    for (const w of left) {
      const b =
        (w.label_no != null ? row.find((x) => x.planned && !x.weight && x.labelNo === w.label_no) : undefined) ?? row.find((x) => !x.weight);
      if (b) put(b, w);
      else {
        const nb = empty();
        row.push(nb);
        put(nb, w);
      }
    }
    for (let i = 0; i < (extra[pid] ?? 0); i++) row.push(empty());

    return {
      productId: pid,
      known,
      boxCount: known ? mine.length : 0,
      blanks: row,
      total: Math.round(weights.reduce((s, w) => s + num(w.weight), 0) * 100) / 100,
    };
  });
}

/** Where the next weight for a row goes (a scan, or the weigh panel): the first empty blank, or a new one after the last. */
export function nextBlank(row: SheetRow): { slot: number; label_no: number | null } {
  const b = row.blanks.find((x) => !x.weight);
  if (b) return { slot: b.slot, label_no: b.planned ? b.labelNo : null };
  return { slot: row.blanks.length + 1, label_no: null };
}

/** "Box 2 of 3 · label 15", "Box 4 (spare)", "Box 7". */
export function blankWords(row: SheetRow, slot: number): string {
  const b = row.blanks[slot - 1];
  if (!b) return `Box ${slot}`;
  const label = b.labelNo != null ? ` · label ${b.labelNo}` : "";
  if (b.planned) return `Box ${slot} of ${row.boxCount}${label}`;
  if (row.known) return `Spare box${label}`;
  return `Box ${slot}${label}`;
}
