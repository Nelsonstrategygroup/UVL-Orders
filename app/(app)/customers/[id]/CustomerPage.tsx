"use client";

// A customer's page (SPEC 5.9): contacts, standing notes, log a contact,
// and a history that merges contact log entries with weekly orders.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { getDb, useStaffData } from "@/components/data/StaffData";
import { useWeekData } from "@/components/data/useWeekData";
import OrderEditor from "@/components/OrderEditor";
import Sheet from "@/components/Sheet";
import { orderSummary } from "@/components/ReadBack";
import { useMe } from "@/components/CurrentUser";
import { useToast } from "@/components/Toast";
import { useWeek } from "@/components/Week";
import { billedThrough, deleteBlockers, rolesLabel, type DeleteCheck } from "@/lib/calc/contacts";
import { displayName, orderingCustomers } from "@/lib/calc/customers";
import { niceDate } from "@/lib/dates";
import { downloadText } from "@/components/download";
import { loadCustomerHistory, loadCustomerOrders, type HistoryEntry } from "@/lib/db/load";
import { customerHistoryCsv, fileSafe } from "@/lib/reports";
import {
  customerDeleteCheck,
  deleteCustomer,
  logContact,
  saveCustomerNotes,
  setFollowUpDone,
  updateContact,
} from "@/lib/db/save";
import type { Contact, Customer } from "@/lib/db/types";
import { STATUS_LABEL } from "@/lib/orders";
import EditCustomer from "../EditCustomer";

const KIND: Record<string, string> = { call: "Call", email: "Email", visit: "Visit", note: "Note" };

