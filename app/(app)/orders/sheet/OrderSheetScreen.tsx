"use client";

// Paper order sheets: every product in its group, with room to write the
// amount and a note, for taking orders by phone away from the screen. One
// sheet per customer location, or a blank one. For a customer: what they
// usually buy first (the same rule as the order screen), their last order's
// amounts, the scheduled delivery, and the week's invoice batch
// (change request 10/22/26).

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStaffData } from "@/components/data/StaffData";
import { useWeekData } from "@/components/data/useWeekData";
import { useWeek } from "@/components/Week";
import { downloadTable } from "@/components/download";
import { orderGridTable } from "@/lib/reports";
import { displayName, orderingCustomers, sortByDisplayName } from "@/lib/calc/customers";
import { deliveryDate, deliveryDayOf, type LastOrder } from "@/lib/calc/lastOrder";
import { fmt } from "@/lib/calc/num";
import { groupProducts } from "@/lib/calc/products";
import { lineUnit, unitWord } from "@/lib/calc/units";
import { DAYS, niceDate, weekName } from "@/lib/dates";
import type { CatalogProduct, Customer, OrderRequest } from "@/lib/db/types";
import { askedOn, requestText } from "@/components/RequestedLines";
import { qtyText } from "@/lib/orders";

const BLANK = "";
const EVERYONE = "__all";

/** How it's ordered, for the "Comes in" column: "pcs", "packs of 2", "pcs or lb (circle)". */
function comesIn(p: CatalogProduct): string {
  const one = (u: string) =>
    u === "pack" && p.pieces_per_pack
      ? `packs of ${fmt(p.pieces_per_pack)}`
      : u === "pack" && p.lb_per_unit
        ? `${fmt(p.lb_per_unit)} lb packs`
        : u === "case" && p.lb_per_unit
          ? `cases (~${fmt(p.lb_per_unit)} lb)`
          : u === "each" && p.lb_per_unit && p.lb_per_unit >= 10
            ? `pcs (~${fmt(p.lb_per_unit)} lb)`
            : unitWord(u);
  const base = p.alt_unit ? `${one(p.unit)} or ${unitWord(p.alt_unit)}` : one(p.unit);
  return p.order_step && p.order_step !== 1 ? `${base}, by ${fmt(p.order_step)}` : base;
}

/** "Sat Oct 31" */
const dayAndDate = (iso: string) => `${DAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()].slice(0, 3)} ${niceDate(iso)}`;

/**
 * A part of the sheet. writeIn: empty rows at its end to write in something
 * else by hand (only after "What they usually buy").
 */
type Section = { title: string | null; groups: { group: string; products: CatalogProduct[] }[]; writeIn?: number };

/**
 * Empty rows to write in by hand, right after what the customer usually buys
 * (Kathy, 10/28/26: a customer asks for something else on the call, and
 * she writes it here instead of hunting through the sheet). Paper only:
 * never entered or saved.
 */
const WRITE_IN_ROWS = 4;

