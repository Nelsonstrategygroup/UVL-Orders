"use client";

// Paper order sheets: every product in its group, with room to write the
// amount and a note, for taking orders by phone away from the screen. One
// sheet per customer location, or a blank one.

import Link from "next/link";
import { useState } from "react";
import { useStaffData } from "@/components/data/StaffData";
import { useWeek } from "@/components/Week";
import { downloadTable } from "@/components/download";
import { orderGridTable } from "@/lib/reports";
import { displayName, orderingCustomers, sortByDisplayName } from "@/lib/calc/customers";
import { fmt } from "@/lib/calc/num";
import { groupProducts } from "@/lib/calc/products";
import { unitWord } from "@/lib/calc/units";
import { niceDate, weekName } from "@/lib/dates";
import type { CatalogProduct, Customer } from "@/lib/db/types";

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

function Sheet({
  customer,
  name,
  week,
  groups,
}: {
  customer: Customer | null;
  name: string;
  week: string | null;
  groups: { group: string; products: CatalogProduct[] }[];
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
          <b>Packing Mon</b>
          {week ? niceDate(week) : ""}
        </div>
        <div>
          <b>Taken by</b>
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
      </div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th className="os-unit">Comes in</th>
            <th className="os-qty">How many</th>
            <th className="os-note">Note</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.group}>
            <tr className="os-group">
              <th colSpan={4}>{g.group}</th>
            </tr>
            {g.products.map((p, i) => (
              <tr key={p.id} className={i % 2 ? "zebra" : undefined}>
                <td>{p.name}</td>
                <td className="os-unit">{comesIn(p)}</td>
                <td className="os-qty" />
                <td className="os-note" />
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      <div className="os-foot">
        Other notes, call back, delivery changes
        <div />
        <div />
      </div>
    </section>
  );
}

export default function OrderSheetScreen() {
  const { catalog, customers, error } = useStaffData();
  const { week } = useWeek();
  const [who, setWho] = useState<string>(BLANK);
  const [withWeek, setWithWeek] = useState(true);

  if (error) return <p className="note bad">Couldn&apos;t load: {error}</p>;
  if (!catalog || !customers) return <div className="empty">Loading...</div>;

  const groups = groupProducts(catalog.products.filter((p) => p.active));
  const list = sortByDisplayName(orderingCustomers(customers.list), customers.byId);
  const sheets: { customer: Customer | null; name: string }[] =
    who === EVERYONE
      ? list.map((c) => ({ customer: c, name: displayName(c, customers.byId) }))
      : who === BLANK
        ? [{ customer: null, name: "" }]
        : [{ customer: customers.byId.get(who) ?? null, name: displayName(customers.byId.get(who)!, customers.byId) }];

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
          Every product we sell, in the same groups as the order form, with room to write how many. Print one for each
          customer, or a blank one.
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
          <label className="flex min-h-[44px] items-center gap-2">
            <input type="checkbox" className="h-6 w-6 accent-forest" checked={withWeek} onChange={(e) => setWithWeek(e.target.checked)} />
            Fill in packing {weekName(week)}
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
                orderGridTable(list, customers.byId, null, groups.flatMap((g) => g.products)),
                "Orders",
                "xlsx",
              )
            }
          >
            Blank grid for Excel
          </button>
        </div>
      </div>
      {sheets.map((s, i) => (
        <Sheet key={s.customer?.id ?? `blank-${i}`} customer={s.customer} name={s.name} week={withWeek ? week : null} groups={groups} />
      ))}
    </>
  );
}
