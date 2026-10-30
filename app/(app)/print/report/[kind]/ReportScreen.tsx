"use client";

// A report from Print and download as a page to read and print (change
// request 10/21/26), with the same filters and the Download kept on it. On a
// phone a narrow report reads as one card per customer, product or week; a
// wide one scrolls sideways with its first column fixed. On paper: a table,
// letter, portrait (landscape when wide), headers repeated on every page.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useWeekData } from "@/components/data/useWeekData";
import { downloadTable, useFileType } from "@/components/download";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { displayName, sortByDisplayName } from "@/lib/calc/customers";
import { fmt } from "@/lib/calc/num";
import { addDays, currentWeek, longDate, niceDate, packingMonday, todayISO, weekName } from "@/lib/dates";
import { readable } from "@/lib/readable";
import type { Table } from "@/lib/reports";
import type { CarcassReport } from "@/lib/calc/carcassReport";
import { buildReport, REPORTS, reportHref, type ReportKind } from "../../reports";
import CarcassBalance from "./CarcassBalance";

type Built = { key: string; table: Table; file: string; sheet: string; carcass?: CarcassReport } | { key: string; none: true } | { key: string; error: string };

export default function ReportScreen(props: { kind: ReportKind; customer: string; from: string; to: string; print?: boolean }) {
  const { kind } = props;
  const def = REPORTS[kind];
  const { catalog, customers, error: loadError } = useStaffData();
  const { week } = useWeek();
  const { data, error } = useWeekData(week);
  const toast = useToast();
  const [fileType] = useFileType();
  const [customerId, setCustomerId] = useState(props.customer);
  const [from, setFrom] = useState(props.from || addDays(currentWeek(), -7 * 12));
  const [to, setTo] = useState(props.to || todayISO());
  const [built, setBuilt] = useState<Built | null>(null);

  // Rebuilt when the week, the filters, or the data change (the data is live).
  const key = `${kind}|${week}|${customerId}|${from}|${to}`;
  useEffect(() => {
    if (!catalog || !customers || !data) return;
    let live = true;
    buildReport(kind, { db: getDb(), week, catalog, customers, data, customerId, from, to }).then(
      (r) => live && setBuilt(r ? { key, ...r } : { key, none: true }),
      (e: unknown) => live && setBuilt({ key, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [kind, key, week, catalog, customers, data, customerId, from, to]);

  // Keep the address in step with the filters, so it can be bookmarked or shared.
  useEffect(() => {
    const href = reportHref(kind, { customerId, from: def.filter === "range" ? from : "", to: def.filter === "range" ? to : "" });
    if (location.pathname + location.search !== href) history.replaceState(null, "", href);
  }, [kind, def.filter, customerId, from, to]);

  const current = built?.key === key ? built : null;
  const view = useMemo(() => (current && "table" in current ? readable(current.table, def.shape) : null), [current, def.shape]);

  // Opened with Print from Print and download: print once the report is ready.
  const [printed, setPrinted] = useState(false);
  useEffect(() => {
    if (!props.print || printed || !view?.rows.length) return;
    const t = setTimeout(() => {
      setPrinted(true);
      window.print();
    }, 300);
    return () => clearTimeout(t);
  }, [props.print, printed, view]);

  if (loadError || error) return <p className="note bad">Couldn&apos;t load: {loadError ?? error}</p>;
  if (!catalog || !customers)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const sorted = sortByDisplayName(customers.list, customers.byId);
  const subtitle =
    def.filter === "week"
      ? // Columns with one value for the whole report (the carcass balance's lambs) go under the title.
        [`Packing ${weekName(week)}`, ...(view?.constants ?? []).filter((f) => f.label !== "Week of").map((f) => `${f.label}: ${f.value}`)].join(" · ")
      : def.filter === "range" && from && to && from <= to
        ? `Packing Mondays ${niceDate(packingMonday(from))} through ${niceDate(packingMonday(to))}`
        : def.filter === "customer" && customers.byId.get(customerId)
          ? displayName(customers.byId.get(customerId)!, customers.byId)
          : kind === "freezer"
            ? `As of ${niceDate(todayISO())}`
            : kind === "box-sizes"
              ? `${fmt(catalog.boxes.capLb)} lb maximum per box · Printed ${longDate(todayISO())}`
              : "";

  async function download() {
    if (!current || !("table" in current)) return;
    try {
      await downloadTable(current.file, current.table, current.sheet, def.xlsxOnly ? "xlsx" : fileType);
    } catch {
      toast("Couldn't download. Check the internet connection.");
    }
  }

  return (
    <div className={def.wide ? "" : "max-w-[1000px]"}>
      {/* Paper: letter, portrait unless the report is wide. */}
      <style>{`@media print { @page { size: letter ${def.wide ? "landscape" : "portrait"}; margin: 0.4in; } }`}</style>
      <div className="screen-only">
        {def.filter === "week" && <WeekBar />}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto">{def.title}</h2>
          <Link href="/print" className="btn ghost">
            &larr; Print and download
          </Link>
          <button type="button" className="btn ghost" disabled={!view} onClick={() => void download()}>
            Download
          </button>
          <button type="button" className="btn" disabled={!view} onClick={() => window.print()}>
            Print
          </button>
        </div>

        {def.filter === "customer" && (
          <div className="mt-2">
            <label htmlFor="rp-customer" className="lbl">
              Customer
            </label>
            <select id="rp-customer" className="field max-w-[420px]" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Pick a customer</option>
              {sorted.map((c) => (
                <option key={c.id} value={c.id}>
                  {displayName(c, customers.byId)}
                </option>
              ))}
            </select>
          </div>
        )}
        {def.filter === "range" && (
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <div>
              <label className="lbl" htmlFor="rp-from">
                From
              </label>
              <input id="rp-from" type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="lbl" htmlFor="rp-to">
                To
              </label>
              <input id="rp-to" type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        )}
        {(def.filter === "none" || (def.filter === "week" && subtitle.includes(" · "))) && subtitle && <p className="muted mt-1 mb-0">{subtitle}</p>}
        {def.wide && <p className="note small rp-laptop">Easier to read on a laptop.</p>}
      </div>

      <div className="rp">
        <header className="rp-head">
          <h1>{def.title}</h1>
          {subtitle && <div>{subtitle}</div>}
        </header>

        {!current ? (
          <div className="empty">Getting it ready...</div>
        ) : "error" in current ? (
          <p className="note bad">Couldn&apos;t load: {current.error}</p>
        ) : "none" in current ? (
          <p className="empty">
            {def.filter === "customer" ? "Pick a customer to see their orders." : "Pick a From date on or before the To date."}
          </p>
        ) : "carcass" in current && current.carcass ? (
          <CarcassBalance r={current.carcass} />
        ) : !view?.rows.length ? (
          <p className="empty">Nothing to show for this {def.filter === "week" ? "week" : "report"} yet.</p>
        ) : (
          <>
            {!def.wide && (
              <div className="rp-cards">
                {view.cards.map((c, i) => (
                  <section key={i} className="rp-card">
                    <h3>{c.title || "—"}</h3>
                    {c.fields.length > 0 && (
                      <dl>
                        {c.fields.map((f) => (
                          <div key={f.label}>
                            <dt>{f.label}</dt>
                            <dd>{f.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {c.items.length > 0 && (
                      <ul>
                        {c.items.map((it, j) => (
                          <li key={j}>
                            <b>{it.title}</b>
                            {it.fields.length > 0 && <span> {it.fields.map((f) => (f.label ? `${f.label} ${f.value}` : f.value)).join(" · ")}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            )}
            <div className={`rp-scroll ${def.wide ? "wide" : "narrow"}`}>
              <table className={`rp-table ${def.lined ? "lined" : ""}`}>
                <thead>
                  <tr>
                    {view.columns.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.rows.map((r, i) =>
                    // A group heading spans the row; the totals line (order grid) stands out.
                    view.kinds[i] === "section" ? (
                      <tr key={i} className="section">
                        <td colSpan={view.columns.length}>{r[0]}</td>
                      </tr>
                    ) : (
                      <tr key={i} className={view.kinds[i] === "total" ? "total" : i % 2 ? "zebra" : undefined}>
                        {r.map((v, j) => (
                          <td key={j}>{v}</td>
                        ))}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
