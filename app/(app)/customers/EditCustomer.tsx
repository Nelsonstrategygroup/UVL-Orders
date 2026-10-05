"use client";

// Add or edit a customer: name, type, call day, parent, active, contacts
// (SPEC 5.9). Ported from the prototype's editCustomer.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getDb, useStaffData } from "@/components/data/StaffData";
import Sheet from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { DAYS } from "@/lib/dates";
import { saveCustomer } from "@/lib/db/save";
import type { Customer } from "@/lib/db/types";
import { CUSTOMER_TYPES } from "@/lib/import/customers";

type ContactDraft = { id?: string; name: string; role: string; phone: string; email: string };
const blank = (): ContactDraft => ({ name: "", role: "", phone: "", email: "" });

export default function EditCustomer({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const { customers, reloadCustomers } = useStaffData();
  const router = useRouter();
  const toast = useToast();

  const [name, setName] = useState(customer?.name ?? "");
  const [type, setType] = useState<string>(customer?.type ?? "Retail");
  const [callDay, setCallDay] = useState(customer?.call_day ?? "");
  const [parentId, setParentId] = useState(customer?.parent_customer_id ?? "");
  const [active, setActive] = useState(customer?.active ?? true);
  const [contacts, setContacts] = useState<ContactDraft[]>(() => {
    const list = (customer?.contacts ?? []).map((k) => ({ id: k.id, name: k.name, role: k.role, phone: k.phone, email: k.email }));
    return list.length ? list : [blank()];
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Possible parents: customers that are not themselves locations, not this
  // customer, and (for a customer that has locations) none at all.
  const hasKids = !!customer && !!customers?.list.some((c) => c.parent_customer_id === customer.id);
  const parents = (customers?.list ?? []).filter((c) => !c.parent_customer_id && c.id !== customer?.id);

  const setContact = (i: number, field: keyof ContactDraft, value: string) =>
    setContacts((list) => list.map((k, j) => (j === i ? { ...k, [field]: value } : k)));

  async function save() {
    if (!name.trim()) {
      setError("Add a name.");
      return;
    }
    setBusy(true);
    const { id, error: err } = await saveCustomer(getDb(), {
      id: customer?.id ?? null,
      name: name.trim(),
      type,
      call_day: callDay || null,
      parent_customer_id: parentId || null,
      active,
      contacts: contacts.map((k) => ({ ...k, name: k.name.trim(), role: k.role.trim(), phone: k.phone.trim(), email: k.email.trim() })),
    });
    setBusy(false);
    if (err) {
      setError(`Couldn't save: ${err}`);
      return;
    }
    await reloadCustomers();
    toast("Customer saved");
    onClose();
    if (!customer && id) router.push(`/customers/${id}`);
  }

  return (
    <Sheet title={customer ? "Edit customer" : "New customer"} onClose={onClose}>
      <label className="lbl" htmlFor="c-name">
        Business name
      </label>
      <input id="c-name" className="field" autoFocus={!customer} value={name} onChange={(e) => setName(e.target.value)} />

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[150px] flex-1">
          <label className="lbl" htmlFor="c-type">
            Type
          </label>
          <select id="c-type" className="field" value={type} onChange={(e) => setType(e.target.value)}>
            {CUSTOMER_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[150px] flex-1">
          <label className="lbl" htmlFor="c-day">
            Call day
          </label>
          <select id="c-day" className="field" value={callDay} onChange={(e) => setCallDay(e.target.value)}>
            <option value="">None</option>
            {DAYS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {!hasKids && (
        <>
          <label className="lbl" htmlFor="c-parent">
            Part of (for a store location)
          </label>
          <select id="c-parent" className="field" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Nothing. This is its own business.</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </>
      )}

      <p className="lbl">People</p>
      {contacts.map((k, i) => (
        <div className="crow" key={k.id ?? `new-${i}`}>
          <input className="field" placeholder="Name" aria-label="Name" value={k.name} onChange={(e) => setContact(i, "name", e.target.value)} />
          <input
            className="field"
            placeholder="Role (orders, receiving, billing)"
            aria-label="Role"
            value={k.role}
            onChange={(e) => setContact(i, "role", e.target.value)}
          />
          <input
            className="field"
            inputMode="tel"
            placeholder="Phone"
            aria-label="Phone"
            value={k.phone}
            onChange={(e) => setContact(i, "phone", e.target.value)}
          />
          <input
            className="field"
            inputMode="email"
            placeholder="Email"
            aria-label="Email"
            value={k.email}
            onChange={(e) => setContact(i, "email", e.target.value)}
          />
          <button type="button" className="copy min-h-[44px]" onClick={() => setContacts((list) => list.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn ghost mt-2" onClick={() => setContacts((list) => [...list, blank()])}>
        Add another person
      </button>

      <label className="mt-4 flex min-h-[44px] items-center gap-3">
        <input type="checkbox" className="h-6 w-6 accent-forest" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active (shows on the weekly order list)
      </label>

      {error && <p className="note bad mt-3">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </Sheet>
  );
}
