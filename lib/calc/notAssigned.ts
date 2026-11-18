// Boxes not assigned (Lucas, 11/17/26): every box of the week with no store,
// and every scanned or label-typed box with a store but no pallet. They show
// in a banner at the top of Packing and Scan boxes until someone assigns them.

type BoxLike = { pallet_id: string | null; source?: string | null; at: string };

export type NotAssigned<W> = {
  w: W;
  /** Its store's order and name; null when it has no store. */
  orderId: string | null;
  customer: string | null;
  lines: Record<string, number> | null;
};

/** No store first, then no pallet, oldest first in each. A box typed from paper with a store is listed on Pallets instead. */
export function notAssignedBoxes<W extends BoxLike>(
  orders: { id: string; labelCustomer: string; lines: Record<string, number>; weights: W[] }[],
  unassigned: W[],
): NotAssigned<W>[] {
  const byTime = (a: NotAssigned<W>, b: NotAssigned<W>) => a.w.at.localeCompare(b.w.at);
  const noStore = unassigned.map((w) => ({ w, orderId: null, customer: null, lines: null }));
  const noPallet = orders.flatMap((o) =>
    o.weights
      .filter((w) => !w.pallet_id && w.source !== "weigh")
      .map((w) => ({ w, orderId: o.id, customer: o.labelCustomer, lines: o.lines })),
  );
  return [...noStore.sort(byTime), ...noPallet.sort(byTime)];
}

/** "1 box not assigned", "3 boxes not assigned". */
export const notAssignedTitle = (n: number) => `${n} box${n === 1 ? "" : "es"} not assigned`;

/** "Racks · 33.30 lb · Lot 111326 · Case 10052", with the store when only the pallet is missing. */
export function notAssignedLine(b: { product: string; weight: number; lot: string | null; caseNo: string | null; customer: string | null }): string {
  return [
    b.product,
    `${b.weight.toFixed(2)} lb`,
    b.lot?.trim() ? `Lot ${b.lot.trim()}` : "No lot",
    b.caseNo?.trim() ? `Case ${b.caseNo.trim()}` : "No case number",
    ...(b.customer ? [`${b.customer}, no pallet`] : []),
  ].join(" · ");
}

/** What Packing says when no order lines are left to pack. */
export function nothingToPackWords(notAssigned: number, notSaved = 0): string {
  if (notSaved)
    return `All orders are packed, but ${[...(notAssigned ? [notAssignedTitle(notAssigned)] : []), `${notSaved} scan${notSaved === 1 ? "" : "s"} not saved`].join(" and ")}. See the top of this page.`;
  return notAssigned ? `All orders are packed, but ${notAssignedTitle(notAssigned)}. Assign ${notAssigned === 1 ? "it" : "them"} at the top of this page.` : "Everything is packed.";
}
