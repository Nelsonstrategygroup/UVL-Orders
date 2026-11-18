// Scans the server refused because their label was already used (Lucas,
// 11/17/26). A refused box is not saved anywhere, so it stays listed at the top
// of Packing and Scan boxes until someone with Orders access marks it dealt with.

export type DuplicateScanRow = {
  id: string;
  message: string;
  order_id: string | null;
  product_id: string | null;
  gtin: string | null;
  serial: string | null;
  created_at: string;
  /** The upload as the phone sent it. */
  details: Record<string, unknown> | null;
};

export type NotSavedScan = {
  key: string;
  /** Every refused try of this label; marked dealt with together. */
  ids: string[];
  productId: string | null;
  weight: number | null;
  lot: string | null;
  caseNo: string | null;
  serial: string | null;
  /** Who the label is already recorded for. */
  usedFor: string | null;
  /** The store chosen on the latest try that chose one. */
  triedFor: string | null;
};

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

type RecordedBox = { gtin: string | null; serial: string | null };

/** This week's refused scans, one per label, oldest first. A label now on one of this week's boxes is no longer missing. */
export function notSavedScans(
  rows: DuplicateScanRow[],
  week: string,
  orders: { id: string; labelCustomer: string; weights?: RecordedBox[] }[],
  unassigned: RecordedBox[] = [],
): NotSavedScan[] {
  const names = new Map(orders.map((o) => [o.id, o.labelCustomer]));
  const recorded = new Set([...orders.flatMap((o) => o.weights ?? []), ...unassigned].map((w) => `${w.gtin ?? ""}:${w.serial ?? ""}`));
  const by = new Map<string, NotSavedScan>();
  for (const r of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const d = r.details ?? {};
    const orderId = r.order_id ?? text(d.order_id);
    if (!(orderId && names.has(orderId)) && text(d.week_id) !== week) continue;
    const key = `${r.gtin ?? ""}:${r.serial ?? r.id}`;
    if (recorded.has(key)) continue;
    const s = by.get(key) ?? {
      key,
      ids: [],
      productId: r.product_id ?? text(d.product_id),
      weight: Number.isFinite(Number(d.weight)) && d.weight != null ? Number(d.weight) : null,
      lot: text(d.lot),
      caseNo: text(d.case_no),
      serial: r.serial,
      usedFor: r.message.match(/already recorded for (.+)\.$/)?.[1] ?? null,
      triedFor: null,
    };
    s.ids.push(r.id);
    if (orderId && names.has(orderId)) s.triedFor = names.get(orderId)!;
    by.set(key, s);
  }
  return [...by.values()];
}

/** "1 scan not saved", "2 scans not saved". */
export const notSavedTitle = (n: number) => `${n} scan${n === 1 ? "" : "s"} not saved`;

/** "Front Shanks · 32.60 lb · Lot 110626 · Case 10052". */
export function notSavedLine(s: NotSavedScan, product: string): string {
  return [product, ...(s.weight == null ? [] : [`${s.weight.toFixed(2)} lb`]), s.lot ? `Lot ${s.lot}` : "No lot", s.caseNo ? `Case ${s.caseNo}` : "No case number"].join(" · ");
}

/** "Label already used for Emerson. Scanned for #16 Bothell." */
export function notSavedWhy(s: NotSavedScan): string {
  return [`Label already used${s.usedFor ? ` for ${s.usedFor}` : ""}.`, ...(s.triedFor ? [`Scanned for ${s.triedFor}.`] : [])].join(" ");
}

/** For the warning before paperwork prints. */
export function notSavedWarning(scans: NotSavedScan[], productName: (id: string | null) => string): string[] {
  if (!scans.length) return [];
  const list = scans.map((s) => `${productName(s.productId)}${s.caseNo ? ` (case ${s.caseNo})` : ""}`).join("; ");
  return [`${notSavedTitle(scans.length)}: ${list}. ${scans.length === 1 ? "That box isn't" : "Those boxes aren't"} on any paperwork unless typed in.`];
}
