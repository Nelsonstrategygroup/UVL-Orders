// Who can see which screens (SPEC 1 and 5).

export type Role = "admin" | "office" | "packing";

export const ROLES: Role[] = ["admin", "office", "packing"];

export const ROLE_INFO: Record<Role, { label: string; sub: string }> = {
  admin: { label: "Admin", sub: "Everything, including users and settings" },
  office: { label: "Office", sub: "Calls, orders, cut sheet, customers. Not users or settings" },
  packing: { label: "Packing", sub: "Just the packing list, big and simple" },
};

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
  adminOnly?: boolean;
};

export const NAV: NavItem[] = [
  { href: "/calls", label: "Calls", short: "Calls", icon: "☎", bottom: true, sub: "Call customers one at a time" },
  { href: "/week", label: "This week", short: "Week", icon: "◉", bottom: true, sub: "Lambs to order and progress" },
  { href: "/orders", label: "Orders", short: "Orders", icon: "✎", bottom: true, sub: "Every customer's order" },
  { href: "/cut-sheet", label: "Cut sheet", short: "Cut sheet", icon: "✂", bottom: false, sub: "This week's sheet for Mohawk" },
  { href: "/packing", label: "Packing", short: "Packing", icon: "✓", bottom: true, sub: "Pack and check off orders" },
  { href: "/half-whole", label: "Half and whole", short: "Half/​whole", icon: "½", bottom: true, sub: "Half and whole lamb orders" },
  { href: "/freezer", label: "Freezer", short: "Freezer", icon: "❄", bottom: false, sub: "What's on hand, add or remove cuts" },
  { href: "/customers", label: "Customers", short: "Customers", icon: "☺", bottom: false, sub: "Customer list and call days" },
  { href: "/setup", label: "Setup", short: "Setup", icon: "⚙", bottom: false, sub: "Parts per lamb and products" },
  { href: "/users", label: "Users", short: "Users", icon: "☻", bottom: false, sub: "Who can log in", adminOnly: true },
];

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as string[]).includes(v);
}

export function navFor(role: Role): NavItem[] {
  if (role === "packing") return [];
  return NAV.filter((n) => !n.adminOnly || role === "admin");
}

/** The first screen after logging in. */
export function homeFor(role: Role): string {
  return role === "packing" ? "/packing" : "/calls";
}

function under(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(base + "/");
}

/** Whether a role may open a page. Data access is enforced separately by RLS. */
export function canOpen(role: Role, pathname: string): boolean {
  if (pathname === "/") return true;
  if (under(pathname, "/help")) return true;
  if (role === "packing") return under(pathname, "/packing");
  if (under(pathname, "/users")) return role === "admin";
  return true;
}
