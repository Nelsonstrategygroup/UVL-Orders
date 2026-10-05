// "Import customers from a spreadsheet" (SPEC 5.9).
// Columns: name, type, call_day, parent, contact_name, contact_role, phone, email, notes
// Several rows with the same name (and parent) become one customer with
// several contacts. Customers already in the list are skipped, never changed.

import { DAYS } from "../dates";
import { parseCsv } from "./csv";

export const IMPORT_COLUMNS = [
  "name",
  "type",
  "call_day",
  "parent",
  "contact_name",
  "contact_role",
  "phone",
  "email",
  "notes",
] as const;

export const CUSTOMER_TYPES = ["Retail", "Wholesale", "Restaurant", "Distributor", "Other"] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export type ImportContact = { name: string; role: string; phone: string; email: string };

export type ImportCustomer = {
  name: string;
  type: CustomerType;
  call_day: string | null;
  parent: string;
  notes: string;
  contacts: ImportContact[];
  /** Spreadsheet row numbers (1 = header) this customer came from. */
  rows: number[];
  status: "new" | "exists";
  warnings: string[];
};

export type ImportPlan = {
  customers: ImportCustomer[];
  /** Parent names that will be created because they don't exist yet. */
  newParents: string[];
  /** Problems that stop the import. */
  errors: string[];
};

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

function normType(raw: string): { type: CustomerType; warning?: string } {
  const v = raw.trim();
  if (!v) return { type: "Other" };
  const hit = CUSTOMER_TYPES.find((t) => t.toLowerCase() === v.toLowerCase());
  if (hit) return { type: hit };
  return { type: "Other", warning: `Type "${v}" isn't one of ${CUSTOMER_TYPES.join(", ")}. It will be "Other".` };
}

function normDay(raw: string): { day: string | null; warning?: string } {
  const v = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!v) return { day: null };
  const hit = DAYS.find((d) => d.toLowerCase() === v || (v.length >= 3 && d.toLowerCase().startsWith(v)));
  if (hit) return { day: hit };
  return { day: null, warning: `Call day "${raw.trim()}" isn't a day of the week. It will be left blank.` };
}

/**
 * Read the spreadsheet and work out what the import will do.
 * `existing` is every customer already in the app, with its parent's name.
 */
export function planImport(
  csvText: string,
  existing: { name: string; parentName: string | null }[],
): ImportPlan {
  const rows = parseCsv(csvText);
  const errors: string[] = [];
  if (!rows.length) return { customers: [], newParents: [], errors: ["The file is empty."] };

  const header = rows[0].map((h) => key(h).replace(/[\s-]+/g, "_"));
  const col = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<
    (typeof IMPORT_COLUMNS)[number],
    number
  >;
  if (col.name < 0) {
    errors.push(`The first row must be the column names. There is no "name" column. Expected: ${IMPORT_COLUMNS.join(", ")}.`);
    return { customers: [], newParents: [], errors };
  }

  const existingKeys = new Set(existing.map((e) => `${key(e.parentName ?? "")}|${key(e.name)}`));
  const existingTop = new Set(existing.filter((e) => !e.parentName).map((e) => key(e.name)));

  const byKey = new Map<string, ImportCustomer>();
  const get = (r: string[], c: number) => (c >= 0 ? (r[c] ?? "").trim() : "");

  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const name = get(r, col.name).replace(/\s+/g, " ");
    if (!name) {
      if (r.some((c) => c.trim())) errors.push(`Row ${rowNo} has no name.`);
      return;
    }
    const parent = get(r, col.parent).replace(/\s+/g, " ");
    const k = `${key(parent)}|${key(name)}`;
    let cust = byKey.get(k);
    if (!cust) {
      const t = normType(get(r, col.type));
      const d = normDay(get(r, col.call_day));
      cust = {
        name,
        type: t.type,
        call_day: d.day,
        parent,
        notes: get(r, col.notes),
        contacts: [],
        rows: [],
        status: existingKeys.has(k) ? "exists" : "new",
        warnings: [t.warning, d.warning].filter((w): w is string => !!w),
      };
      if (parent && key(parent) === key(name)) cust.warnings.push("A customer can't be its own parent. The parent will be ignored.");
      byKey.set(k, cust);
    } else {
      // Later rows add contacts. Fill in anything the first row left blank.
      if (!cust.notes) cust.notes = get(r, col.notes);
    }
    cust.rows.push(rowNo);
    const contact = {
      name: get(r, col.contact_name),
      role: get(r, col.contact_role),
      phone: get(r, col.phone),
      email: get(r, col.email),
    };
    if (contact.name || contact.phone || contact.email) cust.contacts.push(contact);
  });

  const customers = [...byKey.values()];
  for (const c of customers) if (key(c.parent) === key(c.name)) c.parent = "";

  const plannedTop = new Set(customers.filter((c) => !c.parent).map((c) => key(c.name)));
  const newParents = [
    ...new Map(
      customers
        .filter((c) => c.parent && !existingTop.has(key(c.parent)) && !plannedTop.has(key(c.parent)))
        .map((c) => [key(c.parent), c.parent]),
    ).values(),
  ];

  if (!customers.length && !errors.length) errors.push("There are no customers in the file.");
  return { customers, newParents, errors };
}

/** The rows sent to the database for customers that are new. */
export function importPayload(plan: ImportPlan) {
  return plan.customers
    .filter((c) => c.status === "new")
    .map((c) => ({
      name: c.name,
      type: c.type,
      call_day: c.call_day,
      parent: c.parent || null,
      notes: c.notes,
      contacts: c.contacts,
    }));
}

/** A blank spreadsheet with just the column names. */
export function templateCsv(): string {
  return IMPORT_COLUMNS.join(",") + "\r\n";
}
