"use client";

// Everything the invoice screens need for one week, kept current: the
// invoices and their lines, whether each is out of date, prices, codes and
// terms, the business details, the week's invoice number, and the box
// records (for the box detail page and the warnings).

import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useLive } from "@/components/data/useLive";
import { loadCustomerBilling, loadInvoiceSettings, loadPrices } from "@/lib/db/invoicing";
import { loadFingerprints, loadWeekBoxes, loadWeekInvoices, loadWeekPacking } from "@/lib/db/invoices";

async function loadWeek(db: SupabaseClient, week: string) {
  const [invoices, fingerprints, prices, billing, settings, weekRow, boxes, packing] = await Promise.all([
    loadWeekInvoices(db, week),
    loadFingerprints(db, week),
    loadPrices(db),
    loadCustomerBilling(db),
    loadInvoiceSettings(db),
    db.from("weeks").select("invoice_number").eq("id", week).maybeSingle(),
    loadWeekBoxes(db, week),
    loadWeekPacking(db, week),
  ]);
  if (weekRow.error) throw new Error(weekRow.error.message);
  return {
    invoices,
    /** Draft ids whose box records changed since they were made. */
    outOfDate: new Set(invoices.filter((i) => i.status === "draft" && fingerprints.get(i.id) !== i.fingerprint).map((i) => i.id)),
    /** Finalized or sent ids whose box records changed since: a void and reissue may be needed. */
    changedSince: new Set(
      invoices.filter((i) => (i.status === "finalized" || i.status === "sent") && fingerprints.get(i.id) !== i.fingerprint).map((i) => i.id),
    ),
    prices,
    billing,
    settings,
    weekNumber: (weekRow.data as { invoice_number: number | null } | null)?.invoice_number ?? null,
    boxes,
    packing,
  };
}

export type InvoiceWeek = Awaited<ReturnType<typeof loadWeek>>;

export function useInvoiceWeek(week: string) {
  const load = useCallback((db: SupabaseClient) => loadWeek(db, week), [week]);
  return useLive(`invoice-week-${week}`, load, [
    "invoices",
    "invoice_lines",
    "prices",
    "customer_billing",
    "invoice_settings",
    "weeks",
    "packing_weights",
    "packing_lines",
    "order_lines",
    "products",
    "payments",
  ]);
}