function Sheet({
  customer,
  name,
  sections,
  lastOrder,
  delivery,
  invoice,
  requests,
  movedOut,
  products,
}: {
  customer: Customer | null;
  name: string;
  sections: Section[];
  lastOrder: LastOrder | undefined;
  /** "Sat Oct 31", or "" to write in. */
  delivery: string;
  /** The week's invoice number, or "" to write in. */
  invoice: string;
  /** Requested for this week, to confirm on the call (listed first, not again below). */
  requests: OrderRequest[];
  /** "Moved to next week: 12 packs Front Shanks" at the bottom. */
  movedOut: string;
  products: Map<string, CatalogProduct>;
}) {
  const phone = customer?.contacts.find((k) => k.phone)?.phone ?? "";
  const contact = customer?.contacts.find((k) => k.name)?.name ?? "";
  return (
    <section className="ordersheet">
      <h1>Umpqua Valley Lamb · Order</h1>
      <div className="os-head">
        <div>
          <b>Customer</b>
          {name}
        </div>
        <div>
          <b>Scheduled delivery</b>
          {delivery}
        </div>
        <div>
          <b>Invoice batch</b>
          {invoice}
        </div>
        <div>
          <b>Contact</b>
          {contact}
          {contact && phone ? " · " : ""}
          {phone}
        </div>
        <div>
          <b>Called</b>
        </div>
        <div>
          <b>Call day</b>
          {customer?.call_day ?? ""}
        </div>
        {customer && (
          <div className="os-last">
            <b>Last order</b>
            {lastOrder ? weekName(lastOrder.week) : "None yet"}
          </div>
        )}
      </div>
      {requests.length > 0 && (
        <table className="os-requested">
          <colgroup>
            <col className="os-prod" />
            <col className="os-unit" />
            <col className="os-lastq" />
            <col className="os-qty" />
            <col className="os-note" />
          </colgroup>
          <thead>
            <tr className="os-section">
              <th colSpan={5}>Requested, confirm on the call</th>
            </tr>
            <tr>
              <th>Product</th>
              <th>Comes in</th>
              <th>Requested</th>
              <th>How many</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => {
              const p = products.get(r.product_id);
              return (
                <tr key={r.id}>
                  <td>{p?.name ?? r.product_id}</td>
                  <td className="os-unit">{p ? comesIn(p) : ""}</td>
                  <td className="os-lastq">
                    {qtyText(r.qty, r.unit ?? p?.unit ?? "each")}, asked {askedOn(r)}
                  </td>
                  <td />
                  <td />
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <table>
        <colgroup>
          <col className="os-prod" />
          <col className="os-unit" />
          <col className="os-lastq" />
          <col className="os-qty" />
          <col className="os-note" />
        </colgroup>
        <thead>
          <tr>
            <th>Product</th>
            <th>Comes in</th>
            <th>Last order</th>
            <th>How many</th>
            <th>Note</th>
          </tr>
        </thead>
        {sections.map((s) => (
          <SectionRows key={s.title ?? "all"} section={s} lastOrder={lastOrder} />
        ))}
      </table>
      {movedOut && <p className="os-moved">Moved to next week: {movedOut}</p>}
      <div className="os-foot">
        Other notes, call back, delivery changes
        <div />
        <div />
      </div>
    </section>
  );
}

function SectionRows({ section, lastOrder }: { section: Section; lastOrder: LastOrder | undefined }) {
  return (
    <>
      {section.title && (
        <tbody>
          <tr className="os-section">
            <th colSpan={5}>{section.title}</th>
          </tr>
        </tbody>
      )}
      {section.groups.map((g) => (
        <tbody key={g.group}>
          <tr className="os-group">
            <th colSpan={5}>{g.group}</th>
          </tr>
          {g.products.map((p, i) => {
            const last = lastOrder?.lines[p.id] ?? 0;
            return (
              <tr key={p.id} className={i % 2 ? "zebra" : undefined}>
                <td>{p.name}</td>
                <td className="os-unit">{comesIn(p)}</td>
                <td className="os-lastq">{last > 0 ? qtyText(last, lineUnit(p.id, p, lastOrder?.units)) : ""}</td>
                <td />
                <td />
              </tr>
            );
          })}
        </tbody>
      ))}
      {section.writeIn ? (
        <tbody className="os-writein">
          <tr className="os-group">
            <th colSpan={5}>Something else</th>
          </tr>
          {Array.from({ length: section.writeIn }, (_, i) => (
            <tr key={i}>
              <td />
              <td />
              <td />
              <td />
              <td />
            </tr>
          ))}
        </tbody>
      ) : null}
    </>
  );
}

export default function OrderSheetScreen() {
  const { catalog, customers, error } = useStaffData();
  const { week } = useWeek();
  const { data } = useWeekData(week);
  const [who, setWho] = useState<string>(BLANK);
  const [withWeek, setWithWeek] = useState(true);
  const [printAll, setPrintAll] = useState(false);

  // "Print all customers": show every sheet, then print once they're on the page.
  useEffect(() => {
    if (!printAll || who !== EVERYONE) return;
    const t = setTimeout(() => {
      setPrintAll(false);
      window.print();
    }, 300);
    return () => clearTimeout(t);
  }, [printAll, who]);

  if (error) return <p className="note bad">Couldn&apos;t load: {error}</p>;
  if (!catalog || !customers) return <div className="empty">Loading...</div>;

  const active = catalog.products.filter((p) => p.active);
  const everything = groupProducts(active);
  const list = sortByDisplayName(orderingCustomers(customers.list), customers.byId);
  const invoice = withWeek ? (data?.cutSheet?.inv_number?.trim() ?? "") : "";

  /** What they usually buy first (the order screen's rule: anything they've ever ordered, or have on this week's order), then the rest. */
  const sectionsFor = (c: Customer | null): Section[] => {
    if (!c) return [{ title: null, groups: everything }];
    // Products requested this week are in their own box at the top, not again below.
    const asked = new Set((data?.requests.get(c.id) ?? []).map((r) => r.product_id));
    const withoutAsked = (s: Section[]): Section[] =>
      s.map((x) => ({ ...x, groups: x.groups.map((g) => ({ ...g, products: g.products.filter((p) => !asked.has(p.id)) })).filter((g) => g.products.length) }));
    return withoutAsked(sectionsForAll(c));
  };
  const sectionsForAll = (c: Customer): Section[] => {
    const usual = new Set(customers.usual.get(c.id) ?? []);
    const now = data?.orders.get(c.id)?.lines ?? {};
    for (const k in now) if ((now[k] ?? 0) > 0) usual.add(k);
    const first = active.filter((p) => usual.has(p.id));
    if (!first.length) return [{ title: null, groups: everything }];
    return [
      { title: "What they usually buy", groups: groupProducts(first), writeIn: WRITE_IN_ROWS },
      { title: "Other products", groups: groupProducts(active.filter((p) => !usual.has(p.id))) },
    ];
  };
  const sheetFor = (c: Customer | null, i = 0) => {
    const day = c ? deliveryDayOf(c, customers.byId) : null;
    const date = withWeek ? deliveryDate(week, day) : null;
    return (
      <Sheet
        key={c?.id ?? `blank-${i}`}
        customer={c}
        name={c ? displayName(c, customers.byId) : ""}
        sections={sectionsFor(c)}
        lastOrder={c ? data?.lastOrder.get(c.id) : undefined}
        delivery={date ? dayAndDate(date) : ""}
        invoice={c ? invoice : ""}
        requests={c ? (data?.requests.get(c.id) ?? []) : []}
        movedOut={c ? (data?.movedOut.get(c.id) ?? []).map((r) => requestText(r, catalog.productById)).join(", ") : ""}
        products={catalog.productById}
      />
    );
  };
  const chosen = who !== BLANK && who !== EVERYONE ? (customers.byId.get(who) ?? null) : null;

  return (
    <>
      <div className="screen-only mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto">Order sheets</h2>
          <Link href="/print" className="btn ghost">
            &larr; Print and download
          </Link>
        </div>
        <p className="small muted mt-1">
          Every product we sell, in the same groups as the order form, with room to write how many. A customer&apos;s sheet
          lists what they usually buy first, with their last order. Print one for each customer, or a blank one.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="grid gap-1">
            <span className="lbl m-0">Who it&apos;s for</span>
            <select className="field" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value={BLANK}>Blank sheet (write the name in)</option>
              <option value={EVERYONE}>Every customer, one sheet each ({list.length})</option>
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {displayName(c, customers.byId)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setWho(EVERYONE);
              setPrintAll(true);
            }}
          >
            Print all customers ({list.length})
          </button>
          <label className="flex min-h-[44px] items-center gap-2">
            <input type="checkbox" className="h-6 w-6 accent-forest" checked={withWeek} onChange={(e) => setWithWeek(e.target.checked)} />
            Fill in delivery and invoice batch for {weekName(week)}
          </label>
          <button type="button" className="btn" onClick={() => window.print()}>
            Print
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() =>
              void downloadTable(
                "blank-order-grid",
                orderGridTable(list, customers.byId, null, everything.flatMap((g) => g.products)),
                "Orders",
                "xlsx",
              )
            }
          >
            Blank grid for Excel
          </button>
        </div>
      </div>
      {who === EVERYONE ? list.map((c, i) => sheetFor(c, i)) : sheetFor(chosen)}
    </>
  );
}
