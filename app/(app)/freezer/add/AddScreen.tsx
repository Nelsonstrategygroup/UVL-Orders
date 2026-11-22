"use client";

// Add to freezer (Lucas, 11/19/26): put boxes in freezer inventory that
// didn't come through packing or an order. Scan them (same labels as
// Packing) or type them in. Several in one go, saved on the phone first, so it
// works in the freezer with no signal. Each add is in the audit log.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCan, useMe } from "@/components/CurrentUser";
import OfflineStatus from "@/components/offline/OfflineStatus";
import { useOutbox } from "@/components/offline/OutboxProvider";
import FreezerScanner, { type ScanMode } from "@/components/freezer/FreezerScanner";
import { BoxCard, countWord, freezerProducts, ProductSelect, Stepper, UnknownLabel } from "@/components/freezer/FreezerBits";
import { useFreezerBundle } from "@/components/freezer/useFreezerBundle";
import { ADD_REASONS } from "@/lib/calc/freezer";
import { decideFreezerScan, freezerKey, type FreezerScanStep } from "@/lib/calc/freezerScan";
import { num } from "@/lib/calc/num";
import { todayISO, niceDate } from "@/lib/dates";
import { isLocalBox } from "@/lib/offline/freezerQueue";
import type { FreezerAdd } from "@/lib/offline/outbox";
import { LOT_PATTERN, lotKey } from "@/lib/scan/flow";
import { badScan, goodScan } from "@/lib/scan/feedback";
import type { Gs1Box } from "@/lib/scan/gs1";

type Shown = { ok: boolean; title: string; detail?: string } | null;
type Ready = Extract<FreezerScanStep, { kind: "ready" }> & { raw: string };

