// Who can see and change which screens. A role gives default access per area;
// an admin can change it per person (Users screen). The database enforces
// the same levels (migration 20261014000100), so hiding a screen is never
// the only lock.

export type Role = "admin" | "office" | "packing" | "viewer" | "billing";

export const ROLES: Role[] = ["admin", "office", "packing", "viewer", "billing"];

export const ROLE_INFO: Record<Role, { label: string; sub: string }> = {
  admin: { label: "Admin", sub: "Everything, including users and settings" },
  // Shown as "Operations lead" and "Accountant" (11/17/26); the stored codes stay office and billing.
  office: { label: "Operations lead", sub: "Runs the week: calls, orders, cut sheet, packing, customers, operations setup. No money screens" },
  packing: { label: "Packing", sub: "Just the packing list, big and simple" },
  viewer: { label: "Viewer", sub: "Can look at everything but Setup and Users. Can't change anything" },
  billing: { label: "Accountant", sub: "Invoices, and looks at orders, print (manifests), the Weekly P&L and carcass weights" },
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
  "invoices",
  "prices",
  "trucks",
  "pnl",
  "carcass",
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
  downloads: { label: "Reports", sub: "Order sheets, labels, manifests, spreadsheets (looking only)" },
  setup: { label: "Operations setup", sub: "Products, parts per lamb, boxes, lamb sizes, box labels, Ships to" },
  invoices: { label: "Invoices", sub: "Invoices, payments, invoice codes and terms" },
  prices: { label: "Prices", sub: "Product prices (Setup > Prices)" },
  trucks: { label: "Truck runs", sub: "Delivery runs: driver, stops, fuel" },
  pnl: { label: "Weekly P&L", sub: "Income, costs and profit for the week; its entries and adjustments" },
  carcass: { label: "Carcass weights", sub: "Mohawk's carcass weights per producer and kill, and what producers are paid" },
};

