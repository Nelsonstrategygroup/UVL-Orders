"use client";

// Print and download (change request 10/21/26, stage 2; by job, Lucas
// 11/6/26): three tabs. This week (with the week picker): orders,
// processing, packing, shipping, invoices. Reports: not about one week.
// Setup checks: lists to check setup against. Every report opens as a
// readable page (Open) and downloads as a spreadsheet (Download); both build
// the same table (./reports). Print items open their own pages, and show only
// to people who can open them. The full backup for moving the data is
// "Export all data" in Setup.

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCan } from "@/components/CurrentUser";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useWeekData } from "@/components/data/useWeekData";
import { downloadTable, FILE_TYPE_LABEL, useFileType, type FileType } from "@/components/download";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { displayName, sortByDisplayName } from "@/lib/calc/customers";
import { addDays, currentWeek, packingMonday, niceDate, todayISO } from "@/lib/dates";
import PackSheetButtons from "./PackSheetButtons";
import PalletManifestPicker from "./PalletManifestPicker";
import { buildReport, REPORTS, reportHref, type ReportKind } from "./reports";

/** The green section heading (Lucas, 11/6/26): a little bolder than a plain heading, so each one stands out. */
const HEAD = "mb-1 border-b-2 border-forest pb-1.5 text-[1.3rem] text-forest";

/**
 * One printout or report. As a `heading` (the Reports tab), it's a card of
 * its own with its title as the green section heading.
 */
function Item({ title, children, action, heading = false }: { title: string; children: React.ReactNode; action: React.ReactNode; heading?: boolean }) {
  const row = (
    <div className="flex flex-wrap items-center gap-3 border-t border-line py-3 first:border-t-0">
      <div className="min-w-[200px] flex-1">
        {!heading && <b>{title}</b>}
        <div className="small muted">{children}</div>
      </div>
      {action}
    </div>
  );
  if (!heading) return row;
  return (
    <section className="panel mt-3">
      <h3 className={HEAD}>{title}</h3>
      {row}
    </section>
  );
}

/** One card per job. Cards with nothing in them aren't shown. */
function Card({ when, children }: { when: string; children: React.ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  if (!items.length) return null;
  return (
    <section className="panel mt-3">
      <h3 className={HEAD}>{when}</h3>
      {items}
    </section>
  );
}

const open = (href: string, label = "Open") => (
  <Link href={href} className="btn shrink-0">
    {label}
  </Link>
);

type Tab = "week" | "reports" | "setup";
const TABS: [Tab, string][] = [
  ["week", "This week"],
  ["reports", "Reports"],
  ["setup", "Setup checks"],
];
const TAB_KEY = "uvl:printTab";

/** The last tab used on this device; "This week" until one is picked. */
function useTab(): [Tab, (t: Tab) => void] {
  const [tab, setTab] = useState<Tab>("week");
  useEffect(() => {
    // Read once after the page loads (there's no storage on the server).
    try {
      const t = localStorage.getItem(TAB_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (t === "reports" || t === "setup") setTab(t);
    } catch {
      // Not remembered; "This week".
    }
  }, []);
  const set = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // Not remembered; fine.
    }
  };
  return [tab, set];
}

/** The last four packing weeks: the four latest packing Mondays on or before today. */
function lastFourWeeks(): { first: string; last: string } {
  const now = currentWeek();
  const last = now <= todayISO() ? now : addDays(now, -7);
  return { first: addDays(last, -21), last };
}

function DateRange({ id, from, to, setFrom, setTo, ok, note }: { id: string; from: string; to: string; setFrom: (d: string) => void; setTo: (d: string) => void; ok: boolean; note: string }) {
  return (
    <>
      <span className="mt-1 flex flex-wrap items-end gap-3">
        <span>
          <label className="lbl" htmlFor={`${id}-from`}>
            From
          </label>
          <input id={`${id}-from`} type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
        </span>
        <span>
          <label className="lbl" htmlFor={`${id}-to`}>
            To
          </label>
          <input id={`${id}-to`} type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
        </span>
      </span>
      <span className="block">{ok ? note : "Pick a From date on or before the To date."}</span>
    </>
  );
}

