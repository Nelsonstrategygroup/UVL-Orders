"use client";

// Setup > Prices (SPEC 15, stage 1): a default price for each product, and a
// customer's own price where it differs, each from a date on. An invoice
// uses the newest price on or before its date, the customer's own first.
// No prices are entered by the app; a missing one shows "Price needed".
// Whole lambs are listed first, next to the cuts, to compare.

import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCan } from "@/components/CurrentUser";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useToast } from "@/components/Toast";
import { displayName, sortByDisplayName } from "@/lib/calc/customers";
import { parsePrice, priceFor, priceHistory, priceText, PRICE_UNIT_SHORT, type PriceRow } from "@/lib/calc/prices";
import { groupProducts } from "@/lib/calc/products";
import { niceDate, todayISO } from "@/lib/dates";
import { deletePrice, loadPrices, setPrice } from "@/lib/db/invoicing";
import type { CatalogProduct, Customer } from "@/lib/db/types";

const WHOLE = "Whole lambs";

/** "Oct 19, 2026" */
const dateText = (d: string) => `${niceDate(d)}, ${d.slice(0, 4)}`;

export default function Prices() {
  const { catalog, customers } = useStaffData();
  const canEdit = useCan("prices").change;
  const load = useCallback((d: SupabaseClient) => loadPrices(d), []);
  const { data: prices, refresh, error } = useLive("prices", load, ["prices"]);
  const [from, setFrom] = useState(todayISO());

  if (error) return <p className="note bad">Couldn&apos;t load prices: {error}</p>;
  if (!prices || !catalog || !customers) return <p className="small muted">Loading...</p>;

  const today = todayISO();
  const groups = groupProducts(catalog.products.filter((p) => p.active));
  // Whole lambs first, so the whole-lamb price sits next to the cuts.
  groups.sort((a, b) => Number(b.group === WHOLE) - Number(a.group === WHOLE));
  const hasLocations = new Set(customers.list.map((c) => c.parent_customer_id).filter(Boolean));
  const billable = sortByDisplayName(
    customers.list.filter((c) => c.active && !hasLocations.has(c.id)),
    customers.byId,
  );
  const missing = groups.flatMap((g) => g.products).filter((p) => !priceFor(prices, p.id, null, today)).length;

  return (
    <>
      <section className="panel">
        <p className="small muted mt-0">
          Prices are per lb unless the product says per case or per each (set on the product in Setup &gt; Products). A price
          applies from its start date on, so invoices dated earlier keep the old price. A customer&apos;s own price is used
          instead of the default for that customer.
        </p>
        {canEdit ? (
          <label className="grid max-w-[16rem] gap-1">
            <span className="lbl m-0">New prices start on</span>
            <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value || todayISO())} />
          </label>
        ) : (
          <p className="note small">Only someone who can change prices can change these.</p>
        )}
        <p className="small mt-2 mb-0">
          {missing === 0 ? "Every product has a price today." : `${missing} products have no price yet (Price needed on invoices).`}
        </p>
      </section>

      {groups.map((g) => (
        <section key={g.group} className="panel mt-3">
          <h3>{g.group}</h3>
          <table className="simple mt-1">
            <thead>
              <tr>
                <th>Product</th>
                <th>Price today</th>
                {canEdit && <th>New price from {niceDate(from)}</th>}
              </tr>
            </thead>
            <tbody>
              {g.products.map((p) => (
                <ProductRow
                  key={p.id}
                  product={p}
                  prices={prices}
                  today={today}
                  from={from}
                  canEdit={canEdit}
                  billable={billable}
                  customerName={(id) => {
                    const c = customers.byId.get(id);
                    return c ? displayName(c, customers.byId) : "Unknown customer";
                  }}
                  refresh={refresh}
                />
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

function ProductRow({
  product: p,
  prices,
  today,
  from,
  canEdit,
  billable,
  customerName,
  refresh,
}: {
  product: CatalogProduct;
  prices: PriceRow[];
  today: string;
  from: string;
  canEdit: boolean;
  billable: Customer[];
  customerName: (id: string) => string;
  refresh: () => void;
}) {
  const db = getDb();
  const toast = useToast();
  const [text, setText] = useState("");
  const [custId, setCustId] = useState("");
  const [custText, setCustText] = useState("");
  const unit = PRICE_UNIT_SHORT[p.price_unit];
  const now = priceFor(prices, p.id, null, today);
  const history = priceHistory(prices, p.id, null);
  const custIds = [...new Set(prices.filter((x) => x.product_id === p.id && x.customer_id).map((x) => x.customer_id!))];
  const later = history.filter((h) => h.effective_from > today);

  const after = (err: string | null, ok: string) => {
    toast(err ? `Couldn't save: ${err}` : ok);
    refresh();
    return !err;
  };
  const save = async (customerId: string | null, typed: string) => {
    const v = parsePrice(typed);
    if (v == null) {
      toast("Type a price like 9.50");
      return false;
    }
    return after(await setPrice(db, { productId: p.id, customerId, price: v, from }), `Saved: ${priceText(v)}${unit} from ${niceDate(from)}`);
  };
  const remove = async (row: PriceRow) => {
    if (!confirm(`Delete the ${priceText(row.price)} price starting ${dateText(row.effective_from)}?`)) return;
    after(await deletePrice(db, row.id), "Deleted");
  };
  const historyList = (rows: PriceRow[]) => (
    <ul className="m-0 list-none p-0">
      {rows.map((h) => (
        <li key={h.id} className="flex flex-wrap items-center gap-x-3">
          <span className="num">
            {priceText(h.price)}
            {unit}
          </span>
          <span className="muted">from {dateText(h.effective_from)}</span>
          {canEdit && (
            <button type="button" className="copy min-h-[44px] px-2" onClick={() => void remove(h)}>
              Delete
            </button>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <tr>
      <td>
        <b>{p.name}</b>
        <span className="small muted"> · per {p.price_unit}</span>
        {(history.length > 0 || custIds.length > 0 || canEdit) && (
          <details className="mt-1">
            <summary className="copy">
              Past prices and customer prices{custIds.length ? ` (${custIds.length} customer${custIds.length === 1 ? "" : "s"})` : ""}
            </summary>
            <div className="small mt-1 grid gap-2">
              <div>
                <b>Default</b>
                {history.length ? historyList(history) : <p className="muted m-0">None yet.</p>}
              </div>
              {custIds.map((id) => (
                <div key={id}>
                  <b>{customerName(id)}</b>
                  {historyList(priceHistory(prices, p.id, id))}
                </div>
              ))}
              {canEdit && (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!custId) return toast("Pick a customer");
                    void save(custId, custText).then((ok) => ok && setCustText(""));
                  }}
                >
                  <label className="grid gap-1">
                    <span className="lbl m-0">Customer</span>
                    <select className="field" value={custId} onChange={(e) => setCustId(e.target.value)}>
                      <option value="">Pick a customer</option>
                      {billable.map((c) => (
                        <option key={c.id} value={c.id}>
                          {customerName(c.id)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1">
                    <span className="lbl m-0">Their price{unit}</span>
                    <input className="field num w-28!" inputMode="decimal" value={custText} onChange={(e) => setCustText(e.target.value)} />
                  </label>
                  <button type="submit" className="btn ghost" disabled={!custId || !custText.trim()}>
                    Add from {niceDate(from)}
                  </button>
                </form>
              )}
            </div>
          </details>
        )}
      </td>
      <td className="whitespace-nowrap">
        {now ? (
          <>
            <b className="num">
              {priceText(now.price)}
              {unit}
            </b>
            <span className="small muted block">since {dateText(now.effective_from)}</span>
          </>
        ) : (
          <span className="tag extra">Price needed</span>
        )}
        {later.length > 0 && (
          <span className="small block">
            {priceText(later[later.length - 1].price)} from {niceDate(later[later.length - 1].effective_from)}
          </span>
        )}
      </td>
      {canEdit && (
        <td>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save(null, text).then((ok) => ok && setText(""));
            }}
          >
            <input
              className="field num w-28!"
              inputMode="decimal"
              aria-label={`New price for ${p.name}, ${unit}`}
              placeholder={unit}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="btn ghost" disabled={!text.trim()}>
              Save
            </button>
          </form>
        </td>
      )}
    </tr>
  );
}
