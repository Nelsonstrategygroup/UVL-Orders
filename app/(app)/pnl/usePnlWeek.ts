"use client";

// Everything the Weekly P&L shows for one week, worked out in one place, so
// the page, its line detail and the printed P&L detail always agree: income
// from invoices and packing, producer cost, charges, expenses, results, every
// line's "how this was calculated", and the checks on what's missing.

import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useWeekData } from "@/components/data/useWeekData";
import { displayName } from "@/lib/calc/customers";
import { sheetPay, weekPay } from "@/lib/calc/lambCost";
import { groupLead } from "@/lib/calc/packTogether";
import { invoiceIncome, weekPnl } from "@/lib/calc/pnl";
import { pnlChecks, pnlDetails } from "@/lib/calc/pnlDetail";
import { loadWeekBoxes } from "@/lib/db/invoices";
import { loadCharges, loadPrices } from "@/lib/db/invoicing";
import { loadLambCostSetup } from "@/lib/db/lambCost";
import { loadPnlSetup, loadWeekEntries, loadWeekInvoiceData } from "@/lib/db/pnl";
import { loadWeekSheets } from "@/lib/db/weighSheets";
import { weekCalc } from "@/lib/weekCalc";

// Invoices, packing and prices too: projected income follows packing as it happens.
const TABLES = [
  "pnl_expenses",
  "pnl_income",
  "kill_sheets",
  "kill_lambs",
  "kill_adjustments",
  "producers",
  "invoices",
  "packing_weights",
  "packing_lines",
  "order_lines",
  "prices",
  "carcass_charges",
];
const SETUP_TABLES = ["pnl_lamb_charges", "pnl_percent_charges", "expense_categories"];

async function loadWeek(db: SupabaseClient, week: string) {
  const [entries, sheets, inv, invoiceData, prices, charges, boxes, people] = await Promise.all([
    loadWeekEntries(db, week),
    loadWeekSheets(db, week),
    db.from("weeks").select("invoice_number").eq("id", week).maybeSingle(),
    loadWeekInvoiceData(db, week),
    loadPrices(db),
    loadCharges(db),
    loadWeekBoxes(db, week),
    db.from("profiles").select("id, display_name"),
  ]);
  return {
    ...entries,
    sheets,
    inv: (inv.data as { invoice_number?: number | null } | null)?.invoice_number ?? null,
    invoiceData,
    prices,
    charges,
    boxes,
    people: new Map(((people.data ?? []) as { id: string; display_name: string }[]).map((x) => [x.id, x.display_name])),
  };
}

export function usePnlWeek(week: string) {
  const load = useCallback((d: SupabaseClient) => loadWeek(d, week), [week]);
  const { data, error, refresh } = useLive(`pnl:${week}`, load, TABLES);
  const loadSetup = useCallback((d: SupabaseClient) => loadPnlSetup(d), []);
  const { data: setup } = useLive("pnl-setup", loadSetup, SETUP_TABLES);
  const loadProducers = useCallback((d: SupabaseClient) => loadLambCostSetup(d), []);
  const { data: lc } = useLive("lamb-cost-setup", loadProducers, ["producers", "lamb_cost_settings", "producer_rates"]);
  const { customers, catalog } = useStaffData();
  // This week's lamb count (the number This week shows), for the checks.
  const { data: weekData } = useWeekData(week);

  if (error) return { ready: false, error, refresh } as const;
  if (!data || !setup || !lc || !customers || !catalog) return { ready: false, error: null, refresh } as const;

  const pays = data.sheets.sheets.map((s) => sheetPay(s, data.sheets.lambs, data.sheets.adjustments));
  const pay = weekPay(pays);
  const productName = (id: string) => catalog.productById.get(id)?.name ?? id;
  const ii = invoiceIncome({
    week,
    locations: data.invoiceData.locationIds
      .map((id) => {
        const c = customers.byId.get(id);
        return { id, name: c ? displayName(c, customers.byId) : "Unknown customer", chainId: c?.parent_customer_id ?? null };
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
    invoices: data.invoiceData.invoices,
    packed: data.invoiceData.packed,
    prices: data.prices,
    charges: data.charges,
    productName,
  });
  const p = weekPnl({
    week,
    pay,
    income: data.income,
    expenses: data.expenses,
    categories: setup.categories,
    lambCharges: setup.lambCharges,
    percentCharges: setup.percentCharges,
    invoices: ii,
  });
  const producerName = (id: string) => lc.producers.find((x) => x.id === id)?.name ?? "Unknown producer";
  const details = pnlDetails({
    week,
    p,
    ii,
    pays,
    pay,
    settings: lc.settings,
    rates: lc.rates,
    lambCharges: setup.lambCharges,
    percentCharges: setup.percentCharges,
    income: data.income,
    expenses: data.expenses,
    categories: setup.categories,
    prices: data.prices,
    charges: data.charges,
    boxes: data.boxes,
    producerName,
    lead: (id) => groupLead(id, catalog.products),
    userName: (id) => (id ? (data.people.get(id) ?? "someone no longer listed") : "unknown"),
  });
  const lambCount = weekData ? weekCalc(weekData, catalog).c.final : null;
  const checks = pnlChecks({ p, ii, lambCount, categories: setup.categories, expenses: data.expenses });
  return { ready: true, data, setup, pays, pay, ii, p, details, checks, producerName, refresh } as const;
}
