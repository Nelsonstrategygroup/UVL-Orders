import { fmt } from "@/lib/calc/num";
import type { CatalogProduct, Qty } from "@/lib/db/types";

/** The order in large type, to read back to the customer (prototype readback). */
export default function ReadBack({ lines, products }: { lines: Qty; products: CatalogProduct[] }) {
  const items = products.filter((p) => (lines[p.id] ?? 0) > 0);
  if (!items.length) return <div className="readback muted">Nothing ordered yet.</div>;
  return (
    <div className="readback">
      {items.map((p) => (
        <div key={p.id}>
          <span className="q num">{fmt(lines[p.id])}</span>
          <span>
            {p.unit === "lb" ? "lb " : ""}
            {p.name}
          </span>
        </div>
      ))}
    </div>
  );
}

/** "4 Leg BI, 2 French rack" for list summaries. */
export function orderSummary(lines: Qty, products: CatalogProduct[]): string {
  return products
    .filter((p) => (lines[p.id] ?? 0) > 0)
    .map((p) => `${fmt(lines[p.id])} ${p.short_name || p.name}`)
    .join(", ");
}
