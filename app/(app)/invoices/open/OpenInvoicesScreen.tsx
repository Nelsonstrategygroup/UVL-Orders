"use client";

// Open invoices (SPEC 15, stage 3): every finalized invoice, any week, with
// money still owed: total, paid, balance and days overdue. Sorted by invoice
// number (which groups by week, then location), by due date, or by location.

import Link from "next/link";
import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { displayName } from "@/lib/calc/customers";
import { daysOverdue } from "@/lib/calc/invoice";
import { centsText } from "@/lib/calc/prices";
import { niceDate, todayISO } from "@/lib/dates";
import { loadIssuedInvoices } from "@/lib/db/invoices";
import { toIssued } from "@/lib/invoiceExport";
import { reportHref } from "../../print/reports";

type Sort = "number" | "due" | "location";
const SORTS: { key: Sort; label: string }[] = [
  { key: "number", label: "Invoice number" },
  { key: "due", label: "Due date" },
  { key: "location", label: "Location" },
];

const dateText = (d: string) => `${niceDate(d)}, ${d.slice(0, 4)}`;

export default function OpenInvoicesScreen() {
  const { catalog, customers } = useStaffData();
  const load = useCallback((db: SupabaseClient) => loadIssuedInvoices(db), []);
  const { data, error } = useLive("open-invoices", load, ["invoices", "payments"]);
  const [sort, setSort] = useState<Sort>("number");

  if (error) return <p className="note bad">Couldn&apos;t load invoices: {error}</p>;
  if (!data || !customers) return <div className="empty">Loading...</div>;

  const today = todayISO();
  const productName = (id: string) => catalog?.productById.get(id)?.name ?? id;
  const customerName = (id: string) => {
    const c = customers.byId.get(id);
    return c ? displayName(c, customers.byId) : "Unknown customer";
  };
  const rows = data
    .map((inv) => ({ inv, x: toIssued(inv, productName, customerName) }))
    .filter(({ x }) => x.totalCents - x.paidCents !== BigInt(0))
    .sort((a, b) => {
      const byNumber = a.x.number.localeCompare(b.x.number, undefined, { numeric: true });
      if (sort === "due") return a.x.dueDate.localeCompare(b.x.dueDate) || byNumber;
      if (sort === "location") return a.x.customer.localeCompare(b.x.customer, undefined, { numeric: true }) || byNumber;
      return byNumber;
    });
  const sum = (f: (r: (typeof rows)[number]) => bigint) => rows.reduce((s, r) => s + f(r), BigInt(0));
  const overdue = rows.filter((r) => daysOverdue(r.x.dueDate, today) > 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/invoices" className="btn ghost">
          &larr; Invoices
        </Link>
        <h2 className="mr-auto">Open invoices</h2>
        <Link href={reportHref("open-invoices")} className="btn ghost">
          Print or download
        </Link>
      </div>
      <p className="small muted mt-1">
        Finalized invoices with money still owed, every week. Drafts aren&apos;t here until they&apos;re finalized.
        {overdue.length > 0 && ` ${overdue.length} overdue: ${centsText(overdue.reduce((s, r) => s + r.x.totalCents - r.x.paidCents, BigInt(0)))}.`}
      </p>
      <div className="seg mt-1" role="group" aria-label="Sort by">
        {SORTS.map((s) => (
          <button key={s.key} type="button" aria-pressed={sort === s.key} onClick={() => setSort(s.key)}>
            {s.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="empty">Nothing owed. Every finalized invoice is paid.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="simple mt-2">
            <thead>
              <tr>
                <th>Location</th>
                <th>Invoice</th>
                <th>Date</th>
                <th>Due</th>
                <th className="num">Total</th>
                <th className="num">Paid</th>
                <th className="num">Balance</th>
                <th className="num">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ inv, x }) => {
                const late = daysOverdue(x.dueDate, today);
                return (
                  <tr key={inv.id}>
                    <td>{x.customer}</td>
                    <td>
                      <Link href={`/invoices/${inv.id}`}>{x.number}</Link>
                      <span className="small muted block">{x.status}</span>
                    </td>
                    <td>{dateText(x.invoiceDate)}</td>
                    <td>{dateText(x.dueDate)}</td>
                    <td className="num">{centsText(x.totalCents)}</td>
                    <td className="num">{x.paidCents > BigInt(0) ? centsText(x.paidCents) : ""}</td>
                    <td className="num">
                      <b>{centsText(x.totalCents - x.paidCents)}</b>
                    </td>
                    <td className="num">{late ? <span className="tag extra">{late} days</span> : ""}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={4}>{rows.length} open</th>
                <th className="num">{centsText(sum((r) => r.x.totalCents))}</th>
                <th className="num">{centsText(sum((r) => r.x.paidCents))}</th>
                <th className="num">{centsText(sum((r) => r.x.totalCents - r.x.paidCents))}</th>
                <th />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