/** The most a non-admin can have in an area (the database caps it too). */
export function maxLevel(area: Area): Level {
  return area === "downloads" ? 1 : 2;
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

/** A page inside a tab: who may open it (an area at View, any of several areas, or admins only). */
export type Section = { href: string; label: string; area?: Area; anyOf?: Area[]; adminOnly?: boolean };

/** One of the six tabs (Lucas, 11/17/26). */
export type NavItem = {
  key: string;
  /** Where the tab opens: its first section the person can open. */
  href: string;
  label: string;
  /** Short label and symbol for the phone bottom bar. */
  short: string;
  icon: string;
  /** On phones, This week, Orders, Packing and Reports sit in the bar; the rest go under "More". */
  bottom: boolean;
  /** One line for the "More" menu. */
  sub: string;
  /** Its sections the person can open, in order. */
  sections: Section[];
};

type TabDef = Omit<NavItem, "href" | "sections"> & { sections: Section[] };

export const TABS: TabDef[] = [
  {
    key: "week",
    label: "This week",
    short: "Week",
    icon: "◉",
    bottom: true,
    sub: "Lambs to order, this week's steps, and the cut sheet",
    sections: [
      { href: "/week", label: "This week", area: "week" },
      { href: "/cut-sheet", label: "Cut sheet", area: "cutsheet" },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    short: "Sales",
    icon: "☎",
    bottom: false,
    sub: "Calls, customers, and half and whole lamb orders",
    sections: [
      { href: "/calls", label: "Calls", area: "calls" },
      { href: "/customers", label: "Customers", area: "customers" },
      { href: "/half-whole", label: "Half and whole", area: "halfwhole" },
    ],
  },
  {
    key: "orders",
    label: "Orders",
    short: "Orders",
    icon: "✎",
    bottom: true,
    sub: "Every customer's order",
    sections: [{ href: "/orders", label: "Orders", area: "orders" }],
  },
  {
    key: "packing",
    label: "Packing",
    short: "Packing",
    icon: "✓",
    bottom: true,
    sub: "Pack and check off orders, and the freezer",
    sections: [
      { href: "/packing", label: "Packing", area: "packing" },
      { href: "/freezer", label: "Freezer", area: "freezer" },
    ],
  },
  {
    key: "office",
    label: "Office",
    short: "Office",
    icon: "$",
    bottom: false,
    sub: "Invoices, the Weekly P&L, carcass weights and truck runs",
    sections: [
      { href: "/invoices", label: "Invoices", area: "invoices" },
      { href: "/pnl", label: "Weekly P&L", area: "pnl" },
      { href: "/carcass-weights", label: "Carcass weights", area: "carcass" },
      { href: "/truck-runs", label: "Truck runs", area: "trucks" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    short: "Reports",
    icon: "☰",
    bottom: true,
    sub: "Order sheets, labels, manifests and spreadsheets, to open or download",
    sections: [{ href: "/print", label: "Reports", area: "downloads" }],
  },
  {
    key: "setup",
    label: "Setup",
    short: "Setup",
    icon: "⚙",
    bottom: false,
    sub: "Products, parts, prices, invoicing and users",
    sections: [
      { href: "/setup", label: "Setup", anyOf: ["setup", "prices", "invoices"] },
      { href: "/users", label: "Users", adminOnly: true },
    ],
  },
];

/** The Reports page (was Print and download; still at /print). */
export const PRINT: Section = { href: "/print", label: "Reports", area: "downloads" };

/**
 * Who may open a page, by its path (the longest match wins). Pages not
 * listed are open to anyone signed in (Help, Password).
 */
const ROUTES: Section[] = [
  ...TABS.flatMap((t) => t.sections),
  { href: "/downloads", label: "Reports", area: "downloads" },
  { href: "/weigh-sheets", label: "Carcass weights", area: "carcass" },
  { href: "/pnl/activity", label: "P&L activity", adminOnly: true },
  { href: "/setup/prices", label: "Prices", area: "prices" },
  { href: "/setup/invoicing", label: "Invoicing", area: "invoices" },
  { href: "/setup/lamb-cost", label: "P&L Setup", adminOnly: true },
  { href: "/setup/records", label: "Your records", adminOnly: true },
  { href: "/customers/import", label: "Import customers", adminOnly: true },
  ...["products", "boxes", "parts", "instructions", "sizes", "pallets", "gtins", "le-trim", "processor"].map((slug) => ({
    href: `/setup/${slug}`,
    label: "Operations setup",
    area: "setup" as Area,
  })),
];

function under(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(base + "/");
}

/** Whether someone may open this section (View or more on its area). */
export function canSee(perms: Perms, role: Role, s: Section): boolean {
  if (role === "admin") return true;
  if (s.adminOnly) return false;
  if (s.anyOf) return s.anyOf.some((a) => perms[a] >= 1);
  return s.area ? perms[s.area] >= 1 : true;
}

/** The tabs someone can open, each with only the sections they can open. A tab with none doesn't show. */
export function navFor(perms: Perms, role: Role): NavItem[] {
  return TABS.map((t) => ({ ...t, sections: t.sections.filter((s) => canSee(perms, role, s)) }))
    .filter((t) => t.sections.length > 0)
    .map((t) => ({ ...t, href: t.sections[0].href }));
}

/** The tab a page belongs to (for highlighting), by its path. */
export function tabFor(pathname: string): string | null {
  for (const t of TABS) if (t.sections.some((s) => under(pathname, s.href))) return t.key;
  if (under(pathname, "/weigh-sheets")) return "office";
  return null;
}

/** Only the Packing screen: shown big and simple, with no navigation. */
export function onlyPacking(perms: Perms, role: Role): boolean {
  const nav = navFor(perms, role);
  return nav.length === 1 && nav[0].key === "packing" && nav[0].sections.length === 1 && !canSee(perms, role, PRINT);
}

/** The first screen after logging in: This week if they have it, else the first screen they can open. */
export function homeFor(perms: Perms, role: Role): string {
  return navFor(perms, role)[0]?.href ?? "/help";
}

/** Whether someone may open a page. Data access is enforced separately by RLS. */
export function canOpen(perms: Perms, role: Role, pathname: string): boolean {
  if (pathname === "/") return true;
  if (under(pathname, "/help") || under(pathname, "/password") || under(pathname, "/no-access")) return true;
  const rule = ROUTES.filter((r) => under(pathname, r.href)).sort((a, b) => b.href.length - a.href.length)[0];
  return rule ? canSee(perms, role, rule) : true;
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