export default function AddScreen() {
  const me = useMe();
  const isAdmin = me.role === "admin";
  const canChange = useCan("freezer").change;
  const { enqueue } = useOutbox();
  const bundle = useFreezerBundle();
  const data = bundle.data;

  const [reason, setReason] = useState("added_manually");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => todayISO());
  const [income, setIncome] = useState(false);
  const [tab, setTab] = useState<"scan" | "type">("scan");
  const [mode, setMode] = useState<ScanMode>("");
  const [shown, setShown] = useState<Shown>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [unknown, setUnknown] = useState<{ raw: string; box: Gs1Box } | null>(null);
  // This time: the boxes added (by client_id) and the last count per product.
  const [added, setAdded] = useState<string[]>([]);
  const [lastCount, setLastCount] = useState<Map<string, number>>(new Map());

  const products = useMemo(() => (data ? freezerProducts(data.products) : []), [data]);
  const productById = useMemo(() => new Map((data?.products ?? []).map((p) => [p.id, p])), [data]);

  if (bundle.error && !data)
    return (
      <p className="note bad">
        Couldn&apos;t load the freezer, and this phone has no copy yet. Find signal and open Add to freezer once. ({bundle.error})
      </p>
    );
  if (!data) return <div className="empty">Loading...</div>;
  if (!canChange)
    return (
      <p className="note">
        You can&apos;t add to the freezer. Ask an admin if you need to. <Link href="/freezer">Back to Freezer</Link>
      </p>
    );

  const reasonOk = reason !== "other" || note.trim() !== "";
  const thisTime = added.map((id) => data.boxes.find((b) => b.client_id === id)).filter((b) => !!b);

  const ctx = () => ({
    products: productById,
    gtinMap: new Map(data.gtins.map((g) => [g.gtin, g.product_id])),
    lots: new Map(data.lots.map((l) => [lotKey(l.gtin, l.pack_date), l.lot])),
    inFreezer: new Map(data.boxes.map((b) => [freezerKey(b.gtin, b.serial), b.product_id] as const).filter((x): x is [string, string] => !!x[0])),
    held: new Map(data.held.map((h) => [freezerKey(h.gtin, h.serial)!, h.customer])),
    scannedNow: new Set<string>(),
    lastCount,
  });

  async function save(v: Omit<FreezerAdd, "client_id" | "reason" | "note" | "added_on" | "week_id" | "counts_as_income" | "at">) {
    const client_id = crypto.randomUUID();
    try {
      await enqueue({
        type: "freezer-add",
        box: {
          ...v,
          client_id,
          reason,
          note: note.trim(),
          added_on: date,
          week_id: null,
          counts_as_income: isAdmin && income,
          at: new Date().toISOString(),
        },
      });
    } catch {
      badScan();
      setShown({ ok: false, title: "Couldn't save on this phone.", detail: "Try again." });
      return false;
    }
    setAdded((a) => [client_id, ...a]);
    if (v.qty > 0 && productById.get(v.product_id)?.unit !== "lb") setLastCount((m) => new Map(m).set(v.product_id, v.qty));
    goodScan();
    const p = productById.get(v.product_id);
    setShown({ ok: true, title: `Added: ${p?.name ?? "box"}`, detail: [v.weight_lb ? `${v.weight_lb} lb` : "", v.lot ? `Lot ${v.lot}` : "", v.serial ? `Serial ${v.serial}` : ""].filter(Boolean).join(" · ") });
    return true;
  }

  function fromLabel(r: Ready, v: { qty: number; weightLb: number | null; lot: string | null }) {
    const b = r.box;
    return save({
      product_id: r.productId,
      qty: v.qty,
      weight_lb: v.weightLb,
      gtin: b.gtin,
      serial: b.serial,
      serial_date: b.serialDate,
      case_no: b.caseNo,
      pack_date: b.packDate,
      lot: v.lot,
      raw_scan: r.raw,
      product_confirmed: r.confirmed,
      source: "scan",
    });
  }

  function handle(raw: string, answers: { productId?: string; confirmed?: boolean } = {}) {
    if (!reasonOk) {
      badScan();
      return setShown({ ok: false, title: "Write a note for Other first." });
    }
    const step = decideFreezerScan(raw, ctx(), answers);
    if (step.kind === "ready") {
      setUnknown(null);
      const r = { ...step, raw };
      // Pounds with a weight on the label: added straight away, ready for the next box.
      if (step.qtyIsWeight && step.box.weightLb) return void fromLabel(r, { qty: step.box.weightLb, weightLb: step.box.weightLb, lot: step.lot });
      setShown(null);
      return setReady(r);
    }
    badScan();
    if (step.kind === "unknown-gtin") {
      setShown(null);
      return setUnknown({ raw, box: step.box });
    }
    setShown({ ok: false, title: step.message, detail: step.kind === "misread" ? "Scan it again." : undefined });
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto">Add to freezer</h2>
        <Link className="btn ghost" href="/freezer">
          Back to Freezer
        </Link>
      </div>
      <OfflineStatus savedAt={bundle.savedAt} fromPhone={bundle.fromPhone} />

      <section className="panel mt-3">
        <label className="lbl" htmlFor="add-reason">
          Why
        </label>
        <select id="add-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)}>
          {ADD_REASONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <label className="lbl" htmlFor="add-note">
          Note{reason === "other" ? "" : " (optional)"}
        </label>
        <input id="add-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === "other" ? "What happened?" : ""} />
        {!reasonOk && <p className="note bad mt-1">Write a note for Other.</p>}
        <label className="lbl" htmlFor="add-date">
          Date
        </label>
        <input id="add-date" type="date" className="field" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />
        {isAdmin && (
          <label className="mt-3 flex items-start gap-2">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={income} onChange={(e) => setIncome(e.target.checked)} />
            <span>
              Count as this week&apos;s freezer income
              <span className="small muted block">Only if it was really put away this week outside of packing. Admins only.</span>
            </span>
          </label>
        )}
      </section>

      <div className="sizes mt-3" role="group" aria-label="Scan or type">
        <button type="button" aria-pressed={tab === "scan"} onClick={() => setTab("scan")}>
          Scan boxes
        </button>
        <button
          type="button"
          aria-pressed={tab === "type"}
          onClick={() => {
            setTab("type");
            setMode("");
          }}
        >
          Type it in
        </button>
      </div>

      <div className="scan-area">
        {shown && (
          <div className={`scanresult ${shown.ok ? "ok" : "bad"}`} role="status" aria-live="assertive">
            <b>{shown.title}</b>
            {shown.detail}
          </div>
        )}
        {tab === "scan" && unknown && (
          <UnknownLabel
            products={products}
            isAdmin={isAdmin}
            onSkip={() => {
              setUnknown(null);
              setShown({ ok: false, title: "Not added", detail: "Scan the next box." });
            }}
            onPick={(pid) => {
              const u = unknown;
              // An admin teaches the label; it uploads with the box.
              if (isAdmin) void enqueue({ type: "gtin-map", gtin: u.box.gtin, product_id: pid, via: "barcode taught (Add to freezer)" });
              handle(u.raw, { productId: pid, confirmed: isAdmin });
            }}
          />
        )}
        {tab === "scan" && ready && (
          <BoxCard
            key={ready.raw}
            product={productById.get(ready.productId)}
            weightLb={ready.box.weightLb}
            lot={ready.lot}
            qty={ready.qty}
            qtyIsWeight={ready.qtyIsWeight}
            serial={ready.box.serial}
            confirmed={ready.confirmed}
            addLabel="Add to freezer"
            onCancel={() => {
              setReady(null);
              setShown({ ok: false, title: "Not added", detail: "Scan the next box." });
            }}
            onAdd={(v) => {
              const r = ready;
              setReady(null);
              void fromLabel(r, v);
            }}
          />
        )}
        {tab === "scan" && <FreezerScanner mode={mode} setMode={setMode} paused={!!ready || !!unknown} onRead={(t) => handle(t)} />}
        {tab === "type" && <TypeIn products={products} disabled={!reasonOk} onSave={(v) => save(v)} />}
      </div>

      <section className="panel mt-4">
        <h3>Added this time ({thisTime.length})</h3>
        {thisTime.length ? (
          <table className="simple">
            <tbody>
              {thisTime.map((b) => {
                const p = productById.get(b.product_id);
                return (
                  <tr key={b.client_id}>
                    <td>
                      {p?.name ?? b.product_id}
                      {!b.product_confirmed && <span className="small muted block">Product not confirmed</span>}
                    </td>
                    <td className="num">
                      {b.qty} {countWord(p)}
                    </td>
                    <td className="num">{b.weight_lb ? `${b.weight_lb} lb` : ""}</td>
                    <td className="small muted">{isLocalBox(b) ? "Waiting to upload" : "Saved"}</td>
                    <td>
                      <button
                        type="button"
                        className="copy min-h-[44px]"
                        onClick={() => {
                          if (!window.confirm(`Take ${p?.name ?? "this box"} back out? It was added by mistake.`)) return;
                          void enqueue({ type: "freezer-remove", client_id: b.client_id! });
                          setAdded((a) => a.filter((x) => x !== b.client_id));
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty">Nothing added yet.</div>
        )}
        <p className="small muted mb-0">
          Dated {niceDate(date)}. Each box is saved on this phone first and uploads when there&apos;s signal.
        </p>
      </section>
    </>
  );
}

/** Typing a box in: product, how many (in its unit), weight, pack date, lot if known. */
function TypeIn({
  products,
  disabled,
  onSave,
}: {
  products: ReturnType<typeof freezerProducts>;
  disabled: boolean;
  onSave: (v: Omit<FreezerAdd, "client_id" | "reason" | "note" | "added_on" | "week_id" | "counts_as_income" | "at">) => Promise<boolean>;
}) {
  const [pid, setPid] = useState("");
  const [qty, setQty] = useState("1");
  const [weight, setWeight] = useState("");
  const [packDate, setPackDate] = useState("");
  const [lot, setLot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const p = products.find((x) => x.id === pid);
  const byWeight = p?.unit === "lb";
  return (
    <form
      className="panel mt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const w = num(weight) > 0 ? num(weight) : null;
        const q = byWeight ? (w ?? num(qty)) : num(qty);
        if (!pid) return setError("Choose a product.");
        if (!(q > 0)) return setError(`Enter how many ${countWord(p)}.`);
        if (lot.trim() && !LOT_PATTERN.test(lot.trim())) return setError("A lot is 6 digits.");
        setError(null);
        const ok = await onSave({
          product_id: pid,
          qty: q,
          weight_lb: w,
          gtin: null,
          serial: null,
          serial_date: null,
          case_no: null,
          pack_date: packDate || null,
          lot: lot.trim() || null,
          raw_scan: null,
          product_confirmed: true,
          source: "manual",
        });
        if (ok) {
          setWeight("");
          setLot("");
        }
      }}
    >
      <label className="lbl" htmlFor="ti-product">
        Product
      </label>
      <ProductSelect id="ti-product" products={products} value={pid} onChange={setPid} />
      {!byWeight && (
        <>
          <label className="lbl" htmlFor="ti-qty">
            How many {countWord(p) || "pieces"}
          </label>
          <Stepper id="ti-qty" value={qty} onChange={setQty} />
        </>
      )}
      <label className="lbl" htmlFor="ti-weight">
        Weight (lb){byWeight ? "" : ", if known"}
      </label>
      <input id="ti-weight" className="field" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ""))} />
      <label className="lbl" htmlFor="ti-pack">
        Pack date, if known
      </label>
      <input id="ti-pack" type="date" className="field" value={packDate} onChange={(e) => setPackDate(e.target.value)} />
      <label className="lbl" htmlFor="ti-lot">
        Lot, if known
      </label>
      <input id="ti-lot" className="field" inputMode="numeric" maxLength={6} value={lot} onChange={(e) => setLot(e.target.value.replace(/\D/g, ""))} />
      {error && <p className="note bad mt-2">{error}</p>}
      <div className="mt-3 flex justify-end">
        <button type="submit" className="btn" disabled={disabled}>
          Add to freezer
        </button>
      </div>
    </form>
  );
}
