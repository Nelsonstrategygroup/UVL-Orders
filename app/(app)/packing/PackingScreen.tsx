"use client";

// Packing, for Chris's tablet at the plant (stage 3: by weight). One large
// row per line; tap it to weigh. A line can take several weights (one per
// box or case), a piece count, Not filled (the X), or a flag with a note.
// Customers are in pallet group order.

import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCan } from "@/components/CurrentUser";
import { getDb } from "@/components/data/db";
import { useLive } from "@/components/data/useLive";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import ViewOnly from "@/components/ViewOnly";
import { useWeek, WeekBar } from "@/components/Week";
import { fmt, num } from "@/lib/calc/num";
import {
  boxes,
  lineLook,
  lineWords,
  nextBox,
  orderPacked,
  packStats,
  showOrder,
  type PackFilter,
  type PackLine,
} from "@/lib/calc/packing";
import { niceDate } from "@/lib/dates";
import { formatWhen } from "@/lib/format";
import { qtyText } from "@/lib/orders";
import {
  addWeight,
  loadPacking,
  packLines,
  removeWeight,
  saveMark,
  savePallet,
  type LineMark,
  type PackingData,
  type PackOrder,
} from "@/lib/db/packing";

const LIVE_TABLES = ["orders", "order_lines", "packing_lines", "packing_weights", "packing_orders"];
const FILTERS: [PackFilter, string][] = [
  ["todo", "To pack"],
  ["done", "Done"],
  ["all", "All"],
];
// ✕ is the paper sheet's X (not filled); − is packed but short.
const MARK: Record<string, string> = { done: "✓", short: "−", over: "+", flag: "!" };

export default function PackingScreen() {
  const { week } = useWeek();
  const toast = useToast();
  const db = getDb();
  const load = useCallback((d: SupabaseClient) => loadPacking(d, week), [week]);
  const { data, error, refresh } = useLive(`packing-${week}`, load, LIVE_TABLES);
  const canPack = useCan("packing").change;
  const [filter, setFilter] = useState<PackFilter>("todo");
  // Customers finished while "To pack" is showing stay on screen, so the
  // packer can still see "All packed" and fill in the pallet.
  const [finished, setFinished] = useState<{ key: string; ids: Set<string> }>({ key: "", ids: new Set() });
  const finishedKey = `${week}:${filter}`;
  const keepIds = finished.key === finishedKey ? finished.ids : null;
  const [weighing, setWeighing] = useState<{ orderId: string; productId: string } | null>(null);
  const closeWeigh = useCallback(() => setWeighing(null), []);

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

  const keep = (orderId: string) => {
    if (filter === "todo")
      setFinished((f) => ({ key: finishedKey, ids: new Set([...(f.key === finishedKey ? f.ids : []), orderId]) }));
  };
  const saved = (err: string | null) => {
    if (err) toast("Couldn't save. Check the internet connection.");
    refresh();
    return !err;
  };

  const withLines = data.orders.map((o) => ({ o, lines: packLines(o, data.products) }));
  const stats = packStats(withLines.map((x) => ({ lines: x.lines.map(([, l]) => l) })));
  const shown = withLines.filter(({ o, lines }) => showOrder(lines.map(([, l]) => l), filter) || !!keepIds?.has(o.id));
  const wOrder = weighing && data.orders.find((o) => o.id === weighing.orderId);

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
        {!canPack && <ViewOnly what="packing" />}

        {!data.orders.length ? (
          <div className="empty">No orders for this week yet. They show up here as soon as they&apos;re entered.</div>
        ) : !shown.length ? (
          <div className="empty">{filter === "todo" ? "Everything is packed." : "Nothing here yet."}</div>
        ) : (
          shown.map(({ o, lines }, i) => (
            <div key={o.id}>
              {o.group && o.group !== shown[i - 1]?.o.group && <h3 className="mt-5 mb-1">{o.group}</h3>}
              <CustomerCard
                order={o}
                lines={lines}
                data={data}
                canPack={canPack}
                onOpen={(pid) => setWeighing({ orderId: o.id, productId: pid })}
                onPallet={(v) => void savePallet(db, o.id, v).then(saved)}
              />
            </div>
          ))
        )}
      </div>

      <PrintCopy data={data} />

      {weighing && wOrder && (
        <WeighSheet
          order={wOrder}
          productId={weighing.productId}
          data={data}
          canPack={canPack}
          onClose={closeWeigh}
          onAdd={async (weight, box) => {
            keep(wOrder.id);
            const r = await addWeight(db, wOrder.id, weighing.productId, weight, box);
            if (saved(r.error) && r.id) {
              const id = r.id;
              toast(`${fmt(weight)} lb saved`, () => void removeWeight(db, id).then(saved));
            }
          }}
          onRemove={(id) => void removeWeight(db, id).then(saved)}
          onMark={(m) => {
            keep(wOrder.id);
            void saveMark(db, wOrder.id, weighing.productId, m).then(saved);
          }}
        />
      )}
    </>
  );
}

