"use client";

// Calls (SPEC 5.1): one customer at a time, with big buttons.

import { useCan } from "@/components/CurrentUser";
import ViewOnly from "@/components/ViewOnly";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useWeekData } from "@/components/data/useWeekData";
import OrderEditor from "@/components/OrderEditor";
import ReadBack from "@/components/ReadBack";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { useWeek, WeekBar } from "@/components/Week";
import { callQueue, displayName, isDone, orderingCustomers } from "@/lib/calc/customers";
import { ago, todayName } from "@/lib/dates";
import { setOrder } from "@/lib/db/save";
import type { Customer, Order, OrderStatus, Qty, Units } from "@/lib/db/types";
import { hasLines, snapshot, STATUS_LABEL } from "@/lib/orders";

export default function CallsScreen() {
  // Taking answers needs Change on Calls or Orders; anyone else just looks.
  const canCalls = useCan("calls").change;
  const canOrders = useCan("orders").change;
  const canAnswer = canCalls || canOrders;
  const { week } = useWeek();
  const { catalog, customers, error: loadError } = useStaffData();
  const { data, error, patchOrder, refresh } = useWeekData(week);
  const toast = useToast();
  const db = getDb();

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [callbackId, setCallbackId] = useState<string | null>(null);

  const byId = customers?.byId;
  const queue = useMemo(() => {
    if (!customers || !data) return [];
    return callQueue(
      orderingCustomers(customers.list),
      (id) => data.orders.get(id)?.status,
      todayName(),
      customers.byId,
    );
  }, [customers, data]);

  const closeEditor = useCallback(() => {
    if (editingId) {
      setPickedId(editingId);
      setAfterId(editingId);
    }
    setEditingId(null);
    window.scrollTo(0, 0);
  }, [editingId]);

  if (loadError || error) return <p className="note bad">Couldn&apos;t load orders: {loadError || error}</p>;
  if (!catalog || !customers || !data || !byId)
    return (
      <>
        <WeekBar />
        <div className="empty">Loading orders...</div>
      </>
    );

  const header = <WeekBar processDate={data.weekRow?.process_date} />;
  if (!queue.length) {
    return (
      <>
        {header}
        <div className="panel empty">
          <h3 className="mb-2">No customers yet</h3>
          <p>Add customers first, then they show up here each week.</p>
          <Link href="/customers" className="btn">
            Go to Customers
          </Link>
        </div>
      </>
    );
  }

  const doneCount = queue.filter((c) => isDone(data.orders.get(c.id)?.status)).length;
  const current =
    queue.find((c) => c.id === pickedId) ?? queue.find((c) => !isDone(data.orders.get(c.id)?.status)) ?? queue[0];
  const order = data.orders.get(current.id);
  const status: OrderStatus = order?.status ?? "todo";
  const prev = data.lastWeek.get(current.id);
  const prevLines: Qty = prev?.lines ?? {};
  const hasPrev = hasLines(prevLines);
  const parent = current.parent_customer_id ? byId.get(current.parent_customer_id) : undefined;
  const phone =
    current.contacts.find((k) => k.phone)?.phone ?? parent?.contacts.find((k) => k.phone)?.phone ?? null;
  const nextUp = queue.find((c) => c.id !== current.id && !isDone(data.orders.get(c.id)?.status));
  const last = customers.lastContact.get(current.id);
  const name = (c: Customer) => displayName(c, byId);

  async function apply(change: { status: OrderStatus; notes?: string; lines?: Qty; units?: Units }, message: string) {
    const cid = current.id;
    const before = snapshot(data!.orders.get(cid));
    const next: Order = {
      id: order?.id ?? "",
      customer_id: cid,
      status: change.status,
      notes: change.notes ?? before.notes,
      lines: change.lines ?? before.lines,
      units: change.units ?? (change.lines ? {} : before.units),
    };
    patchOrder(cid, next);
    setPickedId(cid);
    setAfterId(cid);
    window.scrollTo(0, 0);
    const err = await setOrder(db, { week, customerId: cid, ...change });
    refresh();
    if (err) {
      setAfterId(null);
      toast("Couldn't save. Check the internet connection.");
      return;
    }
    toast(message, async () => {
      patchOrder(cid, { ...next, ...before });
      setAfterId(null);
      setPickedId(cid);
      await setOrder(db, { week, customerId: cid, ...before });
      refresh();
    });
  }

  const goTo = (id: string) => {
    setPickedId(id);
    setAfterId(null);
    window.scrollTo(0, 0);
  };

  let body: React.ReactNode;
  if (afterId === current.id) {
    body = (
      <>
        <p className="mt-3 mb-0 text-[1.1rem]">
          {status === "none"
            ? "Saved. No order this week."
            : status === "callback"
              ? "Saved. Marked to call back."
              : status === "ordered"
                ? "Saved. Read this back to them:"
                : "Saved."}
        </p>
        {status === "ordered" && <ReadBack lines={order?.lines ?? {}} products={catalog.products} />}
        {status === "ordered" && canAnswer && (
          <button type="button" className="bigbtn alt" onClick={() => setEditingId(current.id)}>
            Fix something
          </button>
        )}
        {nextUp ? (
          <button type="button" className="bigbtn" onClick={() => goTo(nextUp.id)}>
            Next: {name(nextUp)}
          </button>
        ) : (
          <p className="note mt-4">That&apos;s everyone for this week.</p>
        )}
      </>
    );
  } else {
    body = (
      <>
        {current.notes && <div className="pin">{current.notes}</div>}
        {last && (
          <div className="lastc">
            Last contact {ago(last.created_at)}: {last.summary}
          </div>
        )}
        {phone && (
          <a className="bigbtn tel" href={`tel:${phone}`}>
            Call {phone}
          </a>
        )}
        {status === "ordered" ? (
          <>
            <p className="mt-3 mb-0">Already ordered this week:</p>
            <ReadBack lines={order?.lines ?? {}} products={catalog.products} />
          </>
        ) : hasPrev ? (
          <>
            <p className="mt-3 mb-0">Last week they ordered:</p>
            <ReadBack lines={prevLines} units={prev?.units} products={catalog.products} />
          </>
        ) : (
          <p className="muted">No order last week.</p>
        )}
        {canAnswer && hasPrev && status !== "ordered" && (
          <button
            type="button"
            className="bigbtn"
            onClick={() =>
              void apply({ status: "ordered", lines: { ...prevLines }, units: { ...(prev?.units ?? {}) } }, "Copied last week's order")
            }
          >
            Same as last week
          </button>
        )}
        {canAnswer && (
          <>
            <button
              type="button"
              className={`bigbtn ${hasPrev && status !== "ordered" ? "alt" : ""}`}
              onClick={() => setEditingId(current.id)}
            >
              {status === "ordered" ? "Change the order" : hasPrev ? "Different order this week" : "Enter their order"}
            </button>
            <button
              type="button"
              className="bigbtn quiet"
              onClick={() => void apply({ status: "none", lines: {} }, "No order this week")}
            >
              No order this week
            </button>
            <button type="button" className="bigbtn quiet" onClick={() => setCallbackId(current.id)}>
              Call back later
            </button>
          </>
        )}
        {status === "callback" && order?.notes && <p className="small muted">{order.notes}</p>}
      </>
    );
  }

  const editing = editingId ? byId.get(editingId) : undefined;

  return (
    <>
      {header}
      {!canAnswer && <ViewOnly what="calls" />}
      <div className="callprog">
        <h2>Calls</h2>
        <span className="muted">
          {doneCount} of {queue.length} done
        </span>
      </div>

      <div className="callcard">
        <div className="flex items-start gap-3">
          <h2 className="flex-1">{name(current)}</h2>
          <span className={`st ${status} mt-2`}>{STATUS_LABEL[status]}</span>
        </div>
        {body}
      </div>

      <div className="queue">
        <h3 className="mb-1">Everyone this week</h3>
        {queue.map((c) => {
          const s = data.orders.get(c.id)?.status ?? "todo";
          return (
            <button key={c.id} type="button" aria-current={c.id === current.id} onClick={() => goTo(c.id)}>
              <span className="min-w-0 truncate">{name(c)}</span>
              <span className={`st ${s}`}>{STATUS_LABEL[s]}</span>
            </button>
          );
        })}
      </div>

      {editing && (
        <OrderEditor
          week={week}
          customer={editing}
          displayName={name(editing)}
          order={data.orders.get(editing.id)}
          lastWeek={data.lastWeek.get(editing.id)}
          patchOrder={patchOrder}
          refresh={refresh}
          onClose={closeEditor}
        />
      )}

      {callbackId && (
        <CallBackSheet
          onClose={() => setCallbackId(null)}
          onSave={(note) => {
            setCallbackId(null);
            void apply({ status: "callback", notes: note }, "Marked to call back");
          }}
        />
      )}
    </>
  );
}

function CallBackSheet({ onClose, onSave }: { onClose: () => void; onSave: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Sheet title="Call back later" onClose={onClose}>
      <label className="lbl big" htmlFor="cb-note">
        When should you call back? (optional)
      </label>
      <input
        id="cb-note"
        className="field big"
        placeholder="Wednesday after 10"
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave(note.trim());
        }}
      />
      <button type="button" className="bigbtn" onClick={() => onSave(note.trim())}>
        Save
      </button>
    </Sheet>
  );
}
