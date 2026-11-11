// The pallet shipping manifest (change request 10/26/26): every scanned box
// on a pallet, grouped by customer (a PCC store by its location, store number
// first so they sort), rows by product, with each group's and the pallet's
// box count and net weight. Only the recorded box weights are used: nothing
// is recalculated or estimated. A box with no weight shows MISSING. The
// manifest page, the Pallets page and Print and download all use this, and
// the CSV download is built from the same rows.

import type { Table } from "../reports";

export type ManifestBox = {
  id: string;
  customer: string;
  product: string;
  /** Mohawk's serial from the barcode, else the box label number. */
  boxId: string;
  lot: string;
  /** Net weight in lb as recorded; null when missing. */
  lb: number | null;
};

export type ManifestGroup = { customer: string; rows: ManifestBox[]; boxes: number; lb: number };

export type Manifest = { groups: ManifestGroup[]; boxes: number; lb: number; missing: number };

/** A recorded weight, or null when there isn't a usable one. */
export const netWeight = (w: number | null | undefined): number | null => (typeof w === "number" && Number.isFinite(w) && w > 0 ? w : null);

/** What's printed for a box's ID: the serial from its barcode, else its label number. */
export function boxIdOf(b: { serial: string | null; label_no: number | null; case_no?: string | null }): string {
  if (b.serial) return b.serial;
  if (b.label_no != null) return `Label ${b.label_no}`;
  if (b.case_no) return `Case ${b.case_no}`;
  return "";
}

/**
 * What the paperwork prints when a box has no ID at all: typed in with no
 * label number (Type in from paper). Said plainly so the column isn't blank
 * and the box doesn't look left out; how the box was entered is the app's
 * business, not the receiver's (Lucas, 11/10/26).
 */
export const NO_BOX_ID = "No label number";

/** A box's ID as printed: its serial, else its label number, else "No label number". */
export const boxIdShown = (b: Parameters<typeof boxIdOf>[0]): string => boxIdOf(b) || NO_BOX_ID;

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Customers in the week's order (the shared customer order: customers with
 * locations first; Lucas, 11/6/26), given as the names in that order. Names
 * not in the list ("Unassigned") go last, by name.
 */
export function byCustomerOrder(order: string[] = []): (a: string, b: string) => number {
  const at = new Map<string, number>();
  order.forEach((n, i) => at.has(n) || at.set(n, i));
  return (a, b) => (at.get(a) ?? 1e9) - (at.get(b) ?? 1e9) || byName(a, b);
}

/** Group a pallet's boxes by customer (in `order`, the week's customer order), rows by product, with totals. */
export function buildManifest(boxes: ManifestBox[], order?: string[]): Manifest {
  const byCustomer = byCustomerOrder(order);
  const by = new Map<string, ManifestBox[]>();
  for (const b of boxes) by.set(b.customer, [...(by.get(b.customer) ?? []), b]);
  const groups = [...by.entries()]
    .sort(([a], [b]) => byCustomer(a, b))
    .map(([customer, list]) => {
      const rows = [...list].sort((a, b) => byName(a.product, b.product) || byName(a.boxId, b.boxId));
      return { customer, rows, boxes: rows.length, lb: round2(rows.reduce((s, r) => s + (r.lb ?? 0), 0)) };
    });
  return {
    groups,
    boxes: boxes.length,
    lb: round2(groups.reduce((s, g) => s + g.lb, 0)),
    missing: boxes.filter((b) => b.lb == null).length,
  };
}

/** "22.40 lb", or "MISSING". */
export const lbText = (lb: number | null) => (lb == null ? "MISSING" : `${lb.toFixed(2)} lb`);

export const MANIFEST_COLUMNS = ["Pallet", "Customer", "Box ID", "Lot", "Product", "Net weight (lb)"];

/** The CSV rows: one per box, for invoicing later. A missing weight is left blank. */
export function manifestTable(pallets: { tag: string; manifest: Manifest }[]): Table {
  return {
    header: MANIFEST_COLUMNS,
    rows: pallets.flatMap(({ tag, manifest }) =>
      manifest.groups.flatMap((g) => g.rows.map((r) => [tag, g.customer, r.boxId, r.lot, r.product, r.lb == null ? "" : round2(r.lb)])),
    ),
  };
}

// --- Box IDs used twice in a week (Lucas, 11/2/26) ---

export type DuplicateBox = { boxId: string; where: string[] };

/**
 * Box IDs that appear more than once in the week (Lucas, 11/2/26), and where
 * each one is ("PCC #13 Edmonds · Racks · P2"). Boxes with no ID are skipped.
 */
export function duplicateBoxIds(boxes: { boxId: string; where: string }[]): DuplicateBox[] {
  const by = new Map<string, string[]>();
  for (const b of boxes) {
    const id = b.boxId.trim();
    if (!id) continue;
    by.set(id, [...(by.get(id) ?? []), b.where]);
  }
  return [...by.entries()]
    .filter(([, where]) => where.length > 1)
    .sort(([a], [b]) => byName(a, b))
    .map(([boxId, where]) => ({ boxId, where }));
}
