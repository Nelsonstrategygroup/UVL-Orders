"use client";

// Small pieces shared by Add to freezer and the freezer counts.

import { useState } from "react";
import { num } from "@/lib/calc/num";
import { unitWord } from "@/lib/calc/units";
import { LOT_PATTERN } from "@/lib/scan/flow";
import type { FreezerProduct } from "@/lib/db/freezer";

/** "pieces", "packs", "lb": what a product is counted in. */
export function countWord(p: Pick<FreezerProduct, "unit"> | undefined): string {
  if (!p) return "";
  if (p.unit === "each") return "pieces";
  return unitWord(p.unit);
}

/** Products that can be in the freezer: active and not fresh only (plus any already there). */
export function freezerProducts(all: FreezerProduct[], keep: Set<string> = new Set()): FreezerProduct[] {
  return all.filter((p) => (p.active && !p.fresh_only) || keep.has(p.id));
}

export function ProductSelect({
  id,
  products,
  value,
  onChange,
}: {
  id: string;
  products: FreezerProduct[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a product</option>
      {products.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

/** A big minus / number / plus. */
export function Stepper({ id, value, onChange, step = 1 }: { id: string; value: string; onChange: (v: string) => void; step?: number }) {
  const n = Math.max(0, num(value));
  return (
    <div className="stepper">
      <button type="button" aria-label="One less" onClick={() => onChange(String(Math.max(0, Math.round((n - step) * 100) / 100)))}>
        &minus;
      </button>
      <input
        id={id}
        inputMode="decimal"
        value={value}
        onFocus={(e) => e.target.select()}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
      />
      <button type="button" aria-label="One more" onClick={() => onChange(String(Math.round((n + step) * 100) / 100))}>
        +
      </button>
    </div>
  );
}

/**
 * A label the app doesn't know (no alert, 11/20/26). An admin says which
 * product it is and the app learns it. Anyone else picks the product for
 * this box only; it's saved as not confirmed for an admin to check.
 */
export function UnknownLabel({
  products,
  isAdmin,
  onPick,
  onSkip,
}: {
  products: FreezerProduct[];
  isAdmin: boolean;
  onPick: (productId: string) => void;
  onSkip: () => void;
}) {
  const [pid, setPid] = useState("");
  return (
    <div className="scanq" role="dialog" aria-label="A label the app doesn't know">
      <b className="block text-lg">This product isn&apos;t known.</b>
      <p className="mt-1 mb-2">Check the label belongs on this box. Scan it again, or choose the product.</p>
      <label className="lbl" htmlFor="unk-product">
        What product is it?
      </label>
      <ProductSelect id="unk-product" products={products} value={pid} onChange={setPid} />
      <p className="small muted mt-2 mb-0">
        {isAdmin
          ? "The app will know this label from now on."
          : "This box is saved with your choice. An admin checks the product later."}
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn ghost" onClick={onSkip}>
          Skip this box
        </button>
        <button type="button" className="btn" disabled={!pid} onClick={() => onPick(pid)}>
          Use this product
        </button>
      </div>
    </div>
  );
}

/** The count (and lot, and weight if the label has none) for one scanned box. */
export function BoxCard({
  product,
  weightLb,
  lot,
  qty,
  qtyIsWeight,
  serial,
  confirmed,
  addLabel,
  onAdd,
  onCancel,
}: {
  product: FreezerProduct | undefined;
  weightLb: number | null;
  lot: string | null;
  qty: number;
  qtyIsWeight: boolean;
  serial: string | null;
  confirmed: boolean;
  addLabel: string;
  onAdd: (v: { qty: number; weightLb: number | null; lot: string | null }) => void;
  onCancel: () => void;
}) {
  const [count, setCount] = useState(String(qty || ""));
  const [weight, setWeight] = useState(weightLb ? String(weightLb) : "");
  const [lotText, setLotText] = useState(lot ?? "");
  const w = num(weight) > 0 ? num(weight) : null;
  const q = qtyIsWeight ? (w ?? 0) : num(count);
  const lotOk = !lotText.trim() || LOT_PATTERN.test(lotText.trim());
  return (
    <form
      className="scanq"
      aria-label="This box"
      onSubmit={(e) => {
        e.preventDefault();
        if (q > 0 && lotOk) onAdd({ qty: q, weightLb: w, lot: lotText.trim() || null });
      }}
    >
      <b className="block text-lg">{product?.name ?? "Product"}</b>
      <p className="small mt-1 mb-2">
        {weightLb ? `${weightLb} lb` : "No weight on the label"}
        {serial ? ` · Serial ${serial}` : ""}
        {!confirmed && " · Product not confirmed yet"}
      </p>
      {!qtyIsWeight && (
        <>
          <label className="lbl" htmlFor="box-count">
            How many {countWord(product)} in this box?
          </label>
          <Stepper id="box-count" value={count} onChange={setCount} />
        </>
      )}
      {!weightLb && (
        <>
          <label className="lbl" htmlFor="box-weight">
            Weight (lb)
          </label>
          <input id="box-weight" className="field" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ""))} />
        </>
      )}
      {!lot && (
        <>
          <label className="lbl" htmlFor="box-lot">
            Lot, if you can read it
          </label>
          <input
            id="box-lot"
            className="field"
            inputMode="numeric"
            maxLength={6}
            placeholder="6 digits"
            value={lotText}
            onChange={(e) => setLotText(e.target.value.replace(/\D/g, ""))}
          />
          {!lotOk && <p className="note bad mt-1">A lot is 6 digits.</p>}
        </>
      )}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Don&apos;t add
        </button>
        <button type="submit" className="btn" disabled={!(q > 0) || !lotOk}>
          {addLabel}
        </button>
      </div>
    </form>
  );
}
