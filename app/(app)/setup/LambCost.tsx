"use client";

// Setup > Lamb cost (SPEC 16, stage 1): producers, the base rate and live
// weight factor from a date on, and a producer's own rate from a date on.
// Admins only. Nothing is worked out here yet: the weigh sheet (stage 2)
// uses these. A change applies from its date on; past weeks never change.

import { useCallback, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useToast } from "@/components/Toast";
import {
  factorText,
  newestFirst,
  parseFactor,
  parseRate,
  producerRateFor,
  rateText,
  settingFor,
  type Producer,
} from "@/lib/calc/lambCost";
import { niceDate, todayISO } from "@/lib/dates";
import {
  addLambCostSetting,
  addProducerRate,
  deleteLambCostSetting,
  deleteProducerRate,
  loadLambCostSetup,
  saveProducer,
  type LambCostSetup,
} from "@/lib/db/lambCost";

/** "Oct 19, 2026" */
const dateText = (d: string) => `${niceDate(d)}, ${d.slice(0, 4)}`;

export default function LambCost() {
  const load = useCallback((d: SupabaseClient) => loadLambCostSetup(d), []);
  const { data, refresh, error } = useLive("lamb-cost-setup", load, ["producers", "lamb_cost_settings", "producer_rates"]);
  const toast = useToast();

  if (error) return <p className="note bad">Couldn&apos;t load Lamb cost: {error}</p>;
  if (!data) return <p className="small muted">Loading...</p>;

  /** Show the result, reload, and say whether it worked. */
  const after = (err: string | null, ok: string) => {
    toast(err ? `Couldn't save: ${err}` : ok);
    refresh();
    return !err;
  };

  return (
    <>
      <p className="small muted mt-0">
        What UVL pays producers for lambs. Only admins can see this. The weigh sheet uses these to work out pay. A change
        applies from its start date on, so past weeks keep what they were paid.
      </p>
      <Pricing data={data} after={after} />
      <Producers data={data} after={after} />
      <ProducerRates data={data} after={after} />
    </>
  );
}

type After = (err: string | null, ok: string) => boolean;

// ----- Pricing settings -----

