// Contact roles, billing through a parent, and when a customer can be deleted.

export const CONTACT_ROLES = ["orders", "receiving", "billing"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const ROLE_LABEL: Record<ContactRole, string> = {
  orders: "Orders",
  receiving: "Receiving",
  billing: "Billing",
};

/** "Orders, Billing" in the usual order. */
export function rolesLabel(roles: readonly string[]): string {
  return CONTACT_ROLES.filter((r) => roles.includes(r))
    .map((r) => ROLE_LABEL[r])
    .join(", ");
}

/**
 * The spreadsheet's contact_role: one or more of orders, receiving, billing,
 * separated by semicolons ("orders; billing"). Case and spaces don't matter,
 * and "order" counts as "orders". Anything else is returned in `unknown`.
 */
export function parseRoles(text: string): { roles: ContactRole[]; unknown: string[] } {
  const found = new Set<ContactRole>();
  const unknown: string[] = [];
  for (const raw of text.split(";")) {
    const w = raw.trim().toLowerCase();
    if (!w) continue;
    const hit = CONTACT_ROLES.find((r) => r === w || (r === "orders" && w === "order"));
    if (hit) found.add(hit);
    else unknown.push(raw.trim());
  }
  return { roles: CONTACT_ROLES.filter((r) => found.has(r)), unknown };
}

type BillingCustomer = {
  id: string;
  name: string;
  parent_customer_id: string | null;
  bills_for_locations: boolean;
  contacts: { roles: readonly string[] }[];
};

/**
 * For a location whose parent has "Bills for all locations" ticked: the
 * parent and its billing contacts. Otherwise null.
 */
export function billedThrough<T extends BillingCustomer>(
  c: T,
  byId: Map<string, T>,
): { parent: T; contacts: T["contacts"] } | null {
  const parent = c.parent_customer_id ? byId.get(c.parent_customer_id) : undefined;
  if (!parent || !parent.bills_for_locations) return null;
  return { parent, contacts: parent.contacts.filter((k) => k.roles.includes("billing")) };
}

export type DeleteCheck = { orders: number; history: number; cut_sheet_links: number; locations: number };

/**
 * Why a customer can't be deleted, in plain words. An empty list means it
 * can be: no orders, no history, no cut sheet links, and no locations.
 */
export function deleteBlockers(k: DeleteCheck): string[] {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const out: string[] = [];
  if (k.locations) out.push(n(k.locations, "location", "locations"));
  if (k.orders) out.push(n(k.orders, "order", "orders"));
  if (k.history) out.push(n(k.history, "history entry", "history entries"));
  if (k.cut_sheet_links) out.push(n(k.cut_sheet_links, "cut sheet link", "cut sheet links"));
  return out;
}
