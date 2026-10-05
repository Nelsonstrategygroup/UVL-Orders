"use client";

// The order editor (SPEC 5.2), opened from Calls, Orders, or a customer.
// Saves automatically about half a second after typing stops.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ago, niceDate } from "@/lib/dates";
import { fmt, num } from "@/lib/calc/num";
import { logContact, setOrder } from "@/lib/db/save";
import type { CatalogProduct, Customer, Order, OrderStatus, Qty } from "@/lib/db/types";
import { cleanLines, cleanQtyInput, hasLines, snapshot, STATUSES, STATUS_LABEL, statusAfterLines } from "@/lib/orders";
import { getDb, useStaffData } from "./data/StaffData";
import ReadBack from "./ReadBack";
import Sheet from "./Sheet";
import { useToast } from "./Toast";

const SAVE_DELAY_MS = 500;

export type OrderEditorProps = {
  week: string;
  customer: Customer;
  displayName: string;
  order: Order | undefined;
  lastWeek: Order | undefined;
  /** Show a change right away, before the database confirms it. */
  patchOrder: (customerId: string, order: Order | null) => void;
  refresh: () => void;
  onClose: () => void;
};

export default function OrderEditor(props: OrderEditorProps) {
  const { week, customer, order, lastWeek, patchOrder, refresh, onClose } = props;
  const { catalog, customers, reloadCustomers } = useStaffData();
  const toast = useToast();
  const db = getDb();

  // Unsaved quantities, shown over the saved order until the save lands.
  const [draft, setDraft] = useState<Qty | null>(null);
  // Raw text of a quantity box while typing (so "1." stays "1.").
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [logging, setLogging] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const lines = useMemo(() => draft ?? order?.lines ?? {}, [draft, order]);
  const status: OrderStatus = order?.status ?? "todo";

  const pending = useRef<Qty | null>(null);
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
      status: statusAfterLines(cur?.status ?? "todo", toSave),
      lines: toSave,
    };
    patchOrder(customer.id, next);
    const err = await setOrder(db, { week, customerId: customer.id, lines: toSave });
    setSaveError(err ? "Couldn't save. Check the internet connection." : null);
    // Clear the draft only if nothing newer was typed meanwhile.
    if (!pending.current) setDraft((d) => (d === toSave ? null : d));
    refresh();
  }, [db, week, customer.id, patchOrder, refresh]);

  // Save anything still waiting when the editor closes.
  useEffect(() => () => void flush(), [flush]);

  function setQty(productId: string, qty: number) {
    const next = cleanLines({ ...lines, [productId]: Math.max(0, qty) });
    setDraft(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }

  async function save(change: { status?: OrderStatus; notes?: string; lines?: Qty }, message?: string) {
    await flush();
    const before = snapshot(orderRef.current);
    const next: Order = {
      id: orderRef.current?.id ?? "",
      customer_id: customer.id,
      status: change.status ?? statusAfterLines(before.status, change.lines ?? before.lines),
      notes: change.notes ?? before.notes,
      lines: change.lines ?? before.lines,
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
  const first = visible.filter((p) => usual.has(p.id));
  const rest = visible.filter((p) => !usual.has(p.id));
  const phone = customer.contacts.find((k) => k.phone)?.phone;
  const last = customers?.lastContact.get(customer.id);
  const lastWeekHasLines = hasLines(lastWeek?.lines);

  const row = (p: CatalogProduct) => {
    const shown = typing[p.id] ?? (lines[p.id] ? fmt(lines[p.id]) : "");
    return (
      <div className="step" key={p.id}>
        <div className="min-w-0">
          {p.name} <span className="small muted">{p.unit}</span>
        </div>
        <div className="stepper">
          <button type="button" onClick={() => setQty(p.id, (lines[p.id] ?? 0) - 1)} aria-label={`One less ${p.name}`}>
            &minus;
          </button>
          <input
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
          <button type="button" onClick={() => setQty(p.id, (lines[p.id] ?? 0) + 1)} aria-label={`One more ${p.name}`}>
            +
          </button>
        </div>
      </div>
    );
  };

  const grouped = (list: CatalogProduct[]) => {
    const out: React.ReactNode[] = [];
    let lastGroup = "";
    for (const p of list) {
      if (p.group_name !== lastGroup) {
        out.push(
          <h4 className="grouphead" key={`g-${p.group_name}`}>
            {p.group_name}
          </h4>,
        );
        lastGroup = p.group_name;
      }
      out.push(row(p));
    }
    return out;
  };

  const close = async () => {
    await flush();
    onClose();
  };

  return (
    <Sheet title={props.displayName} onClose={() => void close()}>
      <p className="small muted -mt-2 mb-1">
        Week of {niceDate(week)}
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
      {last && (
        <div className="lastc">
          Last contact {ago(last.created_at)}: {last.summary}
        </div>
      )}

      <div className="my-1 flex flex-wrap items-center gap-3">
        <button type="button" className="btn ghost" onClick={() => setLogging((v) => !v)}>
          Log this call
        </button>
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
            onClick={() => void save({ status: "ordered", lines: { ...lastWeek!.lines } }, "Copied last week's order")}
          >
            Same as last week
          </button>
        </div>
      )}

      {usual.size > 0 && <p className="small muted mt-2 mb-0">What they usually buy</p>}
      {first.map(row)}
      {rest.length > 0 &&
        (showAll || usual.size === 0 ? (
          <>
            {usual.size > 0 && <p className="small muted mt-3 mb-0">Other cuts</p>}
            {grouped(rest)}
          </>
        ) : (
          <button type="button" className="more-cuts" onClick={() => setShowAll(true)}>
            Show {rest.length} other cuts
          </button>
        ))}

      <p className="small muted mt-4 mb-0">Read back to the customer</p>
      <ReadBack lines={lines} products={products} />

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
