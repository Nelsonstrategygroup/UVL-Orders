"use client";

// Half and whole lambs (SPEC 5.7), ported from the prototype's renderHW and
// openHW: a list of orders, and a guided form with one choice per slot.

import { useCallback, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import {
  freezerOnHand,
  halfWholeLines,
  halfWholeNeeds,
  slotCount,
  slotOptions,
  slotParts,
} from "@/lib/calc/halfWhole";
import { addInto, fmt } from "@/lib/calc/num";
import type { HalfWholeOrder, Qty } from "@/lib/calc/types";
import { niceDate } from "@/lib/dates";
import { loadHalfWhole, saveHalfWhole, setHalfWholeStatus, type HalfWholeData, type HWOrder } from "@/lib/db/halfwhole";
import type { Catalog } from "@/lib/db/types";

const STATUS: Record<HalfWholeOrder["status"], { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "callback" },
  filled: { label: "Filled", cls: "ordered" },
  cancelled: { label: "Cancelled", cls: "none" },
};

export default function HalfWholeScreen() {
  const { catalog, error: loadError } = useStaffData();
  const toast = useToast();
  const db = getDb();
  const load = useCallback((d: SupabaseClient) => loadHalfWhole(d), []);
  const { data, error, refresh } = useLive("halfwhole", load, ["half_whole_orders", "freezer_log"]);
  const [open, setOpen] = useState<HWOrder | "new" | null>(null);
  const close = useCallback(() => setOpen(null), []);

  if (loadError || error) return <p className="note bad">Couldn&apos;t load half and whole orders: {loadError || error}</p>;
  if (!catalog || !data) return <div className="empty">Loading...</div>;

  const { short } = halfWholeNeeds(data.freezer, data.orders, catalog.parts, catalog.products);
  const shortList = catalog.products.filter((p) => (short[p.id] ?? 0) > 0);
  const rank = { pending: 0, filled: 1, cancelled: 2 } as const;
  const list = [...data.orders].sort(
    (a, b) => rank[a.status] - rank[b.status] || (a.need_by ?? "9999").localeCompare(b.need_by ?? "9999"),
  );
  const nameOf = (id: string) => catalog.productById.get(id)?.name ?? id;

  async function setStatus(o: HWOrder, status: HalfWholeOrder["status"], message: string) {
    const err = await setHalfWholeStatus(db, o.id, status);
    refresh();
    if (err) return toast("Couldn't save. Check the internet connection.");
    toast(message, async () => {
      await setHalfWholeStatus(db, o.id, o.status);
      refresh();
    });
  }

  return (
    <div className="max-w-[860px]">
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h2>Half and whole lambs</h2>
          <span className="muted small">
            Walk the customer through each part. The freezer covers what it can and the rest goes on this week&apos;s order.
          </span>
        </div>
        <button type="button" className="btn" onClick={() => setOpen("new")}>
          New order
        </button>
      </div>

      {shortList.length > 0 && (
        <p className="note small">
          <b>Added to this week&apos;s order:</b>{" "}
          {shortList.map((p) => `${fmt(short[p.id])}${p.unit === "lb" ? " lb" : ""} ${p.name.toLowerCase()}`).join(", ")}. The
          freezer doesn&apos;t have enough for pending orders.
        </p>
      )}

      <div className="grid gap-2.5">
        {list.length ? (
          list.map((o) => {
            const lines = halfWholeLines(o, catalog.parts, catalog.products);
            const st = STATUS[o.status];
            return (
              <div key={o.id} className="hwcard">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-[1.05rem]">{o.customer_name || "Unnamed"}</b>
                  <span className={`st ${st.cls}`}>{st.label}</span>
                  <span className="flex-1" />
                  <span className="small muted">
                    {o.size === "whole" ? "Whole" : "Half"}
                    {o.need_by ? `, needed by ${niceDate(o.need_by)}` : ""}
                  </span>
                </div>
                <span className="small">
                  {Object.entries(lines)
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => `${fmt(v)} ${nameOf(k).toLowerCase()}`)
                    .join(", ")}
                </span>
                {o.notes && <span className="small muted whitespace-pre-wrap">{o.notes}</span>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn ghost" onClick={() => setOpen(o)}>
                    Open
                  </button>
                  {o.status === "pending" && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void setStatus(o, "filled", "Marked filled. Cuts taken out of the freezer.")}
                    >
                      Mark filled
                    </button>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="panel empty">No half or whole lamb orders yet.</div>
        )}
      </div>

      {open && (
        <HWForm
          order={open === "new" ? null : open}
          data={data}
          catalog={catalog}
          onClose={close}
          onSaved={() => {
            close();
            refresh();
            toast("Order saved");
          }}
        />
      )}
    </div>
  );
}

type Draft = {
  customer_name: string;
  phone: string;
  size: "half" | "whole";
  status: HalfWholeOrder["status"];
  need_by: string;
  notes: string;
  /** part id -> chosen product for each slot */
  choices: Record<string, (string | null)[]>;
};

function HWForm({
  order,
  data,
  catalog,
  onClose,
  onSaved,
}: {
  order: HWOrder | null;
  data: HalfWholeData;
  catalog: Catalog;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => {
    const choices: Draft["choices"] = {};
    for (const c of order?.choices ?? []) {
      (choices[c.part_id] ??= [])[c.slot] = c.product_id;
    }
    return {
      customer_name: order?.customer_name ?? "",
      phone: order?.phone ?? "",
      size: order?.size ?? "half",
      status: order?.status ?? "pending",
      need_by: order?.need_by ?? "",
      notes: order?.notes ?? "",
      choices,
    };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const products = catalog.products.filter((p) => p.active);
  const parts = slotParts(catalog.parts);

  // Every slot for the chosen size, keeping earlier choices; new slots start
  // on the first option, as in the prototype.
  const slots = useMemo(() => {
    const out: Record<string, (string | null)[]> = {};
    for (const pt of parts) {
      const opts = slotOptions(pt.id, products);
      const n = slotCount(pt, draft.size);
      const cur = (draft.choices[pt.id] ?? []).slice(0, n);
      while (cur.length < n) cur.push(opts[0]?.id ?? null);
      out[pt.id] = cur;
    }
    return out;
  }, [parts, products, draft.size, draft.choices]);

  // What's free in the freezer for this order: on hand, less other pending orders.
  const onHand = freezerOnHand(data.freezer, data.orders, catalog.parts, catalog.products);
  const otherNeed: Qty = {};
  for (const o of data.orders) {
    if (o.status !== "pending" || o.id === order?.id) continue;
    const l = halfWholeLines(o, catalog.parts, catalog.products);
    for (const k in l) addInto(otherNeed, k, l[k]);
  }
  const usedSoFar: Qty = {};
  const frac = draft.size === "whole" ? 1 : 0.5;
  const trimParts = catalog.parts.filter((p) => !p.balance_check && p.per_lamb > 0);

  async function save() {
    if (!draft.customer_name.trim()) return setError("Add the customer's name.");
    setBusy(true);
    const r = await saveHalfWhole(getDb(), {
      id: order?.id ?? null,
      customer_name: draft.customer_name.trim(),
      phone: draft.phone.trim(),
      size: draft.size,
      status: draft.status,
      need_by: draft.need_by || null,
      notes: draft.notes.trim(),
      choices: Object.entries(slots).flatMap(([part_id, list]) => list.map((product_id, slot) => ({ part_id, slot, product_id }))),
    });
    setBusy(false);
    if (r.error) return setError(`Couldn't save: ${r.error}`);
    onSaved();
  }

  return (
    <Sheet title={order ? "Half or whole order" : "New half or whole order"} onClose={onClose}>
      <div className="flex flex-wrap gap-3">
        <div className="min-w-[200px] flex-[2]">
          <label className="lbl" htmlFor="hw-name">
            Customer
          </label>
          <input
            id="hw-name"
            className="field"
            placeholder="Name"
            autoFocus={!order}
            value={draft.customer_name}
            onChange={(e) => set("customer_name", e.target.value)}
          />
        </div>
        <div className="min-w-[140px] flex-1">
          <label className="lbl" htmlFor="hw-phone">
            Phone
          </label>
          <input id="hw-phone" className="field" inputMode="tel" value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
      </div>

      <p className="lbl">Size</p>
      <div className="sizes" role="group" aria-label="Size">
        <button type="button" aria-pressed={draft.size === "half"} onClick={() => set("size", "half")}>
          Half lamb
        </button>
        <button type="button" aria-pressed={draft.size === "whole"} onClick={() => set("size", "whole")}>
          Whole lamb
        </button>
      </div>

      <div className="coach mt-3">
        {parts.map((pt) => {
          const opts = slotOptions(pt.id, products);
          const list = slots[pt.id];
          if (!list.length) return null;
          return (
            <div key={pt.id} className="part">
              <b>{pt.name}</b>{" "}
              <span className="small muted">
                {list.length} in a {draft.size}
              </span>
              {list.map((v, i) => {
                if (v) usedSoFar[v] = (usedSoFar[v] ?? 0) + 1;
                const free = v ? (onHand[v] ?? 0) - (otherNeed[v] ?? 0) : 0;
                const inFreezer = !!v && free >= (usedSoFar[v] ?? 0);
                return (
                  <div key={i} className="slot">
                    <span>
                      {pt.name} {list.length > 1 ? i + 1 : ""}
                    </span>
                    <select
                      className="field"
                      aria-label={`${pt.name} ${i + 1}`}
                      value={v ?? ""}
                      onChange={(e) => {
                        const next = [...list];
                        next[i] = e.target.value || null;
                        set("choices", { ...slots, [pt.id]: next });
                      }}
                    >
                      {opts.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                    <span className={`avail ${inFreezer ? "ok" : "no"}`}>{inFreezer ? "In freezer" : "Cut fresh"}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {trimParts.map((pt) => {
          const prod = catalog.products.find((p) => p.uses.length === 1 && p.uses[0].part_id === pt.id);
          return (
            <div key={pt.id} className="part small muted">
              Plus about {fmt(pt.per_lamb * frac)} {pt.unit === "lb" ? "lb " : ""}
              {(prod?.name ?? "ground lamb").toLowerCase()} from the {pt.name.toLowerCase()}.
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[150px] flex-1">
          <label className="lbl" htmlFor="hw-need">
            Needed by
          </label>
          <input id="hw-need" type="date" className="field" value={draft.need_by} onChange={(e) => set("need_by", e.target.value)} />
        </div>
        <div className="min-w-[150px] flex-1">
          <label className="lbl" htmlFor="hw-status">
            Status
          </label>
          <select
            id="hw-status"
            className="field"
            value={draft.status}
            onChange={(e) => set("status", e.target.value as HalfWholeOrder["status"])}
          >
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="lbl" htmlFor="hw-notes">
        Notes from the call
      </label>
      <textarea id="hw-notes" className="field" rows={2} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />

      {error && <p className="note bad mt-3">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving..." : "Save order"}
        </button>
      </div>
    </Sheet>
  );
}
