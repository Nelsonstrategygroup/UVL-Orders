// Products packed together in one box (Lucas, 10/29/26): Heart, Liver and
// Kidney go in the same box. One box of any of them is the store's order for
// all of them; box sizes don't apply to them for now. Set on each product
// (Setup > Products, "Packed in one box with"). Billed as one invoice line
// under the group's first product, by weight, at one price.

export type TogetherProduct = { id: string; sort: number; packed_with?: string | null };

const groupName = (p: TogetherProduct | undefined) => (p?.packed_with ?? "").trim();

/** Every product packed in one box with this one, itself included, in sort order. Just itself when it's packed on its own. */
export function packedWith<P extends TogetherProduct>(productId: string, products: Map<string, P> | P[]): string[] {
  const list = Array.isArray(products) ? products : [...products.values()];
  const me = list.find((p) => p.id === productId);
  const g = groupName(me);
  if (!g) return [productId];
  return list
    .filter((p) => groupName(p) === g)
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
    .map((p) => p.id);
}

/** Packed together with something else. */
export const isTogether = <P extends TogetherProduct>(productId: string, products: Map<string, P> | P[]) =>
  packedWith(productId, products).length > 1;

/** The product a group is priced and billed under: its first by sort (the database does the same). */
export const groupLead = <P extends TogetherProduct>(productId: string, products: Map<string, P> | P[]) =>
  packedWith(productId, products)[0];

/** On this order: the product itself, or another packed in the same box. Returns which one, or null. */
export function onOrderAs<P extends TogetherProduct>(productId: string, lines: Record<string, number>, products: Map<string, P> | P[]): string | null {
  if ((lines[productId] ?? 0) > 0) return productId;
  return packedWith(productId, products).find((id) => (lines[id] ?? 0) > 0) ?? null;
}
