"use client";

// This week (SPEC 5.4): how many lambs to order, whether the carcass
// balances, and how the week is going.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useLive } from "@/components/data/useLive";
import { useWeekData } from "@/components/data/useWeekData";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { displayName, isDone, orderingCustomers } from "@/lib/calc/customers";
import { niceDate, todayISO } from "@/lib/dates";
import { loadDueFollowUps, type DueFollowUp } from "@/lib/db/load";
import { halfWholeNeeds } from "@/lib/calc/halfWhole";
import { packStats } from "@/lib/calc/packing";
import { fmt, num } from "@/lib/calc/num";
import { cutSheetTotals, legBreakdown, legBreakdownText, producerMessage } from "@/lib/calc/summary";
import { calcWeek, type PartRow } from "@/lib/calc/week";
import { formatDateTime } from "@/lib/format";
import { saveWeek, setFollowUpDone } from "@/lib/db/save";
import { loadCutSheet } from "@/lib/db/cutsheet";
import { sheetProblems, sheetStatus, specMapOf } from "@/lib/cutsheetView";
import type { WeekRow } from "@/lib/db/types";

export default function WeekScreen() {
  const { week } = useWeek();
  const { catalog, customers, error: loadError } = useStaffData();
  const { data, error, refresh } = useWeekData(week);
  const toast = useToast();
  const db = getDb();

  if (loadError || error) return <p className="note bad">Couldn&apos;t load this week: {loadError || error}</p>;
  if (!catalog || !customers || !data)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading this week...</div>
      </>
    );

  const w = data.weekRow;
  const { short } = halfWholeNeeds(data.freezer, data.halfWhole, catalog.parts, catalog.products);
  const c = calcWeek({
    parts: catalog.parts,
    products: catalog.products,
    orders: [...data.orders.values()].map((o) => o.lines),
    shortfall: short,
    override: w?.lamb_override ?? null,
  });
  const cs = cutSheetTotals(data.cutSets, catalog.sizes);
  const message = producerMessage({ lambs: c.final, processDate: w?.process_date ?? null, cutSheet: cs });
  const legs = legBreakdownText(legBreakdown(c.withShort, catalog.products));

  const ordering = orderingCustomers(customers.list);
  const answered = ordering.filter((cu) => isDone(data.orders.get(cu.id)?.status)).length;
  const { done: linesPacked, total: linesTotal } = packStats(
    [...data.orders.values()].map((o) => ({ lines: o.lines, packed: data.packed.get(o.id) ?? {} })),
  );
  const shortCount = Object.values(short).reduce((a, b) => a + b, 0);
  const unconfirmed = catalog.parts.filter((p) => !p.confirmed).length;
  const processor = catalog.settings?.processor_name || "Mohawk";

  async function save(patch: Partial<Omit<WeekRow, "id">>) {
    const err = await saveWeek(db, week, patch);
    if (err) toast("Couldn't save. Check the internet connection.");
    else toast("Saved");
    refresh();
  }

  const unit = (row: PartRow) => (row.part.unit === "lb" ? " lb" : "");

  return (
    <>
      <WeekBar processDate={w?.process_date} />

      {unconfirmed > 0 && (
        <p className="note small">
          {unconfirmed} of the parts-per-lamb numbers are still starting guesses. The lamb count is only as good as
          those numbers.{" "}
          <Link href="/setup" className="copy text-[.85rem]">
            Review them in Setup
          </Link>
        </p>
      )}

      <div className="grid2">
        <div className="panel">
          <div className="count">
            <div className="big num">{c.final}</div>
            <div className="max-w-[34ch] pb-1.5">
              <h2>lambs to order</h2>
              <div className="muted">
                {c.recommended === 0
                  ? "No orders entered for this week yet."
                  : `Set by ${c.driver!.part.name.toLowerCase()}. ${fmt(c.driver!.need)}${unit(c.driver!)} needed, ${fmt(c.driver!.part.per_lamb)}${unit(c.driver!)} per lamb.`}
              </div>
            </div>
          </div>

          <OverrideField
            key={`${week}:${w?.lamb_override ?? ""}`}
            value={w?.lamb_override ?? null}
            recommended={c.recommended}
            onSave={(v) => void save({ lamb_override: v })}
          />

          <div className="mt-2 flex flex-wrap gap-3">
            <div className="min-w-[180px] flex-1">
              <label className="lbl" htmlFor="producer">
                Producer bringing lambs
              </label>
              <input
                id="producer"
                key={`p-${week}-${w?.producer ?? ""}`}
                className="field"
                defaultValue={w?.producer ?? ""}
                placeholder="Name"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (w?.producer ?? "")) void save({ producer: v });
                }}
              />
            </div>
            <div className="min-w-[160px] flex-1">
              <label className="lbl" htmlFor="pdate">
                Processing day at {processor}
              </label>
              <input
                id="pdate"
                type="date"
                className="field"
                value={w?.process_date ?? ""}
                onChange={(e) => void save({ process_date: e.target.value || null })}
              />
            </div>
          </div>

          <div className="msg">
            <span>{message}</span>
            <button
              type="button"
              className="btn noprint"
              onClick={() =>
                (navigator.clipboard ? navigator.clipboard.writeText(message) : Promise.reject()).then(
                  () => toast("Message copied"),
                  () => toast("Select the message and copy it"),
                )
              }
            >
              Copy message
            </button>
          </div>

          <div className="progress">
            <div>
              <b className="num">
                {answered}/{ordering.length}
              </b>
              <span className="small muted">customers have answered</span>
            </div>
            <div>
              <b className="num">
                {linesPacked}/{linesTotal}
              </b>
              <span className="small muted">lines packed</span>
            </div>
            <div>
              <b className="num">{fmt(shortCount)}</b>
              <span className="small muted">cuts added for half and whole orders</span>
            </div>
          </div>
        </div>

        <div className="panel">
          <h3>Does the carcass balance?</h3>
          <p className="small muted mt-1 mb-2">
            What this week&apos;s orders need from each part, against what {c.final} lambs will give you.
          </p>
          <table className="bal">
            <thead>
              <tr>
                <th>Part</th>
                <th className="num">Need</th>
                <th className="num">Get</th>
                <th className="w-[30%]">
                  <span className="sr-only">Bar</span>
                </th>
                <th>
                  <span className="sr-only">Status</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {c.rows.map((r) => (
                <tr key={r.part.id}>
                  <td>
                    <b>{r.part.name}</b> <span className="small muted">{r.part.unit === "lb" ? "lb" : ""}</span>
                  </td>
                  <td className="num">{fmt(r.need)}</td>
                  <td className="num">{fmt(r.supply)}</td>
                  <td>
                    <div className={`bar ${r.status === "short" ? "short" : ""}`} title={`${fmt(r.need)} of ${fmt(r.supply)}`}>
                      <i style={{ width: `${Math.min(100, r.supply ? (r.need / r.supply) * 100 : r.need ? 100 : 0)}%` }} />
                    </div>
                  </td>
                  <td>
                    <StatusTag row={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {legs && <p className="mt-3 mb-0 font-medium">{legs}</p>}
          <p className="small muted mt-2.5">
            Extras are estimates until the cut sheet comes back from {processor}. Anything extra can go in the freezer
            for half and whole orders.
          </p>
        </div>
      </div>

      <FollowUps week={week} />

      <div className="panel mt-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="mr-auto">Cut sheet for {processor}</h3>
          <Link href="/cut-sheet" className="btn">
            {cs.total ? "Open cut sheet" : "Start this week's cut sheet"}
          </Link>
        </div>
        {cs.total ? (
          <>
            <p className="mt-1.5 mb-0">
              <b>{cs.total} lambs</b> in {data.cutSets.length} sets: {cs.bySize.map((s) => `${s.lambs} ${s.label}`).join(", ")}
            </p>
            <CutSheetStatus week={week} processor={processor} />
          </>
        ) : (
          <p className="small muted mt-1 mb-0">
            The order count above is a guide. The cut sheet is where the lambs get assigned to sets.
          </p>
        )}
      </div>
    </>
  );
}

/** Follow-ups due this week or overdue, with Done buttons (SPEC 5.4). */
function FollowUps({ week }: { week: string }) {
  const { customers } = useStaffData();
  const toast = useToast();
  const db = getDb();
  const [state, setState] = useState<{ week: string; list: DueFollowUp[] } | null>(null);

  const reload = useCallback(async () => {
    try {
      const list = await loadDueFollowUps(db, week);
      setState({ week, list });
    } catch {
      setState({ week, list: [] });
    }
  }, [db, week]);

  useEffect(() => {
    let live = true;
    loadDueFollowUps(db, week).then(
      (list) => live && setState({ week, list }),
      () => live && setState({ week, list: [] }),
    );
    return () => {
      live = false;
    };
  }, [db, week]);

  const list = state?.week === week ? state.list : [];
  if (!list.length || !customers) return null;
  const today = todayISO();

  async function done(id: string, value: boolean) {
    const err = await setFollowUpDone(db, id, value);
    if (err) return toast("Couldn't save. Check the internet connection.");
    await reload();
    if (value) toast("Follow-up done", () => void done(id, false));
  }

  return (
    <section className="panel mt-4">
      <h3>Follow-ups</h3>
      <ul className="m-0 list-none p-0">
        {list.map((f) => {
          const c = customers.byId.get(f.customer_id);
          const late = f.follow_up_date < today;
          return (
            <li key={f.id} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
              <div className="min-w-0 flex-1">
                <Link href={`/customers/${f.customer_id}`} className="font-semibold text-ink no-underline hover:underline">
                  {c ? displayName(c, customers.byId) : "A customer"}
                </Link>
                <div className="small">{f.follow_up_note || f.summary}</div>
              </div>
              <span className={`small ${late ? "font-semibold text-barn" : "muted"}`}>
                {late ? "Overdue, " : ""}
                {niceDate(f.follow_up_date)}
              </span>
              <button type="button" className="btn ghost shrink-0" onClick={() => void done(f.id, true)}>
                Done
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Same checks as the Cut sheet screen: do the sets add up, and has it changed since it was sent? */
function CutSheetStatus({ week, processor }: { week: string; processor: string }) {
  const { catalog } = useStaffData();
  const load = useCallback((d: SupabaseClient) => loadCutSheet(d, week), [week]);
  const { data } = useLive(`weekcard-${week}`, load, ["cut_sheets", "cut_sets", "cut_set_lines"]);
  if (!data?.sheet || !catalog) return null;
  const specs = specMapOf(catalog);
  const problems = sheetProblems(data, catalog, specs);
  const status = sheetStatus(data, catalog, specs);
  const when = data.sheet.sent_at ? formatDateTime(data.sheet.sent_at) : "";
  return (
    <>
      {problems.length > 0 && (
        <div className="cutstat changed">
          {problems.length} set{problems.length > 1 ? "s don't" : " doesn't"} add up. Check before sending.
        </div>
      )}
      {status.kind === "notsent" && <div className="cutstat notsent">Not sent to {processor} yet.</div>}
      {status.kind === "changed" && <div className="cutstat changed">Changed after you sent it on {when}. Send an update.</div>}
      {status.kind === "sent" && (
        <div className="cutstat sent">
          Sent to {processor} {when}.
        </div>
      )}
    </>
  );
}

function StatusTag({ row }: { row: PartRow }) {
  switch (row.status) {
    case "short":
      return <span className="tag short">Short {fmt(-row.left)}</span>;
    case "sets":
      return <span className="tag sets">Sets count</span>;
    case "even":
      return <span className="tag even">Even</span>;
    case "extra":
      return <span className="tag extra">{fmt(row.left)} extra</span>;
    default:
      return null;
  }
}

function OverrideField({
  value,
  recommended,
  onSave,
}: {
  value: number | null;
  recommended: number;
  onSave: (v: number | null) => void;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const commit = () => {
    const t = text.trim();
    const v = t === "" ? null : Math.max(0, Math.round(num(t)));
    if (v !== value) onSave(v);
  };
  return (
    <div className="noprint mt-4 flex flex-wrap items-center gap-2">
      <label htmlFor="override" className="small muted">
        Your number
      </label>
      <input
        id="override"
        className="field num w-28!"
        inputMode="numeric"
        placeholder={String(recommended)}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      {value != null ? (
        <button type="button" className="btn ghost" onClick={() => onSave(null)}>
          Use {recommended}
        </button>
      ) : (
        <span className="small muted">Leave blank to use the recommended count.</span>
      )}
    </div>
  );
}
