"use client";

// Freezer counts (Lucas, 11/19-20/26). Two kinds:
//   Stock-in count   scan everything to add it to the freezer (the first count).
//   Freezer count    count what's really there and line it up with the app.
// The freezer has no signal: every scan is saved on the phone and uploads when
// there's signal. A count can be paused and picked up again, on this phone or
// another (any number of phones can join; nothing locks to one). Nothing
// changes in inventory until the count is reviewed and applied, and that waits
// until every phone's scans are in. No alerts: differences show only on the
// review and in the saved count.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useCan, useMe } from "@/components/CurrentUser";
import { getDb } from "@/components/data/db";
import OfflineStatus from "@/components/offline/OfflineStatus";
import { useOutbox } from "@/components/offline/OutboxProvider";
import FreezerScanner, { type ScanMode } from "@/components/freezer/FreezerScanner";
import { BoxCard, countWord, freezerProducts, ProductSelect, Stepper, UnknownLabel } from "@/components/freezer/FreezerBits";
import { useFreezerBundle } from "@/components/freezer/useFreezerBundle";
import { useToast } from "@/components/Toast";
import { countResults, itemsToAdd, REMOVE_REASONS, reviewCount, type CountReview, type InBox } from "@/lib/calc/freezer";
import { decideFreezerScan, freezerKey, type FreezerScanStep } from "@/lib/calc/freezerScan";
import { num } from "@/lib/calc/num";
import { ago, niceDate, todayISO } from "@/lib/dates";
import { applyCount, countCheckin, deviceId, discardCount, type FreezerBundle, type FreezerProduct } from "@/lib/db/freezer";
import type { CountItemUpload } from "@/lib/offline/outbox";
import { lotKey } from "@/lib/scan/flow";
import { badScan, goodScan } from "@/lib/scan/feedback";
import type { Gs1Box } from "@/lib/scan/gs1";

type Shown = { ok: boolean; title: string; detail?: string } | null;
type Ready = Extract<FreezerScanStep, { kind: "ready" }> & { raw: string; found: boolean };
type Data = FreezerBundle & { waitingCount: number; waitingAdds: number };

const KIND_NAME = { stock_in: "Stock-in count", reconcile: "Freezer count" } as const;

