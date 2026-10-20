"use client";

// The big "Online, all saved" / "Offline, 12 things waiting" line on Packing
// and Scan boxes (SPEC 11.7), when the data was last loaded with signal, and
// anything the server refused (kept, with Try again or Remove).

import { formatWhen } from "@/lib/format";
import { statusLine, type Queued } from "@/lib/offline/outbox";
import { useOutbox } from "./OutboxProvider";

function describe(q: Queued): string {
  const a = q.action;
  switch (a.type) {
    case "weight-add":
      return `A weight of ${a.weight} lb`;
    case "weight-remove":
      return "Taking off a weight";
    case "mark":
      return "A line mark";
    case "pallet-text":
      return `Pallet note "${a.pallet}"`;
    case "box":
      return `A box, ${a.box.weight} lb, lot ${a.box.lot}${a.box.serial ? `, serial ${a.box.serial}` : ""}`;
    case "gtin-map":
      return `GTIN ${a.gtin}`;
    case "pallet-add":
      return `Pallet ${a.number}`;
  }
}

export default function OfflineStatus({ savedAt, fromPhone }: { savedAt: string | null; fromPhone: boolean }) {
  const o = useOutbox();
  const offline = !o.online || fromPhone;
  const line = statusLine({ online: !offline, waiting: o.waiting, stuck: o.stuck.length, needLogin: o.needLogin, syncing: o.syncing });
  const tone = o.stuck.length || o.needLogin ? "bad" : offline || o.waiting ? "wait" : "ok";

  return (
    <div className={`netstatus ${tone}`} role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <b className="mr-auto">{line}</b>
        {o.waiting > 0 && !offline && (
          <button type="button" className="btn ghost" onClick={o.syncNow}>
            Upload now
          </button>
        )}
      </div>
      {savedAt && (
        <div className="small">
          {fromPhone ? "Showing the copy on this phone. " : ""}Last updated {formatWhen(savedAt)}.
        </div>
      )}
      {o.needLogin && <div className="small">Nothing is lost. Log in again (with signal) and it uploads.</div>}
      {o.notes.map((n, i) => (
        <div key={i} className="small mt-1">
          ⚠ {n}{" "}
          {i === o.notes.length - 1 && (
            <button type="button" className="copy text-[.85rem]" onClick={o.clearNotes}>
              OK
            </button>
          )}
        </div>
      ))}
      {o.stuck.map((q) => (
        <div key={q.seq} className="small mt-1">
          ✕ {describe(q)} couldn&apos;t upload: {q.lastError}{" "}
          <button type="button" className="copy text-[.85rem]" onClick={() => o.retry(q.seq)}>
            Try again
          </button>{" "}
          <button
            type="button"
            className="copy text-[.85rem]"
            onClick={() => window.confirm(`Remove this from the phone? ${describe(q)} will not be saved.`) && o.discard(q.seq)}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
