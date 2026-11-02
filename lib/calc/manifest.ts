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

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Group a pallet's boxes by customer, rows by product, with totals. */
export function buildManifest(boxes: ManifestBox[]): Manifest {
  const by = new Map<string, ManifestBox[]>();
  for (const b of boxes) by.set(b.customer, [...(by.get(b.customer) ?? []), b]);
  const groups = [...by.entries()]
    .sort(([a], [b]) => byName(a, b))
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

// --- Grouped by product (Lucas, 11/2/26): one row per product per customer,
// every box ID with its own net weight, the product's total. The CSV stays
// one row per box (manifestTable above). ---

export type ProductRow = {
  product: string;
  /** The product's boxes, by box ID. */
  boxes: ManifestBox[];
  /** Net weight of the boxes that have one. */
  lb: number;
  /** Boxes with no weight. */
  missing: number;
};

/** A customer's boxes as one row per product, sorted by product name. */
export function productRows(rows: ManifestBox[]): ProductRow[] {
  const by = new Map<string, ManifestBox[]>();
  for (const r of rows) by.set(r.product, [...(by.get(r.product) ?? []), r]);
  return [...by.entries()]
    .sort(([a], [b]) => byName(a, b))
    .map(([product, list]) => {
      const boxes = [...list].sort((a, b) => byName(a.boxId, b.boxId));
      return { product, boxes, lb: round2(boxes.reduce((s, b) => s + (b.lb ?? 0), 0)), missing: boxes.filter((b) => b.lb == null).length };
    });
}

/** The lot when every box on the manifest shares one (printed once in the header); null when they differ or there's none. */
export function oneLot(m: Manifest): string | null {
  const lots = new Set(m.groups.flatMap((g) => g.rows.map((r) => r.lot.trim())));
  if (lots.size !== 1) return null;
  const [lot] = lots;
  return lot || null;
}

/** "2630610100 (40.90)"; with the lot in front when lots differ: "092426-2628720009 (10.00)"; "(MISSING)" with no weight. */
export function boxEntry(b: ManifestBox, withLot: boolean): string {
  const id = withLot && b.lot.trim() ? `${b.lot.trim()}-${b.boxId}` : b.boxId;
  return `${id} (${b.lb == null ? "MISSING" : b.lb.toFixed(2)})`;
}

/** A product's total: "62.00 lb", or "40.90 lb + 1 MISSING" when a box has no weight. */
export function productTotalText(r: ProductRow): string {
  return `${r.lb.toFixed(2)} lb${r.missing ? ` + ${r.missing} MISSING` : ""}`;
}

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
