"use client";

// Setup > Invoicing: freight charged to a location (Lucas, 11/16/26). Off for
// everyone unless set here: per pallet, per delivery, per box or per lb, from
// a date on. A chain's setting covers its stores; a store's own overrides
// it. When set, the invoice gets its own Freight line, and the Weekly P&L
// counts it as freight income (taken off Delivery as net delivery cost).

import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useToast } from "@/components/Toast";
import { displayName, sortByDisplayName } from "@/lib/calc/customers";
import { FREIGHT_LABEL, type FreightChargeRow, type FreightMethod } from "@/lib/calc/invoice";
import { parsePrice } from "@/lib/calc/prices";
import { niceDate, todayISO } from "@/lib/dates";
import { deleteFreight, loadFreight, setFreight } from "@/lib/db/invoicing";

const dateText = (d: string) => `${niceDate(d)}, ${d.slice(0, 4)}`;
const UNIT: Record<FreightMethod, string> = { none: "", per_pallet: "a pallet", per_delivery: "a delivery", per_box: "a box", per_lb: "a lb" };
const words = (r: FreightChargeRow) =>
  r.method === "none" ? "No freight" : `$${Number(r.amount).toFixed(r.method === "per_lb" ? 4 : 2).replace(/0{1,2}$/, "")} ${UNIT[r.method]}`;

export default function FreightSetup({ canEdit }: { canEdit: boolean }) {
  const db = getDb();
  const toast = useToast();
  const { customers } = useStaffData();
  const load = useCallback((d: SupabaseClient) => loadFreight(d), []);
  const { data, refresh } = useLive("freight-charges", load, ["freight_charges"]);
  const [who, setWho] = useState("");
  const [method, setMethod] = useState<FreightMethod>("per_pallet");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(todayISO());
  const [note, setNote] = useState("");
  if (!data || !customers) return null;

  const chainIds = new Set(customers.list.map((c) => c.parent_customer_id).filter(Boolean) as string[]);
  const choices = sortByDisplayName(
    customers.list.filter((c) => c.active),
    customers.byId,
  ).map((c) => ({ id: c.id, label: chainIds.has(c.id) ? `${c.name} (all its stores)` : displayName(c, customers.byId) }));
  const nameOf = (id: string) => {
    const c = customers.byId.get(id);
    return c ? (chainIds.has(id) ? `${c.name} (all its stores)` : displayName(c, customers.byId)) : "A customer no longer listed";
  };
  const set = [...new Set(data.map((r) => r.customer_id))].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  const save = async () => {
    if (!who) return toast("Pick the location or chain");
    const v = method === "none" ? "0" : parsePrice(amount);
    if (v == null) return toast("Type the amount like 25.00");
    const err = await setFreight(db, { customerId: who, method, amount: v, from, note });
    toast(err ? `Couldn't save: ${err}` : `Saved: ${nameOf(who)}, ${method === "none" ? "no freight" : `${FREIGHT_LABEL[method].toLowerCase()}`} from ${niceDate(from)}`);
    if (!err) {
      setAmount("");
      setNote("");
    }
    refresh();
  };

  return (
    <section className="panel mt-3" aria-labelledby="freight-setup">
      <h3 id="freight-setup">Freight on invoices</h3>
      <p className="small muted mt-1">
        Off for every location unless set here. When set, the invoice gets its own Freight line: pallets carrying the
        location&apos;s boxes, a delivery, its boxes, or their weight, × the rate on the invoice date. A chain&apos;s setting
        covers its stores. The Weekly P&amp;L counts it as freight income.
      </p>
      {set.length === 0 ? (
        <p className="small m-0">No location has freight set.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {set.map((id) => (
            <li key={id} className="border-t border-line py-1.5">
              <b>{nameOf(id)}</b>
              <ul className="small m-0 list-none p-0">
                {data
                  .filter((r) => r.customer_id === id)
                  .map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-3">
                      <span className="num">{words(r)}</span>
                      <span className="muted">from {dateText(r.effective_from)}</span>
                      {r.note && <span className="muted">{r.note}</span>}
                      {canEdit && (
                        <button
                          type="button"
                          className="copy min-h-[44px] px-2"
                          onClick={() => {
                            if (!confirm(`Delete ${nameOf(id)}'s freight starting ${dateText(r.effective_from)}?`)) return;
                            void deleteFreight(db, r.id).then((err) => {
                              toast(err ? `Couldn't delete it: ${err}` : "Deleted");
                              refresh();
                            });
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form
          className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="grid min-w-[14rem] flex-1 gap-1">
            <span className="lbl m-0">Location or chain</span>
            <select className="field" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Pick one</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="lbl m-0">Freight</span>
            <select className="field" value={method} onChange={(e) => setMethod(e.target.value as FreightMethod)}>
              {(Object.keys(FREIGHT_LABEL) as FreightMethod[]).map((m) => (
                <option key={m} value={m}>
                  {FREIGHT_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          {method !== "none" && (
            <label className="grid gap-1">
              <span className="lbl m-0">$ {UNIT[method]}</span>
              <input className="field num w-24!" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
          )}
          <label className="grid gap-1">
            <span className="lbl m-0">Starts on</span>
            <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="grid min-w-[8rem] flex-1 gap-1">
            <span className="lbl m-0">Note (optional)</span>
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="submit" className="btn ghost" disabled={!who || (method !== "none" && !amount.trim())}>
            Save
          </button>
        </form>
      )}
      <p className="small muted m-0 mt-1">To stop a location&apos;s freight, save &quot;No freight&quot; from a date.</p>
    </section>
  );
}
