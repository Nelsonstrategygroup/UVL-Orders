"use client";

// The order editor (SPEC 5.2), opened from Calls, Orders, or a customer.
// Saves automatically about half a second after typing stops.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ago, weekName } from "@/lib/dates";
import { fmt, num } from "@/lib/calc/num";
import { logContact, setOrder } from "@/lib/db/save";
import { lineUnit, unitWord } from "@/lib/calc/units";
import { findProducts, groupProducts } from "@/lib/calc/products";
import { orderBoxes, orderBoxesText } from "@/lib/calc/boxes";
import type { CatalogProduct, Customer, Order, OrderStatus, OrderUnit, Qty, Units } from "@/lib/db/types";
import type { LastOrder } from "@/lib/calc/lastOrder";
import {
  cleanLines,
  cleanQtyInput,
  cleanUnits,
  hasLines,
  qtyText,
  snapshot,
  STATUSES,
  STATUS_LABEL,
  statusAfterLines,
} from "@/lib/orders";
import { useCan } from "./CurrentUser";
import { getDb, useStaffData } from "./data/StaffData";
import ViewOnly from "./ViewOnly";
import ReadBack, { orderSummary } from "./ReadBack";
import Sheet from "./Sheet";
import { useToast } from "./Toast";

const SAVE_DELAY_MS = 500;

export type OrderEditorProps = {
  week: string;
  customer: Customer;
  displayName: string;
  order: Order | undefined;
  lastWeek: Order | undefined;
  /** Their most recent order before this week ("Last order"); undefined if they never ordered. */
  lastOrder?: LastOrder;
  /** Show a change right away, before the database confirms it. */
  patchOrder: (customerId: string, order: Order | null) => void;
  refresh: () => void;
  onClose: () => void;
};

