// The printed invoice (SPEC 15): one location, Letter, portrait. DRAFT across
// it until it's finalized; "Price needed" and "Count needed" where a line
// can't be worked out yet. Shorted lines show at $0 so the customer sees
// what didn't ship. With box detail on for the location, a second page lists
// every box. Shown as a sheet on screen, printed as is.

import { Fragment } from "react";
import { invoiceTotals, lbText, quantityText, type PricedLine } from "@/lib/calc/invoice";
import { centsText, priceText, PRICE_UNIT_SHORT, toFixedInt } from "@/lib/calc/prices";
import { boxIdOf } from "@/lib/calc/manifest";
import { niceDate, weekName } from "@/lib/dates";
import type { InvoiceSettings } from "@/lib/db/invoicing";
import type { InvoiceBox, InvoiceRow } from "@/lib/db/invoices";

export type InvoiceSheetProps = {
  invoice: InvoiceRow;
  lines: PricedLine[];
  customerName: string;
  billTo: string;
  terms: number;
  due: string;
  settings: InvoiceSettings | null;
  /** The box detail page: the location's boxes, or null when it's off. */
  boxes: InvoiceBox[] | null;
  productName: (id: string) => string;
};

/** "Oct 27, 2026" */
const fullDate = (d: string) => `${niceDate(d)}, ${d.slice(0, 4)}`;

const ordered = (l: PricedLine) => (l.ordered_qty == null ? "" : `Ordered ${Number(l.ordered_qty)} ${l.ordered_unit}`.trim());

const discountText = (l: PricedLine) =>
  l.discount_kind === "percent" ? `Discount ${Number(l.discount)}%` : `Discount ${priceText(l.discount ?? 0)}`;

