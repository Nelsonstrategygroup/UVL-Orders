// The pallet paperwork (Lucas, 11/2/26): cross dock sheets, pallet labels and
// the per-customer manifests. All three are built from the same scanned box
// records (packing_weights), so their counts and weights always agree;
// nothing is recalculated, estimated or stored separately. A pallet takes the
// distributor its customers ship through (Setup > Ships to); pallets are
// numbered within their distributor for the week ("Plymouth 2 of 3"),
// whichever of them are being printed (Lucas, 11/10/26).

import { byCustomerOrder, NO_BOX_ID } from "./manifest";

/** One box on a pallet, as the paperwork needs it. */
export type PwBox = {
  id: string;
  /** Null for an unassigned box (no store yet). */
  customerId: string | null;
  /** As on the box label: "PCC #10 Issaquah". */
  customer: string;
  /** The chain or business ("PCC") and the location ("#10 Issaquah", or ""). */
  labelName: string;
  labelLocation: string;
  /** The distributor the customer ships through; null: none set (Direct). */
  pointId: string | null;
  product: string;
  /** The serial from the barcode, else the label number. */
  boxId: string;
  lot: string;
  /** Net weight as recorded; null when missing. */
  lb: number | null;
  /** When it was packed (for "in the order packed"). */
  at: string;
};

export type PwPallet = {
  id: string;
  /** What Chris wrote on it, the app's pallet number ("P1"). */
  tag: string;
  shipDate: string | null;
  boxes: PwBox[];
  /** Stores planned onto it with no box yet: they count for its distributor too. */
  planned: { customer: string; pointId: string | null }[];
};

export type PwDistributor = { id: string; name: string; shortName: string; code: string; carrier: string; crossDock: string; color: string };

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "2,770.05 lb". */
export const lbWords = (lb: number) => `${lb.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} lb`;

/** Net weight of the boxes that have one. */
export const boxesLb = (boxes: { lb: number | null }[]) => round2(boxes.reduce((s, b) => s + (b.lb ?? 0), 0));

/**
 * The customers on a pallet in one line: PCC stores by number ("PCC #10,
 * 14, 19"), everyone else by name. Stores on the pallet, by box or planned.
 */