export default function CustomerPage({ id }: { id: string }) {
  const { customers, catalog, error, reloadCustomers } = useStaffData();
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [editing, setEditing] = useState(false);

  const reloadHistory = useCallback(async () => {
    try {
      setHistory(await loadCustomerHistory(getDb(), id));
    } catch {
      setHistory([]);
    }
  }, [id]);

  useEffect(() => {
    let live = true;
    loadCustomerHistory(getDb(), id).then(
      (h) => live && setHistory(h),
      () => live && setHistory([]),
    );
    return () => {
      live = false;
    };
  }, [id]);

  if (error) return <p className="note bad">Couldn&apos;t load customers: {error}</p>;
  if (!customers || !catalog) return <div className="empty">Loading...</div>;

  const c = customers.byId.get(id);
  if (!c)
    return (
      <div className="panel empty">
        <p>This customer isn&apos;t in the list.</p>
        <Link href="/customers" className="btn">
          Back to Customers
        </Link>
      </div>
    );

  const parent = c.parent_customer_id ? customers.byId.get(c.parent_customer_id) : undefined;
  const kids = customers.list.filter((k) => k.parent_customer_id === c.id);
  const orders = orderingCustomers(customers.list).some((k) => k.id === c.id);
  const billing = billedThrough(c, customers.byId);
  const meta = [c.type, c.call_day ? `Call ${c.call_day}` : "", c.active ? "" : "Not active"].filter(Boolean);

  return (
    <div className="mx-auto max-w-[720px]">
      <Link href="/customers" className="copy text-[.9rem]">
        ‹ All customers
      </Link>
      <div className="mt-2 flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-0">
          <h2>{displayName(c, customers.byId)}</h2>
          <p className="small muted mt-1 mb-0">{meta.join(", ")}</p>
        </div>
        <button type="button" className="btn ghost" onClick={() => setEditing(true)}>
          Edit details and contacts
        </button>
      </div>

      {parent && (
        <p className="small mt-2">
          Location of{" "}
          <Link href={`/customers/${parent.id}`} className="text-forest">
            {parent.name}
          </Link>
          .
        </p>
      )}

      <section className="mt-3 grid gap-2">
        {c.contacts.length ? (
          c.contacts.map((k) => <ContactLine key={k.id} k={k} />)
        ) : (
          <span className="small muted">No contacts yet.</span>
        )}
      </section>

      {billing && (
        <section className="panel mt-4">
          <h3 className="mb-1">
            Billed through{" "}
            <Link href={`/customers/${billing.parent.id}`} className="text-forest">
              {billing.parent.name}
            </Link>
          </h3>
          {billing.contacts.length ? (
            <div className="grid gap-1">
              {billing.contacts.map((k) => (
                <ContactLine key={k.id} k={k} />
              ))}
            </div>
          ) : (
            <p className="small muted my-0">{billing.parent.name} has no billing contact yet.</p>
          )}
        </section>
      )}

      {kids.length > 0 && (
        <section className="panel mt-4">
          <h3 className="mb-1">Locations</h3>
          <p className="small muted mt-0">Each location places its own order.</p>
          <div className="grid gap-1">
            {kids.map((k) => (
              <Link key={k.id} href={`/customers/${k.id}`} className="flex min-h-[44px] items-center text-forest">
                {k.name}
                {!k.active && <span className="small muted ml-2">(not active)</span>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {orders && <ThisWeekOrder customer={c} />}

      <StandingNotes customer={c} onSaved={reloadCustomers} />

      <LogContactForm
        customerId={c.id}
        onSaved={async () => {
          await Promise.all([reloadHistory(), reloadCustomers()]);
        }}
      />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <h3 className="mr-auto">History</h3>
        <DownloadHistory customer={c} name={displayName(c, customers.byId)} />
      </div>
      {history === null ? (
        <p className="small muted">Loading...</p>
      ) : history.length ? (
        <ul className="timeline">
          {history.map((e) =>
            e.type === "contact" ? (
              <ContactEntry key={e.id} entry={e} onChanged={async () => { await Promise.all([reloadHistory(), reloadCustomers()]); }} />
            ) : (
              <li key={`o-${e.week}`}>
                <div className="when">Order, week of {niceDate(e.week)}</div>
                <div className="small">
                  {e.status === "none" ? "No order this week" : orderSummary(e.lines, catalog.products) || STATUS_LABEL[e.status]}
                </div>
                {e.notes && <div className="small muted">{e.notes}</div>}
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="small muted">Nothing yet. Calls you log and weekly orders show up here.</p>
      )}

      <DeleteCustomer customer={c} name={displayName(c, customers.byId)} recheck={[history, kids.length]} />

      {editing && <EditCustomer customer={c} onClose={() => setEditing(false)} />}
    </div>
  );
}

function ContactLine({ k }: { k: Contact }) {
  const roles = rolesLabel(k.roles);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <b>{k.name || "Contact"}</b>
      {roles && <span className="small muted">{roles}</span>}
      {k.phone && (
        <a href={`tel:${k.phone}`} className="inline-flex min-h-[44px] items-center text-forest">
          {k.phone}
        </a>
      )}
      {k.email && (
        <a href={`mailto:${k.email}`} className="text-forest">
          {k.email}
        </a>
      )}
    </div>
  );
}

/**
 * Delete is only for a customer that was never used: no orders, no history,
 * no cut sheet links, no locations. Otherwise say why and point to Active.
 */
function DeleteCustomer({ customer, name, recheck }: { customer: Customer; name: string; recheck: unknown[] }) {
  const { reloadCustomers } = useStaffData();
  const router = useRouter();
  const toast = useToast();
  const [check, setCheck] = useState<DeleteCheck | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(recheck.map((x) => (Array.isArray(x) ? x.length : x)));

  useEffect(() => {
    let live = true;
    customerDeleteCheck(getDb(), customer.id).then(({ check }) => live && setCheck(check));
    return () => {
      live = false;
    };
  }, [customer.id, key]);

  if (!check) return null;
  const why = deleteBlockers(check);

  async function remove() {
    setBusy(true);
    const err = await deleteCustomer(getDb(), customer.id);
    if (err) {
      setBusy(false);
      setError(err.startsWith("Only") || err.includes("Active") || err.includes("locations") ? err : `Couldn't delete: ${err}`);
      return;
    }
    await reloadCustomers();
    toast(`Deleted ${name}`);
    router.push("/customers");
  }

  if (why.length)
    return (
      <p className="small muted mt-6">
        {check.locations
          ? `To delete this customer, delete its ${check.locations === 1 ? "location" : "locations"} first.`
          : `This customer can't be deleted because it has ${why.join(", ")}.`}{" "}
        To hide it, tap <b>Edit details and contacts</b> and untick <b>Active</b>.
      </p>
    );

  return (
    <>
      <p className="mt-6">
        <button type="button" className="btn danger" onClick={() => setAsking(true)}>
          Delete this customer
        </button>
      </p>
      {asking && (
        <Sheet title="Delete this customer?" onClose={() => setAsking(false)}>
          <p className="mt-0">
            <b>{name}</b> and {customer.contacts.length ? "its contacts" : "its details"} will be removed. This can&apos;t be
            undone.
          </p>
          {error && <p className="note bad">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn ghost" onClick={() => setAsking(false)}>
              Keep it
            </button>
            <button type="button" className="btn danger" disabled={busy} onClick={() => void remove()}>
              {busy ? "Deleting..." : "Delete"}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

type ContactItem = Extract<HistoryEntry, { type: "contact" }>;

/** One contact log entry. The author can edit or delete it; anyone can mark its follow-up done. */
function ContactEntry({ entry: e, onChanged }: { entry: ContactItem; onChanged: () => Promise<void> }) {
  const me = useMe();
  const toast = useToast();
  const db = getDb();
  const [editing, setEditing] = useState(false);
  const mine = e.created_by === me.id;

  async function act(p: Promise<string | null>, ok: string, undo?: () => Promise<string | null>) {
    const err = await p;
    if (err) return toast(err.startsWith("Only") ? err : "Couldn't save. Check the internet connection.");
    await onChanged();
    toast(ok, undo ? () => void undo().then(onChanged) : undefined);
  }

  return (
    <li className="t-contact">
      <div className="when">
        {KIND[e.kind] ?? "Note"},{" "}
        {new Date(e.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" })} by{" "}
        {e.by}
        {e.follow_up_date && (
          <span className={`fu ${e.follow_up_done ? "line-through" : ""}`}>Follow up {niceDate(e.follow_up_date)}</span>
        )}
      </div>
      {editing ? (
        <EditContact
          entry={e}
          onCancel={() => setEditing(false)}
          onSave={async (patch) => {
            const err = await updateContact(db, e.id, patch);
            if (err) return toast(err.startsWith("Only") ? err : "Couldn't save. Check the internet connection.");
            setEditing(false);
            await onChanged();
            toast("Saved");
          }}
        />
      ) : (
        <>
          <div className="whitespace-pre-wrap">{e.summary}</div>
          {e.follow_up_note && <div className="small muted">Next: {e.follow_up_note}</div>}
        </>
      )}
      {!editing && (
        <div className="flex flex-wrap gap-x-4">
          {e.follow_up_date && !e.follow_up_done && (
            <button
              type="button"
              className="copy min-h-[44px] text-[.9rem]"
              onClick={() =>
                void act(setFollowUpDone(db, e.id, true), "Follow-up done", () => setFollowUpDone(db, e.id, false))
              }
            >
              Mark follow-up done
            </button>
          )}
          {mine && (
            <>
              <button type="button" className="copy min-h-[44px] text-[.9rem]" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button
                type="button"
                className="copy min-h-[44px] text-[.9rem]"
                onClick={() =>
                  void act(updateContact(db, e.id, { deleted_at: new Date().toISOString() }), "Entry deleted", () =>
                    updateContact(db, e.id, { deleted_at: null }),
                  )
                }
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

function EditContact({
  entry: e,
  onCancel,
  onSave,
}: {
  entry: ContactItem;
  onCancel: () => void;
  onSave: (patch: { kind: string; summary: string; follow_up_date: string | null; follow_up_note: string }) => Promise<void>;
}) {
  const [kind, setKind] = useState(e.kind);
  const [summary, setSummary] = useState(e.summary);
  const [date, setDate] = useState(e.follow_up_date ?? "");
  const [note, setNote] = useState(e.follow_up_note);
  return (
    <div className="panel my-1 p-3!">
      <div className="seg mb-2" role="group" aria-label="Kind">
        {Object.entries(KIND).map(([k, v]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {v}
          </button>
        ))}
      </div>
      <textarea className="field" rows={2} aria-label="What was said" value={summary} onChange={(x) => setSummary(x.target.value)} />
      <div className="mt-1 flex flex-wrap gap-3">
        <div className="min-w-[140px] flex-1">
          <label className="lbl" htmlFor={`fu-d-${e.id}`}>
            Follow up on
          </label>
          <input id={`fu-d-${e.id}`} type="date" className="field" value={date} onChange={(x) => setDate(x.target.value)} />
        </div>
        <div className="min-w-[200px] flex-[2]">
          <label className="lbl" htmlFor={`fu-n-${e.id}`}>
            What to follow up on
          </label>
          <input id={`fu-n-${e.id}`} className="field" value={note} onChange={(x) => setNote(x.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            summary.trim() && void onSave({ kind, summary: summary.trim(), follow_up_date: date || null, follow_up_note: note.trim() })
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}

function ThisWeekOrder({ customer }: { customer: Customer }) {
  const { week } = useWeek();
  const { customers, catalog } = useStaffData();
  const { data, patchOrder, refresh } = useWeekData(week);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  if (!data || !customers || !catalog) return null;
  const o = data.orders.get(customer.id);
  const st = o?.status ?? "todo";
  const sum = o ? orderSummary(o.lines, catalog.products) : "";
  return (
    <section className="panel mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto min-w-0">
          <h3 className="mb-1">Week of {niceDate(week)}</h3>
          <span className={`st ${st}`}>{STATUS_LABEL[st]}</span>
          {sum && <span className="small ml-2">{sum}</span>}
        </div>
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          {st === "ordered" ? "Change the order" : "Enter their order"}
        </button>
      </div>
      {open && (
        <OrderEditor
          week={week}
          customer={customer}
          displayName={displayName(customer, customers.byId)}
          order={o}
          lastWeek={data.lastWeek.get(customer.id)}
          patchOrder={patchOrder}
          refresh={refresh}
          onClose={close}
        />
      )}
    </section>
  );
}

function StandingNotes({ customer, onSaved }: { customer: Customer; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(customer.notes);
  const [busy, setBusy] = useState(false);
  return (
    <section className="mt-4">
      <div className="flex items-center">
        <h3 className="mr-auto text-base!">Standing notes</h3>
        {!editing && (
          <button
            type="button"
            className="copy min-h-[44px] px-2"
            onClick={() => {
              setText(customer.notes);
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea
            className="field"
            rows={4}
            autoFocus
            aria-label="Standing notes"
            placeholder="Delivery needs, who orders, who pays, preferences, pricing"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const err = await saveCustomerNotes(getDb(), customer.id, text.trim());
                setBusy(false);
                if (err) return toast("Couldn't save. Check the internet connection.");
                await onSaved();
                setEditing(false);
                toast("Notes saved");
              }}
            >
              Save notes
            </button>
          </div>
        </>
      ) : (
        <div className={`pin ${customer.notes ? "" : "empty"}`}>
          {customer.notes || "Things that stay true every week. Delivery times, who does the ordering, cut preferences."}
        </div>
      )}
    </section>
  );
}

function LogContactForm({ customerId, onSaved }: { customerId: string; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [kind, setKind] = useState("call");
  const [summary, setSummary] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="panel mt-4 p-3!">
      <h3 className="text-base!">Log a contact</h3>
      <div className="seg my-2" role="group" aria-label="Kind">
        {Object.entries(KIND).map(([k, v]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {v}
          </button>
        ))}
      </div>
      <textarea
        className="field"
        rows={2}
        placeholder="What was said"
        aria-label="What was said"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
      />
      <div className="mt-1 flex flex-wrap gap-3">
        <div className="min-w-[140px] flex-1">
          <label className="lbl" htmlFor="fu-date">
            Follow up on
          </label>
          <input id="fu-date" type="date" className="field" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
        </div>
        <div className="min-w-[200px] flex-[2]">
          <label className="lbl" htmlFor="fu-note">
            What to follow up on
          </label>
          <input
            id="fu-note"
            className="field"
            placeholder="Optional"
            value={followUpNote}
            onChange={(e) => setFollowUpNote(e.target.value)}
          />
        </div>
      </div>
      {error && <p className="note bad mt-2">{error}</p>}
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            if (!summary.trim()) return setError("Write what was said.");
            setBusy(true);
            const err = await logContact(getDb(), {
              customerId,
              kind,
              summary: summary.trim(),
              followUpDate: followUp || null,
              followUpNote: followUpNote.trim(),
            });
            setBusy(false);
            if (err) return setError("Couldn't save. Check the internet connection.");
            setError(null);
            setSummary("");
            setFollowUp("");
            setFollowUpNote("");
            toast("Saved to history");
            await onSaved();
          }}
        >
          Save to history
        </button>
      </div>
    </section>
  );
}

/** "Download order history": every week they answered, as a spreadsheet. */
function DownloadHistory({ customer, name }: { customer: Customer; name: string }) {
  const { catalog } = useStaffData();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!catalog) return;
    setBusy(true);
    try {
      const orders = await loadCustomerOrders(getDb(), customer.id);
      if (!orders.length) toast("No orders yet to download.");
      else downloadText(`${fileSafe(name)}-order-history.csv`, customerHistoryCsv(name, orders, catalog.products));
    } catch {
      toast("Couldn't download. Check the internet connection.");
    }
    setBusy(false);
  }
  return (
    <button type="button" className="btn ghost" disabled={busy} onClick={() => void go()}>
      {busy ? "Getting it ready..." : "Download order history"}
    </button>
  );
}