export default function CountScreen() {
  const canChange = useCan("freezer").change;
  const bundle = useFreezerBundle();
  const data = bundle.data;
  const [reviewing, setReviewing] = useState(false);

  if (bundle.error && !data)
    return (
      <p className="note bad">
        Couldn&apos;t load the freezer, and this phone has no copy yet. Find signal and open Freezer count once. ({bundle.error})
      </p>
    );
  if (!data) return <div className="empty">Loading...</div>;

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto">{data.count ? KIND_NAME[data.count.kind] : "Freezer count"}</h2>
        <Link className="btn ghost" href="/freezer">
          Back to Freezer
        </Link>
      </div>
      <OfflineStatus savedAt={bundle.savedAt} fromPhone={bundle.fromPhone} />
      {!canChange ? (
        <p className="note mt-3">You can&apos;t count the freezer. Ask an admin if you need to.</p>
      ) : !data.count ? (
        <StartCount data={data} />
      ) : reviewing ? (
        <Review data={data} fromPhone={bundle.fromPhone} onBack={() => setReviewing(false)} onDone={() => { setReviewing(false); bundle.refresh(); }} />
      ) : (
        <Counting data={data} onReview={() => setReviewing(true)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------

function StartCount({ data }: { data: Data }) {
  const { enqueue } = useOutbox();
  const toast = useToast();
  const [kind, setKind] = useState<"stock_in" | "reconcile">(data.boxes.length ? "reconcile" : "stock_in");
  const [some, setSome] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const products = freezerProducts(data.products, new Set(Object.keys(data.onHand).filter((k) => data.onHand[k])));
  return (
    <section className="panel mt-3">
      <p className="lbl mt-0">What kind of count?</p>
      <div className="grid gap-2">
        <button type="button" className={`scanbtn ${kind === "stock_in" ? "" : "alt"}`} aria-pressed={kind === "stock_in"} onClick={() => setKind("stock_in")}>
          Stock-in count
          <span className="small block font-normal">Scan every box to add it to the freezer. For the first count.</span>
        </button>
        <button type="button" className={`scanbtn ${kind === "reconcile" ? "" : "alt"}`} aria-pressed={kind === "reconcile"} onClick={() => setKind("reconcile")}>
          Freezer count
          <span className="small block font-normal">Count what&apos;s there and check it against the app.</span>
        </button>
      </div>
      {kind === "reconcile" && (
        <>
          <p className="lbl">What does it cover?</p>
          <div className="sizes" role="group" aria-label="What it covers">
            <button type="button" aria-pressed={!some} onClick={() => setSome(false)}>
              Whole freezer
            </button>
            <button type="button" aria-pressed={some} onClick={() => setSome(true)}>
              Some products
            </button>
          </div>
          {some && (
            <div className="mt-2 grid gap-1">
              {products.map((p) => (
                <label key={p.id} className="flex min-h-[44px] items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-6 w-6"
                    checked={chosen.has(p.id)}
                    onChange={(e) =>
                      setChosen((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(p.id);
                        else n.delete(p.id);
                        return n;
                      })
                    }
                  />
                  {p.name}
                </label>
              ))}
            </div>
          )}
        </>
      )}
      <button
        type="button"
        className="bigbtn"
        disabled={kind === "reconcile" && some && chosen.size === 0}
        onClick={() =>
          void enqueue({
            type: "count-start",
            count: { id: crypto.randomUUID(), kind, product_ids: kind === "reconcile" && some ? [...chosen] : null, count_date: todayISO() },
          }).catch(() => toast("Couldn't save on this phone. Try again."))
        }
      >
        Start the count
      </button>
      <p className="small muted mb-0">Nothing in the freezer changes until you review the count and apply it.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

function Counting({ data, onReview }: { data: Data; onReview: () => void }) {
  const me = useMe();
  const isAdmin = me.role === "admin";
  const { enqueue, online } = useOutbox();
  const toast = useToast();
  const count = data.count!;
  const device = useMemo(() => deviceId(), []);
  const [mode, setMode] = useState<ScanMode>("");
  const [shown, setShown] = useState<Shown>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [unknown, setUnknown] = useState<{ raw: string; box: Gs1Box } | null>(null);
  const [offer, setOffer] = useState<{ id: string; name: string } | null>(null);
  const [byHand, setByHand] = useState(false);
  const [lastCount, setLastCount] = useState<Map<string, number>>(new Map());

  const productById = useMemo(() => new Map(data.products.map((p) => [p.id, p])), [data.products]);
  const products = freezerProducts(data.products);
  const live = data.items.filter((i) => !i.voided);
  const inScope = (pid: string) => !count.product_ids || count.product_ids.includes(pid);

  // Tell the others how this phone is doing (when there's signal), so the count is applied only when all scans are in.
  useEffect(() => {
    if (!online) return;
    void countCheckin(getDb(), count.id, device, me.displayName, data.waitingCount).catch(() => undefined);
  }, [online, count.id, device, me.displayName, data.waitingCount]);

  const boxByKey = new Map(data.boxes.map((b) => [freezerKey(b.gtin, b.serial), b] as const).filter((x): x is [string, (typeof data.boxes)[number]] => !!x[0]));

  function ctx() {
    return {
      products: productById,
      gtinMap: new Map(data.gtins.map((g) => [g.gtin, g.product_id])),
      lots: new Map(data.lots.map((l) => [lotKey(l.gtin, l.pack_date), l.lot])),
      // A stock-in count adds boxes, so a box already there is refused; a freezer count matches it (below).
      inFreezer: count.kind === "stock_in" ? new Map([...boxByKey].map(([k, b]) => [k, b.product_id])) : new Map<string, string>(),
      held: new Map(data.held.map((h) => [freezerKey(h.gtin, h.serial)!, h.customer])),
      scannedNow: new Set(live.map((i) => freezerKey(i.gtin, i.serial)).filter((k): k is string => !!k)),
      lastCount,
    };
  }

  async function saveItem(v: Omit<CountItemUpload, "id" | "count_id" | "device_id" | "scanned_at" | "decision"> & { decision?: CountItemUpload["decision"] }, words: Shown) {
    const id = crypto.randomUUID();
    try {
      await enqueue({ type: "count-item", item: { decision: null, ...v, id, count_id: count.id, device_id: device, scanned_at: new Date().toISOString() } });
    } catch {
      badScan();
      setShown({ ok: false, title: "Couldn't save on this phone.", detail: "Try again." });
      return null;
    }
    if (v.product_id && productById.get(v.product_id)?.unit !== "lb" && v.kind === "scan") setLastCount((m) => new Map(m).set(v.product_id!, v.qty));
    goodScan();
    setShown(words);
    return id;
  }

  function fromBox(b: Gs1Box, raw: string) {
    return { gtin: b.gtin, serial: b.serial, serial_date: b.serialDate, case_no: b.caseNo, pack_date: b.packDate, raw_scan: raw };
  }

  async function addReady(r: Ready, v: { qty: number; weightLb: number | null; lot: string | null }) {
    const p = productById.get(r.productId);
    const id = await saveItem(
      { kind: "scan", product_id: r.productId, qty: v.qty, weight_lb: v.weightLb, lot: v.lot, product_confirmed: r.confirmed, ...fromBox(r.box, r.raw) },
      r.found ? null : { ok: true, title: `Counted: ${p?.name ?? "box"}`, detail: [v.weightLb ? `${v.weightLb} lb` : "", `${v.qty} ${countWord(p)}`].filter(Boolean).join(" · ") },
    );
    // A box the app doesn't have: offer to add it (an option, not an alert).
    if (id && r.found) setOffer({ id, name: p?.name ?? "This box" });
  }

  function handle(raw: string, answers: { productId?: string; confirmed?: boolean } = {}) {
    setOffer(null);
    const step = decideFreezerScan(raw, ctx(), answers);
    // A freezer count: a box the app has is a match, counted as it is.
    if (count.kind === "reconcile" && (step.kind === "ready" || step.kind === "unknown-gtin")) {
      const key = freezerKey(step.box.gtin, step.box.serial);
      const b = key ? boxByKey.get(key) : undefined;
      if (b) {
        setUnknown(null);
        const p = productById.get(b.product_id);
        if (!inScope(b.product_id)) {
          badScan();
          return setShown({ ok: false, title: `${p?.name ?? "This product"} isn't part of this count.`, detail: "It wasn't counted." });
        }
        void saveItem(
          { kind: "scan", product_id: b.product_id, qty: b.qty_left, weight_lb: b.weight_lb, lot: b.lot, product_confirmed: b.product_confirmed, ...fromBox(step.box, raw) },
          { ok: true, title: `In the app: ${p?.name ?? "box"}`, detail: [b.weight_lb ? `${b.weight_lb} lb` : "", `${b.qty_left} ${countWord(p)}`].filter(Boolean).join(" · ") },
        );
        return;
      }
    }
    if (step.kind === "ready") {
      setUnknown(null);
      if (!inScope(step.productId)) {
        badScan();
        return setShown({ ok: false, title: `${productById.get(step.productId)?.name ?? "This product"} isn't part of this count.`, detail: "It wasn't counted." });
      }
      const r: Ready = { ...step, raw, found: count.kind === "reconcile" };
      if (step.qtyIsWeight && step.box.weightLb) return void addReady(r, { qty: step.box.weightLb, weightLb: step.box.weightLb, lot: step.lot });
      setShown(null);
      return setReady(r);
    }
    if (step.kind === "held") {
      // Recorded so the review shows it, never added.
      const pid = data.gtins.find((g) => g.gtin === step.box.gtin)?.product_id ?? null;
      badScan();
      if (pid)
        void enqueue({
          type: "count-item",
          item: { id: crypto.randomUUID(), count_id: count.id, device_id: device, kind: "scan", product_id: pid, qty: 1, weight_lb: step.box.weightLb, lot: step.box.lot, product_confirmed: true, decision: "skip", scanned_at: new Date().toISOString(), ...fromBox(step.box, raw) },
        });
      return setShown({ ok: false, title: step.message });
    }
    badScan();
    if (step.kind === "unknown-gtin") {
      setShown(null);
      return setUnknown({ raw, box: step.box });
    }
    setShown({ ok: false, title: step.message, detail: step.kind === "misread" ? "Scan it again." : undefined });
  }

  const mine = data.waitingCount;
  const recent = [...live].sort((a, b) => b.scanned_at.localeCompare(a.scanned_at)).slice(0, 30);
  const scans = live.filter((i) => i.kind === "scan").length;

  return (
    <>
      <section className="panel mt-3">
        <p className="m-0">
          Started {niceDate(count.count_date)}
          {count.started_by && data.people[count.started_by] ? ` by ${data.people[count.started_by]}` : ""}.{" "}
          {count.product_ids ? `Only: ${count.product_ids.map((id) => productById.get(id)?.name ?? id).join(", ")}.` : "Whole freezer."}
        </p>
        <p className="mt-1 mb-0 text-lg">
          <b>{live.length}</b> counted ({scans} scanned).{" "}
          {mine > 0 ? (
            <b>
              {mine} {mine === 1 ? "scan" : "scans"} waiting to upload on this phone.
            </b>
          ) : (
            "Everything on this phone has uploaded."
          )}
        </p>
        <PhoneList data={data} device={device} />
      </section>

      <div className="scan-area">
        {shown && (
          <div className={`scanresult ${shown.ok ? "ok" : "bad"}`} role="status" aria-live="assertive">
            <b>{shown.title}</b>
            {shown.detail}
          </div>
        )}
        {offer && (
          <div className="scanq" role="group" aria-label="A box the app doesn't have">
            <b className="block text-lg">{offer.name} isn&apos;t in the app.</b>
            <p className="mt-1 mb-2">It&apos;s counted. Add it to the freezer when the count is applied?</p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setOffer(null);
                  setShown({ ok: true, title: "Counted, not added", detail: "You can still add it on the review." });
                }}
              >
                Skip
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void enqueue({ type: "count-item-set", id: offer.id, count_id: count.id, patch: { decision: "add" } });
                  setOffer(null);
                  setShown({ ok: true, title: "Counted, and will be added", detail: "It's added when the count is applied." });
                }}
              >
                Add to freezer
              </button>
            </div>
          </div>
        )}
        {unknown && (
          <UnknownLabel
            products={products}
            isAdmin={isAdmin}
            onSkip={() => {
              setUnknown(null);
              setShown({ ok: false, title: "Not counted", detail: "Scan the next box, or count it by hand." });
            }}
            onPick={(pid) => {
              const u = unknown;
              if (isAdmin) void enqueue({ type: "gtin-map", gtin: u.box.gtin, product_id: pid, via: "barcode taught (freezer count)" });
              handle(u.raw, { productId: pid, confirmed: isAdmin });
            }}
          />
        )}
        {ready && (
          <BoxCard
            key={ready.raw}
            product={productById.get(ready.productId)}
            weightLb={ready.box.weightLb}
            lot={ready.lot}
            qty={ready.qty}
            qtyIsWeight={ready.qtyIsWeight}
            serial={ready.box.serial}
            confirmed={ready.confirmed}
            addLabel="Count it"
            onCancel={() => {
              setReady(null);
              setShown({ ok: false, title: "Not counted", detail: "Scan the next box." });
            }}
            onAdd={(v) => {
              const r = ready;
              setReady(null);
              void addReady(r, v);
            }}
          />
        )}
        {!byHand && <FreezerScanner mode={mode} setMode={setMode} paused={!!ready || !!unknown} onRead={(t) => handle(t)} />}
        {byHand ? (
          <ByHand
            products={products.filter((p) => inScope(p.id))}
            onClose={() => setByHand(false)}
            onSave={(pid, qty, weight) =>
              void saveItem(
                { kind: "manual", product_id: pid, qty, weight_lb: weight, lot: null, product_confirmed: true, gtin: null, serial: null, serial_date: null, case_no: null, pack_date: null, raw_scan: null, decision: null },
                { ok: true, title: `Counted by hand: ${productById.get(pid)?.name ?? ""}`, detail: `${qty} ${countWord(productById.get(pid))}` },
              )
            }
          />
        ) : (
          <button
            type="button"
            className="btn ghost mt-3 w-full"
            onClick={() => {
              setMode("");
              setByHand(true);
            }}
          >
            Count by hand (no readable label)
          </button>
        )}
      </div>

      <section className="panel mt-4">
        <h3>Counted so far</h3>
        {recent.length ? (
          <table className="simple">
            <tbody>
              {recent.map((i) => {
                const p = i.product_id ? productById.get(i.product_id) : undefined;
                return (
                  <tr key={i.id}>
                    <td>
                      {p?.name ?? "Product not chosen"}
                      <span className="small muted block">
                        {i.kind === "manual" ? "By hand" : i.serial ? `Serial ${i.serial}` : "Scanned"}
                        {i.decision === "add" && count.kind === "reconcile" ? " · Will be added" : ""}
                        {i.decision === "skip" && count.kind === "stock_in" ? " · Skipped" : ""}
                      </span>
                    </td>
                    <td className="num">
                      {i.qty} {countWord(p)}
                    </td>
                    <td className="num">{i.weight_lb ? `${i.weight_lb} lb` : ""}</td>
                    <td>
                      <button
                        type="button"
                        className="copy min-h-[44px]"
                        onClick={() => void enqueue({ type: "count-item-set", id: i.id, count_id: count.id, patch: { voided: true } })}
                      >
                        Take back
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty">Nothing counted yet. Scan a box.</div>
        )}
      </section>

      <div className="mt-4 grid gap-2">
        <button type="button" className="bigbtn mt-0!" onClick={onReview}>
          Review the count
        </button>
        <Link className="btn ghost text-center" href="/freezer">
          Pause (everything is kept)
        </Link>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            if (!window.confirm("Throw this count away? Nothing in the freezer changes.")) return;
            if (!online) return toast("Throwing a count away needs signal.");
            void discardCount(getDb(), count.id).then((e) => toast(e ? `Couldn't: ${e}` : "Count thrown away"));
          }}
        >
          Throw this count away
        </button>
      </div>
    </>
  );
}

function PhoneList({ data, device }: { data: Data; device: string }) {
  const others = data.devices.filter((d) => d.device_id !== device);
  if (!others.length) return null;
  return (
    <ul className="small mt-2 mb-0">
      {others.map((d) => (
        <li key={d.device_id}>
          {d.person_name || "Another phone"}: {d.waiting ? `${d.waiting} waiting to upload` : "all uploaded"}, last seen {ago(d.last_seen)}
        </li>
      ))}
    </ul>
  );
}

function ByHand({ products, onClose, onSave }: { products: FreezerProduct[]; onClose: () => void; onSave: (pid: string, qty: number, weight: number | null) => void }) {
  const [pid, setPid] = useState("");
  const [qty, setQty] = useState("1");
  const [weight, setWeight] = useState("");
  const p = products.find((x) => x.id === pid);
  const byWeight = p?.unit === "lb";
  const q = byWeight ? num(weight) : num(qty);
  return (
    <form
      className="panel mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pid || !(q > 0)) return;
        onSave(pid, q, num(weight) > 0 ? num(weight) : null);
        setWeight("");
        setQty("1");
      }}
    >
      <h3 className="mt-0">Count by hand</h3>
      <label className="lbl" htmlFor="bh-product">
        Product
      </label>
      <ProductSelect id="bh-product" products={products} value={pid} onChange={setPid} />
      {!byWeight && (
        <>
          <label className="lbl" htmlFor="bh-qty">
            How many {countWord(p) || "pieces"}
          </label>
          <Stepper id="bh-qty" value={qty} onChange={setQty} />
        </>
      )}
      <label className="lbl" htmlFor="bh-weight">
        Weight (lb){byWeight ? "" : ", if known"}
      </label>
      <input id="bh-weight" className="field" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ""))} />
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn ghost" onClick={onClose}>
          Back to scanning
        </button>
        <button type="submit" className="btn" disabled={!pid || !(q > 0)}>
          Count it
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Review and apply
// ---------------------------------------------------------------------------

function Review({ data, fromPhone, onBack, onDone }: { data: Data; fromPhone: boolean; onBack: () => void; onDone: () => void }) {
  const me = useMe();
  const isAdmin = me.role === "admin";
  const { enqueue, online } = useOutbox();
  const toast = useToast();
  const count = data.count!;
  const [removals, setRemovals] = useState<Map<string, { reason: string; note: string }>>(new Map());
  const [busy, setBusy] = useState(false);
  const productById = new Map(data.products.map((p) => [p.id, p]));
  const name = (id: string) => productById.get(id)?.name ?? id;
  const inBoxes: InBox[] = data.boxes.filter((b) => !b.id.startsWith("local:"));
  const review: CountReview = reviewCount({ kind: count.kind, scope: count.product_ids, items: data.items, boxes: inBoxes, onHand: data.onHand, held: data.held });
  const mine = data.waitingCount;
  const othersWaiting = data.devices.filter((d) => d.device_id !== deviceId()).reduce((s, d) => s + d.waiting, 0);
  const otherBad = [...removals.values()].some((r) => r.reason === "other" && !r.note.trim());
  const canApply = online && !fromPhone && mine === 0 && !otherBad && review.noProduct.length === 0 && (othersWaiting === 0 || isAdmin);
  const setDecision = (id: string, decision: "add" | "skip" | null) => void enqueue({ type: "count-item-set", id, count_id: count.id, patch: { decision } });

  async function apply() {
    const list = [...removals].map(([box_id, r]) => ({ box_id, reason: r.reason, note: r.note.trim() }));
    if (othersWaiting > 0 && !window.confirm(`${othersWaiting} scans on other phones haven't uploaded. Apply anyway? Those scans won't be in this count.`)) return;
    setBusy(true);
    const err = await applyCount(getDb(), { count: count.id, adds: itemsToAdd(review), removals: list, results: countResults(review, list), anyway: othersWaiting > 0 });
    setBusy(false);
    if (err) return toast(`Couldn't apply: ${err}`);
    toast("Count applied");
    onDone();
  }

  return (
    <>
      <section className="panel mt-3">
        <h3 className="mt-0">Review</h3>
        {mine > 0 && <p className="note bad">{mine} scans on this phone haven&apos;t uploaded yet. Find signal; the count can be applied once they&apos;re in.</p>}
        {othersWaiting > 0 && (
          <p className="note">
            {othersWaiting} scans on other phones haven&apos;t uploaded yet. {isAdmin ? "Wait for them, or apply anyway." : "Wait for them, or ask an admin."}
          </p>
        )}
        {(!online || fromPhone) && <p className="note">No signal. You can look at the review, but applying needs signal.</p>}
        {review.noProduct.length > 0 && <p className="note bad">{review.noProduct.length} scanned boxes have no product. Take them back or count them by hand.</p>}
        {count.kind === "reconcile" && (
          <table className="simple">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">In the app</th>
                <th className="num">Counted</th>
                <th className="num">Difference</th>
              </tr>
            </thead>
            <tbody>
              {review.products.map((p) => (
                <tr key={p.productId}>
                  <td>{name(p.productId)}</td>
                  <td className="num">{p.app}</td>
                  <td className="num">{p.counted}</td>
                  <td className={`num ${p.difference < 0 ? "negative" : ""}`}>{p.difference > 0 ? `+${p.difference}` : p.difference}</td>
                </tr>
              ))}
              <tr>
                <td>
                  <b>Total</b>
                </td>
                <td className="num">
                  <b>{review.totals.app}</b>
                </td>
                <td className="num">
                  <b>{review.totals.counted}</b>
                </td>
                <td className="num">
                  <b>{review.totals.difference > 0 ? `+${review.totals.difference}` : review.totals.difference}</b>
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      {review.products.map((p) => {
        const prod = productById.get(p.productId);
        const nothing = !p.matched.length && !p.found.length && !p.held.length && !p.notCounted.length;
        if (nothing) return null;
        return (
          <section key={p.productId} className="panel mt-3">
            <h3 className="mt-0">{name(p.productId)}</h3>
            {count.kind === "reconcile" && <p className="m-0">Matched: {p.matched.length} {p.matched.length === 1 ? "box" : "boxes"} in the app and counted.</p>}
            {p.found.length > 0 && (
              <>
                <p className="lbl">{count.kind === "stock_in" ? "To add" : "Found: counted but not in the app"}</p>
                <ul className="m-0 grid gap-1 p-0">
                  {p.found.map((f) => (
                    <li key={f.item.id} className="flex flex-wrap items-center gap-2">
                      <span className="flex-1">
                        {f.item.qty} {countWord(prod)}
                        {f.item.weight_lb ? ` · ${f.item.weight_lb} lb` : ""}
                        {f.item.serial ? ` · Serial ${f.item.serial}` : f.item.kind === "manual" ? " · By hand" : ""}
                        <span className="small muted block">{f.added ? (count.kind === "stock_in" ? "Will be added" : "Added during the count: will be added") : "Not added"}</span>
                      </span>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => setDecision(f.item.id, count.kind === "stock_in" ? (f.added ? "skip" : null) : f.added ? null : "add")}
                      >
                        {f.added ? "Don't add" : "Add to freezer"}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {p.held.length > 0 && (
              <p className="small mt-2 mb-0">
                Packed for a customer, held in the freezer (not added): {p.held.map((h) => `${h.held.customer}${h.item.serial ? ` (${h.item.serial})` : ""}`).join(", ")}.
              </p>
            )}
            {p.notCounted.length > 0 && (
              <>
                <p className="lbl">Not counted: in the app but not scanned</p>
                <ul className="m-0 grid gap-2 p-0">
                  {p.notCounted.map((b) => {
                    const r = removals.get(b.id);
                    return (
                      <li key={b.id} className="grid gap-1">
                        <span>
                          {b.qty_left} {countWord(prod)}
                          {b.weight_lb ? ` · ${b.weight_lb} lb` : ""}
                          {b.serial ? ` · Serial ${b.serial}` : ""} · Added {niceDate(b.added_on)}
                        </span>
                        <select
                          className="field"
                          aria-label="What to do with it"
                          value={r?.reason ?? ""}
                          onChange={(e) =>
                            setRemovals((m) => {
                              const n = new Map(m);
                              if (!e.target.value) n.delete(b.id);
                              else n.set(b.id, { reason: e.target.value, note: n.get(b.id)?.note ?? "" });
                              return n;
                            })
                          }
                        >
                          <option value="">Leave as is</option>
                          {REMOVE_REASONS.map(([v, label]) => (
                            <option key={v} value={v}>
                              Remove: {label}
                            </option>
                          ))}
                        </select>
                        {r?.reason === "other" && (
                          <input
                            className="field"
                            placeholder="What happened?"
                            value={r.note}
                            onChange={(e) => setRemovals((m) => new Map(m).set(b.id, { reason: "other", note: e.target.value }))}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        );
      })}
      {review.outOfScope.length > 0 && <p className="small muted mt-2">{review.outOfScope.length} scans were of products this count doesn&apos;t cover. They&apos;re left out.</p>}

      <div className="mt-4 grid gap-2">
        <button type="button" className="bigbtn mt-0!" disabled={!canApply || busy} onClick={() => void apply()}>
          {busy ? "Applying..." : "Apply count"}
        </button>
        <button type="button" className="btn ghost" onClick={onBack}>
          Back to counting
        </button>
      </div>
    </>
  );
}
