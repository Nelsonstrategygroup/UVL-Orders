"use client";

// The Weekly P&L's header (Lucas, 11/17/26): the week, INV#, a status chip
// (Open, Reviewed, Closed), and the buttons: Review (owners only), Close or
// Reopen week (any admin), Add / adjust, P&L detail, Activity, Print. Under
// it: who of the owners has reviewed it, and the week's history.
//
// Closing saves the P&L as shown; while closed, the week's orders, packing,
// invoices, carcass weights, expenses and adjustments can't change. Closing
// with checks still failing asks first and records what was missing.

import Link from "next/link";
import { useState } from "react";
import { getDb } from "@/components/data/StaffData";
import { useCan, useMe } from "@/components/CurrentUser";
import { useToast } from "@/components/Toast";
import type { PnlCheck } from "@/lib/calc/pnlDetail";
import { stamp } from "@/lib/calc/pnlDetail";
import { weekName } from "@/lib/dates";
import { closeWeek, reopenWeek, reviewWeek, type WeekEvent, type WeekStatus as Status } from "@/lib/db/pnl";

const ACTION: Record<WeekEvent["action"], string> = {
  reviewed: "Reviewed",
  review_removed: "Review taken back",
  closed: "Closed",
  reopened: "Reopened",
};

export function WeekHeader({
  week,
  inv,
  status,
  checks,
  snapshot,
  refresh,
  onHelp,
}: {
  week: string;
  inv: number | null;
  status: Status;
  checks: PnlCheck[];
  /** What closing saves; null when the week is closed. */
  snapshot: (() => Record<string, unknown>) | null;
  refresh: () => void;
  onHelp: () => void;
}) {
  const db = getDb();
  const me = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const closed = status.closed;
  const isOwner = status.owners.some((o) => o.profile_id === me.id);
  // Closing and reopening: admins. Entries and adjustments: Change on the Weekly P&L.
  const isAdmin = me.role === "admin";
  const canChange = useCan("pnl").change;
  const mine = status.reviews.some((r) => r.user_id === me.id);
  const reviewed = status.owners.filter((o) => o.profile_id && status.reviews.some((r) => r.user_id === o.profile_id));
  const label = closed ? "Closed" : reviewed.length ? "Reviewed" : "Open";

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
      : "Close this week? Its P&L is saved as it is now, and its orders, packing, invoices, carcass weights, expenses and adjustments can't change until it's reopened.";
    if (!confirm(ask)) return;
    void run(() => closeWeek(db, week, snapshot(), missing), "Week closed");
  };
  const reopen = () => {
    const why = prompt("Why is this week being reopened? (required)");
    if (why == null) return;
    if (!why.trim()) return toast("Type why the week is being reopened");
    void run(() => reopenWeek(db, week, why), "Week reopened");
  };

  const ownerText = (o: Status["owners"][number]) => {
    const r = o.profile_id ? status.reviews.find((x) => x.user_id === o.profile_id) : null;
    if (r) return `${o.name}, ${stamp(r.reviewed_at)}`;
    return o.profile_id ? `${o.name} (not yet)` : `${o.name} (no login yet)`;
  };

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0">
          Weekly P&amp;L · {weekName(week)}
          {inv != null && <span className="muted"> · INV# {inv}</span>}
        </h2>
        <span className={`tag ${closed ? "none" : reviewed.length ? "ordered" : ""}`}>{label}</span>
        <span className="noprint ml-auto flex flex-wrap gap-2">
          {isOwner && (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => void run(() => reviewWeek(db, week, !mine), mine ? "Review taken back" : "Marked reviewed")}>
              {mine ? "Take back review" : "Review"}
            </button>
          )}
          {!isAdmin ? null : closed ? (
            <button type="button" className="btn ghost" disabled={busy} onClick={reopen}>
              Reopen week
            </button>
          ) : (
            <button type="button" className="btn ghost" disabled={busy || !snapshot} onClick={close}>
              Close week
            </button>
          )}
          {!closed && canChange && (
            <Link href={`/pnl/entries?week=${week}`} className="btn ghost">
              Add / adjust
            </Link>
          )}
          <span className="contents max-sm:hidden">
            <Link href={`/pnl/detail?week=${week}`} className="btn ghost">
              P&amp;L detail
            </Link>
            {isAdmin && (
              <Link href={`/pnl/activity?week=${week}`} className="btn ghost">
                Activity
              </Link>
            )}
            <button type="button" className="btn ghost" onClick={() => window.print()}>
              Print
            </button>
          </span>
          <details className="sm:hidden">
            <summary className="btn ghost list-none">More</summary>
            <div className="mt-1 flex flex-col gap-1">
              <Link href={`/pnl/detail?week=${week}`} className="btn ghost">
                P&amp;L detail
              </Link>
              {isAdmin && (
                <Link href={`/pnl/activity?week=${week}`} className="btn ghost">
                  Activity
                </Link>
              )}
            </div>
          </details>
        </span>
      </div>
      <p className="small muted m-0 mt-1">
        {closed && (
          <>
            Closed by {closed.closed_by_name || "someone"}, {stamp(closed.closed_at)}: this is the P&amp;L as it was then. ·{" "}
          </>
        )}
        Reviewed by: {status.owners.length ? status.owners.map(ownerText).join(", ") : "no owners set (Setup > P&L Setup)"}
        <span className="noprint">
          {" "}
          ·{" "}
          <button type="button" className="copy p-0" onClick={onHelp}>
            How this page works
          </button>
        </span>
      </p>
      {closed && closed.missing.length > 0 && <p className="small m-0">Closed with these still missing: {closed.missing.join(" ")}</p>}
      {status.events.length > 0 && (
        <details className="noprint small mt-1">
          <summary className="copy">History ({status.events.length})</summary>
          <ul className="m-0 mt-1 list-none p-0">
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
    </div>
  );
}
