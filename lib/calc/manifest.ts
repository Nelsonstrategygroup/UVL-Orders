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
