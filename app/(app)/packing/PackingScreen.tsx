"use client";

// Packing (SPEC 5.6), for Chris's tablet at the plant. Ported from the
// prototype's renderPack: one large row per line, tap anywhere on it to
// mark it packed, with Undo.

import { useCan } from "@/components/CurrentUser";
import ViewOnly from "@/components/ViewOnly";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/components/data/db";
import { useLive } from "@/components/data/useLive";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { fmt, num } from "@/lib/calc/num";
import {
  afterTap,
  lineLook,
  lineWords,
  orderedLines,
  orderPacked,
  packStats,
  showOrder,
  type PackFilter,
} from "@/lib/calc/packing";
import { niceDate } from "@/lib/dates";
import { formatWhen } from "@/lib/format";
import { qtyText } from "@/lib/orders";
import { loadPacking, savePacked, savePackMeta, type PackingData, type PackOrder } from "@/lib/db/packing";

const LIVE_TABLES = ["orders", "order_lines", "packing_lines", "packing_orders"];
const FILTERS: [PackFilter, string][] = [
  ["todo", "To pack"],
  ["done", "Done"],
  ["all", "All"],
];

export default function PackingScreen() {
  const { week } = useWeek();
  const toast = useToast();
  const db = getDb();
  const load = useCallback((d: SupabaseClient) => loadPacking(d, week), [week]);
  const { data, error, refresh, patch } = useLive(`packing-${week}`, load, LIVE_TABLES);
  const canPack = useCan("packing").change;
  const [filter, setFilter] = useState<PackFilter>("todo");
  // Customers finished while "To pack" is showing stay on screen, so the
  // packer can still see "All packed" and fill in boxes and pallet.
  const [finished, setFinished] = useState<{ key: string; ids: Set<string> }>({ key: "", ids: new Set() });
  const finishedKey = `${week}:${filter}`;
  const keepIds = finished.key === finishedKey ? finished.ids : null;
  const [adjusting, setAdjusting] = useState<{ orderId: string; productId: string } | null>(null);
  const closeAdjust = useCallback(() => setAdjusting(null), [setAdjusting]);

  if (error)
    return (
      <>
        <WeekBar />
        <p className="note bad">Couldn&apos;t load the packing list. Check the internet connection. ({error})</p>
      </>
    );
  if (!data)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading the packing list...</div>
      </>
    );

  /** Show a packed amount right away, then save it. */
  async function setPacked(orderId: string, productId: string, qty: number) {
    patch((d: PackingData) => ({
      ...d,
      orders: d.orders.map((o) => (o.id === orderId ? { ...o, packed: { ...o.packed, [productId]: qty } } : o)),
    }));
    const err = await savePacked(db, orderId, productId, qty);
    if (err) toast("Couldn't save. Check the internet connection.");
    refresh();
    return !err;
  }

  async function tap(o: PackOrder, productId: string) {
    const ordered = o.lines[productId];
    const before = o.packed[productId] ?? 0;
    const next = afterTap(ordered, before);
    if (next > 0 && filter === "todo") {
      setFinished((f) => ({ key: finishedKey, ids: new Set([...(f.key === finishedKey ? f.ids : []), o.id]) }));
    }
    const name = data!.products.get(productId)?.name ?? "That cut";
    if (await setPacked(o.id, productId, next))
      toast(next ? `${name} packed` : `${name} unchecked`, () => void setPacked(o.id, productId, before));
  }

  async function setMeta(o: PackOrder, meta: { boxes?: number | null; pallet?: string }) {
    const full = { boxes: meta.boxes !== undefined ? meta.boxes : o.boxes, pallet: meta.pallet ?? o.pallet };
    patch((d: PackingData) => ({ ...d, orders: d.orders.map((x) => (x.id === o.id ? { ...x, ...full } : x)) }));
    const err = await savePackMeta(db, o.id, full);
    if (err) toast("Couldn't save. Check the internet connection.");
    refresh();
  }

  const stats = packStats(data.orders);
  const shown = data.orders.filter((o) => showOrder(o, filter) || !!keepIds?.has(o.id));
  const adjustOrder = adjusting && data.orders.find((o) => o.id === adjusting.orderId);

  return (
    <>
      <div className="screen-only">
        <WeekBar processDate={data.processDate} />

        <div className="packhead">
          <div>
            <h2>Packing</h2>
            <span className="muted">
              {stats.done} of {stats.total} lines packed
            </span>{" "}
            {data.orders.length > 0 && (
              <button type="button" className="copy ml-1 text-[.95rem]" onClick={() => window.print()}>
                Print a paper copy
              </button>
            )}
          </div>
          <div className="seg" role="group" aria-label="Show">
            {FILTERS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={filter === k}
                onClick={() => {
                  setFilter(k);
                  setFinished({ key: "", ids: new Set() });
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div
          className="pbar"
          role="progressbar"
          aria-label="Lines packed"
          aria-valuemin={0}
          aria-valuemax={stats.total}
          aria-valuenow={stats.done}
        >
          <i style={{ width: `${stats.total ? (stats.done / stats.total) * 100 : 0}%` }} />
        </div>

        {!data.orders.length ? (
          <div className="empty">No orders for this week yet. They show up here as soon as they&apos;re entered.</div>
        ) : !shown.length ? (
          <div className="empty">{filter === "todo" ? "Everything is packed." : "Nothing here yet."}</div>
        ) : (
          shown.map((o) => (
            <fieldset key={o.id} disabled={!canPack} className="m-0 min-w-0 border-0 p-0">
            <CustomerCard
              key={o.id}
              order={o}
              data={data}
              onTap={(pid) => void tap(o, pid)}
              onAdjust={(pid) => setAdjusting({ orderId: o.id, productId: pid })}
              onMeta={(m) => void setMeta(o, m)}
            />
            </fieldset>
          ))
        )}
      </div>

      {!canPack && <ViewOnly what="packing" />}
      <PrintCopy data={data} />

      {adjusting && adjustOrder && (
        <AdjustSheet
          name={data.products.get(adjusting.productId)?.name ?? "This cut"}
          ordered={adjustOrder.lines[adjusting.productId] ?? 0}
          packed={adjustOrder.packed[adjusting.productId] ?? 0}
          onClose={closeAdjust}
          onSave={(qty) => {
            setAdjusting(null);
            if (filter === "todo")
              setFinished((f) => ({ key: finishedKey, ids: new Set([...(f.key === finishedKey ? f.ids : []), adjusting.orderId]) }));
            void setPacked(adjusting.orderId, adjusting.productId, qty);
          }}
        />
      )}
    </>
  );
}

function CustomerCard({
  order: o,
  data,
  onTap,
  onAdjust,
  onMeta,
}: {
  order: PackOrder;
  data: PackingData;
  onTap: (productId: string) => void;
  onAdjust: (productId: string) => void;
  onMeta: (m: { boxes?: number | null; pallet?: string }) => void;
}) {
  const lines = orderedLines(o).sort(
    ([a], [b]) => (data.products.get(a)?.sort ?? 0) - (data.products.get(b)?.sort ?? 0),
  );
  const done = lines.filter(([pid, q]) => lineLook(q, o.packed[pid] ?? 0) === "done").length;

  return (
    <section className="pcust" aria-label={o.customerName}>
      <div className="pcust-head">
        <b>{o.customerName}</b>
        <span className="small num">
          {done}/{lines.length}
        </span>
      </div>
      <PackNotes o={o} />

      {lines.map(([pid, q]) => {
        const p = data.products.get(pid);
        const got = o.packed[pid] ?? 0;
        const look = lineLook(q, got);
        return (
          <div key={pid}>
            <button type="button" className={`prow ${look === "todo" ? "" : look}`} aria-pressed={look === "done"} onClick={() => onTap(pid)}>
              <span className="box" aria-hidden="true">
                {look === "done" ? "✓" : look === "part" ? "!" : ""}
              </span>
              <span className="what">
                <b>{p?.name ?? pid}</b>
                <br />
                <span className="small muted">{lineWords(q, got, o.units[pid] ?? p?.unit ?? "")}</span>
              </span>
              <span className="qty num">{qtyText(q, o.units[pid] ?? p?.unit ?? "each")}</span>
            </button>
            {got > 0 && (
              <button type="button" className="fewer" onClick={() => onAdjust(pid)}>
                {look === "part" ? "Change the count" : "Packed a different amount?"}
              </button>
            )}
          </div>
        );
      })}

      {orderPacked(o) && <div className="alldone">All packed. Add boxes and pallet below.</div>}

      <div className="pfoot">
        <span>Boxes</span>
        <BoxesStepper value={o.boxes} onChange={(boxes) => onMeta({ boxes })} />
        <label htmlFor={`pallet-${o.id}`}>Pallet</label>
        <input
          id={`pallet-${o.id}`}
          key={`${o.id}:${o.pallet}`}
          className="field w-24!"
          defaultValue={o.pallet}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== o.pallet) onMeta({ pallet: v });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <span className="flex-1" />
        {o.lastAt && (
          <span className="by">
            {o.lastBy ?? "Someone"} at {formatWhen(o.lastAt)}
          </span>
        )}
      </div>
    </section>
  );
}

function BoxesStepper({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState<string | null>(null);
  // The latest count, so quick taps of + and - all count.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const step = (d: number) => {
    latest.current = Math.max(0, (latest.current ?? 0) + d);
    onChange(latest.current);
  };
  const shown = text ?? (value ? String(value) : "");
  const commit = () => {
    if (text === null) return;
    const t = text.trim();
    setText(null);
    const v = t === "" ? null : Math.max(0, Math.round(num(t)));
    if (v !== value) onChange(v);
  };
  return (
    <div className="stepper">
      <button type="button" aria-label="One less box" onClick={() => step(-1)}>
        &minus;
      </button>
      <input
        inputMode="numeric"
        aria-label="Boxes"
        value={shown}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <button type="button" aria-label="One more box" onClick={() => step(1)}>
        +
      </button>
    </div>
  );
}

function AdjustSheet({
  name,
  ordered,
  packed,
  onClose,
  onSave,
}: {
  name: string;
  ordered: number;
  packed: number;
  onClose: () => void;
  onSave: (qty: number) => void;
}) {
  const [text, setText] = useState(fmt(packed || ordered));
  const value = Math.max(0, num(text));
  return (
    <Sheet title={name} onClose={onClose}>
      <p className="muted mt-0 text-[1.05rem]">{fmt(ordered)} ordered. How many did you pack?</p>
      <div className="stepper my-4 justify-center">
        <button type="button" aria-label="One less" onClick={() => setText(fmt(Math.max(0, value - 1)))}>
          &minus;
        </button>
        <input
          inputMode="decimal"
          aria-label="Packed"
          className="w-24! text-xl"
          value={text}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))}
        />
        <button type="button" aria-label="One more" onClick={() => setText(fmt(value + 1))}>
          +
        </button>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={() => onSave(value)}>
          Save
        </button>
      </div>
    </Sheet>
  );
}

