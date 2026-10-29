"use client";

// Packing, for Chris's tablet at the plant (stage 3: by weight). One large
// row per line; tap it to weigh. A line can take several weights (one per
// box or case), a piece count, Not filled (the X), or a flag with a note.
// Customers are in pallet group order.

import Link from "next/link";
import { useCallback, useState } from "react";
import { useCan, useMe } from "@/components/CurrentUser";
import OfflineStatus from "@/components/offline/OfflineStatus";
import { useOutbox } from "@/components/offline/OutboxProvider";
import { usePackingBundle } from "@/components/offline/usePackingBundle";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import ViewOnly from "@/components/ViewOnly";
import { useWeek, WeekBar } from "@/components/Week";
import { fmt, num } from "@/lib/calc/num";
import {
  lineLook,
  lineWords,
  orderPacked,
  packStats,
  showOrder,
  type PackFilter,
  type PackLine,
} from "@/lib/calc/packing";
import { formatWhen } from "@/lib/format";
import { qtyText } from "@/lib/orders";
import { orderBoxes, orderBoxesText, type BoxSetup } from "@/lib/calc/boxes";
import { orderSheet, packLines, sheetLabels, sheetRowId, type LineMark, type PackingData, type PackOrder, type PackWeight } from "@/lib/db/packing";
import { isLocal } from "@/lib/offline/outbox";
import { blankWords, nextBlank, type SheetRow } from "@/lib/calc/packSheet";
import { PackNotes, PaperSheet } from "./PackSheet";
import { useLabelNumbers } from "./useLabelNumbers";
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
  const { enqueue } = useOutbox();
  // Loaded with signal and kept on the phone for the freezer (SPEC 11.7).
  const bundle = usePackingBundle(week);
  const data = bundle.data?.packing ?? null;
  const boxSetup = bundle.data?.boxes ?? { types: [], limits: new Map(), capLb: 45 };
  const { error } = bundle;
  const canPack = useCan("packing").change;
  const me = useMe();
  // Number the boxes while there is signal, so the copy kept on the phone prints with label numbers.
  useLabelNumbers(week, bundle.data, bundle.refresh, canPack);
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
        <p className="note bad">
          Couldn&apos;t load the packing list, and this phone has no copy of this week yet. Find signal and open Packing
          once. ({error})
        </p>
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
  // Everything is saved on the phone first and uploads when there's signal.
  const save = (p: Promise<void>) => p.catch(() => toast("Couldn't save on this phone. Try again."));

  const withLines = data.orders.map((o) => ({ o, lines: packLines(o, data.products) }));
  const stats = packStats(withLines.map((x) => ({ lines: x.lines.map(([, l]) => l) })));
  const shown = withLines.filter(({ o, lines }) => showOrder(lines.map(([, l]) => l), filter) || !!keepIds?.has(o.id));
  // Boxes for a whole pallet group, from every order in it.
  const groupBoxes = (g: string) => {
    const all = data.orders.filter((x) => x.group === g).map((x) => orderBoxes(x.lines, x.units, data.products, boxSetup));
    const t = orderBoxesText({ boxes: all.reduce((s, b) => s + b.boxes, 0), problems: all.flatMap((b) => b.problems) });
    return t ? `${t} for this shipment` : "";
  };
  const wOrder = weighing && data.orders.find((o) => o.id === weighing.orderId);
  // The product's boxes as on the paper copy: each weight goes in the next empty one.
  const wRow = wOrder ? orderSheet(wOrder, data, sheetLabels(data, boxSetup)).find((r) => r.productId === sheetRowId(weighing!.productId, data)) : undefined;

  return (
    <>
      <div className="screen-only">
        <WeekBar inv={data.invNumber} />
        <OfflineStatus savedAt={bundle.savedAt} fromPhone={bundle.fromPhone} />

        {/* Packing is only for packing (change request 10/21/26): scan, progress, filter, then the customers. */}
        <h2 className="sr-only">Packing</h2>
        {canPack && data.orders.length > 0 && (
          <Link href="/packing/scan" className="btn big scanbtn">
            Scan boxes
          </Link>
        )}
        {data.orders.length > 0 && (
          <Link href="/packing/pallets" className="btn ghost mb-2.5 w-full min-h-[48px] text-[1.05rem]">
            Pallets
          </Link>
        )}
        <div className="packhead">
          <span className="muted">
            {stats.done} of {stats.total} lines packed
          </span>
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
              {o.group && o.group !== shown[i - 1]?.o.group && (
                <h3 className="mt-5 mb-1">
                  {o.group}{" "}
                  <span className="small muted font-normal">{groupBoxes(o.group)}</span>
                </h3>
              )}
              <CustomerCard
                order={o}
                lines={lines}
                data={data}
                boxSetup={boxSetup}
                onOpen={(pid) => setWeighing({ orderId: o.id, productId: pid })}
                pallets={bundle.data?.pallets ?? []}
                canPack={canPack}
                onExtraOk={(w, ok) =>
                  void save(
                    enqueue({
                      type: "weight-extra-ok",
                      order_id: o.id,
                      ...(isLocal(w) ? { client_id: w.client_id ?? "" } : { weight_id: w.id }),
                      ok,
                      by: me.id,
                      by_name: me.displayName,
                      at: new Date().toISOString(),
                    }),
                  )
                }
              />
            </div>
          ))
        )}
      </div>

      {data.orders.length > 0 && (
        <div className="screen-only mt-5 flex flex-wrap gap-2">
          <Link href="/packing/print" className="btn ghost">
            Paper copy (no internet)
          </Link>
          <Link href="/packing/paper" className="btn ghost">
            Type in from paper
          </Link>
        </div>
      )}
      <PaperSheet data={data} boxes={boxSetup} />

      {weighing && wOrder && wRow && (
        <WeighSheet
          order={wOrder}
          row={wRow}
          productId={weighing.productId}
          data={data}
          canPack={canPack}
          onClose={closeWeigh}
          onAdd={async (weight) => {
            keep(wOrder.id);
            const clientId = crypto.randomUUID();
            const orderId = wOrder.id;
            const at = nextBlank(wRow);
            await save(
              enqueue({
                type: "weight-add",
                client_id: clientId,
                order_id: orderId,
                product_id: weighing.productId,
                weight,
                box_no: null,
                at: new Date().toISOString(),
                ...at,
              }),
            );
            // No Undo: a weight can be removed right here in the list (Lucas, 10/22/26).
            toast(`${fmt(weight)} lb saved`);
          }}
          onRemove={(id) => {
            const w = wOrder.weights.find((x) => x.id === id);
            void save(
              enqueue(
                w && isLocal(w)
                  ? { type: "weight-remove", order_id: wOrder.id, client_id: w.client_id ?? "" }
                  : { type: "weight-remove", order_id: wOrder.id, weight_id: id },
              ),
            );
          }}
          onMark={(m) => {
            keep(wOrder.id);
            void save(enqueue({ type: "mark", order_id: wOrder.id, product_id: weighing.productId, mark: m }));
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
  boxSetup,
  onOpen,
  pallets,
  canPack,
  onExtraOk,
}: {
  order: PackOrder;
  lines: [string, PackLine][];
  data: PackingData;
  boxSetup: BoxSetup;
  onOpen: (productId: string) => void;
  /** The week's pallets, for the tags this customer's boxes are on. */
  pallets: { id: string; tag: string }[];
  canPack: boolean;
  /** Check a box not on the order as correct for the shipment, or undo that. */
  onExtraOk: (w: PackWeight, ok: boolean) => void;
}) {
  const done = lines.filter(([, l]) => lineLook(l) !== "todo").length;
  const weighed = o.weights.reduce((sum, w) => sum + w.weight, 0);
  const name = (pid: string) => data.products.get(pid)?.name ?? pid;
  // The pallets this customer's boxes are on (each box records its own pallet since 10/26/26).
  const tags = [...new Set(o.weights.map((w) => w.pallet_id).filter((x): x is string => !!x))]
    .map((id) => pallets.find((p) => p.id === id)?.tag)
    .filter(Boolean);
  // Boxes for a product the customer didn't order: shown here to check, never on the manifest (Lucas, 10/26/26).
  const extras = o.weights.filter((w) => !(w.product_id in o.lines));
  const toCheck = extras.filter((w) => !w.extra_ok_at).length;
  // Boxes this order should fill, from each product's box size.
  const expect = orderBoxesText(orderBoxes(o.lines, o.units, data.products, boxSetup));

  return (
    <section className="pcust" aria-label={o.customerName}>
      <div className="pcust-head">
        <b>{o.customerName}</b>
        {o.spot && <span className="tag even">{o.spot}</span>}
        <span className="flex-1" />
        {expect && <span className="small muted">{expect}</span>}
        {toCheck > 0 && (
          <span className="tag short">
            {toCheck} extra{toCheck === 1 ? "" : "s"} to check
          </span>
        )}
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

      {extras.length > 0 && (
        <div className="pextra">
          <b>Not on the order</b>
          <span className="small"> · check each box is right for this shipment</span>
          <ul className="m-0 mt-1 grid list-none gap-1 p-0">
            {extras.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-2">
                <span className="flex-1">
                  {name(w.product_id)} · {fmt(w.weight)} lb
                  {w.serial ? <span className="small muted"> · {w.serial}</span> : null}
                </span>
                {w.extra_ok_at ? (
                  <>
                    <span className="small">
                      ✓ OK to ship · {w.extra_ok_by_name ?? "Someone"}, {formatWhen(w.extra_ok_at)}
                    </span>
                    {canPack && (
                      <button type="button" className="copy min-h-[44px]" onClick={() => onExtraOk(w, false)}>
                        Undo
                      </button>
                    )}
                  </>
                ) : (
                  <button type="button" className="btn" disabled={!canPack} onClick={() => onExtraOk(w, true)}>
                    Correct, ship it
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {orderPacked(lines.map(([, l]) => l)) && <div className="alldone">All packed.</div>}

      <div className="pfoot">
        <span className="small">
          {o.weights.length === 0
            ? "No boxes yet."
            : `${o.weights.length} box${o.weights.length === 1 ? "" : "es"} weighed, ${fmt(Math.round(weighed * 100) / 100)} lb`}
        </span>
        {tags.length > 0 && <span className="small">On {tags.join(", ")}</span>}
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

/** Weigh one line: add weights (one box each, in the next empty box), a piece count, Not filled, or a flag. */
function WeighSheet({
  order: o,
  row,
  productId,
  data,
  canPack,
  onClose,
  onAdd,
  onRemove,
  onMark,
}: {
  order: PackOrder;
  row: SheetRow;
  productId: string;
  data: PackingData;
  canPack: boolean;
  onClose: () => void;
  onAdd: (weight: number) => Promise<void>;
  onRemove: (id: string) => void;
  onMark: (m: LineMark) => void;
}) {
  const line = packLines(o, data.products).find(([pid]) => pid === productId)?.[1];
  const mark: LineMark = o.marks[productId] ?? { count: null, shorted: false, flagged: false, flagNote: "" };
  const mine = o.weights.filter((w) => w.product_id === productId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(mark.flagNote);
  const [count, setCount] = useState(mark.count == null ? "" : fmt(mark.count));
  if (!line) return null;
  const slotOf = (id: string) => row.blanks.find((b) => b.weight?.id === id)?.slot;
  const next = nextBlank(row);
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
    await onAdd(value);
    setBusy(false);
    setText("");
  }

  return (
    <Sheet title={data.products.get(productId)?.name ?? productId} onClose={finish}>
      <p className="mt-0 text-[1.05rem]">
        Ordered <b>{qtyText(line.ordered, line.unit)}</b>. {lineWords(line)}.
      </p>

      <fieldset disabled={!canPack || busy} className="m-0 min-w-0 border-0 p-0">
        {mine.length > 0 && (
          <ul className="m-0 mb-3 grid list-none gap-1 p-0">
            {mine.map((w) => (
              <li key={w.id} className="flex items-center gap-3 border-b border-line py-1 text-[1.05rem]">
                <span className="num">{fmt(w.weight)} lb</span>
                <span className="small muted">{slotOf(w.id) ? blankWords(row, slotOf(w.id)!) : "No box"}</span>
                <span className="flex-1" />
                <button type="button" className="copy min-h-[44px]" onClick={() => onRemove(w.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <label className="lbl big mt-0!" htmlFor="weigh-lb">
          {mine.length ? "Add another box (lb)" : "Weight (lb)"} <span className="small muted font-normal">· {blankWords(row, next.slot)}</span>
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
