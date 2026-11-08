"use client";

// The Le Trim plan for a week (change requests 10/25/26 and 10/29/26). Le
// Trim is made by weight: spare trim first, then boned-out shoulders, then
// half legs. The app works out that mix and, if it falls short, about how
// many extra average-size lambs would cover it (added on This week, Extra
// lambs). Kathy types what she actually used; the app checks it in plain
// words but never stops her saving. Saving puts it on the cut sheet. It
// never changes the lamb count.

import Link from "next/link";
import { useState } from "react";
import { useCan } from "@/components/CurrentUser";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useWeekData } from "@/components/data/useWeekData";
import { useToast } from "@/components/Toast";
import ViewOnly from "@/components/ViewOnly";
import { useWeek, WeekBar } from "@/components/Week";
import {
  halfLegLb,
  leTrimChecks,
  leTrimCutLines,
  leTrimShortText,
  legsFor,
  planLb,
  suggestLeTrim,
  type LeTrimNeed,
  type LeTrimWeights,
  type leTrimSpare,
} from "@/lib/calc/leTrim";
import { fmt, num } from "@/lib/calc/num";
import { weekName } from "@/lib/dates";
import { formatWhen } from "@/lib/format";
import { deleteLeTrimPlan, saveLeTrimPlan } from "@/lib/db/save";
import type { LeTrimPlanRow } from "@/lib/db/types";
import { cleanQtyInput } from "@/lib/orders";
import { weekCalc } from "@/lib/weekCalc";
import { customerRank, displayName } from "@/lib/calc/customers";
import { amountText, LE_TRIM_PARTS } from "@/lib/calc/extras";

export default function LeTrimScreen() {
  const { week } = useWeek();
  const { catalog, customers, error: loadError } = useStaffData();
  const { data, error, refresh } = useWeekData(week);
  const canWeek = useCan("week").change;
  const canCutSheet = useCan("cutsheet").change;
  const canChange = canWeek || canCutSheet;

  if (loadError || error) return <p className="note bad">Couldn&apos;t load: {loadError ?? error}</p>;
  if (!catalog || !customers || !data)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  // What's spare before Le Trim (the saved plan left out, so it isn't counted against itself), and Le Trim by weight.
  const rank = customerRank(customers.byId);
  const { leTrim } = weekCalc(data, catalog, { rank });
  // "Only if extra" lines on shoulders, legs or trim, and what each gets with a plan (the one being typed, live).
  const waiting = (p: { shoulders: number; legs: number; trimLb: number } | null): Waiting[] => {
    const { extras, extraLines } = weekCalc(data, catalog, { rank, plan: p });
    return extraLines
      .filter((l) => catalog.productById.get(l.productId)?.uses.some((u) => LE_TRIM_PARTS.has(u.part_id)))
      .sort((a, b) => a.rank - b.rank)
      .map((l) => {
        const c = customers.byId.get(l.customerId);
        const f = extras.fills.get(l.key);
        return {
          key: l.key,
          text: `${c ? displayName(c, customers.byId) : "Unknown customer"}: wants ${amountText(l.asked, catalog.productById.get(l.productId))}, gets ${fmt(f?.fill ?? 0)}`,
          estimated: !!f?.estimated,
          locked: !!f?.locked,
        };
      });
  };
  const { ordered, need, weights } = leTrim;
  // The estimate, before any kill sheet figure typed below.
  const spare = { ...leTrim.spare, trimLb: data.leTrim?.trim_actual_lb != null ? (data.leTrim.trim_estimated_lb ?? leTrim.spare.trimLb) : leTrim.spare.trimLb };

  return (
    <div className="max-w-[760px]">
      <WeekBar />
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="mr-auto">Le Trim</h2>
        <Link href="/week" className="btn ghost">
          &larr; This week
        </Link>
      </div>
      {!canChange && <ViewOnly what="the Le Trim plan" />}
      {ordered.lb === 0 ? (
        <p className="empty">No Le Trim ordered for {weekName(week)}.</p>
      ) : (
        <Plan
          key={`${week}:${data.leTrim?.saved_at ?? "new"}`}
          week={week}
          saved={data.leTrim}
          ordered={ordered}
          spare={spare}
          need={need}
          weights={weights}
          canChange={canChange}
          onSaved={refresh}
          waiting={waiting}
        />
      )}
    </div>
  );
}

