"use client";

// Scanning boxes (SPEC 11.5), with or without signal (11.7).
//
// Scan-to-pallet routing (change request 10/26/26): boxes come off Mohawk's
// roller grouped by size, not by customer. Chris scans a box; the app
// suggests who it's for (soonest ship date, then furthest behind) and which
// pallet it goes on, shown very large ("→ P3"). One tap confirms. Runner-ups,
// "Pick customer anyway" and "Unassigned" are below; anything but the
// suggestion is logged. Nothing is assigned without a tap. "Lock to this
// customer" is the old customer-first flow: scans go straight to that
// customer and its shipment's open pallet.
//
// Questions come up only when needed: a product the app doesn't know (rescan
// first; then an admin says which product), a product not on the locked
// customer's order, and a lot not seen before (typed from the label).

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCan, useMe } from "@/components/CurrentUser";
import { getDb } from "@/components/data/db";
import OfflineStatus from "@/components/offline/OfflineStatus";
import { useOutbox } from "@/components/offline/OutboxProvider";
import { usePackingBundle, type PackingBundle } from "@/components/offline/usePackingBundle";
import CameraScanner from "@/components/scan/CameraScanner";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { fmt, num } from "@/lib/calc/num";
import { unitWord } from "@/lib/calc/units";
import { orderSheet, packLines, sheetLabels, type PackingData, type PackOrder, type PackProduct, type PackWeight } from "@/lib/db/packing";
import { blankWords, type SheetLabel } from "@/lib/calc/packSheet";
import { candidates, needFor, needWords, nextTag, palletFor, type RouteOrder, type RoutePallet } from "@/lib/calc/routing";
import { isLocal } from "@/lib/offline/outbox";
import { planBoxes, type BoxSetup } from "@/lib/calc/boxes";
import { setBoxLot, type BoxUpload } from "@/lib/db/scanning";
import { badScan, goodScan, unlockSound } from "@/lib/scan/feedback";
import { decideScan, LOT_PATTERN, lotKey, type ScanContext, type ScanStep } from "@/lib/scan/flow";
import type { Gs1Box } from "@/lib/scan/gs1";
import { qtyText } from "@/lib/orders";

type Shown = { ok: boolean; title: string; big?: string; detail?: string; warnings?: string[] };
type Answers = { addOffOrder?: boolean; productId?: string; lot?: string };
type Question = { step: Exclude<ScanStep, { kind: "misread" } | { kind: "duplicate" } | { kind: "ready" }>; raw: string; answers: Answers };
type Route = NonNullable<BoxUpload["route"]>;

/** A box read and ready to save, before the customer and pallet are chosen. */
type Base = {
  productId: string;
  upload: Omit<BoxUpload, "order_id" | "week_id" | "pallet_id" | "route" | "suggested_order_id" | "slot" | "label_no" | "box_type_id" | "planned_boxes" | "off_order">;
  photo?: { path: string; blob: Blob };
  warnings: string[];
  /** "GTIN:serial", to stop a second scan of the same box before it uploads. */
  serialKey: string | null;
};

/** The suggestion card: who it's for (null = Unassigned), how they were chosen, and a tag for a new pallet. */
type Pending = { base: Base; list: RouteOrder[]; pick: string | null; route: Route; tag: string };

