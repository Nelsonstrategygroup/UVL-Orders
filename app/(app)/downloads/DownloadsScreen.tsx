"use client";

// Downloads: spreadsheets for people (names, not ID codes), in one place.
// The full backup for moving the data is "Export all data" in Setup.

import { useState } from "react";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useWeekData } from "@/components/data/useWeekData";
import { downloadText } from "@/components/download";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { displayName, orderingCustomers, sortByDisplayName } from "@/lib/calc/customers";
import { halfWholeNeeds } from "@/lib/calc/halfWhole";
import { countUnit } from "@/lib/calc/units";
import { addDays, currentWeek, mondayOf, niceDate, todayISO } from "@/lib/dates";
import { loadCustomerOrders, loadOrdersBetween, loadPackingRecord } from "@/lib/db/load";
import { formatDateTime } from "@/lib/format";
import {
  customerHistoryCsv,
  customerListCsv,
  fileSafe,
  freezerCsv,
  packingRecordCsv,
  productTotalsCsv,
  salesCsv,
  weekOrdersCsv,
} from "@/lib/reports";

function Item({ title, children, action }: { title: string; children: React.ReactNode; action: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line py-3 first:border-t-0">
      <div className="min-w-[220px] flex-1">
        <b>{title}</b>
        <div className="small muted">{children}</div>
      </div>
      {action}
    </div>
  );
}

export default function DownloadsScreen() {
  const { catalog, customers, error: loadError } = useStaffData();
  const { week } = useWeek();
  const { data, error } = useWeekData(week);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [from, setFrom] = useState(() => addDays(currentWeek(), -7 * 12));
  const [to, setTo] = useState(() => todayISO());

  if (loadError || error) return <p className="note bad">Couldn&apos;t load: {loadError ?? error}</p>;
  if (!catalog || !customers || !data)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const run = async (key: string, fn: () => Promise<void> | void) => {
    setBusy(key);
    try {
      await fn();
    } catch {
      toast("Couldn't download. Check the internet connection.");
    }
    setBusy(null);
  };
  const btn = (key: string, fn: () => Promise<void> | void, disabled = false) => (
    <button type="button" className="btn ghost shrink-0" disabled={!!busy || disabled} onClick={() => void run(key, fn)}>
      {busy === key ? "Getting it ready..." : "Download"}
    </button>
  );

  const ordering = new Set(orderingCustomers(customers.list).map((c) => c.id));
  const weekList = customers.list.filter((c) => ordering.has(c.id) || data.orders.has(c.id));
  const { short, need, onHand } = halfWholeNeeds(data.freezer, data.halfWhole, catalog.parts, catalog.products);
  const freezerProducts = catalog.products
    .filter((p) => !p.fresh_only && (p.active || (onHand[p.id] ?? 0) !== 0))
    .map((p) => ({ ...p, countUnit: countUnit(p, catalog.parts) }));
  const sorted = sortByDisplayName(customers.list, customers.byId);
  const chosen = customers.byId.get(customerId);
  const rangeOk = !!from && !!to && from <= to;

  return (
    <div className="max-w-[760px]">
      <h2 className="mb-1">Downloads</h2>
      <p className="muted mt-0">Spreadsheets that open in Excel or Google Sheets.</p>

      <WeekBar processDate={data.weekRow?.process_date} />

      <section className="panel mt-2">
        <h3 className="mb-1">For the week of {niceDate(week)}</h3>
        <Item
          title="This week's orders"
          action={btn("week", () =>
            downloadText(
              `orders-week-of-${week}.csv`,
              weekOrdersCsv(week, weekList, customers.byId, data.orders, data.packed, catalog.products),
            ),
          )}
        >
          Every customer with contact, phone, email, and who to bill, and what they ordered.
        </Item>
        <Item
          title="Product totals"
          action={btn("totals", () =>
            downloadText(
              `product-totals-week-of-${week}.csv`,
              productTotalsCsv(week, catalog.products, [...data.orders.values()], data.packed, short),
            ),
          )}
        >
          Each product added up across customers, plus half and whole lambs, with packed and short. A pick list, and a check
          against what Mohawk cut.
        </Item>
        <Item
          title="Packing record"
          action={btn("packing", async () => {
            const records = await loadPackingRecord(getDb(), week);
            downloadText(
              `packing-record-week-of-${week}.csv`,
              packingRecordCsv(week, records, customers.byId, catalog.products, formatDateTime),
            );
          })}
        >
          Ordered against packed, short or over, who packed each line and when, boxes, and pallet.
        </Item>
      </section>

      <section className="panel mt-4">
        <h3 className="mb-1">Customers</h3>
        <Item
          title="Customer list"
          action={btn("customers", () => downloadText("customer-list.csv", customerListCsv(customers.list, customers.byId)))}
        >
          Every customer and contact, with what each person handles, call days, chains, and standing notes.
        </Item>
        <Item
          title="One customer's order history"
          action={btn(
            "history",
            async () => {
              if (!chosen) return;
              const name = displayName(chosen, customers.byId);
              const orders = await loadCustomerOrders(getDb(), chosen.id);
              if (!orders.length) {
                toast("No orders yet to download.");
                return;
              }
              downloadText(`${fileSafe(name)}-order-history.csv`, customerHistoryCsv(name, orders, catalog.products));
            },
            !chosen,
          )}
        >
          <label htmlFor="dl-customer" className="sr-only">
            Customer
          </label>
          <select id="dl-customer" className="field mt-1" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Pick a customer</option>
            {sorted.map((c) => (
              <option key={c.id} value={c.id}>
                {displayName(c, customers.byId)}
              </option>
            ))}
          </select>
        </Item>
      </section>

      <section className="panel mt-4">
        <h3 className="mb-1">Sales over a date range</h3>
        <p className="small muted mt-0">
          How much each customer ordered of each product. Quantities only; the app doesn&apos;t have prices.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="lbl" htmlFor="dl-from">
              From
            </label>
            <input id="dl-from" type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="lbl" htmlFor="dl-to">
              To
            </label>
            <input id="dl-to" type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {btn(
            "sales",
            async () => {
              const a = mondayOf(from);
              const b = mondayOf(to);
              const orders = await loadOrdersBetween(getDb(), a, b);
              downloadText(`sales-${a}-to-${b}.csv`, salesCsv(a, b, orders, customers.byId, catalog.products));
            },
            !rangeOk,
          )}
        </div>
        <p className="small muted mb-0">
          {rangeOk
            ? `Weeks of ${niceDate(mondayOf(from))} through ${niceDate(mondayOf(to))}.`
            : "Pick a From date on or before the To date."}
        </p>
      </section>

      <section className="panel mt-4">
        <h3 className="mb-1">Freezer</h3>
        <Item
          title="Freezer on hand"
          action={btn("freezer", () =>
            downloadText(`freezer-${todayISO()}.csv`, freezerCsv(todayISO(), freezerProducts, onHand, need)),
          )}
        >
          What&apos;s in the freezer now, what half and whole orders are counting on, and what&apos;s free.
        </Item>
      </section>

      <p className="small muted mt-4">
        For a full copy of everything in the app, to keep or to move to new accounts, an admin can use Export all data in
        Setup.
      </p>
    </div>
  );
}
