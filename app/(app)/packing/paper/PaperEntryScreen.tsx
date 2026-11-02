"use client";

// Type in from paper: after weighing on the Weigh Sheet (Lucas, 11/1/26),
// the weights are typed in here, laid out like the sheet: the same products
// A to Z, the same stores in the same order, the same boxes, and the blank
// rows at the end for boxes that weren't on the sheet. Totals add up per row,
// per product and per store. "+ Add a box" gives a row another box. Each
// box's weight is saved on its own under its store and product (no label
// number: the Weigh Sheet doesn't print them); like the rest of Packing it's
// saved on the phone first.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCan } from "@/components/CurrentUser";
import OfflineStatus from "@/components/offline/OfflineStatus";
import { useOutbox } from "@/components/offline/OutboxProvider";
import { usePackingBundle } from "@/components/offline/usePackingBundle";
import { useToast } from "@/components/Toast";
import ViewOnly from "@/components/ViewOnly";
import { useWeek, WeekBar } from "@/components/Week";
import { fmt, num } from "@/lib/calc/num";
import { groupLead } from "@/lib/calc/packTogether";
import { nextBlank, type SheetBlank } from "@/lib/calc/packSheet";
import { packLines, sheetLabels, type LineMark, type PackOrder } from "@/lib/db/packing";
import { isLocal, type Action } from "@/lib/offline/outbox";
import { WEIGH, weighSections, type WeighRow } from "@/lib/packSheets";

const NO_MARK: LineMark = { count: null, shorted: false, flagged: false, flagNote: "" };
const NOT_ORDERING = "__none";

const r2 = (v: number) => Math.round(v * 100) / 100;