export default function InvoiceSheet({ invoice: inv, lines, customerName, billTo, terms, due, settings, boxes, productName }: InvoiceSheetProps) {
  const t = invoiceTotals(lines);
  const draft = inv.status === "draft";
  const remit = settings?.remit_to?.trim() || [settings?.business_name, settings?.business_address].filter(Boolean).join("\n");
  return (
    <div className="invsheet">
      <section className={`inv-page${draft ? " inv-draft" : ""}`}>
        {draft && (
          <div className="inv-watermark" aria-hidden="true">
            DRAFT
          </div>
        )}
        <div className="inv-head">
          <div>
            <div className="inv-co">{settings?.business_name}</div>
            <div className="whitespace-pre-line">{settings?.business_address}</div>
            {settings?.business_phone && <div>{settings.business_phone}</div>}
            {settings?.business_email && <div>{settings.business_email}</div>}
          </div>
          <div className="inv-title">
            <div className="inv-word">{draft ? "DRAFT INVOICE" : "INVOICE"}</div>
            <table className="inv-facts">
              <tbody>
                <tr>
                  <th>Invoice</th>
                  <td>{inv.number ?? "Number needed"}</td>
                </tr>
                <tr>
                  <th>Date</th>
                  <td>{fullDate(inv.invoice_date)}</td>
                </tr>
                <tr>
                  <th>Terms</th>
                  <td>{terms === 0 ? "Due on receipt" : `Net ${terms}`}</td>
                </tr>
                <tr>
                  <th>Due</th>
                  <td>{fullDate(due)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="inv-addr">
          <div>
            <b>Bill to</b>
            <div className="inv-to">{customerName}</div>
            {billTo && <div className="whitespace-pre-line">{billTo}</div>}
          </div>
          <div>
            <b>Packed</b>
            <div>Week of {fullDate(inv.week_id)}</div>
          </div>
        </div>

        <table className="inv-table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Boxes</th>
              <th className="num">Quantity</th>
              <th className="num">Price</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <Fragment key={l.id}>
                <tr className={l.kind === "shorted" ? "inv-short" : ""}>
                  <td>
                    {l.description}
                    {l.not_on_order && <span className="inv-small"> · not on the order</span>}
                    {l.kind !== "manual" && ordered(l) && <span className="inv-small block">{ordered(l)}</span>}
                    {l.note && !l.discount && <span className="inv-small block">{l.note}</span>}
                  </td>
                  <td className="num">{l.kind === "manual" ? "" : l.boxes}</td>
                  <td className="num">
                    {l.kind === "shorted" ? "Not shipped" : l.countNeeded ? <b>Count needed</b> : l.kind === "manual" ? Number(l.quantity) : quantityText(l.quantity, l.price_unit)}
                  </td>
                  <td className="num">
                    {l.kind === "shorted" ? "" : l.price != null ? `${priceText(l.price)}${l.price_unit ? PRICE_UNIT_SHORT[l.price_unit] : ""}` : <b>Price needed</b>}
                  </td>
                  <td className="num">{l.grossCents != null ? centsText(l.grossCents) : ""}</td>
                </tr>
                {l.discount != null && (
                  <tr className="inv-disc">
                    <td colSpan={4}>
                      {discountText(l)}
                      {l.note ? `: ${l.note}` : ""}
                    </td>
                    <td className="num">{l.grossCents != null ? `-${centsText(l.discountCents)}` : ""}</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        <div className="inv-total">
          <span>
            {t.boxes} box{t.boxes === 1 ? "" : "es"}
            {t.lbThousandths > BigInt(0) ? ` · ${lbText(t.lbThousandths)} lb` : ""}
          </span>
          <span>
            {t.complete ? "Total" : "Total so far"} {centsText(t.totalCents)}
          </span>
        </div>
        {!t.complete && (
          <p className="inv-warn">
            Not complete:{" "}
            {[
              t.priceNeeded ? `${t.priceNeeded} price${t.priceNeeded === 1 ? "" : "s"} needed` : "",
              t.countNeeded ? `${t.countNeeded} count${t.countNeeded === 1 ? "" : "s"} needed` : "",
            ]
              .filter(Boolean)
              .join(", ")}
            .
          </p>
        )}
        {inv.memo && <p className="whitespace-pre-line">{inv.memo}</p>}
        <div className="inv-remit">
          <b>Please send payment to</b>
          <div className="whitespace-pre-line">{remit}</div>
          <div>Please write the invoice number on your payment.</div>
        </div>
        {settings?.invoice_note && <p className="inv-foot">{settings.invoice_note}</p>}
      </section>

      {boxes && <BoxDetail invoice={inv} customerName={customerName} boxes={boxes} productName={productName} />}
    </div>
  );
}

function BoxDetail({
  invoice: inv,
  customerName,
  boxes,
  productName,
}: {
  invoice: InvoiceRow;
  customerName: string;
  boxes: InvoiceBox[];
  productName: (id: string) => string;
}) {
  const byProduct = new Map<string, InvoiceBox[]>();
  for (const b of boxes) byProduct.set(b.product_id, [...(byProduct.get(b.product_id) ?? []), b]);
  const groups = [...byProduct.entries()].sort(([a], [b]) => productName(a).localeCompare(productName(b)));
  const lb = (list: InvoiceBox[]) => list.reduce((s, b) => s + toFixedInt(b.weight, 3), BigInt(0));
  return (
    <section className={`inv-page inv-boxes${inv.status === "draft" ? " inv-draft" : ""}`}>
      <div className="inv-co">Box detail · {inv.number ?? "Number needed"}</div>
      <div className="mb-2">
        {customerName} · {weekName(inv.week_id)}
      </div>
      <table className="inv-table">
        <thead>
          <tr>
            <th>Box</th>
            <th>Lot</th>
            <th>Pack date</th>
            <th className="num">Net weight</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(([pid, list]) => (
            <Fragment key={pid}>
              <tr className="inv-group">
                <th colSpan={4}>{productName(pid)}</th>
              </tr>
              {[...list]
                .sort((a, b) => boxIdOf(a).localeCompare(boxIdOf(b), undefined, { numeric: true }))
                .map((b) => (
                  <tr key={b.id}>
                    <td>{boxIdOf(b) || (b.source === "weigh" ? "Typed in" : "")}</td>
                    <td>{b.lot ?? ""}</td>
                    <td>{b.pack_date ? fullDate(b.pack_date) : ""}</td>
                    <td className="num">{lbText(toFixedInt(b.weight, 3))} lb</td>
                  </tr>
                ))}
              <tr className="inv-sub">
                <td colSpan={3}>
                  {list.length} box{list.length === 1 ? "" : "es"}
                </td>
                <td className="num">{lbText(lb(list))} lb</td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
      <div className="inv-total">
        <span>
          {boxes.length} box{boxes.length === 1 ? "" : "es"}
        </span>
        <span>{lbText(lb(boxes))} lb</span>
      </div>
    </section>
  );
}
