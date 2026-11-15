"use client";

// Setup > Prices (SPEC 15, stage 1): a default price for each product, and a
// customer's own price where it differs, each from a date on. An invoice
// uses the newest price on or before its date: the store's own, else its
// chain's (PCC; Lucas, 11/14/26), else the default. A missing one shows
// "Price needed". Whole lambs are listed first, next to the cuts, to compare.
//
// Also (Lucas, 11/14/26): a price for a whole chain in one step, a warning
// when a price doesn't end in 0, Prices confirmed for each location, and a
// printable price list for one customer.

import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import PrintHeader from "@/components/PrintHeader";
import { useCan } from "@/components/CurrentUser";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useToast } from "@/components/Toast";
import { displayName, sortByDisplayName } from "@/lib/calc/customers";
import {
  endsInZero,
  parsePrice,
  priceFor,
  priceHistory,
  priceSource,
  priceText,
  PRICE_UNIT_SHORT,
  type PriceRow,
} from "@/lib/calc/prices";
import { groupLead, packedWith } from "@/lib/calc/packTogether";
import { groupProducts } from "@/lib/calc/products";
import { niceDate, todayISO } from "@/lib/dates";
import { deletePrice, loadPriceChecks, loadPrices, setPrice, setPriceChecks, type PriceCheck } from "@/lib/db/invoicing";
import type { CatalogProduct, Customer } from "@/lib/db/types";

const WHOLE = "Whole lambs";

/** "Oct 19, 2026" */
const dateText = (d: string) => `${niceDate(d)}, ${d.slice(0, 4)}`;

/** Under a price box: a small warning when the typed price doesn't end in 0. Saving still works. */
function RoundWarning({ typed }: { typed: string }) {
  const v = parsePrice(typed);
  if (v == null || endsInZero(v)) return null;
  return (
    <span className="small block rounded bg-warn px-1" role="status">
      Doesn&apos;t end in 0. You can still save it.
    </span>
  );
}

