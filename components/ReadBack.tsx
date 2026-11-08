import { lineUnit } from "@/lib/calc/units";
import type { CatalogProduct, Qty, Units } from "@/lib/db/types";
import { qtyText } from "@/lib/orders";

/** The order in large type, to read back to the customer (prototype readback). "Only if extra" lines say "if available" (11/8/26). */
export default function ReadBack({
  lines,
  units,
  products,
  extra,
}: {
  lines: Qty;
  units?: Units;
  products: CatalogProduct[];
  extra?: Record<string, unknown>;
}) {
  const items = products.filter((p) => (lines[p.id] ?? 0) > 0);
  if (!items.length) return <div className="readback muted">Nothing ordered yet.</div>;
  return (
    <div className="readback">
      {items.map((p) => (
        <div key={p.id}>
          <span className="q num">{qtyText(lines[p.id], lineUnit(p.id, p, units))}</span>
          <span>
            {p.name}
            {extra?.[p.id] ? <span className="muted"> if available</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/** "16 lb Chops, 3 Short Loin" for list summaries ("if available" on "Only if extra" lines). */
export function orderSummary(lines: Qty, products: CatalogProduct[], units?: Units, extra?: Record<string, unknown>): string {
  return products
    .filter((p) => (lines[p.id] ?? 0) > 0)
    .map((p) => `${qtyText(lines[p.id], lineUnit(p.id, p, units))} ${p.short_name || p.name}${extra?.[p.id] ? " if available" : ""}`)
    .join(", ");
}
