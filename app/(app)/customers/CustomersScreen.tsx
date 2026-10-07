"use client";

// Customers list (SPEC 5.9): compact rows with the main contact, their phone,
// call day, and open follow-ups. Store locations sit under their chain.
// Shows active customers unless "Inactive" or "All" is picked. Counts leave
// out chains that have locations; each location is the customer.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useStaffData } from "@/components/data/StaffData";
import { mainContact } from "@/lib/calc/contacts";
import { countable, groupForList, matchesSearch } from "@/lib/calc/customers";
import type { Customer } from "@/lib/db/types";
import EditCustomer from "./EditCustomer";

type Show = "active" | "inactive" | "all";
const SHOW_LABEL: Record<Show, string> = { active: "Active", inactive: "Inactive", all: "All" };
const fits = (show: Show, active: boolean) => show === "all" || (show === "active") === active;

export default function CustomersScreen({ isAdmin }: { isAdmin: boolean }) {
  const { customers, error } = useStaffData();
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");
  const [show, setShow] = useState<Show>("active");

  const counted = useMemo(() => (customers ? countable(customers.list) : []), [customers]);
  const groups = useMemo(() => {
    if (!customers) return [];
    return groupForList(customers.list, (c) => fits(show, c.active) && matchesSearch(filter, c, customers.byId));
  }, [customers, filter, show]);

  // Search matches left out by Active or Inactive, for the "Show them" hint.
  const found = customers ? counted.filter((c) => matchesSearch(filter, c, customers.byId)) : [];
  const shown = found.filter((c) => fits(show, c.active)).length;
  const hidden = found.length - shown;

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
              {SHOW_LABEL[k]} ({counted.filter((c) => fits(k, c.active)).length})
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
              Clear search
            </button>
          )}
        </div>
      )}

      <div className="clist">
        {groups.map(({ top, locations }) => (
          <div key={top.id} className="grid gap-1.5">
            <Row c={top} follow={customers.openFollowUps.get(top.id) ?? 0} parent={locations.length > 0} />
            {locations.length > 0 && (
              <div className="ml-4 grid gap-1.5 border-l-2 border-line pl-3">
                {locations.map((l) => (
                  <Row key={l.id} c={l} follow={customers.openFollowUps.get(l.id) ?? 0} />
                ))}
              </div>
            )}
          </div>
        ))}
        {!customers.list.length && (
          <div className="panel empty">
            No customers yet.
            {isAdmin ? " Add them one at a time, or import a spreadsheet." : " Add them one at a time."}
          </div>
        )}
        {customers.list.length > 0 && !found.length && filter.trim() && (
          <p className="muted">No customer name starts with “{filter.trim()}”.</p>
        )}
        {customers.list.length > 0 && !groups.length && !filter.trim() && (
          <p className="muted">No {show === "active" ? "active" : "inactive"} customers.</p>
        )}
        {hidden > 0 && filter.trim() && (
          <p className="muted">
            {shown ? "Also " : ""}
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

/** One customer: name and follow-ups, then the main contact and call day. The phone calls them. */
function Row({ c, follow, parent }: { c: Customer; follow: number; parent?: boolean }) {
  const who = mainContact(c.contacts);
  const line = [who?.name, c.call_day ? `Call ${c.call_day}` : ""].filter(Boolean).join(" · ");
  return (
    <div className="ccard relative py-2!">
      <Link href={`/customers/${c.id}`} className="min-w-0 flex-1 after:absolute after:inset-0 after:content-['']">
        <span className="block truncate">
          <b>{c.name}</b>
          {!c.active && <span className="small muted"> (not active)</span>}
          {follow > 0 && (
            <span className="fu">
              {follow} follow-up{follow > 1 ? "s" : ""}
            </span>
          )}
        </span>
        <span className="sum block truncate">{line || (parent ? "Locations below" : "No contact yet")}</span>
      </Link>
      {who?.phone && (
        <a
          href={`tel:${who.phone}`}
          className="relative z-10 inline-flex min-h-[44px] shrink-0 items-center text-[.95rem] text-forest"
          aria-label={`Call ${c.name}, ${who.phone}`}
        >
          {who.phone}
        </a>
      )}
    </div>
  );
}
