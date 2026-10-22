"use client";

// Lines a customer asked for in this week, not confirmed yet (change request
// 10/22/26): shown at the top of Calls and the order screen, with Confirm (as
// typed), a changeable amount, and Drop (with Undo).

import { useState } from "react";
import { getDb } from "./data/StaffData";
import { useToast } from "./Toast";
import { num } from "@/lib/calc/num";
import { niceDate, todayISO, weekName } from "@/lib/dates";
import { changeRequest, confirmRequest, dropRequest, restoreRequest } from "@/lib/db/save";
import type { CatalogProduct, OrderRequest } from "@/lib/db/types";
import { cleanQtyInput, qtyText } from "@/lib/orders";

/** "Oct 22" for when it was asked. */
export const askedOn = (r: OrderRequest) => niceDate(todayISO(new Date(r.requested_at)));

/** "10 packs Front Shanks" */
export function requestText(r: OrderRequest, products: Map<string, CatalogProduct>): string {
  const p = products.get(r.product_id);
  return `${qtyText(r.qty, r.unit ?? p?.unit ?? "each")} ${p?.name ?? r.product_id}`;
}

export default function RequestedLines({
  requests,
  products,
  canChange,
  onChanged,
}: {
  requests: OrderRequest[] | undefined;
  products: Map<string, CatalogProduct>;
  canChange: boolean;
  /** Reload after a change (the lines move between requested and ordered). */
  onChanged: () => void;
}) {
  if (!requests?.length) return null;
  return (
    <section className="requested" aria-label="Requested, confirm on the call">
      <b>Requested, confirm on the call</b>
      {requests.map((r) => (
        <RequestRow key={r.id} r={r} products={products} canChange={canChange} onChanged={onChanged} />
      ))}
    </section>
  );
}

function RequestRow({
  r,
  products,
  canChange,
  onChanged,
}: {
  r: OrderRequest;
  products: Map<string, CatalogProduct>;
  canChange: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const db = getDb();
  const [text, setText] = useState(String(r.qty));
  const [busy, setBusy] = useState(false);
  const qty = num(text);

  async function act(fn: () => Promise<string | null>, done: string, undo?: () => Promise<void>) {
    setBusy(true);
    const err = await fn();
    setBusy(false);
    onChanged();
    if (err) toast(`Couldn't save: ${err}`);
    else toast(done, undo);
  }

  return (
    <div className="reqrow">
      <p className="m-0">
        Requested on {askedOn(r)}: <b>{requestText(r, products)}</b>
        {r.moved_from_week ? ` (moved from ${weekName(r.moved_from_week)})` : ""}
        {r.requested_by_name ? `, by ${r.requested_by_name}` : ""}. Confirm, change, or drop.
      </p>
      {canChange && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            className="field num w-24!"
            inputMode="decimal"
            aria-label={`Amount of ${products.get(r.product_id)?.name ?? "this"} to confirm`}
            value={text}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setText(cleanQtyInput(e.target.value))}
            onBlur={() => {
              // Change: keep the new amount on the request until it's confirmed.
              if (qty > 0 && qty !== r.qty) void act(() => changeRequest(db, r.id, qty), "Amount changed");
            }}
          />
          <button type="button" className="btn" disabled={busy || !(qty > 0)} onClick={() => void act(() => confirmRequest(db, r.id, qty), "Confirmed, added to the order")}>
            Confirm
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const { row, error } = await dropRequest(db, r.id);
              setBusy(false);
              onChanged();
              if (error || !row) return toast(`Couldn't drop it: ${error ?? "it's gone already"}`);
              toast("Request dropped", async () => {
                const err = await restoreRequest(db, row);
                onChanged();
                if (err) toast(`Couldn't put it back: ${err}`);
              });
            }}
          >
            Drop
          </button>
        </div>
      )}
    </div>
  );
}
