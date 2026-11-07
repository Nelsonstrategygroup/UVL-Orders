"use client";

// The Lamb count check (Lucas, 11/7/26): two Letter pages for Kathy to check
// the week's lamb count by hand against her paper order grid. Page 1: what
// the orders add up to, by the part each product comes from. Page 2: from
// parts to lambs, and what the lambs give against what the orders take. The
// numbers are This week's (lib/calc/lambCheck.ts), only written out.

import Link from "next/link";
import { useEffect, useState } from "react";
import { useStaffData } from "@/components/data/StaffData";
import { useWeekData } from "@/components/data/useWeekData";
import PrintHeader from "@/components/PrintHeader";
import { useWeek, WeekBar } from "@/components/Week";
import {
  compareCustomerIds,
  displayName,
  orderingCustomers,
  sortByDisplayName,
} from "@/lib/calc/customers";
import { partPackSizes } from "@/lib/calc/packs";
import { lambCheck } from "@/lib/calc/lambCheck";
import { niceDate } from "@/lib/dates";
import { weekCalc } from "@/lib/weekCalc";

/** A box to tick, printed. */
const Tick = () => (
  <span className="lc-tick" aria-hidden="true">
    ☐
  </span>
);

export default function LambCheckScreen({
  print = false,
}: {
  print?: boolean;
}) {
  const { catalog, customers, error: loadError } = useStaffData();
  const { week } = useWeek();
  const { data, error } = useWeekData(week);
  const [printed, setPrinted] = useState(false);
  const ready = !!(catalog && customers && data);

  // Opened with Print: print once it's ready.
  useEffect(() => {
    if (!print || printed || !ready) return;
    const t = setTimeout(() => {
      setPrinted(true);
      window.print();
    }, 300);
    return () => clearTimeout(t);
  }, [print, printed, ready]);

  if (loadError || error)
    return <p className="note bad">Couldn&apos;t load: {loadError ?? error}</p>;
  if (!catalog || !customers || !data)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const { c, short, requested, leTrim: lt } = weekCalc(data, catalog);
  const name = (id: string) => {
    const cu = customers.byId.get(id);
    return cu ? displayName(cu, customers.byId) : "Unknown customer";
  };
  const ordering = sortByDisplayName(
    orderingCustomers(customers.list),
    customers.byId,
  );
  const status = (id: string) => data.orders.get(id)?.status;
  const plan = data.leTrim;
  const r = lambCheck({
    weekName: niceDate(week),
    c,
    parts: catalog.parts,
    products: catalog.products,
    // In the shared customer order, so the written-out lines read like the order grid.
    orders: [...data.orders.values()]
      .sort((a, b) =>
        compareCustomerIds(customers.byId)(a.customer_id, b.customer_id),
      )
      .map((o) => ({
        customer: name(o.customer_id),
        lines: o.lines,
        units: o.units,
      })),
    packSizes: partPackSizes(catalog.products),
    requested,
    short,
    extraLambs: data.extraLambs ?? [],
    leTrim:
      lt.ordered.lb > 0
        ? plan
          ? {
              orderedLb: lt.ordered.lb,
              planned: true,
              trimLb: plan.trim_lb,
              shoulders: plan.shoulders,
              halfLegs: plan.half_legs,
              legs: plan.legs,
            }
          : {
              orderedLb: lt.ordered.lb,
              planned: false,
              trimLb: lt.need.trimLb,
              shoulders: lt.need.shoulders,
              halfLegs: lt.need.halfLegs,
              legs: lt.need.legs,
            }
        : null,
    answers: {
      ordered: ordering.filter((cu) => status(cu.id) === "ordered").length,
      total: ordering.length,
      waiting: ordering
        .filter((cu) => status(cu.id) !== "ordered" && status(cu.id) !== "none")
        .map((cu) => displayName(cu, customers.byId)),
      noOrder: ordering
        .filter((cu) => status(cu.id) === "none")
        .map((cu) => displayName(cu, customers.byId)),
    },
  });
  const inv = data.weekRow?.invoice_number ?? null;

  return (
    <div className="lc max-w-[820px]">
      <style>{`@media print { @page { size: letter portrait; margin: 0.45in; } }`}</style>
      <div className="screen-only">
        <WeekBar />
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto">Lamb count check</h2>
          <Link href="/week" className="btn ghost">
            &larr; This week
          </Link>
          <button type="button" className="btn" onClick={() => window.print()}>
            Print
          </button>
        </div>
        <p className="small muted mt-1">
          Two pages, to check this week&apos;s lamb count by hand against the
          order grid.
        </p>
      </div>

      {c.recommended === 0 && c.final === 0 ? (
        <div className="empty">No orders for this week yet.</div>
      ) : (
        <>
          <section className="lc-page">
            <PrintHeader
              inv={inv}
              title="Lamb count check"
              when="Page 1: What the orders add up to"
            />
            <p className="lc-lead">
              <b>{r.answersLine}</b>
            </p>
            {r.waitingLine && <p className="lc-warn">{r.waitingLine}</p>}
            {r.noOrderLine && <p>{r.noOrderLine}</p>}

            {/* The groups in two columns on paper, so page 1 stays one sheet. */}
            <div className="lc-groups">
              {r.groups.map((g) => (
                <div key={g.title} className="lc-group">
                  <h3>{g.title}</h3>
                  {/* Two columns of products, each with its total and a box; what's converted or added underneath. */}
                  <div className="lc-products">
                    {g.products.map((p) => (
                      <div
                        key={p.name}
                        className={`lc-prod ${p.converted.length + p.plus.length ? "lc-wide" : ""}`}
                      >
                        <div className="lc-prodRow">
                          <span>{p.name}</span>
                          <span className="lc-num">{p.total}</span>
                          <Tick />
                        </div>
                        {[...p.converted, ...p.plus].map((s) => (
                          <div key={s} className="lc-sub">
                            {s}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  {g.math.map((m) => (
                    <p key={m} className="lc-math">
                      <Tick /> {m}
                    </p>
                  ))}
                  {g.note && <p className="lc-note">{g.note}</p>}
                </div>
              ))}

              {r.leTrim && (
                <div className="lc-group">
                  <h3>Le Trim</h3>
                  <p className="lc-math">
                    <Tick /> {r.leTrim.ordered}
                  </p>
                  <p className="lc-note">{r.leTrim.madeFrom}</p>
                </div>
              )}
            </div>
          </section>

          <section className="lc-page">
            <PrintHeader
              inv={inv}
              title="Lamb count check"
              when="Page 2: From parts to lambs"
              footer={false}
            />

            <h3>Lambs for each part</h3>
            <p className="lc-note">
              Each part&apos;s need ÷ what one lamb gives, rounded up to whole
              lambs. The part needing the most lambs sets the count.
            </p>
            {r.lambs.map((l) => (
              <p key={l.text} className={`lc-math ${l.sets ? "lc-sets" : ""}`}>
                <Tick /> {l.text}
                {l.sets && (
                  <span className="lc-setsTag">This one sets the count.</span>
                )}
              </p>
            ))}
            {r.neverLine && <p className="lc-note">{r.neverLine}</p>}

            <h3>The count</h3>
            {r.countParts.map((t) => (
              <p key={t} className="lc-math">
                <Tick /> {t}
              </p>
            ))}
            <p className="lc-total">
              <Tick /> <b>{r.countTotal}</b>
            </p>
            {r.replaced && <p className="lc-warn">{r.replaced}</p>}

            <h3>What the lambs give against what the orders take</h3>
            <p className="lc-note">{r.balanceLambs}</p>
            <table className="lc-balance">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>The lambs give</th>
                  <th>Taken</th>
                  <th>What&apos;s left</th>
                </tr>
              </thead>
              <tbody>
                {r.balance.map((b) => (
                  <tr key={b.name} className={b.short ? "lc-short" : undefined}>
                    <td>
                      <b>{b.name}</b>
                    </td>
                    <td>
                      <Tick /> {b.give}
                    </td>
                    <td>
                      {b.take.map((t) => (
                        <div key={t}>
                          <Tick /> {t}
                        </div>
                      ))}
                    </td>
                    <td>
                      <Tick /> {b.result}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className={`lc-check ${r.check.ok ? "" : "lc-short"}`}>
              <Tick /> <b>{r.check.text}</b>
            </p>
            {r.guesses && <p className="lc-note">{r.guesses}</p>}
          </section>
        </>
      )}
    </div>
  );
}
