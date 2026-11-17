"use client";

// P&L stage C (Lucas, 11/16/26): a week is Open, Reviewed or Closed. Any admin
// can mark it "Reviewed by me", close it, or reopen it with a reason.
// Closing saves the P&L as shown; while closed, the week's orders, packing,
// invoices, weigh sheets, expenses and adjustments can't change. Closing
// with checks still failing asks first and records what was missing.

import { useState } from "react";
import { getDb } from "@/components/data/StaffData";
import { useMe } from "@/components/CurrentUser";
import { useToast } from "@/components/Toast";
import type { PnlCheck } from "@/lib/calc/pnlDetail";
import { stamp } from "@/lib/calc/pnlDetail";
import { closeWeek, reopenWeek, reviewWeek, type WeekEvent, type WeekStatus as Status } from "@/lib/db/pnl";

const ACTION: Record<WeekEvent["action"], string> = {
  reviewed: "Reviewed",
  review_removed: "Review taken back",
  closed: "Closed",
  reopened: "Reopened",
};

export function WeekStatus({
  week,
  status,
  checks,
  snapshot,
  refresh,
}: {
  week: string;
  status: Status;
  checks: PnlCheck[];
  /** What closing saves; null when the week is closed. */
  snapshot: (() => Record<string, unknown>) | null;
  refresh: () => void;
}) {
  const db = getDb();
  const me = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const closed = status.closed;
  const mine = status.reviews.some((r) => r.user_id === me.id);
  const notYet = status.admins.filter((a) => !status.reviews.some((r) => r.user_id === a.id));
  const label = closed ? "Closed" : status.reviews.length ? "Reviewed" : "Open";

  const run = async (f: () => Promise<string | null>, done: string) => {
    setBusy(true);
    const err = await f();
    setBusy(false);
    toast(err ? `Couldn't do that: ${err}` : done);
    refresh();
  };

  const close = () => {
    if (!snapshot) return;
    const missing = checks.map((c) => c.text);
    const ask = missing.length
      ? `These still need attention:\n\n${missing.map((m) => `• ${m}`).join("\n")}\n\nClose the week anyway? What's missing will be recorded with the close.`
      : "Close this week? Its P&L is saved as it is now, and its orders, packing, invoices, weigh sheets, expenses and adjustments can't change until it's reopened.";
    if (!confirm(ask)) return;
    void run(() => closeWeek(db, week, snapshot(), missing), "Week closed");
  };

  const reopen = () => {
    const why = prompt("Why is this week being reopened? (required)");
    if (why == null) return;
    if (!why.trim()) return toast("Type why the week is being reopened");
    void run(() => reopenWeek(db, week, why), "Week reopened");
  };

  return (
    <section className="panel mt-3" aria-labelledby="pnl-status">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 id="pnl-status" className="m-0">
          Status: {label}
        </h3>
        {closed && (
          <span className="small">
            Closed by {closed.closed_by_name || "someone"}, {stamp(closed.closed_at)}
          </span>
        )}
      </div>
      {closed && (
        <p className="small mt-1 mb-0">
          This is the P&amp;L as it was when the week was closed. To change anything in this week (orders, packing, invoices,
          weigh sheets, expenses, adjustments), reopen it.
        </p>
      )}
      {closed && closed.missing.length > 0 && (
        <div className="note warn small mt-2">
          <b>Closed with these still missing:</b>
          <ul className="m-0 pl-5">
            {closed.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      <ul className="small m-0 mt-1 list-none p-0">
        {status.reviews.map((r) => (
          <li key={r.user_id}>
            Reviewed by {r.name || "someone"}, {stamp(r.reviewed_at)}
          </li>
        ))}
        {notYet.length > 0 && <li className="muted">Not yet reviewed by {notYet.map((a) => a.name).join(", ")}</li>}
      </ul>
      <div className="noprint mt-2 flex flex-wrap gap-2">
        <button type="button" className={mine ? "btn ghost" : "btn"} disabled={busy} onClick={() => void run(() => reviewWeek(db, week, !mine), mine ? "Review taken back" : "Marked reviewed")}>
          {mine ? "Take back my review" : "Reviewed by me"}
        </button>
        {closed ? (
          <button type="button" className="btn ghost" disabled={busy} onClick={reopen}>
            Reopen week
          </button>
        ) : (
          <button type="button" className="btn ghost" disabled={busy || !snapshot} onClick={close}>
            Close week
          </button>
        )}
      </div>
      {status.events.length > 0 && (
        <details className="noprint mt-2">
          <summary className="copy small">History ({status.events.length})</summary>
          <ul className="small m-0 mt-1 list-none p-0">
            {[...status.events].reverse().map((e) => (
              <li key={e.id} className="border-t border-line py-1">
                <b>{ACTION[e.action]}</b> by {e.by_name || "someone"}, {stamp(e.at)}
                {e.reason && <span>: {e.reason}</span>}
                {e.missing.length > 0 && <span className="block muted">Still missing then: {e.missing.join(" ")}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
