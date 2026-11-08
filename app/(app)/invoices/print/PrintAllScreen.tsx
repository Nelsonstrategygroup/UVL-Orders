"use client";

// Every invoice of a week, one after another, to print together (Print all
// on Invoices). ?week= keeps the week it was opened for.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useStaffData } from "@/components/data/StaffData";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { compareCustomerIds } from "@/lib/calc/customers";
import { isISODate } from "@/lib/dates";
import InvoiceSheet from "../InvoiceSheet";
import { sheetFor } from "../sheet";
import { useInvoiceWeek } from "../useInvoiceWeek";

export default function PrintAllScreen() {
  const params = useSearchParams();
  const { week, setWeek } = useWeek();
  const toast = useToast();
  const asked = params.get("week");
  useEffect(() => {
    if (asked && isISODate(asked) && asked !== week) setWeek(asked);
    // Only when opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  const { catalog, customers } = useStaffData();
  const { data, error } = useInvoiceWeek(week);

  if (error) return <p className="note bad">Couldn&apos;t load invoices: {error}</p>;
  if (!data || !customers)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );
  const sheets = data.invoices
    .filter((i) => i.status !== "void")
    .sort((a, b) => compareCustomerIds(customers.byId)(a.customer_id, b.customer_id))
    .map((inv) => sheetFor(data, inv, customers, catalog));

  return (
    <>
      <div className="screen-only">
        <WeekBar inv={data.weekNumber == null ? null : String(data.weekNumber)} />
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/invoices" className="btn ghost">
            &larr; Invoices
          </Link>
          <h2 className="mr-auto">All invoices ({sheets.length})</h2>
          <button type="button" className="btn" disabled={!sheets.length} onClick={() => window.print()}>
            Print
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={!sheets.length}
            onClick={() => {
              toast('In the print window, choose "Save as PDF" as the printer.');
              setTimeout(() => window.print(), 600);
            }}
          >
            Save as PDF
          </button>
        </div>
        {!sheets.length && <div className="empty">No invoices this week.</div>}
      </div>
      {sheets.map((s) => (
        <InvoiceSheet key={s.invoice.id} {...s} />
      ))}
    </>
  );
}
