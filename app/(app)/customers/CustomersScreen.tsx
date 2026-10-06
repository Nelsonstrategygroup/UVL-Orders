"use client";

// Customers list (SPEC 5.9): type, call day, last contact, open follow-ups.
// Shows active customers unless "Inactive" or "All" is picked.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useStaffData } from "@/components/data/StaffData";
import { displayName, matchesSearch, sortByDisplayName } from "@/lib/calc/customers";
import { ago } from "@/lib/dates";
import EditCustomer from "./EditCustomer";

type Show = "active" | "inactive" | "all";
const SHOW_LABEL: Record<Show, string> = { active: "Active", inactive: "Inactive", all: "All" };
const fits = (show: Show, active: boolean) => show === "all" || (show === "active") === active;

export default function CustomersScreen({ isAdmin }: { isAdmin: boolean }) {
  const { customers, error } = useStaffData();
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");
  const [show, setShow] = useState<Show>("active");

  // Everyone matching the search, then split by what's picked.
  const found = useMemo(() => {
    if (!customers) return [];
    return sortByDisplayName(customers.list, customers.byId).filter((c) => matchesSearch(filter, c, customers.byId));
  }, [customers, filter]);
  const list = found.filter((c) => fits(show, c.active));
  const hidden = found.length - list.length;

  if (error) return <p className="note bad">Couldn&apos;t load customers: {error}</p>;
  if (!customers) return <div className="empty">Loading customers...</div>;

  return (
    <div className="max-w-[760px]">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto">Customers</h2>
        {isAdmin && (
          <Link href="/customers/import" className="btn ghost">
            Import customers from a spreadsheet
          </Link>
        )}
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          Add customer
        </button>
      </div>

      {customers.list.length > 0 && (
        <div className="seg mb-3" role="group" aria-label="Show">
          {(["active", "inactive", "all"] as Show[]).map((k) => (
            <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>
              {SHOW_LABEL[k]} ({customers.list.filter((c) => fits(k, c.active)).length})
            </button>
          ))}
        </div>
      )}

      {customers.list.length > 0 && (
        <div className="mb-3 flex gap-2">
          <input
            type="search"
            className="field big"
            placeholder="Type a name to find a customer"
            aria-label="Find a customer"
            autoComplete="off"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter && (
            <button type="button" className="btn ghost shrink-0" onClick={() => setFilter("")}>
              Show all
            </button>
          )}
        </div>
      )}

      <div className="clist">
        {list.map((c) => {
          const last = customers.lastContact.get(c.id);
          const open = customers.openFollowUps.get(c.id) ?? 0;
          const kids = customers.list.filter((k) => k.parent_customer_id === c.id).length;
          const meta = [
            c.type,
            c.call_day ? `Call ${c.call_day}` : "",
            kids ? `${kids} location${kids === 1 ? "" : "s"}` : "",
          ].filter(Boolean);
          return (
            <Link key={c.id} href={`/customers/${c.id}`} className="ccard">
              <span className="min-w-0">
                <b>{displayName(c, customers.byId)}</b>
                {!c.active && <span className="small muted"> (not active)</span>}
                {open > 0 && (
                  <span className="fu">
                    {open} follow-up{open > 1 ? "s" : ""}
                  </span>
                )}
                <br />
                <span className="sum">
                  {meta.join(", ")}
                  {last ? `. Last contact ${ago(last.created_at)}` : ""}
                </span>
              </span>
              <span className="small muted">Open</span>
            </Link>
          );
        })}
        {!customers.list.length && (
          <div className="panel empty">
            No customers yet.
            {isAdmin ? " Add them one at a time, or import a spreadsheet." : " Add them one at a time."}
          </div>
        )}
        {customers.list.length > 0 && !found.length && filter.trim() && (
          <p className="muted">No customer name starts with “{filter.trim()}”.</p>
        )}
        {customers.list.length > 0 && found.length > 0 && !list.length && !filter.trim() && (
          <p className="muted">No {show === "active" ? "active" : "inactive"} customers.</p>
        )}
        {hidden > 0 && filter.trim() && (
          <p className="muted">
            {list.length ? "Also " : ""}
            {hidden} {show === "active" ? "inactive" : "active"} {hidden === 1 ? "match" : "matches"}.{" "}
            <button type="button" className="copy min-h-[44px]" onClick={() => setShow("all")}>
              Show them
            </button>
          </p>
        )}
      </div>

      {adding && <EditCustomer customer={null} onClose={() => setAdding(false)} />}
    </div>
  );
}
