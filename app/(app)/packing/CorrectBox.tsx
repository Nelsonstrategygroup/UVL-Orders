"use client";

// Change a mislabeled box's product, with the reason (Lucas, 11/18/26). The
// label's product, GTIN and serial are kept. Needs signal, because the
// invoice follows straight away.

import { useState } from "react";
import { getDb } from "@/components/data/StaffData";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { fmt } from "@/lib/calc/num";
import { correctBoxProduct, type PackingData, type PackWeight } from "@/lib/db/packing";
import { formatWhen } from "@/lib/format";

/** "Label says Front Shanks", or who changed it and why. Null when there's nothing to say. */
export function BoxLabelNote({ w, data }: { w: PackWeight; data: PackingData }) {
  const label = w.label_product_id ? (data.products.get(w.label_product_id)?.name ?? w.label_product_id) : null;
  if (w.correction_reason)
    return (
      <span className="small muted block">
        Label says {label ?? "another product"}. Changed by {w.corrected_by_name ?? "someone"}
        {w.corrected_at ? `, ${formatWhen(w.corrected_at)}` : ""}: {w.correction_reason}
      </span>
    );
  return label ? <span className="small muted block">Label says {label}</span> : null;
}

export default function CorrectBoxSheet({
  w,
  data,
  onClose,
  onSaved,
}: {
  w: PackWeight;
  data: PackingData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [productId, setProductId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const name = (id: string) => data.products.get(id)?.name ?? id;
  const label = w.label_product_id ?? w.product_id;
  const choices = [...data.products.values()].filter((p) => p.active && p.id !== w.product_id).sort((a, b) => a.sort - b.sort);

  const save = async () => {
    setBusy(true);
    const err = await correctBoxProduct(getDb(), w.id, productId, reason);
    setBusy(false);
    if (err) return toast(`Couldn't change it: ${err}`);
    toast(`Changed to ${name(productId)}`);
    onSaved();
    onClose();
  };

  return (
    <Sheet title={`Change product: ${fmt(w.weight)} lb box`} onClose={onClose}>
      <p className="mt-0">
        Now <b>{name(w.product_id)}</b>.{label !== w.product_id ? ` The label says ${name(label)}.` : ""}
        {w.serial ? <span className="small muted"> Box {w.serial}.</span> : null}
      </p>
      <p className="small muted mt-0">
        For a box with the wrong label. The invoice, inventory and lot trace follow the new product. The label&apos;s product
        and barcode are kept.
      </p>
      <label className="lbl" htmlFor="cb-product">
        What this box really is
      </label>
      <select id="cb-product" className="field" value={productId} onChange={(e) => setProductId(e.target.value)}>
        <option value="">Pick a product</option>
        {choices.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.id === label ? " (what the label says)" : ""}
          </option>
        ))}
      </select>
      <label className="lbl" htmlFor="cb-reason">
        Why
      </label>
      <input id="cb-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Label says Trim 5 lb, box is Le Trim" />
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn" disabled={busy || !productId || !reason.trim()} onClick={() => void save()}>
          Change product
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}