export default function Prices() {
  const { catalog, customers } = useStaffData();
  const canEdit = useCan("prices").change;
  const load = useCallback((d: SupabaseClient) => loadPrices(d), []);
  const { data: prices, refresh, error } = useLive("prices", load, ["prices"]);
  const loadChecks = useCallback((d: SupabaseClient) => loadPriceChecks(d), []);
  const { data: checks, refresh: refreshChecks, error: checksError } = useLive("price-checks", loadChecks, ["customer_price_checks"]);
  const [from, setFrom] = useState(todayISO());
  const [listFor, setListFor] = useState("");

  if (error || checksError) return <p className="note bad">Couldn&apos;t load prices: {error ?? checksError}</p>;
  if (!prices || !checks || !catalog || !customers) return <p className="small muted">Loading...</p>;

  const today = todayISO();
  // Products packed together (Organs) have one price, on the group's first product: one row.
  const groups = groupProducts(catalog.products.filter((p) => p.active && groupLead(p.id, catalog.products) === p.id));
  const title = (p: CatalogProduct) => {
    const ids = packedWith(p.id, catalog.products);
    return ids.length > 1 ? ids.map((id) => catalog.productById.get(id)?.name ?? id).join(", ") : p.name;
  };
  // Whole lambs first, so the whole-lamb price sits next to the cuts.
  groups.sort((a, b) => Number(b.group === WHOLE) - Number(a.group === WHOLE));
  const hasLocations = new Set(customers.list.map((c) => c.parent_customer_id).filter(Boolean));
  const billable = sortByDisplayName(
    customers.list.filter((c) => c.active && !hasLocations.has(c.id)),
    customers.byId,
  );
  // Chains: customers with locations that bill (PCC). A price on a chain applies to all its stores.
  const chains = sortByDisplayName(
    customers.list.filter((c) => c.active && billable.some((b) => b.parent_customer_id === c.id)),
    customers.byId,
  );
  const storesOf = (chainId: string) => billable.filter((b) => b.parent_customer_id === chainId);
  const customerName = (id: string) => {
    const c = customers.byId.get(id);
    if (!c) return "Unknown customer";
    if (hasLocations.has(id)) return `${c.name} (all ${storesOf(id).length} locations)`;
    return displayName(c, customers.byId);
  };
  const missing = groups.flatMap((g) => g.products).filter((p) => !priceFor(prices, p.id, null, today)).length;

  const listCustomer = listFor ? customers.byId.get(listFor) : undefined;
  if (listCustomer) {
    return (
      <PriceList
        customer={listCustomer}
        name={customerName(listCustomer.id)}
        chainName={listCustomer.parent_customer_id ? (customers.byId.get(listCustomer.parent_customer_id)?.name ?? "") : ""}
        check={checks.get(listCustomer.id)}
        groups={groups}
        title={title}
        prices={prices}
        onBack={() => setListFor("")}
      />
    );
  }

  return (
    <>
      <section className="panel">
        <p className="small muted mt-0">
          Prices are per lb unless the product says per case or per each (set on the product in Setup &gt; Products). A price
          applies from its start date on, so invoices dated earlier keep the old price. A price for a chain (like PCC) is used for
          all its stores. A customer&apos;s own price is used instead of the chain&apos;s or the default.
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
          {missing === 0 ? "Every product has a price today." : `${missing} products have no default price yet (Price needed on invoices).`}
        </p>
      </section>

      <section className="panel mt-3">
        <h3>Price list for one customer</h3>
        <p className="small muted mt-1">Every product with the price this customer pays, and where it comes from. You can print it.</p>
        <label className="grid max-w-[22rem] gap-1">
          <span className="lbl m-0">Customer</span>
          <select className="field" value="" onChange={(e) => setListFor(e.target.value)}>
            <option value="">Pick a customer</option>
            {billable.map((c) => (
              <option key={c.id} value={c.id}>
                {customerName(c.id)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <PriceChecks
        chains={chains}
        storesOf={storesOf}
        others={billable.filter((b) => !b.parent_customer_id || !chains.some((c) => c.id === b.parent_customer_id))}
        customerName={customerName}
        checks={checks}
        canEdit={canEdit}
        refresh={refreshChecks}
      />

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
                  title={title(p)}
                  prices={prices}
                  today={today}
                  from={from}
                  canEdit={canEdit}
                  chains={chains}
                  billable={billable}
                  customers={customers.byId}
                  customerName={customerName}
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
  title,
  prices,
  today,
  from,
  canEdit,
  chains,
  billable,
  customers,
  customerName,
  refresh,
}: {
  product: CatalogProduct;
  /** The name, or every product packed together with it ("Heart, Liver, Kidney"). */
  title: string;
  prices: PriceRow[];
  today: string;
  from: string;
  canEdit: boolean;
  chains: Customer[];
  billable: Customer[];
  customers: Map<string, Customer>;
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
  const later = history.filter((h) => h.effective_from > today);
  // Customers with prices of their own for this product: each chain, then its stores with their own price, then the rest.
  const withPrices = new Set(prices.filter((x) => x.product_id === p.id && x.customer_id).map((x) => x.customer_id!));
  const chainIds = chains.map((c) => c.id).filter((id) => withPrices.has(id));
  const storeIds = billable.filter((b) => withPrices.has(b.id)).map((b) => b.id);
  const ordered = [
    ...chainIds.flatMap((cid) => [cid, ...storeIds.filter((s) => customers.get(s)?.parent_customer_id === cid)]),
    ...storeIds.filter((s) => !chainIds.includes(customers.get(s)?.parent_customer_id ?? "")),
    // A price on a customer no longer listed (inactive): still shown, so it can be deleted.
    ...[...withPrices].filter((id) => !chains.some((c) => c.id === id) && !billable.some((b) => b.id === id)),
  ];

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
    const who = customerId ? ` for ${customerName(customerId)}` : "";
    return after(
      await setPrice(db, { productId: p.id, customerId, price: v, from }),
      `Saved: ${priceText(v)}${unit}${who} from ${niceDate(from)}`,
    );
  };
  const remove = async (row: PriceRow) => {
    const who = row.customer_id ? ` for ${customerName(row.customer_id)}` : "";
    if (!confirm(`Delete the ${priceText(row.price)} price${who} starting ${dateText(row.effective_from)}?`)) return;
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
  const isStoreOfChain = (id: string) => chainIds.includes(customers.get(id)?.parent_customer_id ?? "");

  return (
    <tr>
      <td>
        <b>{title}</b>
        <span className="small muted"> · per {p.price_unit}</span>
        {title !== p.name && <span className="small muted block">Packed in one box: one price for all of them.</span>}
        {(history.length > 0 || ordered.length > 0 || canEdit) && (
          <details className="mt-1">
            <summary className="copy">
              Past prices and customer prices{ordered.length ? ` (${ordered.length})` : ""}
            </summary>
            <div className="small mt-1 grid gap-2">
              <div>
                <b>Default</b>
                {history.length ? historyList(history) : <p className="muted m-0">None yet.</p>}
              </div>
              {ordered.map((id) => (
                <div key={id} className={isStoreOfChain(id) ? "ml-4" : ""}>
                  <b>{customerName(id)}</b>
                  {isStoreOfChain(id) && <span className="muted"> · its own price, not the chain&apos;s</span>}
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
                      {chains.map((c) => (
                        <option key={c.id} value={c.id}>
                          {customerName(c.id)}
                        </option>
                      ))}
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
                  <RoundWarning typed={custText} />
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
              aria-label={`New price for ${title}, ${unit}`}
              placeholder={unit}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="btn ghost" disabled={!text.trim()}>
              Save
            </button>
          </form>
          <RoundWarning typed={text} />
        </td>
      )}
    </tr>
  );
}

/** Prices confirmed: one box per location, or one per chain for all its stores. */
function PriceChecks({
  chains,
  storesOf,
  others,
  customerName,
  checks,
  canEdit,
  refresh,
}: {
  chains: Customer[];
  storesOf: (chainId: string) => Customer[];
  /** Locations not in a chain. */
  others: Customer[];
  customerName: (id: string) => string;
  checks: Map<string, PriceCheck>;
  canEdit: boolean;
  refresh: () => void;
}) {
  const db = getDb();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const rows = [
    ...chains.map((c) => ({ id: c.id, name: customerName(c.id), ids: storesOf(c.id).map((s) => s.id) })),
    ...others.map((c) => ({ id: c.id, name: customerName(c.id), ids: [c.id] })),
  ];
  const notYet = rows.filter((r) => !r.ids.every((id) => checks.get(id)?.confirmed)).length;
  const set = async (ids: string[], on: boolean, name: string) => {
    setBusy(true);
    const err = await setPriceChecks(db, ids, on);
    setBusy(false);
    toast(err ? `Couldn't save: ${err}` : on ? `${name}: prices confirmed` : `${name}: not confirmed`);
    refresh();
  };
  /** Who last checked it and when ("Kathy, Nov 14"), from the newest change among its stores. */
  const stamp = (ids: string[]) => {
    const latest = ids
      .map((id) => checks.get(id))
      .filter((c): c is PriceCheck => !!c)
      .sort((a, b) => b.changed_at.localeCompare(a.changed_at))[0];
    if (!latest) return "";
    const d = new Date(latest.changed_at).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    // PCC's rows were set when this started (11/14/26), not by a person.
    if (latest.changed_by_name.startsWith("Starting setting")) return `Confirmed from the start, ${dateText(d)}`;
    return `${latest.confirmed ? "Checked" : "Unchecked"}${latest.changed_by_name ? ` by ${latest.changed_by_name}` : ""} on ${dateText(d)}`;
  };

  return (
    <section className="panel mt-3">
      <h3>Prices confirmed</h3>
      <p className="small muted mt-1">
        Check a customer once their prices here match what they&apos;re really charged. An invoice for a customer that isn&apos;t
        checked shows a warning before it&apos;s printed or sent.
        {notYet > 0 ? ` ${notYet} not confirmed yet.` : " All confirmed."}
      </p>
      <ul className="m-0 grid list-none gap-0 p-0">
        {rows.map((r) => {
          const all = r.ids.length > 0 && r.ids.every((id) => checks.get(id)?.confirmed);
          const some = !all && r.ids.some((id) => checks.get(id)?.confirmed);
          return (
            <li key={r.id} className="border-t border-line py-1">
              <label className="flex min-h-[44px] items-center gap-3">
                <input
                  type="checkbox"
                  className="h-6 w-6"
                  checked={all}
                  disabled={!canEdit || busy}
                  ref={(el) => {
                    if (el) el.indeterminate = some;
                  }}
                  onChange={(e) => void set(r.ids, e.target.checked, r.name)}
                />
                <span className="min-w-0 flex-1">
                  <b>{r.name}</b>
                  <span className="small muted block">
                    {some ? "Some locations confirmed. " : ""}
                    {stamp(r.ids) || "Not confirmed yet"}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const SOURCE_LABEL = { own: "Their own price", chain: "", default: "Default" } as const;

/** Every product with the price one customer pays on a date, and where it comes from. Printable. */
function PriceList({
  customer,
  name,
  chainName,
  check,
  groups,
  title,
  prices,
  onBack,
}: {
  customer: Customer;
  name: string;
  /** The chain it's a store of ("PCC"), or "". */
  chainName: string;
  check: PriceCheck | undefined;
  groups: { group: string; products: CatalogProduct[] }[];
  title: (p: CatalogProduct) => string;
  prices: PriceRow[];
  onBack: () => void;
}) {
  const [on, setOn] = useState(todayISO());
  const chainId = customer.parent_customer_id;
  const label = (r: PriceRow) => {
    const s = priceSource(r, customer.id);
    return s === "chain" ? `${chainName} price` : SOURCE_LABEL[s];
  };
  return (
    <>
      <div className="noprint flex flex-wrap items-end gap-3">
        <button type="button" className="btn ghost" onClick={onBack}>
          &larr; All prices
        </button>
        <label className="grid gap-1">
          <span className="lbl m-0">Prices on</span>
          <input type="date" className="field" value={on} onChange={(e) => setOn(e.target.value || todayISO())} />
        </label>
        <button type="button" className="btn ml-auto" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <PrintHeader className="print-only" label="" title={`Price list: ${name}`} when={`Prices on ${dateText(on)}`} />
      <p className="mt-2">
        <b>{name}</b> · prices on {dateText(on)}
        <span className="small block">
          {check?.confirmed ? "Prices confirmed." : "Prices not confirmed yet."} Per lb unless it says per case or per each.
        </span>
      </p>
      <table className="simple mt-1">
        <thead>
          <tr>
            <th>Product</th>
            <th className="text-right">Price</th>
            <th>From</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <PriceListGroup key={g.group} group={g.group}>
              {g.products.map((p) => {
                const r = priceFor(prices, p.id, customer.id, on, chainId);
                return (
                  <tr key={p.id}>
                    <td>{title(p)}</td>
                    <td className="num whitespace-nowrap text-right">
                      {r ? (
                        <>
                          {priceText(r.price)}
                          {PRICE_UNIT_SHORT[p.price_unit]}
                        </>
                      ) : (
                        <span className="tag extra">Price needed</span>
                      )}
                    </td>
                    <td className="small">{r ? (priceSource(r, customer.id) === "default" ? label(r) : <b>{label(r)}</b>) : ""}</td>
                  </tr>
                );
              })}
            </PriceListGroup>
          ))}
        </tbody>
      </table>
    </>
  );
}

function PriceListGroup({ group, children }: { group: string; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <th colSpan={3} className="pt-3 text-left">
          {group}
        </th>
      </tr>
      {children}
    </>
  );
}
