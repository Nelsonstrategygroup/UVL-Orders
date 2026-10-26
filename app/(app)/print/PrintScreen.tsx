"use client";

// Print and download (change request 10/21/26, stage 2): everything to print
// or download, grouped by when in the week it's used. Every report opens as a
// readable page (Open) and downloads as a spreadsheet (Download); both build
// the same table (./reports). Print items open their own pages, and show only
// to people who can open them. The full backup for moving the data is
// "Export all data" in Setup.

import Link from "next/link";
import { useState } from "react";
import { useCan } from "@/components/CurrentUser";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useWeekData } from "@/components/data/useWeekData";
import { downloadTable, FILE_TYPE_LABEL, useFileType, type FileType } from "@/components/download";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { displayName, sortByDisplayName } from "@/lib/calc/customers";
import { addDays, currentWeek, packingMonday, niceDate, todayISO } from "@/lib/dates";
import { buildReport, REPORTS, reportHref, type ReportKind } from "./reports";

function Item({ title, children, action }: { title: string; children: React.ReactNode; action: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line py-3 first:border-t-0">
      <div className="min-w-[200px] flex-1">
        <b>{title}</b>
        <div className="small muted">{children}</div>
      </div>
      {action}
    </div>
  );
}

/** One card per stage of the week. Cards with nothing in them aren't shown. */
function Card({ when, children }: { when: string; children: React.ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  if (!items.length) return null;
  return (
    <section className="panel mt-3">
      <h3 className="mb-1">{when}</h3>
      {items}
    </section>
  );
}

const open = (href: string, label = "Open") => (
  <Link href={href} className="btn shrink-0">
    {label}
  </Link>
);

export default function PrintScreen() {
  const { catalog, customers, error: loadError } = useStaffData();
  const { week } = useWeek();
  const { data, error } = useWeekData(week);
  const toast = useToast();
  const seeOrders = useCan("orders").view;
  const seeCutSheet = useCan("cutsheet").view;
  const seePacking = useCan("packing").view;
  const [busy, setBusy] = useState<string | null>(null);
  const [fileType, setFileType] = useFileType();
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

  const download = async (kind: ReportKind) => {
    setBusy(kind);
    try {
      const r = await buildReport(kind, { db: getDb(), week, catalog, customers, data, customerId, from, to });
      if (!r) return;
      if (kind === "history" && !r.table.rows.length) toast("No orders yet to download.");
      else await downloadTable(r.file, r.table, r.sheet, REPORTS[kind].xlsxOnly ? "xlsx" : fileType);
    } catch {
      toast("Couldn't download. Check the internet connection.");
    } finally {
      setBusy(null);
    }
  };
  /** Open (the readable page) and Download, for a report with a spreadsheet. */
  const both = (kind: ReportKind, ready = true, filters: { customerId?: string; from?: string; to?: string } = {}) => (
    <div className="flex shrink-0 gap-2">
      {ready ? (
        <Link href={reportHref(kind, filters)} className="btn">
          Open
        </Link>
      ) : (
        <button type="button" className="btn" disabled>
          Open
        </button>
      )}
      <button type="button" className="btn ghost" disabled={!!busy || !ready} onClick={() => void download(kind)}>
        {busy === kind ? "Getting it ready..." : "Download"}
      </button>
    </div>
  );

  const sorted = sortByDisplayName(customers.list, customers.byId);
  const rangeOk = !!from && !!to && from <= to;

  return (
    <div className="max-w-[760px]">
      <WeekBar />
      <h2 className="mb-1">Print and download</h2>
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="small">Spreadsheets as</span>
        <div className="seg" role="group" aria-label="File type">
          {(["csv", "xlsx"] as FileType[]).map((t) => (
            <button key={t} type="button" aria-pressed={fileType === t} onClick={() => setFileType(t)}>
              {FILE_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      <p className="small muted mt-0">
        {fileType === "xlsx" ? "Excel workbook (.xlsx)." : "CSV opens anywhere, including Google Sheets."} Remembered on this device.
        Open shows a report as a page to read or print.
      </p>

      <Card when="Thursday, orders">
        {seeOrders && (
          <Item key="sheets" title="Order sheets" action={open("/orders/sheet")}>
            Every product in its group with room to write the amount, one sheet per customer, or a blank one.
          </Item>
        )}
        <Item key="week" title="This week's orders" action={both("week-orders")}>
          Every customer with contact, phone, email, and who to bill, and what they ordered.
        </Item>
        <Item key="grid" title="Order grid" action={both("order-grid")}>
          Customers down the side, products across the top, like the grid on Orders. Downloads as Excel.
        </Item>
      </Card>

      <Card when="Weekend, cut sheet">
        {seeCutSheet && (
          <Item key="cut" title="Cut sheet for Mohawk" action={open("/cut-sheet")}>
            Open the sheet to check it, then print it or email it.
          </Item>
        )}
        <Item key="totals" title="Product totals" action={both("product-totals")}>
          Each product added up across customers, plus half and whole lambs, with packed and short. A pick list, and a check
          against what Mohawk cut.
        </Item>
      </Card>

      <Card when="Before packing day">
        {seePacking && (
          <Item key="labels" title="Box Label Report" action={open("/packing/labels")}>
            One row for every box, to make the customer labels before packing day.
          </Item>
        )}
      </Card>

      {/* Tuesday, shipping and billing (manifest, invoices) goes here once the app has them. */}

      <Card when="Monday, packing">
        {seePacking && (
          <Item key="paper" title="Paper packing copy" action={open("/packing/print")}>
            The backup for when there&apos;s no internet: a blank for each box&apos;s weight under its label number, then
            the total. Print it before packing day.
          </Item>
        )}
        {seePacking && (
          <Item key="paper-in" title="Type in from paper" action={open("/packing/paper")}>
            After packing on paper, type the weights in. Laid out just like the paper.
          </Item>
        )}
        <Item key="record" title="Packing record" action={both("packing-record")}>
          Ordered against packed, short or over, each box&apos;s weight and label number, who packed each line and when, and pallet.
        </Item>
      </Card>

      <section className="panel mt-3">
        <h3 className="mb-1">Anytime</h3>
        <Item title="Customer list" action={both("customers")}>
          Every customer and contact, with what each person handles, call days, chains, and standing notes.
        </Item>
        <Item title="One customer's order history" action={both("history", !!customers.byId.get(customerId), { customerId })}>
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
        <Item title="Sales over a date range" action={both("sales", rangeOk, { from, to })}>
          How much each customer ordered of each product. Quantities only; the app doesn&apos;t have prices.
          <span className="mt-1 flex flex-wrap items-end gap-3">
            <span>
              <label className="lbl" htmlFor="dl-from">
                From
              </label>
              <input id="dl-from" type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
            </span>
            <span>
              <label className="lbl" htmlFor="dl-to">
                To
              </label>
              <input id="dl-to" type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
            </span>
          </span>
          <span className="block">
            {rangeOk
              ? `Packing Mondays ${niceDate(packingMonday(from))} through ${niceDate(packingMonday(to))}.`
              : "Pick a From date on or before the To date."}
          </span>
        </Item>
        <Item title="Freezer on hand" action={both("freezer")}>
          What&apos;s in the freezer now, what half and whole orders are counting on, and what&apos;s free.
        </Item>
        <Item
          title="Box sizes"
          action={
            <div className="flex shrink-0 flex-wrap gap-2">
              <Link href={reportHref("box-sizes")} className="btn">
                Open
              </Link>
              <Link href={`${reportHref("box-sizes")}?print=1`} className="btn ghost">
                Print
              </Link>
              <button type="button" className="btn ghost" disabled={!!busy} onClick={() => void download("box-sizes")}>
                {busy === "box-sizes" ? "Getting it ready..." : "Download"}
              </button>
            </div>
          }
        >
          How much of each product fits in each box, as in Setup &gt; Boxes, with a blank Notes column to write corrections on.
        </Item>
      </section>

      <p className="small muted mt-4">
        For a full copy of everything in the app, to keep or to move to new accounts, an admin can use Export all data in
        Setup.
      </p>
    </div>
  );
}
