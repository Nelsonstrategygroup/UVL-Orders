"use client";

// Setup > Invoicing (SPEC 15, stage 1): the business and remit-to details
// printed on invoices, the default terms (Net 15), each week's invoice
// number, and each location's invoice code, terms, bill-to address and box
// detail. Codes and numbers can be changed any time; the database keeps
// them unique.

import Link from "next/link";
import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCan } from "@/components/CurrentUser";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useToast } from "@/components/Toast";
import { displayName, sortByDisplayName } from "@/lib/calc/customers";
import { cleanCode, invoiceNumberText, isInvoiceCode, parseWeekNumber, suggestWeekNumber } from "@/lib/calc/invoiceNumbers";
import { currentWeek, niceDate } from "@/lib/dates";
import {
  loadCustomerBilling,
  loadInvoiceSettings,
  loadWeekNumbers,
  saveCustomerBilling,
  setWeekInvoiceNumber,
  updateInvoiceSettings,
  type InvoiceSettings,
} from "@/lib/db/invoicing";

export default function Invoicing() {
  const canEdit = useCan("invoices").change;
  return (
    <>
      <Business canEdit={canEdit} />
      <WeekNumbers canEdit={canEdit} />
      <Locations canEdit={canEdit} />
    </>
  );
}

function useAfter(refresh: () => void) {
  const toast = useToast();
  return (err: string | null) => {
    toast(err ? `Couldn't save: ${err}` : "Saved");
    refresh();
  };
}

function Business({ canEdit }: { canEdit: boolean }) {
  const db = getDb();
  const load = useCallback((d: SupabaseClient) => loadInvoiceSettings(d), []);
  const { data: s, refresh } = useLive("invoice-settings", load, ["invoice_settings"]);
  const after = useAfter(refresh);
  if (s === undefined || s === null) return <p className="small muted">Loading...</p>;

  const text = (key: keyof InvoiceSettings, label: string, rows = 1, placeholder = "") => {
    const v = String(s[key] ?? "");
    const props = {
      key: `${key}:${v}`,
      className: "field",
      defaultValue: v,
      disabled: !canEdit,
      placeholder,
      onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const nv = e.target.value.trim();
        if (nv !== v) void updateInvoiceSettings(db, { [key]: nv }).then(after);
      },
    };
    return (
      <label className="grid gap-1">
        <span className="lbl m-0">{label}</span>
        {rows > 1 ? <textarea rows={rows} {...props} /> : <input {...props} />}
      </label>
    );
  };

  return (
    <section className="panel">
      <h3>On every invoice</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {text("business_name", "Business name")}
        {text("business_phone", "Phone")}
        {text("business_address", "Address", 3)}
        {text("remit_to", "Send payment to (remit-to)", 3, "Blank: the business name and address")}
        {text("business_email", "Email")}
        <label className="grid gap-1">
          <span className="lbl m-0">Terms for everyone (days)</span>
          <input
            key={`terms:${s.default_terms_days}`}
            className="field num w-28!"
            inputMode="numeric"
            defaultValue={s.default_terms_days}
            disabled={!canEdit}
            onBlur={(e) => {
              const n = Number(e.target.value.trim());
              if (!Number.isInteger(n) || n < 0 || n > 365) return after("Terms are a number of days, 0 to 365.");
              if (n !== s.default_terms_days) void updateInvoiceSettings(db, { default_terms_days: n }).then(after);
            }}
          />
          <span className="small muted">Net {s.default_terms_days}: due {s.default_terms_days} days after the invoice date. A customer can have their own below.</span>
        </label>
      </div>
      <div className="mt-3">{text("invoice_note", "Note at the bottom of every invoice", 2, "For example: Thank you!")}</div>
    </section>
  );
}

