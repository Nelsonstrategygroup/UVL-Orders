"use client";

// This week (SPEC 5.4), the weekly overview: how many lambs to order and
// whether the carcass balances, the week's steps (orders, cut sheet, box
// labels, packing) each tapping through to its page, then the planning.

import { useCan } from "@/components/CurrentUser";
import ViewOnly from "@/components/ViewOnly";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { cutSheetTotals, legBreakdown, legBreakdownText, shortParts, weekNumbers } from "@/lib/calc/summary";
import { packPartIncludes, partPackSizes } from "@/lib/calc/packs";
import { calcWeek, plannedExtras, type PartRow } from "@/lib/calc/week";
import { labelCustomer, labelList } from "@/lib/calc/labels";
import { cantConvert, inProductUnits, unitWord } from "@/lib/calc/units";
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
  const canChange = useCan("week").change;
  const seeCutSheet = useCan("cutsheet").view;
  const seeNotes = useCan("callnotes").view;
  const seeFreezer = useCan("freezer").view;
  const seeHalfWhole = useCan("halfwhole").view;
  const seePacking = useCan("packing").view;
  const seeCalls = useCan("calls").view;
  const seeOrders = useCan("orders").view;

  if (loadError || error) return <p className="note bad">Couldn&apos;t load this week: {loadError || error}</p>;
  if (!catalog || !customers || !data)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading this week...</div>
      </>
    );

  const w = data.weekRow;
  // Lines requested for this week, not confirmed yet.
  const requested = [...data.requests.values()].flat();
  const { short } = halfWholeNeeds(data.freezer, data.halfWhole, catalog.parts, catalog.products);
  const cs = cutSheetTotals(data.cutSets, catalog.sizes);
  // The week's ONE lamb count is worked out in calcWeek: your number, else the
  // cut sheet total, else the count from orders. Every lamb number on this
  // screen comes from `n` (see lib/calc/oneLambCount.test.ts).
  const c = calcWeek({
    parts: catalog.parts,
    products: catalog.products,
    // In each product's own unit (pounds of a piece product become pieces).
    // Requested lines count too: they're cut and frozen this week (10/22/26).
    orders: [
      ...[...data.orders.values()].map((o) => inProductUnits(o.lines, o.units, catalog.productById)),
      ...requested.map((r) => inProductUnits({ [r.product_id]: r.qty }, r.unit ? { [r.product_id]: r.unit } : {}, catalog.productById)),
    ],
    shortfall: short,
    override: w?.lamb_override ?? null,
    cutSheetLambs: cs.total,
  });
  const n = weekNumbers(c, cs, w?.process_date ?? null);
  const message = n.message;
  const balanceGroups = [
    { title: "Main cuts", sub: "You plan for these.", rows: c.rows.filter((r) => r.planned) },
    { title: "Comes with every lamb", sub: "No need to plan.", rows: c.rows.filter((r) => !r.planned) },
  ];
  const extras = plannedExtras(c.rows);
  // The box label list, to say whether it needs printing again (SPEC 12.5).
  const labels = labelList(
    [...data.orders.values()].map((o) => {
      const cu = customers.byId.get(o.customer_id);
      const parent = cu?.parent_customer_id ? customers.byId.get(cu.parent_customer_id) : undefined;
      const name = cu ? labelCustomer(cu.name, parent?.name) : "";
      return { customer: name, sortKey: name, lines: o.lines, units: o.units };
    }),
    catalog.productById,
    catalog.boxes,
  );
  const noBoxCount = labels.noBoxProducts.length;
  const legs = legBreakdownText(legBreakdown(c.withShort, catalog.products));
  // Lines in pounds for a product with no weight per piece count as nothing.
  const uncounted = [...data.orders.values()].flatMap((o) => cantConvert(o.lines, o.units, catalog.productById));

  const ordering = orderingCustomers(customers.list);
  const answered = ordering.filter((cu) => isDone(data.orders.get(cu.id)?.status)).length;
  // A line is packed once it has a weight or is marked not filled.
  const { done: linesPacked, total: linesTotal } = packStats(
    [...data.orders.values()].map((o) => ({
      lines: Object.entries(o.lines)
        .filter(([, q]) => q > 0)
        .map(([pid, q]) => ({
          ordered: q,
          unit: o.units[pid] ?? catalog.productById.get(pid)?.unit ?? "each",
          weight: data.packed.get(o.id)?.[pid] ?? 0,
          count: null,
          shorted: !!data.shorted.get(o.id)?.has(pid),
          flagged: false,
          flagNote: "",
        })),
    })),
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

  // Shanks are ordered in packs, so they show in packs here (the math stays in shanks).
  const packSizes = partPackSizes(catalog.products);
  const shortLine = shortParts(c.rows, packSizes);
  const packIncludes = [...packSizes].flatMap(([id, size]) =>
    packPartIncludes(id, catalog.parts.find((p) => p.id === id)?.name ?? id, size, catalog.products, c.withShort),
  );
  const labelsChanged = !!w?.labels_hash && w.labels_hash !== labels.hash;

  return (
    <>
      <WeekBar processDate={w?.process_date} schedule />
      {!canChange && <ViewOnly what="this week's settings" />}

      {unconfirmed > 0 && (
        <p className="note small">
          {unconfirmed} of the parts-per-lamb numbers are still starting guesses. The lamb count is only as good as
          those numbers.{" "}
          <Link href="/setup/parts" className="copy text-[.85rem]">
            Review them in Setup
          </Link>
        </p>
      )}

      {/* The weekly overview (change request 10/21/26): the count and the balance, the week's steps, then planning. */}
      <div className="grid2">
        <div className="panel">
          <div className="count">
            <div className="big num">{n.headline}</div>
            <div className="max-w-[34ch] pb-1.5">
              <h2>lambs to order</h2>
              {n.sourceLine && <div className="font-semibold">{n.sourceLine}.</div>}
              {n.carcassLine && <div className="font-semibold">{n.carcassLine}.</div>}
              {requested.length > 0 && (
                <div className="small">
                  Includes {requested.length} requested line{requested.length === 1 ? "" : "s"} not confirmed yet.
                </div>
              )}
              <div className="muted">
                {c.recommended === 0
                  ? "No orders entered for this week yet."
                  : c.driver
                    ? `${c.source === "orders" ? "Set" : "Orders: set"} by ${c.driver.part.name.toLowerCase()}. ${fmt(c.driver.need)}${unit(c.driver)} needed, ${fmt(c.driver.part.per_lamb)}${unit(c.driver)} per lamb.`
                    : "Only carcass lambs so far."}
              </div>
            </div>
          </div>

          <fieldset disabled={!canChange} className="m-0 min-w-0 border-0 p-0">
            <OverrideField
              key={`${week}:${w?.lamb_override ?? ""}`}
              value={w?.lamb_override ?? null}
              fallback={c.cutSheetLambs > 0 ? c.cutSheetLambs : c.recommended}
              fallbackFrom={c.cutSheetLambs > 0 ? "the cut sheet" : "orders"}
              onSave={(v) => void save({ lamb_override: v })}
            />
          </fieldset>

          <div className={`balsum ${shortLine.length ? "short" : "ok"}`}>
            {c.recommended === 0 ? (
              "The carcass balance shows once orders are in."
            ) : shortLine.length ? (
              shortLine.join(" · ")
            ) : (
              "Every part comes out even or extra."
            )}
          </div>
        </div>

        <BalanceDetails>
          <p className="small muted mt-1 mb-2">
            What this week&apos;s orders need from each part, against what {n.balanceLambs} lambs will give you.
            {c.carcass > 0 && <> The {fmt(c.carcass)} carcass lamb{c.carcass === 1 ? "" : "s"} go out uncut and aren&apos;t in this table.</>}
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
            {balanceGroups.map(
              (g) =>
                g.rows.length > 0 && (
                  <tbody key={g.title}>
                    <tr className="bal-group">
                      <th colSpan={5} scope="rowgroup">
                        {g.title} <span className="font-normal">{g.sub}</span>
                      </th>
                    </tr>
                    {g.rows.map((r) => {
                      const pack = packSizes.get(r.part.id) ?? 1;
                      return (
                        <tr key={r.part.id} className={r.parent ? "bal-sub" : undefined}>
                          <td>
                            {r.parent ? (
                              <span title={`Cut from ${catalog.parts.find((x) => x.id === r.parent)?.name.toLowerCase() ?? r.parent}s`}>
                                <span aria-hidden="true">↳ </span>
                                {r.part.name}
                              </span>
                            ) : (
                              <b>{r.part.name}</b>
                            )}{" "}
                            <span className="small muted">{pack > 1 ? "packs" : r.part.unit === "lb" ? "lb" : ""}</span>
                          </td>
                          <td className="num">{fmt(r.need / pack)}</td>
                          <td className="num">{fmt(r.supply / pack)}</td>
                          <td>
                            <div className={`bar ${r.status === "short" ? "short" : ""}`} title={`${fmt(r.need / pack)} of ${fmt(r.supply / pack)}`}>
                              <i style={{ width: `${Math.min(100, r.supply ? (r.need / r.supply) * 100 : r.need ? 100 : 0)}%` }} />
                            </div>
                          </td>
                          <td>
                            <StatusTag row={r} pack={pack} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                ),
            )}
          </table>
          {packIncludes.map((t) => (
            <p key={t} className="mt-2 mb-0">
              {t}
            </p>
          ))}
          {legs && <p className="mt-3 mb-0 font-medium">{legs}</p>}
          {uncounted.length > 0 && (
            <p className="note bad small mt-3">
              Not counted: {uncounted.map((u) => `${u.name} ${fmt(u.qty)} ${unitWord(u.unit, u.qty)}`).join(", ")}. Add a weight
              per piece in Setup so these count.
            </p>
          )}
        </BalanceDetails>
      </div>

      {requested.length > 0 && data.cutSheet?.sent_at && (
        <p className="note bad mt-4" role="status">
          The cut sheet was sent with {requested.length} requested line{requested.length === 1 ? "" : "s"} still not confirmed.
          Confirm or drop {requested.length === 1 ? "it" : "them"} on Calls.
        </p>
      )}

      <section className="panel mt-4" aria-labelledby="steps-h">
        <h3 id="steps-h">This week&apos;s steps</h3>
        <ul className="steps">
          {(seeCalls || seeOrders) && (
            <Step
              href={seeCalls ? "/calls" : "/orders"}
              title="Orders"
              tone={ordering.length > 0 && answered === ordering.length ? "done" : "todo"}
            >
              {answered} of {ordering.length} customers answered
              {requested.length > 0 && ` · ${requested.length} requested to confirm`}
            </Step>
          )}
          {seeCutSheet && <CutSheetStep week={week} processor={processor} />}
          {seePacking && (
            <Step href="/packing/labels" title="Box labels" tone={labelsChanged ? "warn" : w?.labels_printed_at ? "done" : "todo"}>
              {labels.total === 0
                ? "Nothing to label yet"
                : labelsChanged
                  ? "Orders changed since you printed"
                  : w?.labels_printed_at
                    ? `Printed ${formatDateTime(w.labels_printed_at)}`
                    : "Not printed"}
              {noBoxCount > 0 && ` · ${noBoxCount} ${noBoxCount === 1 ? "product has" : "products have"} no box size yet`}
            </Step>
          )}
          {seePacking && (
            <Step href="/packing" title="Packing" tone={linesTotal > 0 && linesPacked === linesTotal ? "done" : "todo"}>
              {linesTotal ? `${linesPacked} of ${linesTotal} lines packed` : "No orders to pack yet"}
            </Step>
          )}
        </ul>
      </section>

      <section className="panel mt-4">
        <h3>Planning</h3>
        <fieldset disabled={!canChange} className="m-0 min-w-0 border-0 p-0">
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
        </fieldset>

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

        {extras.length > 0 && (
          <div className="note mt-3">
            <b>Extra cuts to plan for:</b> {extras.map((r) => `${r.part.name} ${fmt(r.left)}`).join(", ")}.
            {(seeFreezer || seeCutSheet || seeHalfWhole) && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="small">Decide where they go:</span>
                {seeFreezer && (
                  <Link href="/freezer" className="btn">
                    Freezer
                  </Link>
                )}
                {seeCutSheet && (
                  <Link href="/cut-sheet" className="btn">
                    Grind (on the cut sheet)
                  </Link>
                )}
                {seeHalfWhole && (
                  <Link href="/half-whole" className="btn">
                    Half and whole orders
                  </Link>
                )}
              </div>
            )}
          </div>
        )}
        {c.filled.length > 0 && (
          <div className="note mt-3">
            <b>Filled from extras, not in the table:</b>
            {c.filled.map((f) => {
              const step = catalog.productById.get(f.product.id)?.order_step ?? 1;
              return (
                <div key={f.product.id} className="mt-1">
                  {f.product.name}: {fmt(f.qty)} {unitWord(f.product.unit, f.qty)}
                  {step > 1 && ` (${fmt(f.qty / step)} × ${fmt(step)} ${unitWord(f.product.unit, step)})`}. {f.note}
                </div>
              );
            })}
          </div>
        )}
        {shortCount > 0 && (
          <p className="mt-3 mb-0">{fmt(shortCount)} cuts added to this week for half and whole orders the freezer can&apos;t cover.</p>
        )}
        <p className="small muted mt-2.5 mb-0">Extras are estimates until the cut sheet comes back from {processor}.</p>
      </section>

      {seeNotes && <FollowUps week={week} />}
    </>
  );
}

/** The full balance table: starts closed on phones, open on wide screens. */
function BalanceDetails({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (ref.current && window.matchMedia("(min-width: 900px)").matches) ref.current.open = true;
  }, []);
  return (
    <details ref={ref} className="panel baldetails">
      <summary>
        <h3 className="inline">Show the full balance</h3>
      </summary>
      {children}
    </details>
  );
}

type Tone = "done" | "todo" | "warn";

/** One row of the weekly checklist: the step, how it stands, and a tap through to its page. */
function Step({ href, title, tone, children }: { href: string; title: string; tone: Tone; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className={`step ${tone}`}>
        <span className="step-mark" aria-hidden="true">
          {tone === "done" ? "✓" : tone === "warn" ? "!" : "○"}
        </span>
        <span className="min-w-0 flex-1">
          <b>{title}</b>
          <span className="step-status">{children}</span>
        </span>
        <span aria-hidden="true" className="step-go">
          &#8250;
        </span>
      </Link>
    </li>
  );
}

/** The cut sheet step: not started, in progress, or sent (and whether it changed since). Same checks as the Cut sheet screen. */
function CutSheetStep({ week, processor }: { week: string; processor: string }) {
  const { catalog } = useStaffData();
  const load = useCallback((d: SupabaseClient) => loadCutSheet(d, week), [week]);
  const { data } = useLive(`weekcard-${week}`, load, ["cut_sheets", "cut_sets", "cut_set_lines"]);
  if (!data || !catalog)
    return (
      <Step href="/cut-sheet" title="Cut sheet" tone="todo">
        Checking...
      </Step>
    );
  if (!data.sheet)
    return (
      <Step href="/cut-sheet" title="Cut sheet" tone="todo">
        Not started
      </Step>
    );
  const specs = specMapOf(catalog);
  const problems = sheetProblems(data, catalog, specs).length;
  const status = sheetStatus(data, catalog, specs);
  const lambs = data.sets.reduce((t, x) => t + num(x.lambs), 0);
  const when = data.sheet.sent_at ? formatDateTime(data.sheet.sent_at) : "";
  const tone: Tone = status.kind === "changed" || problems ? "warn" : status.kind === "sent" ? "done" : "todo";
  return (
    <Step href="/cut-sheet" title="Cut sheet" tone={tone}>
      {status.kind === "sent" ? `Sent to ${processor} ${when}` : status.kind === "changed" ? `Changed since you sent it ${when}` : "In progress"}
      {` · ${lambs} lambs in ${data.sets.length} set${data.sets.length === 1 ? "" : "s"}`}
      {problems > 0 && ` · ${problems} set${problems > 1 ? "s don't" : " doesn't"} add up`}
    </Step>
  );
}

/** Follow-ups due this week or overdue, with Done buttons (SPEC 5.4). */
function FollowUps({ week }: { week: string }) {
  const { customers } = useStaffData();
  const canMark = useCan("callnotes").change;
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
              <button type="button" className="btn ghost shrink-0" disabled={!canMark} onClick={() => void done(f.id, true)}>
                Done
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Short, even, extra or available; in packs for parts ordered in packs (pack > 1). */
function StatusTag({ row, pack = 1 }: { row: PartRow; pack?: number }) {
  const left = row.left / pack;
  switch (row.status) {
    case "short":
      return <span className="tag short">Short {fmt(-left)}</span>;
    case "sets":
      return <span className="tag sets">Sets count</span>;
    case "even":
      return <span className="tag even">Even</span>;
    case "extra":
      // Main cuts stand out; what comes with every lamb stays quiet.
      if (row.availableOnly) return <span className="tag plain">{fmt(left)} available</span>;
      return <span className={row.planned ? "tag extra" : "tag plain"}>{fmt(left)} extra</span>;
    default:
      return null;
  }
}

function OverrideField({
  value,
  fallback,
  fallbackFrom,
  onSave,
}: {
  value: number | null;
  /** The count used when "Your number" is blank. */
  fallback: number;
  fallbackFrom: string;
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
        placeholder={String(fallback)}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      {value != null ? (
        <button type="button" className="btn ghost" onClick={() => onSave(null)}>
          Use {fallback} from {fallbackFrom}
        </button>
      ) : (
        <span className="small muted">Leave blank to use {fallback} from {fallbackFrom}.</span>
      )}
    </div>
  );
}
