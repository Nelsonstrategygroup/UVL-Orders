import { lineUnit } from "@/lib/calc/units";
import type { CatalogProduct, Qty, Units } from "@/lib/db/types";
import { qtyText } from "@/lib/orders";

/** The order in large type, to read back to the customer (prototype readback). */
export default function ReadBack({ lines, units, products }: { lines: Qty; units?: Units; products: CatalogProduct[] }) {
  const items = products.filter((p) => (lines[p.id] ?? 0) > 0);
  if (!items.length) return <div className="readback muted">Nothing ordered yet.</div>;
  return (
    <div className="readback">
      {items.map((p) => (
        <div key={p.id}>
          <span className="q num">{qtyText(lines[p.id], lineUnit(p.id, p, units))}</span>
          <span>{p.name}</span>
        </div>
      ))}
    </div>
  );
}

/** "16 lb Chops, 3 Short Loin" for list summaries. */
export function orderSummary(lines: Qty, products: CatalogProduct[], units?: Units): string {
  return products
    .filter((p) => (lines[p.id] ?? 0) > 0)
    .map((p) => `${qtyText(lines[p.id], lineUnit(p.id, p, units))} ${p.short_name || p.name}`)
    .join(", ");
}
