"use client";

// Freezer (SPEC 5.8), ported from the prototype's renderFreezer: what's on
// hand, what pending half and whole orders are counting on, and what's free.

import { useCan } from "@/components/CurrentUser";
import ViewOnly from "@/components/ViewOnly";
import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { halfWholeNeeds } from "@/lib/calc/halfWhole";
import { fmt, num } from "@/lib/calc/num";
import { countUnit } from "@/lib/calc/units";
import { niceDate } from "@/lib/dates";
import { addFreezerEntry, loadHalfWhole, removeFreezerEntry, type FreezerRow } from "@/lib/db/halfwhole";
import type { CatalogPart, CatalogProduct } from "@/lib/db/types";

const RECENT = 40;

export default function FreezerScreen() {
  const { catalog, error: loadError } = useStaffData();
  const toast = useToast();
  const db = getDb();
  const load = useCallback((d: SupabaseClient) => loadHalfWhole(d), []);
  const { data, error, refresh } = useLive("freezer", load, ["freezer_log", "half_whole_orders"]);
  const [adding, setAdding] = useState(false);
  const close = useCallback(() => setAdding(false), []);
  const canChange = useCan("freezer").change;

  if (loadError || error) return <p className="note bad">Couldn&apos;t load the freezer: {loadError || error}</p>;
  if (!catalog || !data) return <div className="empty">Loading...</div>;

  const { onHand, need } = halfWholeNeeds(data.freezer, data.orders, catalog.parts, catalog.products);
  // Fresh-only products are never filled from the freezer, so they aren't listed.
  const products = catalog.products.filter((p) => !p.fresh_only && (p.active || (onHand[p.id] ?? 0) !== 0));
  const recent = data.freezer.slice(0, RECENT);
  const nameOf = (id: string) => catalog.productById.get(id)?.name ?? id;

  async function remove(e: FreezerRow) {
    const err = await removeFreezerEntry(db, e.id);
    refresh();
    if (err) return toast("Couldn't remove it. Check the internet connection.");
    toast("Entry removed", async () => {
      await addFreezerEntry(db, { id: e.id, product_id: e.product_id, qty: e.qty, note: e.note, entry_date: e.entry_date });
      refresh();
    });
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto">Freezer</h2>
        {canChange && (
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            Add or take out
          </button>
        )}
      </div>
      {!canChange && <ViewOnly what="the freezer" />}

      <div className="grid2">
        <section className="panel">
          <table className="simple">
            <thead>
              <tr>
                <th>Cut</th>
                <th className="num">On hand</th>
                <th className="num">Held for orders</th>
                <th className="num">Free</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const oh = onHand[p.id] ?? 0;
                const held = need[p.id] ?? 0;
                const free = oh - held;
                return (
                  <tr key={p.id}>
                    <td>
                      {p.name} <span className="small muted">{countUnit(p, catalog.parts)}</span>
                    </td>
                    <td className="num">
                      <b>{fmt(oh)}</b>
                    </td>
                    <td className="num">{held ? fmt(held) : ""}</td>
                    <td className={`num ${free < 0 ? "negative" : ""}`}>{fmt(free)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted">
            Held means pending half and whole orders are counting on it. When an order is marked filled, what the freezer
            had comes off the on-hand count; the rest was cut fresh.
          </p>
        </section>

        <section className="panel">
          <h3>Recent changes</h3>
          {recent.length ? (
            <table className="simple">
              <tbody>
                {recent.map((e) => (
                  <tr key={e.id}>
                    <td className="small whitespace-nowrap">{niceDate(e.entry_date)}</td>
                    <td>{nameOf(e.product_id)}</td>
                    <td className={`num ${e.qty < 0 ? "negative" : ""}`}>
                      {e.qty > 0 ? "+" : ""}
                      {fmt(e.qty)}
                    </td>
                    <td className="small muted">{e.note}</td>
                    <td>
                      {!canChange ? null : e.half_whole_order_id ? (
                        <span className="small muted" title="Change the order on Half and whole to put these back">
                          Order
                        </span>
                      ) : (
                        <button type="button" className="copy min-h-[44px]" aria-label={`Remove ${nameOf(e.product_id)} entry`} onClick={() => void remove(e)}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty">Nothing logged yet.</div>
          )}
        </section>
      </div>

      {adding && (
        <FreezerChange
          products={products}
          parts={catalog.parts}
          onClose={close}
          onSave={async (entry) => {
            const err = await addFreezerEntry(db, entry);
            refresh();
            if (err) return toast("Couldn't save. Check the internet connection.");
            close();
            toast("Freezer updated");
          }}
        />
      )}
    </>
  );
}

function FreezerChange({
  products,
  parts,
  onClose,
  onSave,
}: {
  products: CatalogProduct[];
  parts: CatalogPart[];
  onClose: () => void;
  onSave: (e: { product_id: string; qty: number; note: string }) => Promise<void>;
}) {
  const [dir, setDir] = useState<1 | -1>(1);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = Math.max(0, num(qty));
  const chosen = products.find((p) => p.id === productId);

  return (
    <Sheet title="Freezer change" onClose={onClose}>
      <div className="sizes" role="group" aria-label="Put in or take out">
        <button type="button" aria-pressed={dir === 1} onClick={() => setDir(1)}>
          Put in
        </button>
        <button type="button" aria-pressed={dir === -1} onClick={() => setDir(-1)}>
          Take out
        </button>
      </div>
      <label className="lbl" htmlFor="fz-cut">
        Cut
      </label>
      <select id="fz-cut" className="field" value={productId} onChange={(e) => setProductId(e.target.value)}>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <label className="lbl" htmlFor="fz-qty">
        How many{" "}
        {chosen && countUnit(chosen, parts) !== chosen.unit && (
          <span className="font-normal">{countUnit(chosen, parts)}</span>
        )}
      </label>
      <div className="stepper">
        <button type="button" aria-label="One less" onClick={() => setQty(fmt(Math.max(0, value - 1)))}>
          &minus;
        </button>
        <input
          id="fz-qty"
          inputMode="decimal"
          value={qty}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ""))}
        />
        <button type="button" aria-label="One more" onClick={() => setQty(fmt(value + 1))}>
          +
        </button>
      </div>
      <label className="lbl" htmlFor="fz-note">
        Note
      </label>
      <input
        id="fz-note"
        className="field"
        placeholder="Extra from this week, damaged, count correction"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && <p className="note bad mt-3">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            if (!value) return setError("Enter how many.");
            if (!productId) return setError("Choose a cut.");
            setBusy(true);
            await onSave({ product_id: productId, qty: value * dir, note: note.trim() });
            setBusy(false);
          }}
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}