/** The paper checklist: blanks for packed count, boxes, pallet, and initials. */
/** Standing notes and this week's order notes, so Chris sees them while packing. */
function PackNotes({ o }: { o: PackOrder }) {
  if (!o.standingNotes && !o.orderNotes) return null;
  return (
    <div className="mt-1 grid gap-0.5 text-[.95rem] font-normal">
      {o.orderNotes && (
        <div>
          <b>This week:</b> {o.orderNotes}
        </div>
      )}
      {o.standingNotes && (
        <div className="whitespace-pre-wrap">
          <b>Always:</b> {o.standingNotes}
        </div>
      )}
    </div>
  );
}

function PrintCopy({ data }: { data: PackingData }) {
  return (
    <div className="print-only printsheet">
      <h1>Packing list, week of {niceDate(data.week)}</h1>
      {data.orders.map((o) => (
        <table key={o.id}>
          <thead>
            <tr>
              <th colSpan={4}>
                {o.customerName}
                <PackNotes o={o} />
              </th>
            </tr>
            <tr>
              <th className="ck">Done</th>
              <th>Cut</th>
              <th>Ordered</th>
              <th className="blank">Packed</th>
            </tr>
          </thead>
          <tbody>
            {orderedLines(o)
              .sort(([a], [b]) => (data.products.get(a)?.sort ?? 0) - (data.products.get(b)?.sort ?? 0))
              .map(([pid, q]) => {
                const p = data.products.get(pid);
                return (
                  <tr key={pid}>
                    <td className="ck">☐</td>
                    <td>
                      {p?.name ?? pid}
                    </td>
                    <td>{qtyText(q, o.units[pid] ?? p?.unit ?? "each")}</td>
                    <td />
                  </tr>
                );
              })}
            <tr>
              <td colSpan={4}>Boxes: ________ &nbsp;&nbsp; Pallet: ________ &nbsp;&nbsp; Initials: ______</td>
            </tr>
          </tbody>
        </table>
      ))}
    </div>
  );
}