export default function ScanScreen() {
  const { week } = useWeek();
  const me = useMe();
  const isAdmin = me.role === "admin";
  const canPack = useCan("packing").change;
  const toast = useToast();
  const db = getDb();
  const { enqueue, online } = useOutbox();
  // The same copy Packing keeps on the phone (SPEC 11.7).
  const bundle = usePackingBundle(week);
  const { data, error, refresh } = bundle;

  // Lock to this customer: the old customer-first flow.
  const [lockId, setLockId] = useState("");
  const [scanning, setScanning] = useState(false);
  const [question, setQuestion] = useState<Question | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [lastProduct, setLastProduct] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [typed, setTyped] = useState("");
  const [keyboard, setKeyboard] = useState(false);
  const busy = useRef(false);
  // Boxes saved this session, before the list reloads: no double scans in between.
  const savedHere = useRef(new Map<string, string>());
  // Boxes filled this session (order|product|slot), before the list reloads: the next scan takes the next box.
  const filledHere = useRef(new Set<string>());

  const labels = useMemo(() => (data ? sheetLabels(data.packing, data.boxes) : []), [data]);
  const locked = data?.packing.orders.find((o) => o.id === lockId);
  const products = data?.packing.products;

  // Built when a label is read (not during render): it includes boxes saved
  // moments ago that the list hasn't reloaded yet.
  const makeCtx = (): ScanContext | null => {
    if (!data) return null;
    const known = new Map<string, string>(savedHere.current);
    for (const o of data.packing.orders)
      for (const w of o.weights) if (w.gtin && w.serial) known.set(`${w.gtin}:${w.serial}`, o.customerName);
    for (const w of data.packing.unassigned) if (w.gtin && w.serial) known.set(`${w.gtin}:${w.serial}`, "unassigned boxes");
    return {
      gtinMap: new Map(data.gtins.map((g) => [g.gtin, g.product_id])),
      lots: new Map(data.lots.map((l) => [lotKey(l.gtin, l.pack_date), l.lot])),
      known,
      onOrder: locked ? new Set(Object.keys(locked.lines)) : null,
      products: data.packing.products,
    };
  };

  const show = (s: Shown) => {
    setShown(s);
    if (s.ok) goodScan();
    else badScan();
  };

  /** Save the box: for a customer on a pallet (starting one if needed), or unassigned. */
  async function confirm(p: Pending) {
    if (!data) return;
    const { base } = p;
    const name = products?.get(base.productId)?.name ?? "Box";
    if (p.pick == null) {
      try {
        if (base.photo) await enqueue({ type: "box", box: { ...base.upload, order_id: null, week_id: week, route: "unassigned" }, photo: base.photo });
        else await enqueue({ type: "box", box: { ...base.upload, order_id: null, week_id: week, route: "unassigned" } });
      } catch {
        return show({ ok: false, title: "Couldn't save on this phone", detail: "Scan the box again." });
      }
      if (base.serialKey) savedHere.current.set(base.serialKey, "unassigned boxes");
      setPending(null);
      return show({ ok: true, title: `${name} · ${fmt(base.upload.weight)} lb`, big: "Unassigned", detail: "Kathy will choose who it goes to." });
    }
    const order = data.packing.orders.find((o) => o.id === p.pick);
    if (!order) return;
    const ro = routeOrder(order, base.productId, data, labels);
    let pallet = palletFor(ro, base.productId, routePallets(data));
    let tag = pallet?.tag ?? p.tag.trim();
    if (!tag) return toast("Write a tag on the pallet, then type it here.");
    try {
      if (!pallet) {
        const id = crypto.randomUUID();
        await enqueue({
          type: "pallet-start",
          id,
          week_id: week,
          tag,
          ship_to_customer_id: order.shipsToPointId ? null : order.customerId,
          ship_to_point_id: order.shipsToPointId,
          at: new Date().toISOString(),
        });
        pallet = { id, tag, status: "open", shipKeys: [order.shipKey], createdAt: new Date().toISOString(), plan: [], boxes: [] };
        tag = pallet.tag;
      }
      const box = boxFor(order, base.productId, data.packing, labels, filledHere.current);
      const upload: BoxUpload = {
        ...base.upload,
        order_id: order.id,
        pallet_id: pallet.id,
        route: p.route,
        suggested_order_id: p.route === "other" || p.route === "picked" ? (p.list[0]?.orderId ?? null) : null,
        slot: box.slot,
        label_no: box.label_no,
        box_type_id: box.boxTypeId,
        planned_boxes: ro.need?.kind === "boxes" ? ro.need.total : null,
        off_order: !(base.productId in order.lines),
      };
      await enqueue(base.photo ? { type: "box", box: upload, photo: base.photo } : { type: "box", box: upload });
      if (base.serialKey) savedHere.current.set(base.serialKey, order.customerName);
      filledHere.current.add(`${order.id}|${base.productId}|${box.slot}`);
    } catch {
      return show({ ok: false, title: "Couldn't save on this phone", detail: "Scan the box again." });
    }
    setPending(null);
    setLastProduct(base.productId);
    show({
      ok: true,
      title: `${name} · ${fmt(base.upload.weight)} lb`,
      big: `→ ${tag}`,
      detail: `${order.labelCustomer}${order.group ? ` · via ${order.group}` : ""}${online ? "" : " · on this phone"}`,
      warnings: base.warnings,
    });
  }

  /** A box is read: lock mode saves it straight away; otherwise suggest. */
  function routeBox(base: Base) {
    if (!data) return;
    if (locked) {
      const p: Pending = { base, list: [], pick: locked.id, route: "locked", tag: nextTag(data.pallets) };
      // A pallet to start still needs a tag: ask with the card.
      if (!palletFor(routeOrder(locked, base.productId, data, labels), base.productId, routePallets(data))) return setPending(p);
      return void confirm(p);
    }
    const list = candidates(data.packing.orders.map((o) => routeOrder(o, base.productId, data, labels)));
    setPending({ base, list, pick: list[0]?.orderId ?? null, route: list.length ? "suggested" : "unassigned", tag: nextTag(data.pallets) });
    if (list.length) goodScan();
    else badScan();
  }

  async function handle(raw: string, answers: Answers = {}) {
    const ctx = makeCtx();
    if (!ctx) return;
    const step = decideScan(raw, ctx, answers);
    if (step.kind === "misread") return show({ ok: false, title: "Scan again", detail: step.message });
    if (step.kind === "duplicate") return show({ ok: false, title: "Already scanned", detail: step.message });
    if (step.kind === "ready") {
      setQuestion(null);
      const b = step.box;
      if (!(b.weightLb && b.weightLb > 0))
        return show({ ok: false, title: "This label has no weight.", detail: 'Use "Label won\'t scan" and type the weight.' });
      setShown(null);
      return routeBox({
        productId: step.productId,
        upload: {
          client_id: crypto.randomUUID(),
          product_id: step.productId,
          source: "scan",
          weight: b.weightLb,
          lot: step.lot,
          gtin: b.gtin,
          serial: b.serial,
          serial_date: b.serialDate,
          case_no: b.caseNo,
          pack_date: b.packDate,
          raw_scan: raw,
          scanned_at: new Date().toISOString(),
        },
        warnings: step.warnings,
        serialKey: b.serial ? `${b.gtin}:${b.serial}` : null,
      });
    }
    if (step.kind !== "need-lot") badScan();
    setQuestion({ step, raw, answers });
  }

  const onRead = (text: string) => {
    if (busy.current || question || manual || pending) return;
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

  const pallets = routePallets(data);
  const openPallets = data.pallets.filter((p) => p.status === "open");
  const recent = locked
    ? locked.weights
    : [...data.packing.orders.flatMap((o) => o.weights.map((w) => ({ ...w, who: o.labelCustomer }))), ...data.packing.unassigned.map((w) => ({ ...w, who: "Unassigned" }))]
        .filter((w) => w.source !== "weigh")
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 8);

  return (
    <>
      <WeekBar inv={data.packing.invNumber} />
      <OfflineStatus savedAt={bundle.savedAt} fromPhone={bundle.fromPhone} />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto">Scan boxes</h2>
        {/* Plain links, so they open from the phone's copy with no signal. */}
        <a href="/packing/pallets" className="btn ghost">
          Pallets
        </a>
        <a href="/packing" className="btn ghost">
          Back to Packing
        </a>
      </div>
      {!canPack && <p className="note">You can look, but not pack.</p>}

      <div className="panel mt-3 grid gap-2">
        {locked ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[1.15rem]">
              🔒 Locked to <b>{locked.labelCustomer}</b>
            </span>
            <span className="flex-1" />
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setLockId("");
                setLastProduct(null);
              }}
            >
              Unlock
            </button>
          </div>
        ) : (
          <label className="grid gap-1">
            <span className="lbl m-0">Each box goes to who needs it. Or lock to one customer:</span>
            <select
              className="field big"
              value=""
              onChange={(e) => {
                setLockId(e.target.value);
                setShown(null);
                setPending(null);
              }}
            >
              <option value="">Lock to a customer...</option>
              {data.packing.orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.labelCustomer}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {locked && <LineTotals order={locked} products={products} boxes={data.boxes} current={lastProduct} />}

      {pending && (
        <SuggestCard
          p={pending}
          data={data}
          labels={labels}
          pallets={pallets}
          canPack={canPack}
          onChange={setPending}
          onConfirm={() => void confirm(pending)}
          onCancel={() => {
            setPending(null);
            show({ ok: false, title: "Not saved", detail: "Scan the box again when ready." });
          }}
        />
      )}

      {!pending && (
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
        </div>
      )}
      <CameraScanner active={scanning && !pending} onRead={onRead} />

      {shown && !pending && (
        <div className={`scanresult ${shown.ok ? "ok" : "bad"}`} role="status" aria-live="assertive">
          {shown.big && <div className="route-done">{shown.big}</div>}
          <b>
            {shown.ok ? "✓ " : "✕ "}
            {shown.title}
          </b>
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

      {!pending && (
        <>
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
        </>
      )}

      {openPallets.length > 0 && (
        <div className="panel mt-3">
          <h3>Open pallets</h3>
          <ul className="m-0 mt-1 grid list-none gap-1 p-0">
            {openPallets.map((pl) => {
              const n = pallets.find((x) => x.id === pl.id)?.boxes.length ?? 0;
              return (
                <li key={pl.id} className="flex flex-wrap items-center gap-3 border-b border-line py-2">
                  <b className="text-[1.6rem] leading-none">{pl.tag}</b>
                  <span className="flex-1">
                    {shipNames(pl.shipKeys, data)} · {n} box{n === 1 ? "" : "es"}
                  </span>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={!canPack}
                    onClick={() =>
                      void enqueue({ type: "pallet-status", id: pl.id, status: "full" })
                        .then(() => toast(`${pl.tag} is full. The next box for it asks for a new tag.`))
                        .catch(() => toast("Couldn't save on this phone. Try again."))
                    }
                  >
                    Pallet full
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <RecentBoxes
        title={locked ? `Boxes for ${locked.labelCustomer}` : "Last boxes scanned"}
        boxes={recent}
        products={products}
        pallets={data.pallets}
        isAdmin={isAdmin}
        db={db}
        onChanged={refresh}
      />

      {manual && (
        <ManualBox
          products={products}
          onOrder={locked ? Object.keys(locked.lines) : null}
          week={week}
          onClose={() => setManual(false)}
          onReady={(base) => {
            setManual(false);
            routeBox(base);
          }}
        />
      )}
    </>
  );
}

/** The suggestion: the pallet very large, who it's for, and other choices below. One tap to confirm. */
function SuggestCard({
  p,
  data,
  labels,
  pallets,
  canPack,
  onChange,
  onConfirm,
  onCancel,
}: {
  p: Pending;
  data: PackingBundle;
  labels: SheetLabel[];
  pallets: RoutePallet[];
  canPack: boolean;
  onChange: (p: Pending) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const product = data.packing.products.get(p.base.productId);
  const order = p.pick ? data.packing.orders.find((o) => o.id === p.pick) : undefined;
  const ro = order ? routeOrder(order, p.base.productId, data, labels) : null;
  const pallet = ro ? palletFor(ro, p.base.productId, pallets) : null;
  const box = order ? boxFor(order, p.base.productId, data.packing, labels, new Set()) : null;
  const tagUsed = !pallet && p.tag.trim() && data.pallets.some((x) => x.tag.trim().toUpperCase() === p.tag.trim().toUpperCase());
  const others = p.list.filter((o) => o.orderId !== p.pick).slice(0, 5);
  // A customer picked by hand who doesn't need this product: over the order.
  const over = order && ro && p.route === "picked" && (!ro.need || !p.list.some((o) => o.orderId === order.id));

  return (
    <div className="route-card" role="dialog" aria-label="Where this box goes">
      <p className="m-0 text-[1.1rem]">
        <b>{product?.name ?? "Box"}</b> · {fmt(p.base.upload.weight)} lb
      </p>
      {p.base.warnings.map((w) => (
        <div key={w} className="scanwarn">
          ⚠ {w}
        </div>
      ))}

      {!order ? (
        <>
          <div className="route-tag none">Unassigned</div>
          <p className="m-0 text-[1.1rem]">
            {p.list.length ? "Kathy will choose who it goes to." : "No open orders need this product."}
          </p>
        </>
      ) : (
        <>
          {pallet ? (
            <div className="route-tag">→ {pallet.tag}</div>
          ) : (
            <label className="mt-2 grid gap-1">
              <span className="text-[1.1rem] font-semibold">Start pallet for {ro!.shipName}</span>
              <span className="small">Write a tag on the pallet, then type it here.</span>
              <input
                className="field big route-taginput"
                value={p.tag}
                autoFocus
                aria-label="Tag for the new pallet"
                onChange={(e) => onChange({ ...p, tag: e.target.value.toUpperCase().slice(0, 12) })}
              />
              {tagUsed && <span className="scanwarn">⚠ {p.tag} is already used this week. Use a different tag.</span>}
            </label>
          )}
          <div className="route-who">{order.labelCustomer}</div>
          <p className="m-0 text-[1.1rem]">
            {box?.label_no != null ? `Label ${box.label_no} · ` : ""}
            {ro!.need ? needWords(ro!.need) : "not on their order"}
          </p>
          {ro!.via && <p className="small muted m-0">via {ro!.via}</p>}
          {over && <p className="scanwarn">⚠ More than {order.labelCustomer} ordered. It will be flagged for Kathy.</p>}
        </>
      )}

      <div className="mt-3 grid gap-2">
        <button type="button" className="bigbtn mt-0!" disabled={!canPack || (!!order && !pallet && !p.tag.trim())} onClick={onConfirm}>
          {order ? (pallet ? `Put on ${pallet.tag}` : `Start ${p.tag.trim() || "pallet"} and put it on`) : "Save as unassigned"}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel, scan again
        </button>
      </div>

      {(others.length > 0 || p.pick != null) && (
        <div className="mt-3">
          <p className="small m-0 mb-1">Or put it with:</p>
          <div className="flex flex-wrap gap-2">
            {others.map((o) => (
              <button
                key={o.orderId}
                type="button"
                className="route-alt"
                onClick={() => onChange({ ...p, pick: o.orderId, route: o.orderId === p.list[0]?.orderId ? "suggested" : "other" })}
              >
                {o.name}
                <small>{o.need ? needWords(o.need) : ""}</small>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {!picking ? (
          <button type="button" className="btn ghost" onClick={() => setPicking(true)}>
            Pick customer anyway
          </button>
        ) : (
          <select
            className="field big"
            value=""
            autoFocus
            onChange={(e) => {
              if (!e.target.value) return;
              onChange({ ...p, pick: e.target.value, route: "picked" });
              setPicking(false);
            }}
          >
            <option value="">Who is it for?</option>
            {data.packing.orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.labelCustomer}
              </option>
            ))}
          </select>
        )}
        {p.pick != null && (
          <button type="button" className="btn ghost" onClick={() => onChange({ ...p, pick: null, route: "unassigned" })}>
            Unassigned (extras)
          </button>
        )}
      </div>
    </div>
  );
}

/** One order as routing sees it, for this product. */
function routeOrder(o: PackOrder, productId: string, data: PackingBundle, labels: SheetLabel[]): RouteOrder {
  const rows = orderSheet(o, data.packing, labels);
  const lines = new Map(packLines(o, data.packing.products));
  const row = rows.find((r) => r.productId === productId);
  const line = lines.get(productId);
  const need = row && line ? needFor(row, line, data.packing.products.get(productId)?.lb_per_unit ?? null) : null;
  // How far along the whole order is: boxes packed over boxes planned (pounds where boxes aren't known).
  let done = 0;
  let total = 0;
  for (const r of rows) {
    const l = lines.get(r.productId);
    if (!l) continue;
    if (r.known) {
      done += Math.min(r.blanks.filter((b) => b.weight).length, r.boxCount);
      total += r.boxCount;
    }
  }
  const progress = total > 0 ? done / total : 0;
  return {
    orderId: o.id,
    customerId: o.customerId,
    name: o.labelCustomer,
    shipKey: o.shipKey,
    shipName: o.group ?? o.labelCustomer,
    via: o.group,
    shipDate: null,
    need,
    progress,
  };
}

/** The week's pallets with the boxes on them, as routing sees them. */
function routePallets(data: PackingBundle): RoutePallet[] {
  const boxes = new Map<string, { customerId: string | null; productId: string }[]>();
  const add = (w: PackWeight, customerId: string | null) => {
    if (!w.pallet_id) return;
    const l = boxes.get(w.pallet_id) ?? [];
    l.push({ customerId, productId: w.product_id });
    boxes.set(w.pallet_id, l);
  };
  for (const o of data.packing.orders) for (const w of o.weights) add(w, o.customerId);
  for (const w of data.packing.unassigned) add(w, null);
  return data.pallets.map((p) => ({ id: p.id, tag: p.tag, status: p.status, shipKeys: p.shipKeys, createdAt: p.created_at, plan: p.plan, boxes: boxes.get(p.id) ?? [] }));
}

/** "PCC distributor", "Key City". */
function shipNames(keys: string[], data: PackingBundle): string {
  return keys
    .map((k) => {
      const [kind, id] = k.split(":");
      if (kind === "point") return data.packing.points.get(id) ?? "Distributor";
      return data.packing.orders.find((o) => o.customerId === id)?.labelCustomer ?? "A customer";
    })
    .join(", ");
}

/** For the locked customer: each product ordered, boxes and pounds scanned so far. */
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
              <Link href="/setup/products" className="btn ghost" target="_blank">
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

/** Boxes scanned or typed, newest first: who, which pallet. Admins can fix a lot. */
function RecentBoxes({
  title,
  boxes,
  products,
  pallets,
  isAdmin,
  db,
  onChanged,
}: {
  title: string;
  boxes: (PackWeight & { who?: string })[];
  products: Map<string, PackProduct>;
  pallets: { id: string; tag: string }[];
  isAdmin: boolean;
  db: SupabaseClient;
  onChanged: () => void;
}) {
  const toast = useToast();
  const list = boxes.filter((w) => w.source !== "weigh").slice().sort((a, b) => b.at.localeCompare(a.at));
  if (!list.length) return null;
  const tag = (id: string | null) => (id ? pallets.find((p) => p.id === id)?.tag : undefined);
  return (
    <div className="panel mt-3">
      <h3>{title}</h3>
      <ul className="m-0 mt-2 list-none p-0">
        {list.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center gap-2 border-b border-line py-2">
            <span className="flex-1">
              {tag(w.pallet_id) && <b>{tag(w.pallet_id)} · </b>}
              {w.who && <>{w.who} · </>}
              {w.label_no != null ? <>Label {w.label_no} · </> : null}
              {products.get(w.product_id)?.name ?? w.product_id} · {fmt(w.weight)} lb · Lot {w.lot}
              {w.case_no && <span className="small muted"> · case {w.case_no}</span>}
              {w.source === "manual" && <span className="small muted"> · typed</span>}
            </span>
            {isLocal(w) && <span className="small muted">on this phone</span>}
            {isAdmin && !isLocal(w) && (
              <button
                type="button"
                className="copy text-[.9rem]"
                onClick={() => {
                  const v = window.prompt(`New lot for this box (now ${w.lot}):`, w.lot ?? "");
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

/** A label that won't scan: product, weight, and lot by hand, with an optional photo. Then it's routed like a scan. */
function ManualBox({
  products,
  onOrder,
  week,
  onClose,
  onReady,
}: {
  products: Map<string, PackProduct>;
  /** The locked customer's products, listed first; null when routing. */
  onOrder: string[] | null;
  week: string;
  onClose: () => void;
  onReady: (base: Base) => void;
}) {
  const active = [...products.values()].filter((p) => p.active);
  const first = onOrder ? active.filter((p) => onOrder.includes(p.id)) : active;
  const rest = onOrder ? active.filter((p) => !onOrder.includes(p.id)) : [];
  const [productId, setProductId] = useState(first[0]?.id ?? "");
  const [weight, setWeight] = useState("");
  const [lot, setLot] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const ok = !!productId && num(weight) > 0 && LOT_PATTERN.test(lot);

  async function next() {
    setBusy(true);
    const clientId = crypto.randomUUID();
    // The photo is kept on the phone with the box and uploads first.
    const photoPath = photo ? `${week}/${clientId}.jpg` : null;
    const blob = photo ? await shrink(photo) : null;
    setBusy(false);
    onReady({
      productId,
      upload: {
        client_id: clientId,
        product_id: productId,
        source: "manual",
        weight: num(weight),
        lot,
        photo_path: photoPath,
        scanned_at: new Date().toISOString(),
      },
      photo: blob && photoPath ? { path: photoPath, blob } : undefined,
      warnings: [],
      serialKey: null,
    });
  }

  return (
    <Sheet title="Label won't scan" onClose={onClose}>
      <p className="small muted -mt-2">Type what&apos;s printed on the label.</p>
      <label className="lbl" htmlFor="mb-product">
        Product
      </label>
      <select id="mb-product" className="field big" value={productId} onChange={(e) => setProductId(e.target.value)}>
        {first.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        {rest.length > 0 && (
          <optgroup label="Not on this order">
            {rest.map((p) => (
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
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn" disabled={!ok || busy} onClick={() => void next()}>
          {busy ? "One moment..." : "Next: where it goes"}
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

/** The next empty box of a customer's product on the packing sheet, skipping ones filled moments ago. */
function boxFor(order: PackOrder, productId: string, data: PackingData, labels: SheetLabel[], filled: Set<string>) {
  const row = orderSheet(order, data, labels).find((r) => r.productId === productId);
  if (!row) return { slot: 1, label_no: null, boxTypeId: null, words: "Box 1" };
  const b = row.blanks.find((x) => !x.weight && !filled.has(`${order.id}|${productId}|${x.slot}`));
  const slot = b?.slot ?? Math.max(row.blanks.length, ...[...filled].filter((k) => k.startsWith(`${order.id}|${productId}|`)).map((k) => Number(k.split("|")[2]))) + 1;
  return {
    slot,
    label_no: b?.planned ? b.labelNo : null,
    boxTypeId: b?.boxTypeId ?? row.blanks[row.blanks.length - 1]?.boxTypeId ?? null,
    words: b ? blankWords(row, slot) : `Box ${slot}`,
  };
}
