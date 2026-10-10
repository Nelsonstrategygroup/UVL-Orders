// Who can see and change which screens. A role gives default access per area;
// an admin can change it per person (Users screen). The database enforces
// the same levels (migration 20261014000100), so hiding a screen is never
// the only lock.

export type Role = "admin" | "office" | "packing" | "viewer";

export const ROLES: Role[] = ["admin", "office", "packing", "viewer"];

export const ROLE_INFO: Record<Role, { label: string; sub: string }> = {
  admin: { label: "Admin", sub: "Everything, including users and settings" },
  office: { label: "Office", sub: "Calls, orders, cut sheet, customers. Not users or settings" },
  packing: { label: "Packing", sub: "Just the packing list, big and simple" },
  viewer: { label: "Viewer", sub: "Can look at everything but Setup and Users. Can't change anything" },
};

/** Screen areas, in the order the Users screen lists them. Users itself is admin-only. */
export const AREAS = [
  "calls",
  "orders",
  "week",
  "cutsheet",
  "packing",
  "halfwhole",
  "freezer",
  "customers",
  "callnotes",
  "downloads",
  "setup",
] as const;
export type Area = (typeof AREAS)[number];

/** 0 Off, 1 View, 2 Change. */
export type Level = 0 | 1 | 2;
export type Perms = Record<Area, Level>;

export const LEVEL_LABEL: Record<Level, string> = { 0: "Off", 1: "View", 2: "Change" };

export const AREA_INFO: Record<Area, { label: string; sub: string }> = {
  calls: { label: "Calls", sub: "Calling customers and taking their answers" },
  orders: { label: "Orders", sub: "Every customer's order for the week" },
  week: { label: "This week", sub: "Lamb count, producer, processing day" },
  cutsheet: { label: "Cut sheet", sub: "The sheet for Mohawk" },
  packing: { label: "Packing", sub: "Checking off what's packed" },
  halfwhole: { label: "Half and whole", sub: "Half and whole lamb orders" },
  freezer: { label: "Freezer", sub: "What's on hand" },
  customers: { label: "Customers", sub: "Customer list, contacts, standing notes" },
  callnotes: { label: "Call notes", sub: "The history of calls and follow-ups" },
  downloads: { label: "Downloads", sub: "Spreadsheets (looking only)" },
  setup: { label: "Setup", sub: "Products and parts. Only admins can change it" },
};

/** The most a non-admin can have in an area (the database caps it too). */
export function maxLevel(area: Area): Level {
  return area === "setup" || area === "downloads" ? 1 : 2;
}

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as string[]).includes(v);
}

/** Everything (admins). */
export const ALL_ACCESS: Perms = Object.fromEntries(AREAS.map((a) => [a, 2])) as Perms;
export const NO_ACCESS: Perms = Object.fromEntries(AREAS.map((a) => [a, 0])) as Perms;

/** Permissions from the database's my_permissions() (anything unknown is Off). */
export function permsFrom(json: unknown): Perms {
  const src = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const out = { ...NO_ACCESS };
  for (const a of AREAS) {
    const v = Number(src[a]);
    out[a] = (v === 1 || v === 2 ? v : 0) as Level;
  }
  return out;
}

export type NavItem = {
  href: string;
  label: string;
  /** Short label and symbol for the phone bottom bar. */
  short: string;
  icon: string;
  /** On phones, items without a bottom-bar spot go under "More". */
  bottom: boolean;
  /** One line for the "More" menu. */
  sub: string;
  /** The area that opens it; none for admin-only screens. */
  area?: Area;
  adminOnly?: boolean;
};

export const NAV: NavItem[] = [
  { href: "/week", label: "This week", short: "Week", icon: "◉", bottom: true, sub: "Lambs to order and progress", area: "week" },
  { href: "/calls", label: "Calls", short: "Calls", icon: "☎", bottom: true, sub: "Call customers one at a time", area: "calls" },
  { href: "/orders", label: "Orders", short: "Orders", icon: "✎", bottom: true, sub: "Every customer's order", area: "orders" },
  { href: "/cut-sheet", label: "Cut sheet", short: "Cut sheet", icon: "✂", bottom: false, sub: "This week's sheet for Mohawk", area: "cutsheet" },
  { href: "/packing", label: "Packing", short: "Packing", icon: "✓", bottom: true, sub: "Pack and check off orders", area: "packing" },
  { href: "/half-whole", label: "Half and whole", short: "Half/​whole", icon: "½", bottom: true, sub: "Half and whole lamb orders", area: "halfwhole" },
  { href: "/freezer", label: "Freezer", short: "Freezer", icon: "❄", bottom: false, sub: "What's on hand, add or remove cuts", area: "freezer" },
  { href: "/customers", label: "Customers", short: "Customers", icon: "☺", bottom: false, sub: "Customer list and call days", area: "customers" },
  { href: "/downloads", label: "Downloads", short: "Downloads", icon: "⤓", bottom: false, sub: "Spreadsheets of orders, customers, and more", area: "downloads" },
  { href: "/setup", label: "Setup", short: "Setup", icon: "⚙", bottom: false, sub: "Parts per lamb and products", area: "setup" },
  { href: "/users", label: "Users", short: "Users", icon: "☻", bottom: false, sub: "Who can log in", adminOnly: true },
];

/** The screens someone can open. */
export function navFor(perms: Perms, role: Role): NavItem[] {
  return NAV.filter((n) => (n.adminOnly ? role === "admin" : n.area ? perms[n.area] >= 1 : true));
}

/** Only the Packing screen: shown big and simple, with no navigation. */
export function onlyPacking(perms: Perms, role: Role): boolean {
  const nav = navFor(perms, role);
  return nav.length === 1 && nav[0].area === "packing";
}

/** The first screen after logging in: This week if they have it, else the first screen they can open. */
export function homeFor(perms: Perms, role: Role): string {
  return navFor(perms, role)[0]?.href ?? "/help";
}

function under(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(base + "/");
}

/** Whether someone may open a page. Data access is enforced separately by RLS. */
export function canOpen(perms: Perms, role: Role, pathname: string): boolean {
  if (pathname === "/") return true;
  if (under(pathname, "/help") || under(pathname, "/password")) return true;
  if (under(pathname, "/users") || under(pathname, "/customers/import")) return role === "admin";
  const item = NAV.find((n) => under(pathname, n.href));
  if (!item) return true;
  return item.adminOnly ? role === "admin" : item.area ? perms[item.area] >= 1 : true;
}

/** "View" or "Change" or not, in one place for the screens. */
export function can(perms: Perms, area: Area, level: "view" | "change"): boolean {
  return perms[area] >= (level === "view" ? 1 : 2);
}

/** Role defaults for the roles that have them (admins always have everything). */
export type RoleDefaults = Record<Exclude<Role, "admin">, Perms>;

/**
 * What someone can actually do: their own change if they have one, else
 * their role's default, capped at what the area allows. Same rule as the
 * database's perm().
 */
export function effectivePerms(role: Role, defaults: RoleDefaults, overrides: Partial<Record<Area, Level>>): Perms {
  if (role === "admin") return { ...ALL_ACCESS };
  const out = { ...NO_ACCESS };
  for (const a of AREAS) {
    const v = overrides[a] ?? defaults[role]?.[a] ?? 0;
    out[a] = Math.min(v, maxLevel(a)) as Level;
  }
  return out;
}