export default function PrintScreen() {
  const { catalog, customers, error: loadError } = useStaffData();
  const { week } = useWeek();
  const { data, error } = useWeekData(week);
  const toast = useToast();
  const seeOrders = useCan("orders").view;
  const seeCutSheet = useCan("cutsheet").view;
  const seePacking = useCan("packing").view;
  const seeInvoices = useCan("invoices").view;
  const [tab, setTab] = useTab();
  const [busy, setBusy] = useState<string | null>(null);
  const [fileType, setFileType] = useFileType();
  const [customerId, setCustomerId] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  // Sales: packing weeks. QuickBooks lines: invoice dates, through today.
  const [from, setFrom] = useState(() => lastFourWeeks().first);
  const [to, setTo] = useState(() => lastFourWeeks().last);
  const [qbFrom, setQbFrom] = useState(() => lastFourWeeks().first);
  const [qbTo, setQbTo] = useState(() => todayISO());

  const tabs = (
    <div className="seg mb-2" role="tablist" aria-label="Print and download">
      {TABS.map(([t, label]) => (
        <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
          {label}
        </button>
      ))}
    </div>
  );

  if (loadError || error) return <p className="note bad">Couldn&apos;t load: {loadError ?? error}</p>;
  if (!catalog || !customers || !data)
    return (
      <>
        {tab === "week" && <WeekBar />}
        <div className="empty">Loading...</div>
      </>
    );

  const download = async (kind: ReportKind, range?: { from: string; to: string }) => {
    setBusy(kind);
    try {
      const r = await buildReport(kind, { db: getDb(), week, catalog, customers, data, customerId, from: range?.from ?? from, to: range?.to ?? to });
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
      <button
        type="button"
        className="btn ghost"
        disabled={!!busy || !ready}
        onClick={() => void download(kind, filters.from && filters.to ? { from: filters.from, to: filters.to } : undefined)}
      >
        {busy === kind ? "Getting it ready..." : "Download"}
      </button>
    </div>
  );

  // The shared customer order (customers with locations first); active only unless asked.
  const pickable = sortByDisplayName(
    customers.list.filter((c) => showInactive || c.active || c.id === customerId),
    customers.byId,
  );
  const rangeOk = !!from && !!to && from <= to;
  const qbOk = !!qbFrom && !!qbTo && qbFrom <= qbTo;
  // Every tab has a Download button today; the choice shows only where one does.
  const hasDownload = true;

  return (
    <div className="max-w-[760px]">
      {tab === "week" && <WeekBar />}
      <h2 className="mb-1">Print and download</h2>
      {tabs}
      {hasDownload && (
        <>
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
            {fileType === "xlsx" ? "Excel workbook (.xlsx)." : "CSV opens anywhere, including Google Sheets."} Remembered on this
            device. Open shows a report as a page to read or print.
          </p>
        </>
      )}

      {tab === "week" && (
        <div role="tabpanel" aria-label="This week">
          <Card when="Orders">
            {seeOrders && (
              <Item key="sheets" title="Order sheets" action={open("/orders/sheet")}>
                One sheet per customer to write amounts on, or a blank one.
              </Item>
            )}
            <Item key="week" title="This week's orders" action={both("week-orders")}>
              Every customer, their contact and who to bill, and what they ordered.
            </Item>
            <Item key="grid" title="Order grid" action={both("order-grid")}>
              Customers down the side, products across, like Orders. Downloads as Excel.
            </Item>
          </Card>

          <Card when="Processing">
            {seeCutSheet && (
              <Item key="cut" title="Cut sheet" action={open("/cut-sheet")}>
                Check the cut sheet, then print it or email it.
              </Item>
            )}
            <Item key="balance" title="Carcass balance" action={both("carcass-balance")}>
              Each part: what the lambs give, where it goes, and what&apos;s left or short.
            </Item>
            <Item key="totals" title="Product totals" action={both("product-totals")}>
              Each product added up across customers, with packed and short.
            </Item>
          </Card>

          <Card when="Packing">
            {seePacking && (
              <Item key="labels" title="Box Label Report" action={open("/packing/labels")}>
                One row for every box, to make the labels before packing day.
              </Item>
            )}
            {seePacking && (
              <Item key="weigh" title="Weigh Sheet" action={<PackSheetButtons week={week} kind="weigh" fileType={fileType} />}>
                Each store&apos;s boxes by product, with room to write each weight.
              </Item>
            )}
            {seePacking && (
              <Item key="pallet-sheet" title="Pallet Sheet" action={<PackSheetButtons week={week} kind="pallet" fileType={fileType} />}>
                Each store&apos;s products to check off, with Pallet and Initials.
              </Item>
            )}
            <Item key="record" title="Packing record" action={both("packing-record")}>
              Ordered against packed, each box&apos;s weight, who packed it and when.
            </Item>
          </Card>

          <Card when="Shipping">
            {seePacking && (
              <Item key="crossdock" title="Cross dock sheets" action={<PalletManifestPicker week={week} kind="crossdock" />}>
                One page per distributor and ship date, with cases and weight.
              </Item>
            )}
            {seePacking && (
              <Item key="pallet-labels" title="Pallet labels" action={<PalletManifestPicker week={week} kind="labels" />}>
                One label per pallet for the outside, two copies each.
              </Item>
            )}
            {seePacking && (
              <Item key="manifest" title="Pallet manifests" action={<PalletManifestPicker week={week} kind="manifests" />}>
                Every box by customer, with lot and net weight, to ship with the pallet.
              </Item>
            )}
          </Card>

          {seeInvoices && (
            <Card when="Invoices">
              <Item key="inv-week" title="This week's invoices" action={open(`/invoices/print?week=${week}`)}>
                Every invoice for the week, to print or save as a PDF.
              </Item>
            </Card>
          )}
        </div>
      )}

      {tab === "reports" && (
        <div role="tabpanel" aria-label="Reports">
          {seeInvoices && (
            <Item heading title="Open invoices" action={both("open-invoices")}>
              Finalized invoices with money still owed, and days overdue.
            </Item>
          )}
          {seeInvoices && (
            <Item heading title="Invoice lines for QuickBooks" action={both("invoice-lines", qbOk, { from: qbFrom, to: qbTo })}>
              One row per line of finalized invoices dated From to To, for QuickBooks.
              <DateRange
                id="qb"
                from={qbFrom}
                to={qbTo}
                setFrom={setQbFrom}
                setTo={setQbTo}
                ok={qbOk}
                note={`Invoices dated ${niceDate(qbFrom)} through ${niceDate(qbTo)}.`}
              />
            </Item>
          )}
          <Item heading title="Sales over a date range" action={both("sales", rangeOk, { from, to })}>
            How much each customer ordered of each product. No prices.
            <DateRange
              id="dl"
              from={from}
              to={to}
              setFrom={setFrom}
              setTo={setTo}
              ok={rangeOk}
              note={`Packing Mondays ${niceDate(packingMonday(from))} through ${niceDate(packingMonday(to))}.`}
            />
          </Item>
          <Item heading title="One customer's order history" action={both("history", !!customers.byId.get(customerId), { customerId })}>
            <label htmlFor="dl-customer" className="sr-only">
              Customer
            </label>
            <select id="dl-customer" className="field mt-1" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Pick a customer</option>
              {pickable.map((c) => (
                <option key={c.id} value={c.id}>
                  {displayName(c, customers.byId)}
                  {c.active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
            <label className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => {
                  setShowInactive(e.target.checked);
                  const picked = customers.byId.get(customerId);
                  if (!e.target.checked && picked && !picked.active) setCustomerId("");
                }}
              />
              Show inactive
            </label>
          </Item>
          <Item heading title="Freezer on hand" action={both("freezer")}>
            What&apos;s in the freezer, what orders are counting on, and what&apos;s free.
          </Item>
          <Item heading title="Customer list" action={both("customers")}>
            Every customer and contact, with call days, chains and standing notes.
          </Item>
        </div>
      )}

      {tab === "setup" && (
        <section className="panel mt-3" role="tabpanel" aria-label="Setup checks">
          {seeInvoices && (
            <Item title="Invoice codes" action={both("invoice-codes")}>
              Each location&apos;s invoice code, with room to write corrections.
            </Item>
          )}
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
            How much of each product fits in each box, with room for notes.
          </Item>
        </section>
      )}

      <p className="small muted mt-4">
        For a full copy of everything in the app, to keep or to move to new accounts, an admin can use Export all data in Setup.
      </p>
    </div>
  );
}