function WeekNumbers({ canEdit }: { canEdit: boolean }) {
  const db = getDb();
  const load = useCallback((d: SupabaseClient) => loadWeekNumbers(d), []);
  const { data: weeks, refresh } = useLive("week-invoice-numbers", load, ["weeks"]);
  const after = useAfter(refresh);
  if (!weeks) return <p className="small muted">Loading...</p>;

  const thisWeek = currentWeek();
  const next = suggestWeekNumber(weeks);
  // Weeks with a number, and every week from this one on.
  const shown = weeks.filter((w) => w.invoice_number != null || w.id >= thisWeek).slice(0, 12);

  return (
    <section className="panel mt-3">
      <h3>Invoice number for each week</h3>
      <p className="small muted mt-1">
        Each invoice is the week&apos;s number and the location&apos;s code: {invoiceNumberText(3001, "NEWP")}. Weeks are named by
        their packing Monday. {next ? `The next number would be ${next}.` : ""} Numbers can be changed any time; two weeks
        can&apos;t share one.
      </p>
      <table className="simple mt-1">
        <thead>
          <tr>
            <th>Week of</th>
            <th>Invoice number</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((w) => (
            <tr key={w.id}>
              <td>
                {niceDate(w.id)}, {w.id.slice(0, 4)}
              </td>
              <td>
                <input
                  key={`${w.id}:${w.invoice_number ?? ""}`}
                  className="field num w-28!"
                  inputMode="numeric"
                  aria-label={`Invoice number for the week of ${niceDate(w.id)}`}
                  defaultValue={w.invoice_number ?? ""}
                  placeholder={w.invoice_number == null && next ? `${next}?` : ""}
                  disabled={!canEdit}
                  onBlur={(e) => {
                    const t = e.target.value.trim();
                    const n = t === "" ? null : parseWeekNumber(t);
                    if (t !== "" && n == null) return after("An invoice number is a whole number, like 3002.");
                    if (n !== w.invoice_number) void setWeekInvoiceNumber(db, w.id, n).then(after);
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Locations({ canEdit }: { canEdit: boolean }) {
  const db = getDb();
  const { customers } = useStaffData();
  const load = useCallback((d: SupabaseClient) => loadCustomerBilling(d), []);
  const { data: billing, refresh } = useLive("customer-billing", load, ["customer_billing"]);
  const settingsLoad = useCallback((d: SupabaseClient) => loadInvoiceSettings(d), []);
  const { data: settings } = useLive("invoice-settings", settingsLoad, ["invoice_settings"]);
  const after = useAfter(refresh);
  if (!billing || !customers) return <p className="small muted">Loading...</p>;

  const terms = settings?.default_terms_days ?? 15;
  // Who gets invoices: locations, and customers without locations.
  const hasLocations = new Set(customers.list.map((c) => c.parent_customer_id).filter(Boolean));
  const list = sortByDisplayName(
    customers.list.filter((c) => !hasLocations.has(c.id) && (c.active || billing.get(c.id)?.invoice_code)),
    customers.byId,
  );
  const missing = list.filter((c) => !billing.get(c.id)?.invoice_code).length;

  return (
    <section className="panel mt-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="mr-auto">Each location</h3>
        <Link href="/print/report/invoice-codes" className="btn ghost">
          Print the code list
        </Link>
      </div>
      <p className="small muted mt-1">
        Each location gets its own invoice. The code is 3 to 5 capital letters or digits (PCC stores: PCC and the store
        number). Terms blank: Net {terms}. Bill-to blank: the invoice shows the name only. Box detail adds a page listing
        every box.
        {missing > 0 && ` ${missing} have no code yet.`}
      </p>
      <div className="overflow-x-auto">
        <table className="simple mt-1">
          <thead>
            <tr>
              <th>Location</th>
              <th>Code</th>
              <th>Terms (days)</th>
              <th>Bill-to address</th>
              <th>Box detail</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const b = billing.get(c.id);
              const name = displayName(c, customers.byId);
              return (
                <tr key={c.id} className={c.active ? "" : "bg-field"}>
                  <td>
                    {name}
                    {!c.active && <span className="small muted"> (turned off)</span>}
                  </td>
                  <td>
                    <input
                      key={`${c.id}:code:${b?.invoice_code ?? ""}`}
                      className="field w-24! uppercase"
                      aria-label={`Invoice code for ${name}`}
                      defaultValue={b?.invoice_code ?? ""}
                      maxLength={6}
                      disabled={!canEdit}
                      onBlur={(e) => {
                        const v = cleanCode(e.target.value);
                        if (v === (b?.invoice_code ?? "")) return;
                        if (v && !isInvoiceCode(v)) return after("A code is 3 to 5 capital letters or digits.");
                        void saveCustomerBilling(db, c.id, { invoice_code: v || null }).then(after);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      key={`${c.id}:terms:${b?.terms_days ?? ""}`}
                      className="field num w-20!"
                      inputMode="numeric"
                      aria-label={`Terms in days for ${name}`}
                      defaultValue={b?.terms_days ?? ""}
                      placeholder={String(terms)}
                      disabled={!canEdit}
                      onBlur={(e) => {
                        const t = e.target.value.trim();
                        const n = t === "" ? null : Number(t);
                        if (n != null && (!Number.isInteger(n) || n < 0 || n > 365)) return after("Terms are a number of days, 0 to 365.");
                        if (n !== (b?.terms_days ?? null)) void saveCustomerBilling(db, c.id, { terms_days: n }).then(after);
                      }}
                    />
                  </td>
                  <td className="min-w-[14rem]">
                    <textarea
                      key={`${c.id}:addr:${b?.bill_to_address ?? ""}`}
                      className="field"
                      rows={2}
                      aria-label={`Bill-to address for ${name}`}
                      defaultValue={b?.bill_to_address ?? ""}
                      placeholder="Name only"
                      disabled={!canEdit}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (b?.bill_to_address ?? "")) void saveCustomerBilling(db, c.id, { bill_to_address: v }).then(after);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      className="h-6 w-6 accent-forest"
                      aria-label={`Box detail page for ${name}`}
                      checked={b?.box_detail ?? false}
                      disabled={!canEdit}
                      onChange={(e) => void saveCustomerBilling(db, c.id, { box_detail: e.target.checked }).then(after)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
