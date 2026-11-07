// The pallet paperwork (Lucas, 11/2/26): cross dock sheets, pallet labels and
// the per-customer manifests. All three are built from the same scanned box
// records (packing_weights), so their counts and weights always agree;
// nothing is recalculated, estimated or stored separately. A pallet takes the
// distributor its customers ship through (Setup > Ships to); pallets are
// numbered within their distributor and ship date ("Plymouth 1 of 3").

import { byCustomerOrder } from "./manifest";

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
  /** 1, 2, 3 within the distributor and ship date, and how many. */
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
 * Pallets by distributor and ship date, numbered within each by their tag
 * (P1, P2, P3 -> Plymouth 1, 2, 3), and the pallets that can't go on a sheet
 * (no distributor, or mixed) with the reason.
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
  const groups = [...by.entries()].map(([key, list]) => {
    const [pointId, date] = key.split("|");
    const point = points.get(pointId)!;
    const sorted = [...list].sort((a, b) => byName(a.tag, b.tag));
    const rows = sorted.map((pallet, i) => ({
      pallet,
      n: i + 1,
      of: sorted.length,
      name: `${point.shortName} ${i + 1}`,
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

export type ManifestRow =
  | { kind: "box"; box: PwBox }
  /** Under a product with 2 or more boxes: "Le Trim · 2 boxes · 61.90 lb". */
  | { kind: "sub"; product: string; boxes: number; lb: number; missing: number };

export type CustomerManifest = {
  customer: string;
  customerId: string | null;
  rows: ManifestRow[];
  boxes: number;
  lb: number;
  missing: number;
};

/**
 * A pallet's boxes, one customer each (in `order`, the week's customer
 * order), a row per box by product then box ID, a subtotal under any product
 * with 2 or more boxes.
 */
export function customerManifests(boxes: PwBox[], order?: string[]): CustomerManifest[] {
  const byCustomer = byCustomerOrder(order);
  const by = new Map<string, PwBox[]>();
  for (const b of boxes) by.set(b.customer, [...(by.get(b.customer) ?? []), b]);
  return [...by.entries()]
    .sort(([a], [b]) => byCustomer(a, b))
    .map(([customer, list]) => {
      const sorted = [...list].sort((a, b) => byName(a.product, b.product) || byName(a.boxId, b.boxId));
      const rows: ManifestRow[] = [];
      for (let i = 0; i < sorted.length; ) {
        const product = sorted[i].product;
        let j = i;
        while (j < sorted.length && sorted[j].product === product) j++;
        const same = sorted.slice(i, j);
        for (const box of same) rows.push({ kind: "box", box });
        if (same.length > 1) rows.push({ kind: "sub", product, boxes: same.length, lb: boxesLb(same), missing: same.filter((x) => x.lb == null).length });
        i += same.length;
      }
      return { customer, customerId: sorted[0]?.customerId ?? null, rows, boxes: sorted.length, lb: boxesLb(sorted), missing: sorted.filter((x) => x.lb == null).length };
    });
}

/**
 * A customer's rows split into printed pages: up to `perPage` rows a page,
 * and the last page leaves room for the total, signature and footer
 * (`lastPage` rows). A product's subtotal stays with its last box.
 */
export function manifestPages(rows: ManifestRow[], perPage: number, lastPage: number): ManifestRow[][] {
  if (rows.length <= lastPage) return [rows];
  const pages: ManifestRow[][] = [];
  let i = 0;
  while (rows.length - i > lastPage) {
    let end = Math.min(i + perPage, rows.length);
    // Don't start the next page with a subtotal: keep it with its boxes.
    if (rows[end]?.kind === "sub") end -= 1;
    // What's left must fit the last page; if this page would leave too much, it's simply full.
    pages.push(rows.slice(i, end));
    i = end;
  }
  pages.push(rows.slice(i));
  return pages;
}
