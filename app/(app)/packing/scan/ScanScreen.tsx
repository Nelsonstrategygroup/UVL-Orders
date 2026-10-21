"use client";

// Scanning boxes (SPEC 11.5), with or without signal (11.7). Chris picks the customer and pallet,
// then scans box after box. Each good scan is saved as a box on that
// customer's order with its weight, label details, and lot.
//
// Questions come up only when needed: a product the app doesn't know (rescan
// first; then an admin says which product), a product not on this order, and
// a lot not seen before (typed from the label). The weigh panel on Packing
// still works alongside this.

import Link from "next/link";
import { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCan, useMe } from "@/components/CurrentUser";
import { getDb } from "@/components/data/db";
import OfflineStatus from "@/components/offline/OfflineStatus";
import { useOutbox } from "@/components/offline/OutboxProvider";
import { usePackingBundle } from "@/components/offline/usePackingBundle";
import CameraScanner from "@/components/scan/CameraScanner";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { fmt, num } from "@/lib/calc/num";
import { unitWord } from "@/lib/calc/units";
import { todayISO } from "@/lib/dates";
import { type PackOrder, type PackProduct } from "@/lib/db/packing";
import { isLocal } from "@/lib/offline/outbox";
import { planBoxes, type BoxSetup } from "@/lib/calc/boxes";
import { setBoxLot, type BoxUpload } from "@/lib/db/scanning";
import { badScan, goodScan, unlockSound } from "@/lib/scan/feedback";
import { decideScan, LOT_PATTERN, lotKey, type ScanContext, type ScanStep } from "@/lib/scan/flow";
import type { Gs1Box } from "@/lib/scan/gs1";
import { qtyText } from "@/lib/orders";


type Shown = { ok: boolean; title: string; detail?: string; warnings?: string[] };
type Answers = { addOffOrder?: boolean; productId?: string; lot?: string };
type Question = { step: Exclude<ScanStep, { kind: "misread" } | { kind: "duplicate" } | { kind: "ready" }>; raw: string; answers: Answers };

