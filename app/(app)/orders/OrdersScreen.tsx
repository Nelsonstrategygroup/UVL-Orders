"use client";

// Orders (SPEC 5.3): "One customer at a time" cards by default, or a
// spreadsheet grid on wide screens.

import { useCan } from "@/components/CurrentUser";
import ViewOnly from "@/components/ViewOnly";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useWeekData } from "@/components/data/useWeekData";
import OrderEditor from "@/components/OrderEditor";
import { orderSummary } from "@/components/ReadBack";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { toProductUnit, unitWord } from "@/lib/calc/units";
import { displayName, orderingCustomers, sortByDisplayName } from "@/lib/calc/customers";
import { halfWholeNeeds } from "@/lib/calc/halfWhole";
import { orderBoxes, orderBoxesText } from "@/lib/calc/boxes";
import { amountText } from "@/lib/calc/extras";
import { willGetLines } from "@/lib/weekCalc";
import { fmt, num } from "@/lib/calc/num";
import { todayName, weekName } from "@/lib/dates";
import { gridPrintPages, gridPrintRows, type GridPrintColumn, type GridPrintPage, type GridPrintRow } from "@/lib/orderGridPrint";
import PrintHeader from "@/components/PrintHeader";
import { setOrder } from "@/lib/db/save";
import type { Customer, Order, OrderStatus, Qty, WeekData } from "@/lib/db/types";
import { cleanLines, cleanQtyInput, cleanUnits, hasLines, snapshot, STATUSES, STATUS_LABEL, statusAfterLines } from "@/lib/orders";

type View = "list" | "grid";
const VIEW_KEY = "uvl:orderview";

export default function OrdersScreen() {
  const { week } = useWeek();
  const { catalog, customers, error: loadError } = useStaffData();
  const { data, error, patchOrder, refresh } = useWeekData(week);
  const ordersCan = useCan("orders");
  const callsCan = useCan("calls");
  const canChange = ordersCan.change || callsCan.change;
  const [view, setView] = useState<View>(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
    } catch {
      return "list";
    }
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const closeEditor = useCallback(() => setEditingId(null), []);

  const list = useMemo(
    () => (customers ? sortByDisplayName(orderingCustomers(customers.list), customers.byId) : []),
    [customers],
  );

  if (loadError || error) return <p className="note bad">Couldn&apos;t load orders: {loadError || error}</p>;
  if (!catalog || !customers || !data)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading orders...</div>
      </>
    );

  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Private browsing: the choice just won't be remembered.
    }
  };

  const header = <WeekBar />;
  if (!list.length) {
    return (
      <>
        {header}
        <div className="panel empty">
          <h3 className="mb-2">No customers yet</h3>
          <p>Add customers first, then their names show up here each week.</p>
          <Link href="/customers" className="btn">
            Go to Customers
          </Link>
        </div>
      </>
    );
  }

  const editing = editingId ? customers.byId.get(editingId) : undefined;
  const cards = <OrderCards list={list} data={data} onOpen={setEditingId} />;

  return (
    <>
      {/* On paper the grid prints by itself, with its own heading (11/10/26). */}
      <div className={view === "grid" ? "screen-only" : undefined}>
        {header}
        {!canChange && <ViewOnly what="orders" />}
      </div>
      <div className={`mb-3 flex flex-wrap items-center gap-3 ${view === "grid" ? "screen-only" : ""}`}>
        <h2 className="mr-auto">Orders</h2>
        {view === "grid" && (
          <button type="button" className="btn ghost desk-only" onClick={() => window.print()}>
            Print the grid
          </button>
        )}
        <div className="desk-only">
          <div className="seg" role="group" aria-label="Layout">
            <button type="button" aria-pressed={view === "list"} onClick={() => choose("list")}>
              One customer at a time
            </button>
            <button type="button" aria-pressed={view === "grid"} onClick={() => choose("grid")}>
              Spreadsheet grid
            </button>
          </div>
        </div>
      </div>

      {view === "grid" ? (
        <>
          <div className="desk-only og-shell">
            <div className="w-full min-w-0">
              <fieldset disabled={!canChange} className="m-0 min-w-0 border-0 p-0">
                <OrderGrid list={list} data={data} patchOrder={patchOrder} refresh={refresh} />
              </fieldset>
            </div>
          </div>
          <div className="mob-only og-cards">
            <div className="w-full min-w-0">{cards}</div>
          </div>
        </>
      ) : (
        <div className="max-w-[760px]">{cards}</div>
      )}

      {editing && (
        <OrderEditor
          week={week}
          customer={editing}
          displayName={displayName(editing, customers.byId)}
          order={data.orders.get(editing.id)}
          lastWeek={data.lastWeek.get(editing.id)}
          lastOrder={data.lastOrder.get(editing.id)}
          requests={data.requests.get(editing.id)}
          movedOut={data.movedOut.get(editing.id)}
          patchOrder={patchOrder}
          refresh={refresh}
          onClose={closeEditor}
        />
      )}
    </>
  );
}

