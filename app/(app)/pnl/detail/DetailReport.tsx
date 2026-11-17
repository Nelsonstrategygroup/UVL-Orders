"use client";

// P&L detail (Lucas, 11/15/26): every line of the week's P&L with its formula,
// the rates and dates used, and the records it came from, in one document for
// the owners to review on paper. Same numbers as the P&L page (usePnlWeek).

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import PrintHeader from "@/components/PrintHeader";
import { useWeek, WeekBar } from "@/components/Week";
import { isISODate, weekDays, weekName, niceDate } from "@/lib/dates";
import { stamp } from "@/lib/calc/pnlDetail";
import { DetailBlock } from "../Detail";
import { usePnlWeek } from "../usePnlWeek";

export default function DetailReport() {
  const { week, setWeek } = useWeek();
  // ?week= keeps the week it was opened from (the P&L's link).
  const asked = useSearchParams().get("week");
  useEffect(() => {
    if (asked && isISODate(asked) && asked !== week) setWeek(asked);
    // Only when opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  const w = usePnlWeek(week);
  const head = (
    <div className="noprint">
      <WeekBar />
    </div>
  );
  if (w.error) return <>{head}<p className="note bad">Couldn&apos;t load the P&amp;L: {w.error}</p></>;
  if (!w.ready) return <>{head}<p className="small muted">Loading...</p></>;
  const { data, details, checks, p, status } = w;
  const closed = status.closed;
  const days = weekDays(week);

  return (
    <div className="max-w-[900px]">
      {head}
      <div className="noprint mt-2 flex flex-wrap items-center gap-2">
        <Link href="/pnl" className="btn ghost">
          &larr; Weekly P&amp;L
        </Link>
        <h2 className="m-0 mr-auto">P&amp;L detail · {weekName(week)}</h2>
        <button type="button" className="btn" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <PrintHeader className="print-only" inv={data.inv} title="P&L detail" when={`Week of ${weekName(week)}`} />
      <p className="small mt-2">
        Thursday {niceDate(days[0])} to Wednesday {niceDate(days[6])}. Every line with how it was worked out, the rates and the
        dates they apply from, and the records it came from.
        {p.projected && <b> Income and everything worked out from it are projected: not every invoice is finalized.</b>}
      </p>
      {closed && (
        <p className="note">
          <b>Closed</b> by {closed.closed_by_name || "someone"}, {stamp(closed.closed_at)}. This is the P&amp;L as it was when the
          week was closed.
          {status.reviews.length > 0 && ` Reviewed by ${status.reviews.map((r) => `${r.name} (${stamp(r.reviewed_at)})`).join(", ")}.`}
        </p>
      )}
      {!closed && status.reviews.length > 0 && (
        <p className="small">Reviewed by {status.reviews.map((r) => `${r.name} (${stamp(r.reviewed_at)})`).join(", ")}.</p>
      )}
      {closed ? (
        closed.missing.length > 0 && (
          <div className="note warn">
            <b>Closed with these still missing:</b>
            <ul className="m-0 mt-1 pl-5">
              {closed.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )
      ) : (
      <div className={checks.length ? "note warn" : "note bg-ok"}>
        {checks.length ? (
          <>
            <b>Missing before this week can be trusted:</b>
            <ul className="m-0 mt-1 pl-5">
              {checks.map((c) => (
                <li key={c.key}>{c.text}</li>
              ))}
            </ul>
          </>
        ) : (
          <b>Complete.</b>
        )}
      </div>
      )}
      <div className="grid gap-4">
        {details.map((d) => (
          <div key={d.key} className="panel">
            <DetailBlock d={d} />
          </div>
        ))}
      </div>
    </div>
  );
}
