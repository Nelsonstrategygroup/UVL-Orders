"use client";

// Everything the Weekly P&L shows for one week, worked out in one place, so
// the page, its line detail and the printed P&L detail always agree: income
// from invoices and packing, producer cost, charges, expenses, results, every
// line's "how this was calculated", and the checks on what's missing.
// A closed week (stage C) shows the P&L saved when it was closed instead.

import { useCallback } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useWeekData } from "@/components/data/useWeekData";
import { displayName } from "@/lib/calc/customers";
import { sheetPay, weekPay } from "@/lib/calc/lambCost";
import { groupLead } from "@/lib/calc/packTogether";
import { invoiceIncome, weekPnl, type ExpenseCategory } from "@/lib/calc/pnl";
import { pnlChecks, pnlDetails } from "@/lib/calc/pnlDetail";
import { fromSnapshot, toSnapshot } from "@/lib/calc/pnlSnapshot";
import { loadWeekBoxes } from "@/lib/db/invoices";
import { loadCharges, loadPrices } from "@/lib/db/invoicing";
import { loadLambCostSetup } from "@/lib/db/lambCost";
import { loadPnlSetup, loadWeekAdjustments, loadWeekEntries, loadWeekExpenseFiles, loadWeekInvoiceData, loadWeekStatus } from "@/lib/db/pnl";
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
  "pnl_adjustments",
  "pnl_expense_files",
];
const SETUP_TABLES = ["pnl_lamb_charges", "pnl_percent_charges", "expense_categories"];

const STATUS_TABLES = ["pnl_closed_weeks", "pnl_week_reviews", "pnl_week_events"];

async function loadWeek(db: SupabaseClient, week: string) {
  const [entries, sheets, inv, invoiceData, prices, charges, boxes, people, adjustments, expenseFiles] = await Promise.all([
    loadWeekEntries(db, week),
    loadWeekSheets(db, week),
    db.from("weeks").select("invoice_number").eq("id", week).maybeSingle(),
    loadWeekInvoiceData(db, week),
    loadPrices(db),
    loadCharges(db),
    loadWeekBoxes(db, week),
    db.from("profiles").select("id, display_name"),
    loadWeekAdjustments(db, week),
    loadWeekExpenseFiles(db, week),
  ]);
  return {
    ...entries,
    sheets,
    inv: (inv.data as { invoice_number?: number | null } | null)?.invoice_number ?? null,
    invoiceData,
    prices,
    charges,
    boxes,
    adjustments,
    expenseFiles,
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
  const loadStatus = useCallback((d: SupabaseClient) => loadWeekStatus(d, week), [week]);
  const { data: status, error: statusError, refresh: refreshStatus } = useLive(`pnl-status:${week}`, loadStatus, STATUS_TABLES);
  const { customers, catalog } = useStaffData();
  // This week's lamb count (the number This week shows), for the checks.
  const { data: weekData } = useWeekData(week);

  if (error || statusError) return { ready: false, error: error ?? statusError, refresh } as const;
  if (!data || !setup || !lc || !customers || !catalog || !status) return { ready: false, error: null, refresh } as const;
  const refreshAll = () => {
    refresh();
    refreshStatus();
  };

  // Closed: everything as it was saved when the week was closed.
  if (status.closed) {
    const s = fromSnapshot<Snapshot>(status.closed.snapshot);
    return {
      ready: true,
      data: { ...data, inv: s.inv, income: s.income, expenses: s.expenses, expenseFiles: s.expenseFiles },
      setup: { ...setup, categories: s.categories },
      pays: s.pays,
      pay: s.pay,
      ii: s.ii,
      p: s.p,
      details: s.details,
      checks: s.checks,
      producerName: (id: string) => s.producerNames[id] ?? "Unknown producer",
      refresh: refreshAll,
      status,
      snapshot: null,
    } as const;
  }

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
    adjustments: data.adjustments,
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
    expenseFiles: data.expenseFiles,
  });
  const lambCount = weekData ? weekCalc(weekData, catalog).c.final : null;
  const checks = pnlChecks({ p, ii, lambCount, categories: setup.categories, expenses: data.expenses });
  // What closing the week saves (and the closed week shows).
  const snapshot = () =>
    toSnapshot({
      version: 1,
      inv: data.inv,
      income: data.income,
      expenses: data.expenses,
      expenseFiles: data.expenseFiles,
      categories: setup.categories,
      pays,
      pay,
      ii,
      p,
      details,
      checks,
      producerNames: Object.fromEntries(pay.producers.map((r) => [r.producerId, producerName(r.producerId)])),
    } satisfies Snapshot);
  return { ready: true, data, setup, pays, pay, ii, p, details, checks, producerName, refresh: refreshAll, status, snapshot } as const;
}

type Loaded = Awaited<ReturnType<typeof loadWeek>>;
/** A closed week's P&L, as saved. */
type Snapshot = {
  version: 1;
  inv: Loaded["inv"];
  income: Loaded["income"];
  expenses: Loaded["expenses"];
  expenseFiles: Loaded["expenseFiles"];
  categories: ExpenseCategory[];
  pays: ReturnType<typeof sheetPay>[];
  pay: ReturnType<typeof weekPay>;
  ii: ReturnType<typeof invoiceIncome>;
  p: ReturnType<typeof weekPnl>;
  details: ReturnType<typeof pnlDetails>;
  checks: ReturnType<typeof pnlChecks>;
  producerNames: Record<string, string>;
};