function OrderCards({ list, data, onOpen }: { list: Customer[]; data: WeekData; onOpen: (id: string) => void }) {
  const { catalog, customers } = useStaffData();
  const today = todayName();
  return (
    <>
      <p className="small muted mt-0 mb-2">Tap a customer to enter their order. Today is {today}.</p>
      <div className="clist">
        {list.map((c) => {
          const o = data.orders.get(c.id);
          const st: OrderStatus = o?.status ?? "todo";
          const sum = o ? orderSummary(o.lines, catalog!.products, o.units, o.extra) : "";
          // Boxes for what goes out ("Only if extra" lines: what they'll get).
          const out = o ? willGetLines(o) : null;
          const bx = out ? orderBoxesText(orderBoxes(out.lines, out.units, catalog!.productById, catalog!.boxes)) : "";
          // "Wants 54 packs Front Shanks, 7 available" (11/8/26).
          const wants = Object.entries(o?.extra ?? {})
            .filter(([pid]) => (o!.lines[pid] ?? 0) > 0)
            .map(([pid, x]) => {
              const p = catalog!.productById.get(pid);
              const asked = p ? toProductUnit(o!.lines[pid], o!.units[pid], p) : o!.lines[pid];
              if (x.fill == null) return `${amountText(asked, p)}: filled from extras`;
              return x.fill >= asked ? `${amountText(asked, p)}: all available` : `Wants ${amountText(asked, p)}, ${x.fill} available`;
            });
          return (
            <button key={c.id} type="button" className="ccard" onClick={() => onOpen(c.id)}>
              <span className="min-w-0">
                <b>{displayName(c, customers!.byId)}</b>
                {c.call_day === today && st === "todo" && <span className="small text-barn"> Call today</span>}
                <br />
                <span className="sum">{sum || o?.notes || "Nothing yet"}</span>
                {bx && <span className="small muted"> · {bx}</span>}
                {wants.length > 0 && <span className="small block">{wants.join(". ")}.</span>}
                {(data.requests.get(c.id)?.length ?? 0) > 0 && (
                  <span className="small text-barn"> · {data.requests.get(c.id)!.length} requested to confirm</span>
                )}
              </span>
              <span className={`st ${st}`}>{STATUS_LABEL[st]}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

const SAVE_DELAY_MS = 500;

function OrderGrid({
  list,
  data,
  patchOrder,
  refresh,
}: {
  list: Customer[];
  data: WeekData;
  patchOrder: (customerId: string, order: Order | null) => void;
  refresh: () => void;
}) {
  const { catalog, customers } = useStaffData();
  const { week } = useWeek();
  const toast = useToast();
  const db = getDb();

  // Unsaved quantities per customer, and the raw text of the box being typed in.
  const [drafts, setDrafts] = useState<Record<string, Qty>>({});
  const [typing, setTyping] = useState<Record<string, string>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Record<string, Qty>>({});
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Active products, plus any turned-off product someone still has this week,
  // so older orders don't lose columns.
  const used = new Set([...data.orders.values()].flatMap((o) => Object.keys(o.lines).filter((k) => o.lines[k])));
  const products = catalog!.products.filter((p) => p.active || used.has(p.id));
  const byId = customers!.byId;

  const flush = useCallback(
    async (cid: string) => {
      clearTimeout(timers.current[cid]);
      const lines = pending.current[cid];
      if (!lines) return;
      delete pending.current[cid];
      const cur = dataRef.current.orders.get(cid);
      patchOrder(cid, {
        id: cur?.id ?? "",
        customer_id: cid,
        notes: cur?.notes ?? "",
        status: statusAfterLines(cur?.status ?? "todo", lines),
        lines,
        // The grid changes amounts only; each line keeps its unit.
        units: cleanUnits(cur?.units ?? {}, lines),
      });
      const err = await setOrder(db, { week, customerId: cid, lines });
      if (err) toast("Couldn't save. Check the internet connection.");
      if (!pending.current[cid])
        setDrafts((d) => {
          if (d[cid] !== lines) return d;
          const n = { ...d };
          delete n[cid];
          return n;
        });
      refresh();
    },
    [db, week, patchOrder, refresh, toast],
  );

  // Save everything still waiting when leaving the grid.
  useEffect(() => {
    const t = timers.current;
    const p = pending.current;
    return () => {
      for (const cid of Object.keys(p)) {
        clearTimeout(t[cid]);
        void setOrder(db, { week, customerId: cid, lines: p[cid] });
      }
    };
  }, [db, week]);

  const linesOf = (cid: string): Qty => drafts[cid] ?? data.orders.get(cid)?.lines ?? {};

  function setQty(cid: string, pid: string, raw: string) {
    const next = cleanLines({ ...linesOf(cid), [pid]: num(raw) });
    setTyping((t) => ({ ...t, [`${cid}:${pid}`]: raw }));
    setDrafts((d) => ({ ...d, [cid]: next }));
    pending.current[cid] = next;
    clearTimeout(timers.current[cid]);
    timers.current[cid] = setTimeout(() => void flush(cid), SAVE_DELAY_MS);
  }

  async function saveStatus(cid: string, status: OrderStatus) {
    await flush(cid);
    const cur = data.orders.get(cid);
    patchOrder(cid, { ...snapshot(cur), id: cur?.id ?? "", customer_id: cid, status });
    const err = await setOrder(db, { week, customerId: cid, status });
    if (err) toast("Couldn't save. Check the internet connection.");
    refresh();
  }

  async function sameAsLastWeek(cid: string) {
    await flush(cid);
    const prev = data.lastWeek.get(cid);
    if (!prev || !hasLines(prev.lines)) return;
    const cur = data.orders.get(cid);
    const before = snapshot(cur);
    patchOrder(cid, {
      id: cur?.id ?? "",
      customer_id: cid,
      notes: before.notes,
      status: "ordered",
      lines: { ...prev.lines },
      units: { ...prev.units },
    });
    const err = await setOrder(db, { week, customerId: cid, status: "ordered", lines: prev.lines, units: prev.units });
    refresh();
    if (err) return toast("Couldn't save. Check the internet connection.");
    toast("Copied last week's order", async () => {
      patchOrder(cid, { id: cur?.id ?? "", customer_id: cid, ...before });
      await setOrder(db, { week, customerId: cid, ...before });
      refresh();
    });
  }

  function moveVert(e: React.KeyboardEvent<HTMLInputElement>, dir: 1 | -1) {
    const el = e.currentTarget;
    const all = [...document.querySelectorAll<HTMLInputElement>(`input[data-grid-p="${el.dataset.gridP}"]`)];
    all[all.indexOf(el) + dir]?.focus();
  }

  const { short } = halfWholeNeeds(data.freezer, data.halfWhole, catalog!.parts, catalog!.products);
  // Totals in each product's own unit (a shoulder line taken in pounds becomes pieces).
  const totals: Qty = {};
  for (const c of list) {
    const l = linesOf(c.id);
    const u = data.orders.get(c.id)?.units ?? {};
    for (const k in l) {
      const prod = catalog!.productById.get(k);
      totals[k] = (totals[k] ?? 0) + (prod ? toProductUnit(l[k], u[k], prod) : l[k]);
    }
  }

  const rows: React.ReactNode[] = [];
  let lastParent: string | null = null;
  for (const c of list) {
    const parentId = c.parent_customer_id;
    if (parentId && parentId !== lastParent) {
      rows.push(
        <tr className="grp" key={`grp-${parentId}`}>
          <td className="cust">{byId.get(parentId)?.name}</td>
          <td colSpan={products.length} />
        </tr>,
      );
    }
    lastParent = parentId;
    const o = data.orders.get(c.id);
    const st: OrderStatus = o?.status ?? "todo";
    const lines = linesOf(c.id);
    const prev = data.lastWeek.get(c.id);
    rows.push(
      <tr key={c.id}>
        <td className="cust">
          <Link href={`/customers/${c.id}`} className="block truncate font-semibold text-ink no-underline hover:underline">
            {parentId ? c.name : displayName(c, byId)}
          </Link>
          {c.notes && (
            <span className="block max-w-[210px] truncate text-[.72rem] text-ink-soft italic" title={c.notes}>
              {c.notes}
            </span>
          )}
          <span className="mt-0.5 flex items-center gap-1.5">
            <select
              className="status"
              value={st}
              aria-label={`Status for ${displayName(c, byId)}`}
              onChange={(e) => void saveStatus(c.id, e.target.value as OrderStatus)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            {hasLines(prev?.lines) && (
              <button type="button" className="copy" onClick={() => void sameAsLastWeek(c.id)}>
                Same as last week
              </button>
            )}
          </span>
        </td>
        {products.map((p) => {
          const key = `${c.id}:${p.id}`;
          // A line taken in another unit than the column's (pounds of a piece product).
          const other = data.orders.get(c.id)?.units?.[p.id];
          // "Only if extra" (11/8/26): marked, with what it will get.
          const ex = (lines[p.id] ?? 0) > 0 ? data.orders.get(c.id)?.extra?.[p.id] : undefined;
          return (
            <td key={p.id} className={other || ex ? "relative" : undefined} title={ex ? `Only if extra${ex.fill != null ? `: gets ${fmt(ex.fill)}` : ""}` : undefined}>
              {ex && (
                <small className="pointer-events-none absolute top-0 left-1 text-[.6rem] font-semibold text-barn">
                  if extra{ex.fill != null ? ` · ${fmt(ex.fill)}` : ""}
                </small>
              )}
              {other && (
                <small className="pointer-events-none absolute right-1 bottom-0.5 text-[.65rem] text-ink-soft">
                  {unitWord(other)}
                </small>
              )}
              <input
                data-grid-p={p.id}
                inputMode="decimal"
                autoComplete="off"
                aria-label={`${displayName(c, byId)}, ${p.name}${other ? `, in ${unitWord(other)}` : ""}`}
                value={typing[key] ?? (lines[p.id] ? fmt(lines[p.id]) : "")}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setQty(c.id, p.id, cleanQtyInput(e.target.value))}
                onBlur={() =>
                  setTyping((t) => {
                    const n = { ...t };
                    delete n[key];
                    return n;
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "ArrowDown") {
                    e.preventDefault();
                    moveVert(e, 1);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    moveVert(e, -1);
                  }
                }}
              />
            </td>
          );
        })}
      </tr>,
    );
  }

  // On paper (11/10/26): only products with an order, a set number of columns a
  // page, the customer column on every page. The scrolling grid cut off every
  // product past the page edge.
  const printRows: GridPrintRow[] = [];
  let printParent: string | null = null;
  let anyIfExtra = false;
  for (const c of list) {
    const parentId = c.parent_customer_id;
    if (parentId && parentId !== printParent) printRows.push({ heading: true, name: byId.get(parentId)?.name ?? "", cells: {} });
    printParent = parentId;
    const o = data.orders.get(c.id);
    const l = linesOf(c.id);
    const cells: Record<string, string> = {};
    for (const k in l) {
      if (!(l[k] > 0)) continue;
      const other = o?.units?.[k];
      const ifExtra = !!o?.extra?.[k];
      if (ifExtra) anyIfExtra = true;
      cells[k] = `${fmt(l[k])}${other ? ` ${unitWord(other, l[k])}` : ""}${ifExtra ? " *" : ""}`;
    }
    printRows.push({ name: parentId ? c.name : displayName(c, byId), under: !!parentId, cells });
  }
  const printTotals: Qty = {};
  for (const p of products) printTotals[p.id] = (totals[p.id] ?? 0) + (short[p.id] ?? 0);
  const printPages = gridPrintPages(
    products.map((p) => ({ id: p.id, head: p.short_name || p.name, unit: unitWord(p.unit), group: p.group_name })),
    printRows,
    printTotals,
  );
  const shownRows = gridPrintRows(printRows);
  const noOrder = printRows.filter((r) => !r.heading && !Object.values(r.cells).some(Boolean)).length;
  const anyShort = products.some((p) => short[p.id]);

  return (
    <>
      <div className="print-only ogp">
        <style>{`@media print { @page { size: letter landscape; margin: 0.3in; } }`}</style>
        {printPages.length === 0 && <p>No orders for this week yet.</p>}
        {printPages.map((pg) => (
          <section key={pg.page} className="ogp-page">
            <PrintHeader
              inv={data.weekRow?.invoice_number ?? null}
              title="Order grid"
              when={`Packing ${weekName(week)} · Products ${pg.from} to ${pg.to} of ${pg.of}${pg.pages > 1 ? ` · Sheet ${pg.page} of ${pg.pages}` : ""}`}
              footer={pg.page === 1}
            />
            {/* Totals right under the headers, every other column shaded, a thicker line between groups,
                and the same column slots on every sheet (Lucas, 11/13/26). */}
            <table className="ogp-table">
              <colgroup>
                <col className="cust" />
                {Array.from({ length: pg.slots }, (_, i) => (
                  <col key={i} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="cust">Customer</th>
                  {pg.products.map((p) => (
                    <th key={p.id} className={colClass(p)}>
                      {p.head}
                      <small>{p.unit}</small>
                    </th>
                  ))}
                  {fill(pg)}
                </tr>
                <tr className="tot">
                  <th className="cust">Total this week</th>
                  {pg.products.map((p) => (
                    <th key={p.id} className={colClass(p)}>
                      {printTotals[p.id] ? fmt(printTotals[p.id]) : ""}
                    </th>
                  ))}
                  {fill(pg)}
                </tr>
                {anyShort && (
                  <tr className="sf">
                    <th className="cust">Of that, half and whole shortfall</th>
                    {pg.products.map((p) => (
                      <th key={p.id} className={colClass(p)}>
                        {short[p.id] ? fmt(short[p.id]) : ""}
                      </th>
                    ))}
                    {fill(pg)}
                  </tr>
                )}
              </thead>
              <tbody>
                {shownRows.map((r, i) =>
                  r.heading ? (
                    <tr key={i} className="grp">
                      <td className="cust">{r.name}</td>
                      {pg.products.map((p) => (
                        <td key={p.id} className={colClass(p)} />
                      ))}
                      {fill(pg)}
                    </tr>
                  ) : (
                    <tr key={i}>
                      <td className="cust">{r.name}</td>
                      {pg.products.map((p) => (
                        <td key={p.id} className={colClass(p)}>
                          {r.cells[p.id] ?? ""}
                        </td>
                      ))}
                      {fill(pg)}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            {pg.page === pg.pages && (
              <p className="ogp-note">
                Only products with an order this week are printed. A unit after a number (&quot;20 lb&quot;) means that line was taken
                in another unit than the column&apos;s; totals are in the column&apos;s unit.
                {anyIfExtra ? " * Only if extra: not counted on to be filled." : ""}
                {noOrder > 0 ? ` ${noOrder} customer${noOrder === 1 ? "" : "s"} with no order this week ${noOrder === 1 ? "isn't" : "aren't"} listed.` : ""}
              </p>
            )}
          </section>
        ))}
      </div>
      <p className="small muted mt-0 mb-2 screen-only">
        Customers down the side, products across the top. Type a number and press Tab to move across, Enter to move
        down. It saves as you go.
      </p>
      <div className="gridwrap screen-only">
        <table className="og">
          <thead>
            <tr>
              <th className="cust">Customer</th>
              {products.map((p) => (
                <th key={p.id} title={p.name}>
                  {p.short_name || p.name}
                  <small>{unitWord(p.unit)}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows}
            <tr className="sf">
              <td className="cust small">Half and whole shortfall</td>
              {products.map((p) => (
                <td key={p.id} className="num">
                  {short[p.id] ? fmt(short[p.id]) : ""}
                </td>
              ))}
            </tr>
            <tr className="tot">
              <td className="cust">Total this week</td>
              {products.map((p) => {
                const t = (totals[p.id] ?? 0) + (short[p.id] ?? 0);
                return (
                  <td key={p.id} className="num">
                    {t ? fmt(t) : ""}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

/** A printed grid column's look: shaded every other column, a thicker line where a new product group starts. */
function colClass(p: GridPrintColumn): string {
  return [p.shaded ? "alt" : "", p.groupStart ? "gs" : ""].filter(Boolean).join(" ") || "";
}

/** Empty slots at the end of a sheet with fewer products, so its columns line up with the other sheets'. */
function fill(pg: GridPrintPage) {
  return Array.from({ length: pg.slots - pg.products.length }, (_, i) => <td key={`fill-${i}`} className="fill" aria-hidden="true" />);
}