export default function OrderEditor(props: OrderEditorProps) {
  const { week, customer, order, lastWeek, lastOrder, patchOrder, refresh, onClose } = props;
  const { catalog, customers, reloadCustomers, reloadCatalog } = useStaffData();
  // Changing an order needs Change on Orders or Calls; logging a call needs Call notes.
  const ordersCan = useCan("orders");
  const callsCan = useCan("calls");
  const notesCan = useCan("callnotes");
  const canChange = ordersCan.change || callsCan.change;
  const canLog = notesCan.change;
  const seeNotes = notesCan.view;
  const toast = useToast();
  const db = getDb();

  // Unsaved quantities, shown over the saved order until the save lands.
  const [draft, setDraft] = useState<{ lines: Qty; units: Units } | null>(null);
  // Raw text of a quantity box while typing (so "1." stays "1.").
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [logging, setLogging] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Which product's info note is open.
  const [info, setInfo] = useState<string | null>(null);
  // The "Add a product" search box, and products added from it this time.
  const [search, setSearch] = useState("");
  const [added, setAdded] = useState<string[]>([]);

  // Fetch the product list fresh when the editor opens, so a product just
  // added in Setup (on this device or another) is there.
  useEffect(() => {
    void reloadCatalog();
  }, [reloadCatalog]);

  const lines = useMemo(() => draft?.lines ?? order?.lines ?? {}, [draft, order]);
  const units = useMemo(() => draft?.units ?? order?.units ?? {}, [draft, order]);
  const status: OrderStatus = order?.status ?? "todo";

  const pending = useRef<{ lines: Qty; units: Units } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the latest order for the save callback without re-creating it.
  const orderRef = useRef(order);
  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const toSave = pending.current;
    if (!toSave) return;
    pending.current = null;
    const cur = orderRef.current;
    const next: Order = {
      id: cur?.id ?? "",
      customer_id: customer.id,
      notes: cur?.notes ?? "",
      status: statusAfterLines(cur?.status ?? "todo", toSave.lines),
      lines: toSave.lines,
      units: toSave.units,
    };
    patchOrder(customer.id, next);
    const err = await setOrder(db, { week, customerId: customer.id, lines: toSave.lines, units: toSave.units });
    setSaveError(err ? "Couldn't save. Check the internet connection." : null);
    // Clear the draft only if nothing newer was typed meanwhile.
    if (!pending.current) setDraft((d) => (d === toSave ? null : d));
    refresh();
  }, [db, week, customer.id, patchOrder, refresh]);

  // Save anything still waiting when the editor closes.
  useEffect(() => () => void flush(), [flush]);

  function queue(next: { lines: Qty; units: Units }) {
    setDraft(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }

  /** Set a quantity, or change it from the latest count (so quick taps of + all count). */
  function setQty(productId: string, qty: number | ((current: number) => number)) {
    const base = pending.current ?? { lines, units };
    const value = typeof qty === "function" ? qty(base.lines[productId] ?? 0) : qty;
    const nextLines = cleanLines({ ...base.lines, [productId]: Math.max(0, value) });
    queue({ lines: nextLines, units: cleanUnits(base.units, nextLines) });
  }

  /** Pieces or pounds for one line. The quantity stays; Kathy types the new amount. */
  function setUnit(p: CatalogProduct, unit: OrderUnit) {
    const base = pending.current ?? { lines, units };
    const nextUnits = { ...base.units };
    if (unit === p.unit) delete nextUnits[p.id];
    else nextUnits[p.id] = unit;
    queue({ lines: base.lines, units: nextUnits });
  }

  async function save(change: { status?: OrderStatus; notes?: string; lines?: Qty; units?: Units }, message?: string) {
    await flush();
    const before = snapshot(orderRef.current);
    const next: Order = {
      id: orderRef.current?.id ?? "",
      customer_id: customer.id,
      status: change.status ?? statusAfterLines(before.status, change.lines ?? before.lines),
      notes: change.notes ?? before.notes,
      lines: change.lines ?? before.lines,
      units: change.units ?? (change.lines ? {} : before.units),
    };
    patchOrder(customer.id, next);
    const err = await setOrder(db, { week, customerId: customer.id, ...change });
    if (err) {
      setSaveError("Couldn't save. Check the internet connection.");
      refresh();
      return;
    }
    setSaveError(null);
    refresh();
    if (message)
      toast(message, async () => {
        patchOrder(customer.id, { ...next, ...before });
        await setOrder(db, { week, customerId: customer.id, ...before });
        refresh();
      });
  }

  const products = catalog?.products ?? [];
  // "What they usually buy" is fixed when the editor opens, so a row doesn't
  // jump to the top of the list while someone is tapping + on it.
  const [usual] = useState(() => {
    const s = new Set(customers?.usual.get(customer.id) ?? []);
    for (const k in order?.lines ?? {}) if ((order?.lines[k] ?? 0) > 0) s.add(k);
    return s;
  });

  const visible = products.filter((p) => p.active || (lines[p.id] ?? 0) > 0);
  const onTop = (p: CatalogProduct) => usual.has(p.id) || added.includes(p.id);
  const first = visible.filter(onTop);
  const rest = visible.filter((p) => !onTop(p));
  const found = findProducts(products, search);

  /** Picked from "Add a product": put it with their usual cuts and start it at one step. */
  function pick(p: CatalogProduct) {
    setAdded((a) => (a.includes(p.id) ? a : [...a, p.id]));
    if (!(lines[p.id] ?? 0)) setQty(p.id, p.order_step || 1);
    setSearch("");
    // Bring the new line into view so they can change the amount.
    setTimeout(() => document.getElementById(`qty-${p.id}`)?.focus(), 50);
  }
  const phone = customer.contacts.find((k) => k.phone)?.phone;
  const last = customers?.lastContact.get(customer.id);
  const lastWeekHasLines = hasLines(lastWeek?.lines);

  const row = (p: CatalogProduct) => {
    const shown = typing[p.id] ?? (lines[p.id] ? fmt(lines[p.id]) : "");
    const unit = lineUnit(p.id, p, units);
    const step = p.order_step || 1;
    return (
      <div key={p.id}>
        <div className="step">
          <div className="min-w-0">
            {p.name}{" "}
            {p.alt_unit ? (
              <span className="unitswitch" role="group" aria-label={`${p.name}: pieces or pounds`}>
                {[p.unit, p.alt_unit].map((u) => (
                  <button
                    key={u}
                    type="button"
                    aria-pressed={unit === u}
                    onClick={() => setUnit(p, u as OrderUnit)}
                  >
                    {unitWord(u)}
                  </button>
                ))}
              </span>
            ) : (
              <span className="small muted">{unitWord(unit)}</span>
            )}
            {step !== 1 && <span className="small muted"> by {fmt(step)}</span>}
            {(lastOrder?.lines[p.id] ?? 0) > 0 && (
              <span className="lastq">Last: {qtyText(lastOrder!.lines[p.id], lineUnit(p.id, p, lastOrder!.units))}</span>
            )}
            {p.note && (
              <button
                type="button"
                className="infobtn"
                aria-expanded={info === p.id}
                aria-label={`About ${p.name}`}
                onClick={() => setInfo((v) => (v === p.id ? null : p.id))}
              >
                i
              </button>
            )}
          </div>
          <div className="stepper">
            <button type="button" onClick={() => setQty(p.id, (n) => n - step)} aria-label={`${fmt(step)} less ${p.name}`}>
              &minus;
            </button>
            <input
              id={`qty-${p.id}`}
              inputMode="decimal"
              value={shown}
              aria-label={p.name}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const raw = cleanQtyInput(e.target.value);
                setTyping((t) => ({ ...t, [p.id]: raw }));
                setQty(p.id, num(raw));
              }}
              onBlur={() =>
                setTyping((t) => {
                  const n = { ...t };
                  delete n[p.id];
                  return n;
                })
              }
            />
            <button type="button" onClick={() => setQty(p.id, (n) => n + step)} aria-label={`${fmt(step)} more ${p.name}`}>
              +
            </button>
          </div>
        </div>
        {info === p.id && <p className="note small mt-1 mb-2">{p.note}</p>}
      </div>
    );
  };

  const grouped = (list: CatalogProduct[]) =>
    groupProducts(list).flatMap((g) => [
      <h4 className="grouphead" key={`g-${g.group}`}>
        {g.group}
      </h4>,
      ...g.products.map(row),
    ]);

  const close = async () => {
    await flush();
    onClose();
  };

  // The phone or browser Back button closes the order and stays on this
  // screen: opening it adds a step to the history ("#order"), and Back takes
  // that step away. Closing it any other way takes the step away too.
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    let backed = false;
    if (window.location.hash !== "#order") window.history.pushState(null, "", `${window.location.pathname}${window.location.search}#order`);
    const onPop = () => {
      backed = true;
      void closeRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      alive.current = false;
      window.removeEventListener("popstate", onPop);
      // Wait a moment: in development React mounts twice, and the editor
      // may be opening again rather than closing.
      setTimeout(() => {
        if (!alive.current && !backed && window.location.hash === "#order") window.history.back();
      }, 0);
    };
  }, []);

  const box = catalog ? orderBoxes(lines, units, catalog.productById, catalog.boxes) : { boxes: 0, problems: [] };

  return (
    <Sheet title={props.displayName} onClose={() => void close()}>
      <p className="small muted -mt-2 mb-1">
        Packing {weekName(week)}
        {phone && (
          <>
            {" · "}
            <a href={`tel:${phone}`} className="text-forest">
              {phone}
            </a>
          </>
        )}
      </p>
      {customer.notes && <div className="pin small">{customer.notes}</div>}
      {!canChange && <ViewOnly what="this order" />}
      {last && seeNotes && (
        <div className="lastc">
          Last contact {ago(last.created_at)}: {last.summary}
        </div>
      )}

      <div className="my-1 flex flex-wrap items-center gap-3">
        {canLog && (
          <button type="button" className="btn ghost" onClick={() => setLogging((v) => !v)}>
            Log this call
          </button>
        )}
        <Link href={`/customers/${customer.id}`} className="copy text-[.9rem]" onClick={() => void flush()}>
          Customer page
        </Link>
      </div>
      {logging && (
        <LogCall
          customerId={customer.id}
          onSaved={async () => {
            setLogging(false);
            toast("Saved to history");
            await reloadCustomers();
          }}
        />
      )}

      <fieldset disabled={!canChange} className="m-0 min-w-0 border-0 p-0">
      {lastOrder && (
        <p className="lastorder">
          <b>Last order ({weekName(lastOrder.week)}):</b> {orderSummary(lastOrder.lines, products, lastOrder.units)}
        </p>
      )}

      <div className="seg my-2" role="group" aria-label="Status">
        {STATUSES.map((s) => (
          <button key={s} type="button" aria-pressed={s === status} onClick={() => void save({ status: s })}>
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {lastWeekHasLines && (
        <div>
          <button
            type="button"
            className="btn ghost mb-2"
            onClick={() =>
              void save({ status: "ordered", lines: { ...lastWeek!.lines }, units: { ...lastWeek!.units } }, "Copied last week's order")
            }
          >
            Same as last week
          </button>
        </div>
      )}

      {usual.size > 0 && <p className="small muted mt-2 mb-0">What they usually buy</p>}
      {grouped(first)}
      {rest.length > 0 &&
        (showAll || usual.size === 0 ? (
          <>
            {usual.size > 0 && <p className="small muted mt-3 mb-0">Other products</p>}
            {grouped(rest)}
          </>
        ) : (
          <button type="button" className="more-cuts" onClick={() => setShowAll(true)}>
            Show {rest.length} other products
          </button>
        ))}

      <div className="addprod mt-4">
        <label className="lbl" htmlFor="add-product">
          Add a product
        </label>
        <input
          id="add-product"
          type="search"
          className="field"
          autoComplete="off"
          placeholder="Type part of the name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search.trim() && (
          <ul className="picklist" aria-label="Matching products">
            {found.length === 0 && <li className="small muted p-2">No product by that name. Add it in Setup first.</li>}
            {found.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => pick(p)}>
                  <span>
                    {p.name}
                    {p.short_name ? <span className="small muted"> ({p.short_name})</span> : null}
                  </span>
                  <span className="small muted">{(lines[p.id] ?? 0) > 0 ? "on this order" : unitWord(p.unit)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="small muted mt-4 mb-0">Read back to the customer</p>
      <ReadBack lines={lines} units={units} products={products} />
      {(box.boxes > 0 || box.problems.length > 0) && (
        <p className="small muted mt-1 mb-0">
          {box.boxes > 0 && <>About {orderBoxesText(box)}. </>}
          {box.problems.length > 0 && (
            <>Can&apos;t box yet: {box.problems.map((x) => `${x.name} (${x.problem.toLowerCase()})`).join("; ")}.</>
          )}
        </p>
      )}

      <label className="lbl" htmlFor="order-notes">
        Notes
      </label>
      <input
        id="order-notes"
        className="field"
        defaultValue={order?.notes ?? ""}
        placeholder="Call back time, delivery changes"
        onBlur={(e) => {
          if (e.target.value !== (order?.notes ?? "")) void save({ notes: e.target.value });
        }}
      />

      </fieldset>

      {saveError && (
        <p className="note bad mt-3" role="alert">
          {saveError}
        </p>
      )}
      <div className="mt-4 flex justify-end">
        <button type="button" className="btn" onClick={() => void close()}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

function LogCall({ customerId, onSaved }: { customerId: string; onSaved: () => void }) {
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="panel my-2 p-3!">
      <label className="lbl mt-0!" htmlFor="log-summary">
        What was said
      </label>
      <textarea
        id="log-summary"
        className="field"
        rows={2}
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        autoFocus
      />
      {error && <p className="note bad mt-2">{error}</p>}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            if (!summary.trim()) {
              setError("Write what was said.");
              return;
            }
            setBusy(true);
            const err = await logContact(getDb(), {
              customerId,
              kind: "call",
              summary: summary.trim(),
              followUpDate: null,
              followUpNote: "",
            });
            setBusy(false);
            if (err) setError("Couldn't save. Check the internet connection.");
            else onSaved();
          }}
        >
          Save to history
        </button>
      </div>
    </div>
  );
}