export function customersLine(p: Pick<PwPallet, "boxes" | "planned">): string {
  const seen = new Map<string, { name: string; loc: string; customer: string }>();
  for (const b of p.boxes) if (b.customerId) seen.set(b.customer, { name: b.labelName, loc: b.labelLocation, customer: b.customer });
  const numbered = new Map<string, string[]>();
  const others: string[] = [];
  for (const { name, loc, customer } of seen.values()) {
    const m = loc.match(/^#\s*(\d+)/);
    if (m) numbered.set(name, [...(numbered.get(name) ?? []), m[1]]);
    else others.push(customer);
  }
  for (const pl of p.planned) if (![...seen.values()].some((x) => x.customer === pl.customer)) others.push(pl.customer);
  const chains = [...numbered.entries()]
    .sort(([a], [b]) => byName(a, b))
    .map(([name, nums]) => `${name} #${[...new Set(nums)].sort((a, b) => Number(a) - Number(b)).join(", ")}`);
  return [...chains, ...[...new Set(others)].sort(byName)].join(", ");
}

/** A pallet's distributor, or why it hasn't one: customers with none set, or more than one distributor. */
export type PalletPoint = { pointId: string | null; noPoint: string[]; mixed: string[] };

export function palletPoint(p: Pick<PwPallet, "boxes" | "planned">): PalletPoint {
  const points = new Set<string>();
  const noPoint = new Set<string>();
  for (const b of p.boxes) {
    if (!b.customerId) continue; // an unassigned box has no store yet
    if (b.pointId) points.add(b.pointId);
    else noPoint.add(b.customer);
  }
  for (const pl of p.planned) {
    if (pl.pointId) points.add(pl.pointId);
    else noPoint.add(pl.customer);
  }
  const list = [...points];
  return { pointId: list.length === 1 && !noPoint.size ? list[0] : null, noPoint: [...noPoint].sort(byName), mixed: list.length > 1 ? list : [] };
}

/** What's wrong with a pallet's distributor, in words; null when it has exactly one. */
export function palletPointProblem(pp: PalletPoint, names: Map<string, string>): string | null {
  if (pp.mixed.length) return `This pallet mixes distributors (${pp.mixed.map((id) => names.get(id) ?? "a distributor").join(" and ")}).`;
  if (pp.noPoint.length)
    return `${pp.noPoint.join(", ")} ${pp.noPoint.length === 1 ? "needs" : "need"} a distributor in Setup > Ships to.`;
  if (!pp.pointId) return "No boxes or stores on this pallet yet.";
  return null;
}

export type CrossDockPallet = {
  pallet: PwPallet;
  /** 1, 2, 3 among all the distributor's pallets that week (by tag), and how many there are. */
  n: number;
  of: number;
  /** "Plymouth 1". */
  name: string;
  cases: number;
  lb: number;
  missing: number;
  customers: string;
};

export type CrossDockGroup = {
  point: PwDistributor;
  shipDate: string | null;
  pallets: CrossDockPallet[];
  cases: number;
  lb: number;
  missing: number;
};

/**
 * Pallets by distributor and ship date (one cross dock sheet each), and the
 * pallets that can't go on a sheet (no distributor, or mixed) with the
 * reason. A pallet's number counts every pallet going to that distributor
 * that week, by tag (P1, P2, P3 -> Plymouth 1, 2, 3 of 3), so it's the same
 * on every sheet, label and manifest, whichever pallets are printed and
 * whatever day each ships (Lucas, 11/10/26: P2 printed alone said "1 of 1").
 * Give every pallet of the week; choose which to print afterwards.
 */
export function crossDockGroups(
  pallets: PwPallet[],
  points: Map<string, PwDistributor>,
): { groups: CrossDockGroup[]; blocked: { pallet: PwPallet; problem: string }[] } {
  const names = new Map([...points.values()].map((d) => [d.id, d.name]));
  const by = new Map<string, PwPallet[]>();
  const blocked: { pallet: PwPallet; problem: string }[] = [];
  for (const p of pallets) {
    const pp = palletPoint(p);
    const problem = palletPointProblem(pp, names);
    if (problem || !pp.pointId || !points.has(pp.pointId)) {
      if (p.boxes.length || p.planned.length) blocked.push({ pallet: p, problem: problem ?? "Its distributor isn't set up." });
      continue;
    }
    const key = `${pp.pointId}|${p.shipDate ?? ""}`;
    by.set(key, [...(by.get(key) ?? []), p]);
  }
  // Each distributor's pallets for the whole week, in tag order: a pallet's place in that list is its number.
  const week = new Map<string, PwPallet[]>();
  for (const [key, list] of by) {
    const pointId = key.split("|")[0];
    week.set(pointId, [...(week.get(pointId) ?? []), ...list]);
  }
  for (const [pointId, list] of week) week.set(pointId, list.sort((a, b) => byName(a.tag, b.tag)));
  const groups = [...by.entries()].map(([key, list]) => {
    const [pointId, date] = key.split("|");
    const point = points.get(pointId)!;
    const all = week.get(pointId)!;
    const sorted = [...list].sort((a, b) => byName(a.tag, b.tag));
    const rows = sorted.map((pallet) => ({
      pallet,
      n: all.indexOf(pallet) + 1,
      of: all.length,
      name: `${point.shortName} ${all.indexOf(pallet) + 1}`,
      cases: pallet.boxes.length,
      lb: boxesLb(pallet.boxes),
      missing: pallet.boxes.filter((b) => b.lb == null).length,
      customers: customersLine(pallet),
    }));
    return {
      point,
      shipDate: date || null,
      pallets: rows,
      cases: rows.reduce((s, r) => s + r.cases, 0),
      lb: round2(rows.reduce((s, r) => s + r.lb, 0)),
      missing: rows.reduce((s, r) => s + r.missing, 0),
    };
  });
  groups.sort((a, b) => (a.shipDate ?? "9999").localeCompare(b.shipDate ?? "9999") || byName(a.point.name, b.point.name));
  return { groups, blocked };
}

// --- The manifest, one customer per page ---

/** Box entries on one line of a manifest row; more wrap to the next line. */
export const BOX_ENTRIES_PER_LINE = 3;
/** About how many characters of product name fit on one line of its column. */
const PRODUCT_CHARS_PER_LINE = 20;

/** One box on a product row: "010167 - 42.30", with its lot only when the row needs it. */
export type ManifestBoxEntry = { id: string; text: string; lot: string };

/** One product on a customer's page, with every box of it. */
export type ManifestProductRow = {
  product: string;
  boxes: number;
  entries: ManifestBoxEntry[];
  /** The product's total; null when none of its boxes has a weight. */
  lb: number | null;
  /** The lot, when it belongs on this row (not in the header, and the same on all its boxes). */
  lot: string;
};

export type CustomerManifest = {
  customer: string;
  customerId: string | null;
  rows: ManifestProductRow[];
  /** The lot for the header, when every box has this same one; else "". */
  lot: string;
  boxes: number;
  lb: number;
  missing: number;
};

/** The last 6 digits of a scanned box ID. "Label 38" and "No label number" stay whole. */
export function shortBoxId(boxId: string): string {
  const id = boxId.trim();
  if (!id) return NO_BOX_ID;
  return /^\d{7,}$/.test(id) ? id.slice(-6) : id;
}

/** "010167 - 42.30", or only the ID when the box has no weight. */
export const boxEntryText = (b: Pick<PwBox, "boxId" | "lb">): string =>
  b.lb == null ? shortBoxId(b.boxId) : `${shortBoxId(b.boxId)} - ${b.lb.toFixed(2)}`;

/** The one lot all these boxes share; "" if they differ or any has none. */
function sharedLot(boxes: PwBox[]): string {
  const lots = new Set(boxes.map((b) => b.lot.trim()));
  return lots.size === 1 ? [...lots][0] : "";
}

/**
 * A pallet's boxes, one customer each (in `order`, the week's customer
 * order), one row per product with its boxes by box ID (Raven, 11/17/26).
 * One lot for the whole customer goes in the header. Otherwise a product's
 * shared lot goes on its row, and a product with mixed lots shows each box's.
 */
export function customerManifests(boxes: PwBox[], order?: string[]): CustomerManifest[] {
  const byCustomer = byCustomerOrder(order);
  const by = new Map<string, PwBox[]>();
  for (const b of boxes) by.set(b.customer, [...(by.get(b.customer) ?? []), b]);
  return [...by.entries()]
    .sort(([a], [b]) => byCustomer(a, b))
    .map(([customer, list]) => {
      const sorted = [...list].sort((a, b) => byName(a.product, b.product) || byName(a.boxId, b.boxId));
      const headerLot = sharedLot(sorted);
      const byProduct = new Map<string, PwBox[]>();
      for (const b of sorted) byProduct.set(b.product, [...(byProduct.get(b.product) ?? []), b]);
      const rows = [...byProduct.entries()].map(([product, same]): ManifestProductRow => {
        const rowLot = headerLot ? "" : sharedLot(same);
        const lotOnEntries = !headerLot && !rowLot;
        return {
          product,
          boxes: same.length,
          entries: same.map((b) => ({ id: b.id, text: boxEntryText(b), lot: lotOnEntries ? b.lot.trim() : "" })),
          lb: same.some((b) => b.lb != null) ? boxesLb(same) : null,
          lot: rowLot,
        };
      });
      return { customer, customerId: sorted[0]?.customerId ?? null, rows, lot: headerLot, boxes: sorted.length, lb: boxesLb(sorted), missing: sorted.filter((x) => x.lb == null).length };
    });
}

/** How many printed lines a product row takes: its box entries, or a long product name. */
export function manifestRowLines(row: Pick<ManifestProductRow, "product" | "entries" | "lot">): number {
  const name = row.product.length + (row.lot ? ` · Lot ${row.lot}`.length : 0);
  return Math.max(1, Math.ceil(row.entries.length / BOX_ENTRIES_PER_LINE), Math.ceil(name / PRODUCT_CHARS_PER_LINE));
}

/**
 * A customer's rows split into printed pages: up to `perPage` lines a page,
 * and the last page leaves room for the total, signature and footer
 * (`lastPage` lines). A row is never split.
 */
export function manifestPages(rows: ManifestProductRow[], perPage: number, lastPage: number): ManifestProductRow[][] {
  const linesFrom = (start: number) => rows.slice(start).reduce((s, r) => s + manifestRowLines(r), 0);
  if (linesFrom(0) <= lastPage) return [rows];
  const pages: ManifestProductRow[][] = [];
  let i = 0;
  while (linesFrom(i) > lastPage) {
    let end = i;
    let used = 0;
    while (end < rows.length) {
      const lines = manifestRowLines(rows[end]);
      // A row taller than a whole page still gets a page of its own.
      if (end > i && used + lines > perPage) break;
      used += lines;
      end++;
    }
    pages.push(rows.slice(i, end));
    i = end;
  }
  pages.push(rows.slice(i));
  return pages;
}

/** A box as the warnings name it: "PCC #12 Redmond, Front Shanks (Label 38)". */
function boxRef(b: Pick<PwBox, "customer" | "product" | "boxId">): string {
  return `${b.customer}, ${b.product}${b.boxId && b.boxId !== NO_BOX_ID ? ` (${b.boxId})` : ""}`;
}

/** At most this many boxes are named in one warning; the rest are counted. */
const NAMED = 6;

function named(list: string[]): string {
  return list.length > NAMED ? `${list.slice(0, NAMED).join("; ")}; and ${list.length - NAMED} more` : list.join("; ");
}

/**
 * Before any pallet paperwork prints (Lucas, 11/10/26): every box of the
 * week on no pallet, by customer and product, since it isn't on any
 * manifest.
 */
export function looseBoxWarnings(boxes: (Pick<PwBox, "customer" | "product" | "boxId"> & { palletId: string | null })[]): string[] {
  const loose = boxes.filter((b) => !b.palletId);
  if (!loose.length) return [];
  const n = loose.length;
  return [
    `${n} box${n === 1 ? " is" : "es are"} on no pallet, so not on any manifest: ${named(loose.map(boxRef))}. Put ${n === 1 ? "it" : "them"} on a pallet on the Pallets page.`,
  ];
}

/** A pallet as the count check needs it: the stores planned onto it (Plan pallets). */
export type PalletStores = { id: string; tag: string; customers: string[] };

/**
 * Each pallet's boxes against its stores (Lucas, 11/10/26): the boxes packed
 * for the stores planned onto it, and the boxes on its manifest. When they
 * differ, says which boxes and where they are. A pallet with no stores
 * planned onto it isn't checked.
 */
export function palletCountWarnings(
  boxes: (Pick<PwBox, "customerId" | "customer" | "product" | "boxId"> & { palletId: string | null })[],
  pallets: PalletStores[],
  allPallets: { id: string; tag: string }[] = pallets,
): string[] {
  const tagOf = new Map(allPallets.map((p) => [p.id, p.tag]));
  const out: string[] = [];
  for (const p of pallets) {
    if (!p.customers.length) continue;
    const stores = new Set(p.customers);
    const forStores = boxes.filter((b) => b.customerId && stores.has(b.customerId));
    const onIt = boxes.filter((b) => b.palletId === p.id);
    const elsewhere = forStores.filter((b) => b.palletId !== p.id);
    const others = onIt.filter((b) => !(b.customerId && stores.has(b.customerId)));
    if (!elsewhere.length && !others.length) continue;
    const parts = [`${p.tag}: ${forStores.length} box${forStores.length === 1 ? "" : "es"} packed for its stores, ${onIt.length} on its manifest.`];
    if (elsewhere.length)
      parts.push(`Not on ${p.tag}: ${named(elsewhere.map((b) => `${boxRef(b)}, ${b.palletId ? `on ${tagOf.get(b.palletId) ?? "another pallet"}` : "on no pallet"}`))}.`);
    if (others.length) parts.push(`On ${p.tag} but not one of its stores: ${named(others.map(boxRef))}.`);
    out.push(parts.join(" "));
  }
  return out;
}