function Plan({
  week,
  saved,
  ordered,
  spare,
  need,
  weights,
  canChange,
  onSaved,
  waiting,
}: {
  waiting: (plan: { shoulders: number; legs: number; trimLb: number } | null) => Waiting[];
  week: string;
  saved: LeTrimPlanRow | null;
  ordered: { lb: number; packs: number };
  spare: ReturnType<typeof leTrimSpare>;
  need: LeTrimNeed;
  weights: LeTrimWeights;
  canChange: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [shoulders, setShoulders] = useState(saved ? String(saved.shoulders) : "");
  const [halfLegs, setHalfLegs] = useState(saved ? String(saved.half_legs) : "");
  const [trim, setTrim] = useState(saved ? fmt(saved.trim_lb) : "");
  const [actual, setActual] = useState(saved?.trim_actual_lb != null ? fmt(saved.trim_actual_lb) : "");
  const [busy, setBusy] = useState(false);

  const plan = { shoulders: Math.round(num(shoulders)), halfLegs: Math.round(num(halfLegs)), trimLb: num(trim) };
  // Numbers typed and not saved yet: the waiting lines show what they'd get with them (live).
  const anyTyped = (shoulders + halfLegs + trim).trim() !== "";
  const typedPlan = anyTyped && (!saved || dirty(saved, plan)) ? { shoulders: plan.shoulders, legs: legsFor(plan.halfLegs), trimLb: plan.trimLb } : null;
  const hasActual = actual.trim() !== "";
  const trimSpare = hasActual ? num(actual) : spare.trimLb;
  const checks = leTrimChecks(plan, spare, ordered.lb, { lb: trimSpare, actual: hasActual }, weights);
  const legs = legsFor(plan.halfLegs);
  const short = leTrimShortText(need);
  // The saved plan is what the week uses (This week, the cut sheet): shown at the top once saved (Lucas, 11/2/26).
  const sp = saved ? { shoulders: saved.shoulders, halfLegs: saved.half_legs, trimLb: num(saved.trim_lb) } : null;
  const spLb = sp ? Math.round(planLb(sp, weights)) : 0;
  const spDiff = spLb - Math.round(ordered.lb);
  /** "3 left after your plan" or "2 short for your plan", once a plan is saved. */
  const leftWords = (n: number, unit = "") =>
    n >= 0 ? `${fmt(n)}${unit} left after your plan` : `${fmt(-n)}${unit} short for your plan`;

  async function save() {
    setBusy(true);
    const err = await saveLeTrimPlan(getDb(), week, {
      shoulders: plan.shoulders,
      halfLegs: plan.halfLegs,
      trimLb: plan.trimLb,
      trimEstimatedLb: Math.round(spare.trimLb * 10) / 10,
      trimActualLb: hasActual ? num(actual) : null,
    });
    setBusy(false);
    if (err) return toast(`Couldn't save: ${err}`);
    toast("Le Trim plan saved");
    onSaved();
  }

  async function remove() {
    if (!confirm("Remove the saved Le Trim plan? The app goes back to its worked-out mix, and the plan comes off the cut sheet.")) return;
    setBusy(true);
    const err = await deleteLeTrimPlan(getDb(), week);
    setBusy(false);
    if (err) return toast(`Couldn't remove: ${err}`);
    toast("Le Trim plan removed");
    onSaved();
  }

  const box = (label: string, value: string, set: (v: string) => void, hint?: React.ReactNode, id?: string) => (
    <label className="lt-input" htmlFor={id}>
      <span>{label}</span>
      <input id={id} className="field num" inputMode="decimal" value={value} disabled={!canChange} onChange={(e) => set(cleanQtyInput(e.target.value))} />
      {hint && <small>{hint}</small>}
    </label>
  );

  return (
    <>
      <div className="lt-facts">
        <div>
          <span>Le Trim ordered</span>
          <b>{fmt(ordered.lb)} lb</b>
          <small>by weight</small>
        </div>
        {/* Once a plan is saved, the big numbers are the plan; what's spare goes underneath (Lucas, 11/2/26). */}
        {sp ? (
          <>
            <div>
              <span>Shoulders in your plan</span>
              <b>{sp.shoulders}</b>
              <small>
                of {spare.shoulders} spare · {leftWords(spare.shoulders - sp.shoulders)}
              </small>
            </div>
            <div>
              <span>Half legs in your plan</span>
              <b>{sp.halfLegs}</b>
              <small>
                of {spare.halfLegs} spare ({spare.legs} legs) · {leftWords(spare.halfLegs - sp.halfLegs)}
              </small>
            </div>
            <div>
              <span>Trim in your plan</span>
              <b>{fmt(Math.round(sp.trimLb))} lb</b>
              <small>
                of {fmt(Math.round(trimSpare))} lb spare ({hasActual ? "kill sheet" : "estimated"}) · {leftWords(Math.round(trimSpare - sp.trimLb), " lb")}
              </small>
            </div>
          </>
        ) : (
          <>
            <div>
              <span>Extra shoulders</span>
              <b>{spare.shoulders}</b>
              <small>after all other orders</small>
            </div>
            <div>
              <span>Extra legs</span>
              <b>{spare.legs}</b>
              <small>up to {spare.halfLegs} half legs</small>
            </div>
            <div>
              <span>Extra trim</span>
              <b>{fmt(Math.round(trimSpare))} lb</b>
              <small className={hasActual ? "" : "lt-est"}>{hasActual ? "From the kill sheet" : "Estimated"}</small>
            </div>
          </>
        )}
      </div>

      <section className={`note mt-4 ${short || (sp && spDiff < 0) ? "warn" : ""}`} aria-live="polite">
        {sp && (
          <>
            <b>Your saved plan:</b> {fmt(Math.round(sp.trimLb))} lb trim, {sp.shoulders} shoulder{sp.shoulders === 1 ? "" : "s"} ({fmt(weights.shoulderLb)} lb
            each), {sp.halfLegs} half leg{sp.halfLegs === 1 ? "" : "s"} ({fmt(halfLegLb(weights))} lb each, {legsFor(sp.halfLegs)} leg
            {legsFor(sp.halfLegs) === 1 ? "" : "s"} halved): approximately {fmt(spLb)} of {fmt(ordered.lb)} lb
            {spDiff > 0 ? `, about ${fmt(spDiff)} lb over.` : spDiff < 0 ? `. About ${fmt(-spDiff)} lb short.` : "."} This is what This week and the cut
            sheet use.
            <div className="small mt-1">
              The app&apos;s own mix would be about {fmt(Math.round(need.trimLb))} lb trim, {need.shoulders} shoulders and {need.halfLegs} half legs.
            </div>
          </>
        )}
        {!sp && <b>The app&apos;s mix by weight, approximately:</b>}
        {!sp && <> {fmt(Math.round(need.trimLb))} lb trim</>}
        {!sp && (
          <>
            {need.shoulders > 0 && `, ${need.shoulders} shoulder${need.shoulders === 1 ? "" : "s"} (${fmt(weights.shoulderLb)} lb each)`}
            {need.halfLegs > 0 && `, ${need.halfLegs} half leg${need.halfLegs === 1 ? "" : "s"} (${fmt(halfLegLb(weights))} lb each, ${need.legs} leg${need.legs === 1 ? "" : "s"} halved)`}: about{" "}
            {fmt(Math.round(need.coveredLb))} of {fmt(ordered.lb)} lb.
          </>
        )}
        {short ? (
          <div className="mt-1">
            <b>{short}</b> Add them on <Link href="/week">This week</Link>, under Extra lambs.
          </div>
        ) : (
          !sp && <div className="mt-1">Covered by what&apos;s spare.</div>
        )}
        <div className="small muted mt-1">
          Average-size lambs: {fmt(weights.trimPerLambLb)} lb trim each, {fmt(weights.shoulderLb)} lb a shoulder, {fmt(weights.legLb)} lb a leg (Setup).
          Smaller or bigger lambs need more or fewer.
        </div>
      </section>

      <section className="panel mt-4">
        <h3 className="m-0">What you used for Le Trim</h3>
        <div className="lt-inputs">
          {box("Shoulders", shoulders, setShoulders, "boned out", "lt-sh")}
          {box("Half legs", halfLegs, setHalfLegs, legs ? `= ${legs} leg${legs === 1 ? "" : "s"} cut in half` : "", "lt-hl")}
          {box(
            "Trim (lb)",
            trim,
            setTrim,
            plan.shoulders + plan.halfLegs + plan.trimLb > 0 ? <>Approximately {fmt(Math.round(planLb(plan, weights)))} lb of Le Trim in all.</> : null,
            "lt-tr",
          )}
        </div>
        {canChange && (
          <button
            type="button"
            className="btn ghost mt-3"
            onClick={() => {
              const s = suggestLeTrim(need);
              setShoulders(String(s.shoulders));
              setHalfLegs(String(s.halfLegs));
              setTrim(fmt(s.trimLb));
            }}
          >
            Suggest (trim, then shoulders, then half legs)
          </button>
        )}

        <ul className="lt-checks" aria-live="polite">
          {checks.map((ch) => (
            <li key={ch.text} className={ch.ok ? "ok" : "warn"}>
              <span aria-hidden="true">{ch.ok ? "✓" : "!"}</span> {ch.text}
            </li>
          ))}
        </ul>

        <div className="mt-3">
          {box("Actual extra trim from the kill sheet (lb)", actual, setActual, "Leave blank until you have it. Until then the trim is estimated.", "lt-actual")}
        </div>

        {canChange && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className="bigbtn mt-0! w-auto! px-6" disabled={busy} onClick={() => void save()}>
              {saved ? "Save changes" : "Save Le Trim plan"}
            </button>
            {saved && (
              <>
                <span className="small muted">
                  Saved {formatWhen(saved.saved_at)}
                  {saved.saved_by_name ? ` by ${saved.saved_by_name}` : ""}.
                </span>
                <button type="button" className="btn ghost" disabled={busy} onClick={() => void remove()}>
                  Remove saved plan
                </button>
              </>
            )}
          </div>
        )}
        {(saved || plan.shoulders + plan.halfLegs > 0) && (
          <p className="small mt-3 mb-0">
            <b>On the cut sheet{saved ? "" : " once saved"}:</b>{" "}
            {leTrimCutLines(saved && !dirty(saved, plan) ? { shoulders: saved.shoulders, halfLegs: saved.half_legs } : plan).join(" · ") || "nothing yet"}
          </p>
        )}
      </section>
      <WaitingLines list={waiting(typedPlan)} typed={!!typedPlan} />
    </>
  );
}

type Waiting = { key: string; text: string; estimated: boolean; locked: boolean };

/** "Only if extra" lines waiting on shoulders, legs or trim: what each gets under the plan as typed (11/8/26). */
function WaitingLines({ list, typed }: { list: Waiting[]; typed: boolean }) {
  if (!list.length) return null;
  return (
    <section className="note mt-4" aria-live="polite">
      <b>Only if extra lines waiting on Le Trim:</b> they get what&apos;s left after it{typed ? ", with the numbers above" : ""}.
      <ul className="m-0 mt-1 grid list-none gap-1 p-0">
        {list.map((w) => (
          <li key={w.key}>
            {w.text}
            {w.estimated && <span className="tag ml-1">estimated</span>}
            {w.locked && <span className="tag ml-1">packing started</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The boxes differ from what's saved. */
function dirty(saved: LeTrimPlanRow, plan: { shoulders: number; halfLegs: number; trimLb: number }) {
  return saved.shoulders !== plan.shoulders || saved.half_legs !== plan.halfLegs || saved.trim_lb !== plan.trimLb;
}