function CustomerCard({
  order: o,
  lines,
  data,
  canPack,
  onOpen,
  onPallet,
}: {
  order: PackOrder;
  lines: [string, PackLine][];
  data: PackingData;
  canPack: boolean;
  onOpen: (productId: string) => void;
  onPallet: (v: string) => void;
}) {
  const done = lines.filter(([, l]) => lineLook(l) !== "todo").length;
  const bx = boxes(o.weights);
  const name = (pid: string) => data.products.get(pid)?.name ?? pid;

  return (
    <section className="pcust" aria-label={o.customerName}>
      <div className="pcust-head">
        <b>{o.customerName}</b>
        {o.spot && <span className="tag even">{o.spot}</span>}
        <span className="flex-1" />
        <span className="small num">
          {done}/{lines.length}
        </span>
      </div>
      <PackNotes o={o} />

      {lines.map(([pid, l]) => {
        const look = lineLook(l);
        return (
          <button
            key={pid}
            type="button"
            className={`prow ${look === "todo" ? "" : look}`}
            onClick={() => onOpen(pid)}
            aria-label={`${name(pid)}. ${lineWords(l)}`}
          >
            <span className="box" aria-hidden="true">
              {l.shorted && !l.flagged ? "✕" : (MARK[look] ?? "")}
            </span>
            <span className="what">
              <b>{name(pid)}</b>
              <br />
              <span className="small">{lineWords(l)}</span>
            </span>
            <span className="qty num">{qtyText(l.ordered, l.unit)}</span>
          </button>
        );
      })}

      {orderPacked(lines.map(([, l]) => l)) && <div className="alldone">All packed. Add the pallet below.</div>}

      <div className="pfoot">
        <span className="small">
          {bx.length === 0
            ? "No boxes yet."
            : `${bx.length} box${bx.length === 1 ? "" : "es"}: ` +
              bx.map((b) => `${b.box_no}${b.mixed ? " (mixed)" : ""} ${fmt(b.weight)} lb`).join(", ")}
        </span>
        <label htmlFor={`pallet-${o.id}`}>Pallet</label>
        <input
          id={`pallet-${o.id}`}
          key={`${o.id}:${o.pallet}`}
          className="field w-24!"
          defaultValue={o.pallet}
          disabled={!canPack}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== o.pallet) onPallet(v);
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

/** Weigh one line: add weights (each in a box), a piece count, Not filled, or a flag. */
function WeighSheet({
  order: o,
  productId,
  data,
  canPack,
  onClose,
  onAdd,
  onRemove,
  onMark,
}: {
  order: PackOrder;
  productId: string;
  data: PackingData;
  canPack: boolean;
  onClose: () => void;
  onAdd: (weight: number, box: number | null) => Promise<void>;
  onRemove: (id: string) => void;
  onMark: (m: LineMark) => void;
}) {
  const line = packLines(o, data.products).find(([pid]) => pid === productId)?.[1];
  const mark: LineMark = o.marks[productId] ?? { count: null, shorted: false, flagged: false, flagNote: "" };
  const mine = o.weights.filter((w) => w.product_id === productId);
  const newBox = nextBox(o.weights);
  const [text, setText] = useState("");
  const [box, setBox] = useState<number>(newBox);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(mark.flagNote);
  const [count, setCount] = useState(mark.count == null ? "" : fmt(mark.count));
  if (!line) return null;
  const boxList = boxes(o.weights);
  const name = (pid: string) => data.products.get(pid)?.name ?? pid;
  const value = num(text);

  /** Done: save a flag note or count still being typed, then close. */
  function finish() {
    const c = count.trim() === "" ? null : num(count);
    if (canPack && ((mark.flagged && note !== mark.flagNote) || (line!.unit !== "lb" && c !== mark.count)))
      onMark({ ...mark, flagNote: mark.flagged ? note : mark.flagNote, count: line!.unit !== "lb" ? c : mark.count });
    onClose();
  }

  async function add() {
    if (!(value > 0)) return;
    setBusy(true);
    await onAdd(value, box);
    setBusy(false);
    setText("");
    setBox(box === newBox ? newBox + 1 : box);
  }

  return (
    <Sheet title={name(productId)} onClose={finish}>
      <p className="mt-0 text-[1.05rem]">
        Ordered <b>{qtyText(line.ordered, line.unit)}</b>. {lineWords(line)}.
      </p>

      <fieldset disabled={!canPack || busy} className="m-0 min-w-0 border-0 p-0">
        {mine.length > 0 && (
          <ul className="m-0 mb-3 grid list-none gap-1 p-0">
            {mine.map((w) => (
              <li key={w.id} className="flex items-center gap-3 border-b border-line py-1 text-[1.05rem]">
                <span className="num">{fmt(w.weight)} lb</span>
                <span className="small muted">{w.box_no ? `Box ${w.box_no}` : "No box"}</span>
                <span className="flex-1" />
                <button type="button" className="copy min-h-[44px]" onClick={() => onRemove(w.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="lbl big mt-0!" htmlFor="weigh-lb">
          {mine.length ? "Add another weight (lb)" : "Weight (lb)"}
        </label>
        <div className="flex gap-2">
          <input
            id="weigh-lb"
            className="field big num"
            inputMode="decimal"
            autoFocus
            value={text}
            placeholder="0.00"
            onChange={(e) => setText(e.target.value.replace(/[^0-9.]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
          />
          <button type="button" className="btn shrink-0" disabled={!(value > 0)} onClick={() => void add()}>
            Save weight
          </button>
        </div>

        <p className="lbl">Which box?</p>
        <div className="seg flex-wrap" role="group" aria-label="Which box">
          {boxList.map((b) => (
            <button key={b.box_no} type="button" aria-pressed={box === b.box_no} onClick={() => setBox(b.box_no)}>
              Box {b.box_no}
              {/* What's already in it, so mixing is a choice you can see */}
              {b.products.some((pid) => pid !== productId)
                ? ` · ${b.products.filter((pid) => pid !== productId).map(name).join(", ")}`
                : ""}
            </button>
          ))}
          <button type="button" aria-pressed={box === newBox} onClick={() => setBox(newBox)}>
            New box ({newBox})
          </button>
        </div>
        <p className="small muted mt-1">Pick a box that already has something else in it to make a mixed box.</p>

        {line.unit !== "lb" && (
          <>
            <label className="lbl" htmlFor="weigh-count">
              How many {line.unit === "pack" ? "packs" : line.unit === "case" ? "cases" : "pieces"}? (optional)
            </label>
            <input
              id="weigh-count"
              className="field num w-28!"
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value.replace(/[^0-9.]/g, ""))}
              onBlur={() => {
                const c = count.trim() === "" ? null : num(count);
                if (c !== mark.count) onMark({ ...mark, count: c });
              }}
            />
          </>
        )}

        <div className="mt-4 grid gap-2">
          <label className="flex min-h-[44px] items-center gap-3 text-[1.05rem]">
            <input
              type="checkbox"
              className="h-6 w-6 accent-forest"
              checked={mark.shorted}
              onChange={(e) => onMark({ ...mark, shorted: e.target.checked })}
            />
            Not filled (none packed)
          </label>
          <label className="flex min-h-[44px] items-center gap-3 text-[1.05rem]">
            <input
              type="checkbox"
              className="h-6 w-6 accent-forest"
              checked={mark.flagged}
              onChange={(e) => onMark({ ...mark, flagged: e.target.checked, flagNote: note })}
            />
            Flag this line for Kathy
          </label>
          {mark.flagged && (
            <input
              className="field"
              aria-label="Why it's flagged"
              placeholder="What's wrong? (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => note !== mark.flagNote && onMark({ ...mark, flagNote: note })}
            />
          )}
        </div>
      </fieldset>

      <div className="mt-4 flex justify-end">
        <button type="button" className="btn" onClick={finish}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

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

/** The paper checklist: blanks for weights, box, not filled, pallet, and initials. */
function PrintCopy({ data }: { data: PackingData }) {
  return (
    <div className="print-only printsheet">
      <h1>Packing list, week of {niceDate(data.week)}</h1>
      {data.orders.map((o) => (
        <table key={o.id}>
          <thead>
            <tr>
              <th colSpan={6}>
                {o.customerName}
                {o.group ? ` · ${o.group}${o.spot ? `, ${o.spot}` : ""}` : ""}
                <PackNotes o={o} />
              </th>
            </tr>
            <tr>
              <th className="ck">Done</th>
              <th>Product</th>
              <th>Ordered</th>
              <th className="blank">Weight (lb)</th>
              <th className="blank">Box</th>
              <th className="ck">X</th>
            </tr>
          </thead>
          <tbody>
            {packLines(o, data.products).map(([pid, l]) => (
              <tr key={pid}>
                <td className="ck">☐</td>
                <td>{data.products.get(pid)?.name ?? pid}</td>
                <td>{qtyText(l.ordered, l.unit)}</td>
                <td>{l.weight > 0 ? fmt(l.weight) : ""}</td>
                <td />
                <td className="ck">{l.shorted ? "X" : "☐"}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={6}>Pallet: ________ &nbsp;&nbsp; Initials: ______</td>
            </tr>
          </tbody>
        </table>
      ))}
    </div>
  );
}