export default function PaperEntryScreen() {
  const { week } = useWeek();
  const toast = useToast();
  const { enqueue } = useOutbox();
  const bundle = usePackingBundle(week);
  const canPack = useCan("packing").change;
  // "+ Add a box": extra boxes, by order|product.
  const [extra, setExtra] = useState<Record<string, number>>({});
  const sections = useMemo(
    () => (bundle.data ? weighSections(bundle.data.packing, sheetLabels(bundle.data.packing, bundle.data.boxes), extra) : []),
    [bundle.data, extra],
  );
  const data = bundle.data?.packing ?? null;

  if (bundle.error) return <p className="note bad">Couldn&apos;t load: {bundle.error}</p>;
  if (!data)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const save = (a: Action) => void enqueue(a).catch(() => toast("Couldn't save on this phone. Try again."));
  const storeTotals = data.orders
    .map((o) => ({ o, lb: r2(o.weights.reduce((s, w) => s + num(w.weight), 0)) }))
    .filter((x) => x.lb > 0);

  return (
    <>
      <WeekBar inv={data.invNumber} />
      <OfflineStatus savedAt={bundle.savedAt} fromPhone={bundle.fromPhone} />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto">Type in from paper</h2>
        <Link href="/packing/weigh" className="btn ghost">
          Weigh Sheet
        </Link>
        <Link href="/packing" className="btn ghost">
          &larr; Packing
        </Link>
      </div>
      <p className="small muted">
        The same order as the Weigh Sheet: products A to Z, then each store. Type each box&apos;s weight in a box on its row. Tab
        moves to the next box. Totals add up as you go.
      </p>
      {!canPack && <ViewOnly what="packing" />}
      {!data.orders.length && <div className="empty">No orders for this week yet.</div>}

      <fieldset disabled={!canPack} className="m-0 min-w-0 border-0 p-0">
        {sections.map((s) => {
          const total = r2(s.rows.reduce((n, r) => n + r.row.total, 0));
          return (
            <section key={s.productId} className="pe-sec panel mt-4" aria-label={s.name}>
              <h3 className="m-0 text-[1.35rem]!">{s.name}</h3>
              {s.rows.map((r) => (
                <Row
                  key={r.order.id}
                  r={r}
                  save={save}
                  productName={s.name}
                  marks={r.order.marks}
                  onOrder={packLines(r.order, data.products).map(([id]) => id).filter((id) => groupLead(id, data.products) === s.productId)}
                  addBox={() => setExtra((x) => ({ ...x, [`${r.order.id}|${s.productId}`]: (x[`${r.order.id}|${s.productId}`] ?? 0) + 1 }))}
                />
              ))}
              <p className="pe-sectotal m-0">
                {s.name} total: <b className="num">{fmt(total)} lb</b>
              </p>
            </section>
          );
        })}

        {data.orders.length > 0 && (
          <SpareRows
            week={week}
            orders={data.orders}
            products={[...data.products.values()].filter((p) => p.active && groupLead(p.id, data.products) === p.id).sort((a, b) => sectionName(a).localeCompare(sectionName(b)))}
            sections={sections}
            save={save}
            toast={toast}
          />
        )}

        {storeTotals.length > 0 && (
          <section className="panel mt-4">
            <h3 className="m-0">Total by store</h3>
            <table className="simple mt-2">
              <tbody>
                {storeTotals.map(({ o, lb }) => (
                  <tr key={o.id}>
                    <td>{o.labelCustomer}</td>
                    <td className="num">{fmt(lb)} lb</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </fieldset>
    </>
  );
}

const sectionName = (p: { name: string; label_name: string }) => (p.label_name ?? "").trim() || p.name;

/** One store's row in a product: what was ordered, a box per box, the total, Add a box, Not filled. */
function Row({
  r,
  save,
  productName,
  marks,
  onOrder,
  addBox,
}: {
  r: WeighRow;
  save: (a: Action) => void;
  productName: string;
  marks: PackOrder["marks"];
  /** The products of this row on the order (one, or the organs ordered). */
  onOrder: string[];
  addBox: () => void;
}) {
  const shorted = onOrder.length > 0 && onOrder.every((id) => (marks[id] ?? NO_MARK).shorted);
  return (
    <div className="pe-row">
      <div className="pe-prod">
        <b>{r.customer}</b>
        <div className="small">
          {r.ordered}
          {r.row.known ? ` · ${r.row.boxCount} box${r.row.boxCount === 1 ? "" : "es"}` : ""}
        </div>
        {!r.row.known && <div className="small muted italic">box count unknown</div>}
        {onOrder.length > 0 && (
          <label className="mt-1 flex items-center gap-2 small">
            <input
              type="checkbox"
              className="h-5 w-5 accent-forest"
              checked={shorted}
              onChange={(e) => {
                for (const id of onOrder) save({ type: "mark", order_id: r.order.id, product_id: id, mark: { ...(marks[id] ?? NO_MARK), shorted: e.target.checked } });
              }}
            />
            Not filled
          </label>
        )}
      </div>
      <div className="pe-blanks">
        {r.row.blanks.map((b) => (
          <Blank key={b.slot} o={r.order} productId={r.row.productId} b={b} save={save} label={`${productName}, ${r.customer}, box ${b.slot}`} />
        ))}
        <div className="pe-cell pe-total">
          <span className="pe-lab">Total lbs</span>
          <output className="pe-sum num" aria-label={`${productName}, ${r.customer}: total`}>
            {r.row.total > 0 ? fmt(r.row.total) : "0"}
          </output>
        </div>
        <button type="button" className="btn ghost pe-add" onClick={addBox}>
          + Add a box
        </button>
      </div>
    </div>
  );
}

/** One box's weight: saved on blur, changed or taken off the same way. */
function Blank({ o, productId, b, save, label }: { o: PackOrder; productId: string; b: SheetBlank; save: (a: Action) => void; label: string }) {
  const w = b.weight;
  const target = w ? (isLocal(w as { id: string }) ? { client_id: w.client_id ?? "" } : { weight_id: w.id }) : null;
  return (
    <div className="pe-cell">
      <span className="pe-lab">Box {b.slot}</span>
      <input
        key={`w:${w?.id ?? "new"}:${w?.weight ?? ""}`}
        className="pe-weight num"
        inputMode="decimal"
        aria-label={`${label}: weight in lb`}
        defaultValue={w ? fmt(w.weight) : ""}
        onBlur={(e) => {
          const v = e.target.value.trim();
          const lb = r2(num(v));
          if (w && target) {
            if (v === "" || !(lb > 0)) save({ type: "weight-remove", order_id: o.id, ...target });
            else if (lb !== w.weight) save({ type: "weight-edit", order_id: o.id, ...target, weight: lb, label_no: w.label_no });
          } else if (lb > 0) {
            save({
              type: "weight-add",
              client_id: crypto.randomUUID(),
              order_id: o.id,
              product_id: productId,
              weight: lb,
              box_no: null,
              at: new Date().toISOString(),
              slot: b.slot,
              // The Weigh Sheet has no label numbers (Lucas, 11/1/26).
              label_no: null,
            });
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </div>
  );
}

type SpareProduct = { id: string; name: string; label_name: string };

/**
 * The blank rows at the end of the Weigh Sheet: boxes that weren't on it.
 * Pick the product and the store, type the weight. A store not ordering this
 * week: the box is saved unassigned, for Kathy to put on a pallet (Pallets).
 */
function SpareRows({
  week,
  orders,
  products,
  sections,
  save,
  toast,
}: {
  week: string;
  orders: PackOrder[];
  products: SpareProduct[];
  sections: ReturnType<typeof weighSections>;
  save: (a: Action) => void;
  toast: (m: string) => void;
}) {
  const [rows, setRows] = useState(() => Array.from({ length: WEIGH.spareRows }, (_, i) => ({ key: i, product: "", customer: "", weight: "" })));
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const submit = (i: number) => {
    const r = rows[i];
    const lb = r2(num(r.weight));
    if (!r.product || !r.customer || !(lb > 0)) return;
    const at = new Date().toISOString();
    if (r.customer === NOT_ORDERING) {
      save({
        type: "box",
        box: { client_id: crypto.randomUUID(), order_id: null, week_id: week, product_id: r.product, source: "manual", weight: lb, lot: "", scanned_at: at, route: "unassigned" },
      });
      toast("Saved with no store. Put it on a pallet on the Pallets page.");
    } else {
      const sheetRow = sections.find((s) => s.productId === r.product)?.rows.find((x) => x.order.id === r.customer)?.row;
      const slot = sheetRow ? nextBlank(sheetRow).slot : 1;
      save({ type: "weight-add", client_id: crypto.randomUUID(), order_id: r.customer, product_id: r.product, weight: lb, box_no: null, at, slot, label_no: null });
      toast("Saved. It's on that store's row above.");
    }
    setRows((rs) => rs.map((x, k) => (k === i ? { key: Date.now() + k, product: "", customer: "", weight: "" } : x)));
  };

  return (
    <section className="pe-sec panel mt-4" aria-label="Boxes not on the sheet">
      <h3 className="m-0 text-[1.35rem]!">Boxes not on the sheet</h3>
      <p className="small muted mt-1">From the blank rows at the end of the Weigh Sheet. Pick the product and the store, then type the weight.</p>
      {rows.map((r, i) => (
        <div key={r.key} className="pe-spare">
          <select className="field" aria-label={`Blank row ${i + 1}: product`} value={r.product} onChange={(e) => set(i, { product: e.target.value })}>
            <option value="">Product...</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {sectionName(p)}
              </option>
            ))}
          </select>
          <select className="field" aria-label={`Blank row ${i + 1}: store`} value={r.customer} onChange={(e) => set(i, { customer: e.target.value })}>
            <option value="">Store...</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.labelCustomer}
              </option>
            ))}
            <option value={NOT_ORDERING}>Not ordering this week (no store yet)</option>
          </select>
          <input
            className="field num pe-weight"
            inputMode="decimal"
            placeholder="lb"
            aria-label={`Blank row ${i + 1}: weight in lb`}
            value={r.weight}
            onChange={(e) => set(i, { weight: e.target.value })}
            onBlur={() => submit(i)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        </div>
      ))}
    </section>
  );
}