export default function ScanScreen() {
  const { week } = useWeek();
  const me = useMe();
  const isAdmin = me.role === "admin";
  const canPack = useCan("packing").change;
  const toast = useToast();
  const db = getDb();
  const shipDate = todayISO();
  const { enqueue, online } = useOutbox();
  // The same copy Packing keeps on the phone (SPEC 11.7).
  const bundle = usePackingBundle(week, shipDate);
  const { data, error, refresh } = bundle;

  const [orderId, setOrderId] = useState("");
  const [palletId, setPalletId] = useState("");
  const [scanning, setScanning] = useState(false);
  const [question, setQuestion] = useState<Question | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [lastProduct, setLastProduct] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [typed, setTyped] = useState("");
  const [keyboard, setKeyboard] = useState(false);
  const busy = useRef(false);
  // Boxes saved this session, before the list reloads: no double scans in between.
  const savedHere = useRef(new Map<string, string>());

  const order = data?.packing.orders.find((o) => o.id === orderId);
  const products = data?.packing.products;

  // Built when a label is read (not during render): it includes boxes saved
  // moments ago that the list hasn't reloaded yet.
  const makeCtx = (): ScanContext | null => {
    if (!data || !order) return null;
    const known = new Map<string, string>(savedHere.current);
    for (const o of data.packing.orders)
      for (const w of o.weights) if (w.gtin && w.serial) known.set(`${w.gtin}:${w.serial}`, o.customerName);
    return {
      gtinMap: new Map(data.gtins.map((g) => [g.gtin, g.product_id])),
      lots: new Map(data.lots.map((l) => [lotKey(l.gtin, l.pack_date), l.lot])),
      known,
      onOrder: new Set(Object.keys(order.lines)),
      products: data.packing.products,
    };
  };

  const show = (s: Shown) => {
    setShown(s);
    if (s.ok) goodScan();
    else badScan();
  };

  async function save(step: Extract<ScanStep, { kind: "ready" }>, raw: string, answers: Answers) {
    if (!order) return;
    const b = step.box;
    const p = products?.get(step.productId);
    const upload: BoxUpload = {
      client_id: crypto.randomUUID(),
      order_id: order.id,
      product_id: step.productId,
      source: "scan",
      weight: b.weightLb ?? 0,
      lot: step.lot,
      gtin: b.gtin,
      serial: b.serial,
      serial_date: b.serialDate,
      case_no: b.caseNo,
      pack_date: b.packDate,
      pallet_id: palletId || null,
      raw_scan: raw,
      scanned_at: new Date().toISOString(),
      off_order: !!answers.addOffOrder,
    };
    if (!(upload.weight > 0)) {
      show({ ok: false, title: "This label has no weight.", detail: "Use \"Label won't scan\" and type the weight." });
      return;
    }
    // Saved on the phone first; it uploads when there's signal. The server
    // checks for duplicates again and flags anything odd for Kathy.
    const boxNo = Math.max(0, ...order.weights.map((w) => w.box_no ?? 0)) + 1;
    try {
      await enqueue({ type: "box", box: upload });
    } catch {
      show({ ok: false, title: "Couldn't save on this phone", detail: "Scan the box again." });
      return;
    }
    if (b.serial) savedHere.current.set(`${b.gtin}:${b.serial}`, order.customerName);
    setLastProduct(step.productId);
    show({
      ok: true,
      title: `${p?.name ?? "Box"} · ${fmt(upload.weight)} lb`,
      detail: `Lot ${step.lot}${b.caseNo ? ` · Case ${b.caseNo}` : ""} · Box ${boxNo}${online ? "" : " · on this phone"}`,
      warnings: step.warnings,
    });
  }

  async function handle(raw: string, answers: Answers = {}) {
    const ctx = makeCtx();
    if (!ctx || !order) {
      show({ ok: false, title: "Pick a customer first." });
      return;
    }
    const step = decideScan(raw, ctx, answers);
    if (step.kind === "misread") return show({ ok: false, title: "Scan again", detail: step.message });
    if (step.kind === "duplicate") return show({ ok: false, title: "Already scanned", detail: step.message });
    if (step.kind === "ready") {
      setQuestion(null);
      return save(step, raw, answers);
    }
    if (step.kind !== "need-lot") badScan();
    setQuestion({ step, raw, answers });
  }

  const onRead = (text: string) => {
    if (busy.current || question || manual) return;
    busy.current = true;
    void handle(text).finally(() => {
      busy.current = false;
    });
  };

  if (error)
    return (
      <p className="note bad">
        Couldn&apos;t load, and this phone has no copy of this week yet. Find signal and open Packing once. ({error})
      </p>
    );
  if (!data || !products)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const pallets = data.pallets;
  const pallet = pallets.find((x) => x.id === palletId);
  const totalPallets = pallets.length;

  return (
    <>
      <WeekBar inv={data.packing.invNumber} />
      <OfflineStatus savedAt={bundle.savedAt} fromPhone={bundle.fromPhone} />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto">Scan boxes</h2>
        {/* A plain link, so it opens from the phone's copy with no signal. */}
        <a href="/packing" className="btn ghost">
          Back to Packing
        </a>
      </div>
      {!canPack && <p className="note">You can look, but not pack.</p>}

      <div className="panel mt-3 grid gap-3">
        <label className="grid gap-1">
          <span className="lbl m-0">Customer</span>
          <select
            className="field big"
            value={orderId}
            onChange={(e) => {
              setOrderId(e.target.value);
              setShown(null);
              setLastProduct(null);
            }}
          >
            <option value="">Choose who you&apos;re packing...</option>
            {data.packing.orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.group ? `${o.group}: ` : ""}
                {o.customerName}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid flex-1 gap-1">
            <span className="lbl m-0">Pallet (shipping {shipDate})</span>
            <select className="field big" value={palletId} onChange={(e) => setPalletId(e.target.value)}>
              <option value="">No pallet yet</option>
              {pallets.map((x) => (
                <option key={x.id} value={x.id}>
                  Pallet {x.number} of {totalPallets}
                  {x.label ? ` · ${x.label}` : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn ghost"
            disabled={!canPack}
            onClick={() => {
              const next = Math.max(0, ...pallets.map((x) => x.number)) + 1;
              const id = crypto.randomUUID();
              void enqueue({ type: "pallet-add", id, week_id: week, ship_date: shipDate, number: next, label: order?.group ?? "" })
                .then(() => setPalletId(id))
                .catch(() => toast("Couldn't add a pallet on this phone. Try again."));
            }}
          >
            New pallet
          </button>
        </div>
      </div>

      {order && (
        <>
          <LineTotals order={order} products={products} boxes={data.boxes} current={lastProduct} />

          <div className="mt-3 grid gap-2">
            <button
              type="button"
              className={`scanbtn ${scanning ? "on" : ""}`}
              disabled={!canPack}
              onClick={() => {
                unlockSound();
                setScanning((v) => !v);
              }}
            >
              {scanning ? "Stop scanning" : "Start scanning"}
            </button>
            <CameraScanner active={scanning} onRead={onRead} />
          </div>

          {shown && (
            <div className={`scanresult ${shown.ok ? "ok" : "bad"}`} role="status" aria-live="assertive">
              <b>{shown.ok ? "✓ " : "✕ "}{shown.title}</b>
              {shown.detail && <div>{shown.detail}</div>}
              {shown.warnings?.map((w) => (
                <div key={w} className="scanwarn">
                  ⚠ {w}
                </div>
              ))}
            </div>
          )}

          {question && (
            <QuestionCard
              key={question.step.kind}
              q={question}
              products={products}
              isAdmin={isAdmin}
              onCancel={() => {
                setQuestion(null);
                show({ ok: false, title: "Not saved", detail: "Scan the box again when ready." });
              }}
              onAnswer={(a) => {
                const next = { ...question.answers, ...a };
                busy.current = true;
                void handle(question.raw, next).finally(() => {
                  busy.current = false;
                });
              }}
              onMap={async (gtin, productId) => {
                await enqueue({ type: "gtin-map", gtin, product_id: productId });
                const next = { ...question.answers, productId };
                void handle(question.raw, next);
              }}
            />
          )}

          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const t = typed;
              setTyped("");
              if (t.trim()) onRead(t);
            }}
          >
            <label className="grid flex-1 gap-1">
              <span className="lbl m-0">Bluetooth scanner, or type the label</span>
              <input
                className="field"
                value={typed}
                inputMode={keyboard ? "numeric" : "none"}
                autoComplete="off"
                placeholder="Tap here, then scan"
                onChange={(e) => setTyped(e.target.value)}
              />
            </label>
            <button type="button" className="btn ghost" onClick={() => setKeyboard((k) => !k)}>
              {keyboard ? "Hide keys" : "Type it"}
            </button>
            <button type="submit" className="btn ghost">
              Enter
            </button>
          </form>

          <button type="button" className="btn ghost mt-3" disabled={!canPack} onClick={() => setManual(true)}>
            Label won&apos;t scan
          </button>

          <RecentBoxes order={order} products={products} isAdmin={isAdmin} db={db} onChanged={refresh} />
        </>
      )}

      {manual && order && (
        <ManualBox
          order={order}
          products={products}
          palletId={palletId || null}
          week={week}
          onClose={() => setManual(false)}
          onSaved={(title, detail) => {
            setManual(false);
            show({ ok: true, title, detail });
            refresh();
          }}
        />
      )}
      {pallet && <p className="small muted mt-3">Packing onto Pallet {pallet.number} of {totalPallets}.</p>}
    </>
  );
}

/** For the customer: each product ordered, boxes and pounds scanned so far. */
function LineTotals({
  order,
  products,
  boxes,
  current,
}: {
  order: PackOrder;
  products: Map<string, PackProduct>;
  boxes: BoxSetup;
  current: string | null;
}) {
  const rows = Object.entries(order.lines).map(([pid, qty]) => {
    const p = products.get(pid);
    const ws = order.weights.filter((w) => w.product_id === pid);
    const lb = ws.reduce((s, w) => s + num(w.weight), 0);
    const unit = order.units[pid] ?? p?.unit ?? "each";
    // Mohawk leaves pieces at 0, so pieces come from the box plan: the boxes
    // scanned so far, filled as planned (full boxes first).
    const plan = p && unit !== "lb" ? planBoxes(num(qty), p, boxes.limits.get(pid) ?? [], boxes.types, boxes.capLb) : null;
    const pcs = plan && plan.boxes.length ? plan.boxes.slice(0, ws.length).reduce((n, b) => n + b.amount, 0) : null;
    return { pid, name: p?.name ?? pid, qty, unit, boxes: ws.length, lb, pcs };
  });
  return (
    <div className="panel mt-3">
      <table className="simple w-full">
        <thead>
          <tr>
            <th>Product</th>
            <th className="num">Ordered</th>
            <th className="num">Boxes</th>
            <th className="num">lb</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.pid} className={r.pid === current ? "scancur" : undefined}>
              <td>{r.name}</td>
              <td className="num">{qtyText(r.qty, r.unit)}</td>
              <td className="num">
                {r.boxes}
                {r.pcs != null && <span className="small muted"> (≈{fmt(r.pcs)} {unitWord(r.unit, r.pcs)})</span>}
              </td>
              <td className="num">{r.lb ? fmt(Math.round(r.lb * 100) / 100) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One question about the box just scanned. */
function QuestionCard({
  q,
  products,
  isAdmin,
  onCancel,
  onAnswer,
  onMap,
}: {
  q: Question;
  products: Map<string, PackProduct>;
  isAdmin: boolean;
  onCancel: () => void;
  onAnswer: (a: Answers) => void;
  onMap: (gtin: string, productId: string) => Promise<void>;
}) {
  const [lot, setLot] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [pick, setPick] = useState("");
  const s = q.step;
  const box: Gs1Box = s.box;

  return (
    <div className="scanq" role="dialog" aria-label="Question about this box">
      <p className="m-0 font-semibold">{s.message}</p>
      <p className="small muted mt-1 mb-2">
        GTIN {box.gtin}
        {box.weightLb != null && ` · ${fmt(box.weightLb)} lb`}
        {box.packDate && ` · packed ${box.packDate}`}
        {box.caseNo && ` · case ${box.caseNo}`}
      </p>

      {s.kind === "unknown-gtin" &&
        (!choosing ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={onCancel}>
              Scan again
            </button>
            {isAdmin ? (
              <button type="button" className="btn ghost" onClick={() => setChoosing(true)}>
                The label is right: choose the product
              </button>
            ) : (
              <span className="small">If the label is right, ask an admin to add this product.</span>
            )}
          </div>
        ) : (
          <div className="grid gap-2">
            <select className="field big" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Which product is this?</option>
              {[...products.values()]
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" disabled={!pick} onClick={() => void onMap(box.gtin, pick)}>
                Save and use
              </button>
              <Link href="/setup" className="btn ghost" target="_blank">
                Add a new product in Setup
              </Link>
              <button type="button" className="btn ghost" onClick={onCancel}>
                Cancel
              </button>
            </div>
            <p className="small muted m-0">Every box with this GTIN will be this product from now on.</p>
          </div>
        ))}

      {s.kind === "off-order" && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel, wrong box
          </button>
          <button type="button" className="btn ghost" onClick={() => onAnswer({ addOffOrder: true, productId: s.productId })}>
            Add it to this order anyway
          </button>
        </div>
      )}

      {s.kind === "need-lot" && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (LOT_PATTERN.test(lot)) onAnswer({ lot, productId: s.productId });
          }}
        >
          <input
            className="field big num w-[10ch]"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoFocus
            aria-label="Lot from the label"
            placeholder="000000"
            value={lot}
            onChange={(e) => setLot(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <button type="submit" className="btn" disabled={!LOT_PATTERN.test(lot)}>
            Save box
          </button>
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <p className="small muted m-0 w-full">Later boxes of this product packed the same day fill this in by themselves.</p>
        </form>
      )}
    </div>
  );
}

/** Boxes scanned or typed for this customer, newest first. Admins can fix a lot. */
function RecentBoxes({
  order,
  products,
  isAdmin,
  db,
  onChanged,
}: {
  order: PackOrder;
  products: Map<string, PackProduct>;
  isAdmin: boolean;
  db: SupabaseClient;
  onChanged: () => void;
}) {
  const toast = useToast();
  const boxes = order.weights.filter((w) => w.source !== "weigh").slice().reverse();
  if (!boxes.length) return null;
  return (
    <div className="panel mt-3">
      <h3>Boxes for {order.customerName}</h3>
      <ul className="m-0 mt-2 list-none p-0">
        {boxes.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center gap-2 border-b border-line py-2">
            <span className="flex-1">
              {w.box_no != null && <>Box {w.box_no} · </>}
              {products.get(w.product_id)?.name ?? w.product_id} · {fmt(w.weight)} lb · Lot {w.lot}
              {w.case_no && <span className="small muted"> · case {w.case_no}</span>}
              {w.source === "manual" && <span className="small muted"> · typed</span>}
            </span>
            {!isLocal(w) && <span className="sr-only">uploaded</span>}
            {isLocal(w) && <span className="small muted">on this phone</span>}
            {isAdmin && !isLocal(w) && (
              <button
                type="button"
                className="copy text-[.9rem]"
                onClick={() => {
                  const v = window.prompt(`New lot for box ${w.box_no ?? ""} (now ${w.lot}):`, w.lot ?? "");
                  if (v == null || v.trim() === (w.lot ?? "")) return;
                  if (!LOT_PATTERN.test(v.trim())) return toast("A lot is 6 digits.");
                  void setBoxLot(db, w.id, v.trim()).then((e) => {
                    if (e) toast(`Couldn't change it: ${e}`);
                    else toast("Lot changed");
                    onChanged();
                  });
                }}
              >
                Change lot
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A label that won't scan: product, weight, and lot by hand, with an optional photo. */
function ManualBox({
  order,
  products,
  palletId,
  week,
  onClose,
  onSaved,
}: {
  order: PackOrder;
  products: Map<string, PackProduct>;
  palletId: string | null;
  week: string;
  onClose: () => void;
  onSaved: (title: string, detail: string) => void;
}) {
  const { enqueue } = useOutbox();
  const [productId, setProductId] = useState(Object.keys(order.lines)[0] ?? "");
  const [weight, setWeight] = useState("");
  const [lot, setLot] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const onOrder = Object.keys(order.lines);
  const others = [...products.values()].filter((p) => p.active && !onOrder.includes(p.id));
  const ok = !!productId && num(weight) > 0 && LOT_PATTERN.test(lot);

  async function save() {
    setBusy(true);
    setProblem(null);
    const clientId = crypto.randomUUID();
    // The photo is kept on the phone with the box and uploads first.
    const photoPath = photo ? `${week}/${clientId}.jpg` : null;
    const blob = photo ? await shrink(photo) : null;
    const box: BoxUpload = {
      client_id: clientId,
      order_id: order.id,
      product_id: productId,
      source: "manual",
      weight: num(weight),
      lot,
      pallet_id: palletId,
      photo_path: photoPath,
      scanned_at: new Date().toISOString(),
      off_order: !onOrder.includes(productId),
    };
    try {
      await enqueue({ type: "box", box, photo: blob && photoPath ? { path: photoPath, blob } : undefined });
    } catch {
      setBusy(false);
      return setProblem("Couldn't save on this phone. Try again.");
    }
    setBusy(false);
    onSaved(`${products.get(productId)?.name ?? "Box"} · ${fmt(num(weight))} lb`, `Lot ${lot} · typed in`);
  }

  return (
    <Sheet title="Label won't scan" onClose={onClose}>
      <p className="small muted -mt-2">Type what&apos;s printed on the label.</p>
      <label className="lbl" htmlFor="mb-product">
        Product
      </label>
      <select id="mb-product" className="field big" value={productId} onChange={(e) => setProductId(e.target.value)}>
        {onOrder.map((id) => (
          <option key={id} value={id}>
            {products.get(id)?.name ?? id}
          </option>
        ))}
        {others.length > 0 && (
          <optgroup label="Not on this order">
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <label className="lbl" htmlFor="mb-weight">
        Net weight (lb)
      </label>
      <input
        id="mb-weight"
        className="field big num"
        inputMode="decimal"
        value={weight}
        onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ""))}
      />
      <label className="lbl" htmlFor="mb-lot">
        Lot (6 digits)
      </label>
      <input
        id="mb-lot"
        className="field big num"
        inputMode="numeric"
        maxLength={6}
        value={lot}
        onChange={(e) => setLot(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
      <label className="lbl" htmlFor="mb-photo">
        Photo of the label (optional)
      </label>
      <input id="mb-photo" type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
      {problem && <p className="note bad mt-2">{problem}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn" disabled={!ok || busy} onClick={() => void save()}>
          {busy ? "Saving..." : "Save box"}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/** Shrink a phone photo to about 1280 px JPEG before upload. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? file), "image/jpeg", 0.7));
  } catch {
    return file;
  }
}
