"use client";

// The Le Trim plan for a week (change request 10/25/26). After the other
// orders are in, Kathy decides what the Le Trim is made from: boned-out extra
// shoulders, extra legs cut in half, and trim. She types what she used; the
// app shows what's spare and checks it in plain words, but never stops her
// saving. Saving takes it out of the week's extras and puts it on the cut
// sheet. It never changes the lamb count.

import Link from "next/link";
import { useState } from "react";
import { useCan } from "@/components/CurrentUser";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useWeekData } from "@/components/data/useWeekData";
import { useToast } from "@/components/Toast";
import ViewOnly from "@/components/ViewOnly";
import { useWeek, WeekBar } from "@/components/Week";
import { leTrimChecks, leTrimCutLines, leTrimOrdered, leTrimSpare, legsFor, suggestLeTrim, trimFor, type LeTrimSettings } from "@/lib/calc/leTrim";
import { fmt, num } from "@/lib/calc/num";
import { weekName } from "@/lib/dates";
import { formatWhen } from "@/lib/format";
import { saveLeTrimPlan } from "@/lib/db/save";
import type { LeTrimPlanRow } from "@/lib/db/types";
import { cleanQtyInput } from "@/lib/orders";
import { weekCalc } from "@/lib/weekCalc";

export default function LeTrimScreen() {
  const { week } = useWeek();
  const { catalog, error: loadError } = useStaffData();
  const { data, error, refresh } = useWeekData(week);
  const canWeek = useCan("week").change;
  const canCutSheet = useCan("cutsheet").change;
  const canChange = canWeek || canCutSheet;

  if (loadError || error) return <p className="note bad">Couldn&apos;t load: {loadError ?? error}</p>;
  if (!catalog || !data)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading...</div>
      </>
    );

  const settings: LeTrimSettings = {
    shoulderTrimLb: num(catalog.settings?.le_trim_shoulder_trim_lb ?? 5),
    halfLegTrimLb: num(catalog.settings?.le_trim_half_leg_trim_lb ?? 6.5),
  };
  // What's spare before Le Trim (the saved plan left out, so it isn't counted against itself).
  const { c } = weekCalc(data, catalog, { withLeTrim: false });
  const ordered = leTrimOrdered(c);
  const spare = leTrimSpare(c);

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
          settings={settings}
          canChange={canChange}
          onSaved={refresh}
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
  settings,
  canChange,
  onSaved,
}: {
  week: string;
  saved: LeTrimPlanRow | null;
  ordered: { lb: number; packs: number };
  spare: ReturnType<typeof leTrimSpare>;
  settings: LeTrimSettings;
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
  const hasActual = actual.trim() !== "";
  const trimSpare = hasActual ? num(actual) : spare.trimLb;
  const checks = leTrimChecks(plan, spare, ordered, { lb: trimSpare, actual: hasActual });
  const estimate = trimFor(plan, settings);
  const legs = legsFor(plan.halfLegs);

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
          <small>{ordered.packs} packs of 10 lb</small>
        </div>
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
      </div>

      <section className="panel mt-4">
        <h3 className="m-0">What you used for Le Trim</h3>
        <div className="lt-inputs">
          {box("Shoulders", shoulders, setShoulders, "boned out", "lt-sh")}
          {box("Half legs", halfLegs, setHalfLegs, legs ? `= ${legs} leg${legs === 1 ? "" : "s"} cut in half` : "", "lt-hl")}
          {box(
            "Trim (lb)",
            trim,
            setTrim,
            plan.shoulders + plan.halfLegs > 0 ? (
              <>
                About {fmt(estimate)} lb at {fmt(settings.shoulderTrimLb)} lb a shoulder and {fmt(settings.halfLegTrimLb)} lb a half leg.{" "}
                {canChange && (
                  <button type="button" className="copy" onClick={() => setTrim(fmt(estimate))}>
                    Use {fmt(estimate)}
                  </button>
                )}
              </>
            ) : null,
            "lt-tr",
          )}
        </div>
        {canChange && (
          <button
            type="button"
            className="btn ghost mt-3"
            onClick={() => {
              const s = suggestLeTrim(ordered, spare, settings);
              setShoulders(String(s.shoulders));
              setHalfLegs(String(s.halfLegs));
              setTrim(fmt(s.trimLb));
            }}
          >
            Suggest (shoulders first, then half legs)
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
              <span className="small muted">
                Saved {formatWhen(saved.saved_at)}
                {saved.saved_by_name ? ` by ${saved.saved_by_name}` : ""}.
              </span>
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
    </>
  );
}

/** The boxes differ from what's saved. */
function dirty(saved: LeTrimPlanRow, plan: { shoulders: number; halfLegs: number; trimLb: number }) {
  return saved.shoulders !== plan.shoulders || saved.half_legs !== plan.halfLegs || saved.trim_lb !== plan.trimLb;
}