function Pricing({ data, after }: { data: LambCostSetup; after: After }) {
  const db = getDb();
  const toast = useToast();
  const today = todayISO();
  const first = data.settings.length === 0;
  const [from, setFrom] = useState(today);
  // With no setting yet, start from the numbers in use today (SPEC 16.2).
  const [rate, setRate] = useState(first ? "3.00" : "");
  const [factor, setFactor] = useState(first ? "2.02" : "");
  const [note, setNote] = useState("");
  const now = settingFor(data.settings, today);
  const later = data.settings.filter((s) => s.effective_from > today);

  const add = async () => {
    const r = parseRate(rate);
    const f = parseFactor(factor);
    if (r == null) return toast("Type the rate like 3.00");
    if (f == null) return toast("Type the factor like 2.02");
    if (!from) return toast("Pick the date it starts");
    const ok = after(
      await addLambCostSetting(db, { from, baseRate: r, liveFactor: f, note }),
      `Saved: ${rateText(r)} per lb live, factor ${factorText(f)}, from ${niceDate(from)}`,
    );
    if (ok) {
      setRate("");
      setFactor("");
      setNote("");
    }
  };
  const remove = async (id: string, label: string) => {
    if (!confirm(`Delete the setting starting ${label}?`)) return;
    after(await deleteLambCostSetting(db, id), "Deleted");
  };

  return (
    <section className="panel" aria-labelledby="lc-pricing">
      <h3 id="lc-pricing">Pricing</h3>
      <p className="small muted mt-1">
        Carcass lb &times; live weight factor = live lb. Live lb &times; rate = pay.
      </p>
      {now ? (
        <p className="mt-2 mb-1">
          Today: <b className="num">{rateText(now.base_rate)}</b> per lb live, live weight factor{" "}
          <b className="num">{factorText(now.live_factor)}</b>
          <span className="small muted"> · since {dateText(now.effective_from)}</span>
        </p>
      ) : (
        <p className="note mt-2">No rate is set for today yet. Add one below.</p>
      )}
      {later.map((s) => (
        <p key={s.id} className="small m-0">
          From {dateText(s.effective_from)}: {rateText(s.base_rate)} per lb live, factor {factorText(s.live_factor)}
        </p>
      ))}

      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <label className="grid gap-1">
          <span className="lbl m-0">Starts on</span>
          <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">Rate ($ per lb live)</span>
          <input className="field num w-28!" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <label className="grid gap-1">
          <span className="lbl m-0">Live weight factor</span>
          <input className="field num w-28!" inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value)} />
        </label>
        <label className="grid min-w-[10rem] flex-1 gap-1">
          <span className="lbl m-0">Note (optional)</span>
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="submit" className="btn" disabled={!rate.trim() || !factor.trim()}>
          Add
        </button>
      </form>

      {data.settings.length > 0 && (
        <details className="mt-3">
          <summary className="copy">All settings ({data.settings.length})</summary>
          <table className="simple mt-1">
            <thead>
              <tr>
                <th>Starts on</th>
                <th>Rate</th>
                <th>Factor</th>
                <th>Note</th>
                <th>
                  <span className="sr-only">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {newestFirst(data.settings).map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap">{dateText(s.effective_from)}</td>
                  <td className="num">{rateText(s.base_rate)}</td>
                  <td className="num">{factorText(s.live_factor)}</td>
                  <td className="small">{s.note}</td>
                  <td className="text-right">
                    <button type="button" className="copy min-h-[44px] px-2" onClick={() => void remove(s.id, dateText(s.effective_from))}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

// ----- Producers -----

function Producers({ data, after }: { data: LambCostSetup; after: After }) {
  const [editing, setEditing] = useState<Producer | "new" | null>(null);
  const on = data.producers.filter((p) => p.active);
  const off = data.producers.filter((p) => !p.active);

  const row = (p: Producer) =>
    editing !== "new" && editing?.id === p.id ? (
      <li key={p.id} className="border-t border-line py-2">
        <ProducerForm producer={p} after={after} onDone={() => setEditing(null)} />
      </li>
    ) : (
      <li key={p.id} className="flex flex-wrap items-center gap-x-3 border-t border-line py-1.5">
        <span className="min-w-0 flex-1">
          <b>{p.name}</b>
          {p.ranch_name && <span className="muted"> · {p.ranch_name}</span>}
          {!p.active && <span className="tag ml-1">Off</span>}
          {p.contact && <span className="small muted block whitespace-pre-line">{p.contact}</span>}
        </span>
        <button type="button" className="btn ghost" onClick={() => setEditing(p)}>
          Change
        </button>
      </li>
    );

  return (
    <section className="panel mt-3" aria-labelledby="lc-producers">
      <h3 id="lc-producers">Producers</h3>
      {data.producers.length === 0 && <p className="small muted mt-1">No producers yet.</p>}
      <ul className="m-0 mt-1 list-none p-0">{on.map(row)}</ul>
      {off.length > 0 && (
        <details className="mt-2">
          <summary className="copy">Turned off ({off.length})</summary>
          <ul className="m-0 list-none p-0">{off.map(row)}</ul>
        </details>
      )}
      {editing === "new" ? (
        <div className="mt-2 border-t border-line pt-2">
          <ProducerForm producer={null} after={after} onDone={() => setEditing(null)} />
        </div>
      ) : (
        <button type="button" className="btn mt-2" onClick={() => setEditing("new")}>
          Add a producer
        </button>
      )}
    </section>
  );
}

function ProducerForm({ producer, after, onDone }: { producer: Producer | null; after: After; onDone: () => void }) {
  const db = getDb();
  const toast = useToast();
  const [name, setName] = useState(producer?.name ?? "");
  const [ranch, setRanch] = useState(producer?.ranch_name ?? "");
  const [contact, setContact] = useState(producer?.contact ?? "");
  const [active, setActive] = useState(producer?.active ?? true);
  const [busy, setBusy] = useState(false);
  const id = producer?.id ?? "new";

  const save = async () => {
    if (!name.trim()) return toast("Type the producer's name");
    setBusy(true);
    const ok = after(
      await saveProducer(db, { id: producer?.id, name, ranch_name: ranch, contact, active }),
      producer ? "Saved" : `Added ${name.trim()}`,
    );
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap gap-3">
        <label className="grid min-w-[12rem] flex-1 gap-1">
          <span className="lbl m-0">Name</span>
          <input id={`pr-name-${id}`} className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="grid min-w-[12rem] flex-1 gap-1">
          <span className="lbl m-0">Ranch name (optional)</span>
          <input className="field" value={ranch} onChange={(e) => setRanch(e.target.value)} />
        </label>
      </div>
      <label className="grid gap-1">
        <span className="lbl m-0">Contact (optional): phone, email, address</span>
        <textarea className="field" rows={2} value={contact} onChange={(e) => setContact(e.target.value)} />
      </label>
      {producer && (
        <label className="flex min-h-[44px] items-center gap-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>On (shows on the weigh sheet)</span>
        </label>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn" disabled={busy}>
          {producer ? "Save" : "Add"}
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ----- Producer rates -----

function ProducerRates({ data, after }: { data: LambCostSetup; after: After }) {
  const db = getDb();
  const toast = useToast();
  const today = todayISO();
  const [producerId, setProducerId] = useState("");
  const [from, setFrom] = useState(today);
  const [rate, setRate] = useState("");
  const [note, setNote] = useState("");
  const nameOf = (id: string) => data.producers.find((p) => p.id === id)?.name ?? "Unknown producer";
  const withRates = data.producers.filter((p) => data.rates.some((r) => r.producer_id === p.id));

  const add = async () => {
    const r = parseRate(rate);
    if (!producerId) return toast("Pick a producer");
    if (r == null) return toast("Type the rate like 3.25");
    if (!from) return toast("Pick the date it starts");
    const ok = after(
      await addProducerRate(db, { producerId, from, rate: r, note }),
      `Saved: ${nameOf(producerId)} ${rateText(r)} per lb live from ${niceDate(from)}`,
    );
    if (ok) {
      setRate("");
      setNote("");
    }
  };
  const remove = async (id: string, label: string) => {
    if (!confirm(`Delete ${label}?`)) return;
    after(await deleteProducerRate(db, id), "Deleted");
  };

  return (
    <section className="panel mt-3" aria-labelledby="lc-rates">
      <h3 id="lc-rates">A producer&apos;s own rate</h3>
      <p className="small muted mt-1">
        Only if a producer is paid a different rate per lb live. Their lambs use it instead of the base rate, from its start
        date on. The live weight factor stays the same.
      </p>
      {withRates.length === 0 ? (
        <p className="small m-0">No producer has their own rate.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {withRates.map((p) => {
            const current = producerRateFor(data.rates, p.id, today);
            return (
              <li key={p.id} className="border-t border-line py-1.5">
                <b>{p.name}</b>
                <span className="small muted">
                  {" "}
                  · {current ? `today ${rateText(current.rate)} per lb live` : "no rate of their own today"}
                </span>
                <ul className="small m-0 list-none p-0">
                  {newestFirst(data.rates.filter((r) => r.producer_id === p.id)).map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-3">
                      <span className="num">{rateText(r.rate)}</span>
                      <span className="muted">from {dateText(r.effective_from)}</span>
                      {r.note && <span className="muted">{r.note}</span>}
                      <button
                        type="button"
                        className="copy min-h-[44px] px-2"
                        onClick={() => void remove(r.id, `${p.name}'s ${rateText(r.rate)} rate from ${dateText(r.effective_from)}`)}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      {data.producers.some((p) => p.active) ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="grid gap-1">
            <span className="lbl m-0">Producer</span>
            <select className="field" value={producerId} onChange={(e) => setProducerId(e.target.value)}>
              <option value="">Pick a producer</option>
              {data.producers
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="lbl m-0">Starts on</span>
            <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="lbl m-0">Rate ($ per lb live)</span>
            <input className="field num w-28!" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </label>
          <label className="grid min-w-[10rem] flex-1 gap-1">
            <span className="lbl m-0">Note (optional)</span>
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="submit" className="btn ghost" disabled={!producerId || !rate.trim()}>
            Add
          </button>
        </form>
      ) : (
        <p className="small muted mt-2 mb-0">Add a producer first.</p>
      )}
    </section>
  );
}
