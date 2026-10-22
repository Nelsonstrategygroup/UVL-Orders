"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { navFor, onlyPacking, type NavItem, type Perms, type Role } from "@/lib/auth/roles";
import { logout } from "@/app/login/actions";
import Sheet from "./Sheet";
import { getLabelOffset, setLabelOffset } from "./labelOffset";
import { StaffDataProvider } from "./data/StaffData";
import { CurrentUserProvider } from "./CurrentUser";
import { ToastProvider } from "./Toast";
import { WeekProvider } from "./Week";
import { OutboxProvider } from "./offline/OutboxProvider";
import RegisterServiceWorker from "./offline/RegisterServiceWorker";

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export default function AppShell({
  userId,
  role,
  perms,
  displayName,
  children,
}: {
  userId: string;
  role: Role;
  perms: Perms;
  displayName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Someone who can only pack gets the big, simple Packing screen with no menus.
  const simple = onlyPacking(perms, role);
  const nav = simple ? [] : navFor(perms, role);
  const bottom = nav.filter((n) => n.bottom);
  const more = nav.filter((n) => !n.bottom);
  const moreCurrent = more.some((n) => isCurrent(pathname, n.href));

  // A sheet belongs to the screen it was opened on, so it closes after moving to another screen.
  const [opened, setOpened] = useState<{ kind: "more" | "account"; path: string } | null>(null);
  const sheet = opened && opened.path === pathname ? opened.kind : null;
  const setSheet = (kind: "more" | "account") => setOpened({ kind, path: pathname });
  const close = useCallback(() => setOpened(null), []);

  return (
    <>
      <header className="topbar">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="brandmark" aria-hidden="true">
            UV
          </div>
          <h1 className="truncate text-[#F4F2E6]">Umpqua Valley Lamb</h1>
        </div>
        {nav.length > 0 && (
          <nav className="toptabs desk-only ml-auto flex-wrap gap-1" aria-label="Sections">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} aria-current={isCurrent(pathname, n.href) ? "page" : undefined}>
                {n.label}
              </Link>
            ))}
          </nav>
        )}
        <button
          type="button"
          className={`topbtn ${nav.length > 0 ? "" : "ml-auto"} max-[899px]:ml-auto`}
          onClick={() => setSheet("account")}
        >
          My account
        </button>
      </header>

      <main className="mx-auto max-w-[1280px] px-4 pt-4 pb-24">
        <CurrentUserProvider me={{ id: userId, role, displayName, perms }}>
          <ToastProvider>
            <WeekProvider>
              <OutboxProvider>
                <RegisterServiceWorker />
                {simple ? children : <StaffDataProvider>{children}</StaffDataProvider>}
              </OutboxProvider>
            </WeekProvider>
          </ToastProvider>
        </CurrentUserProvider>
      </main>

      {nav.length > 0 && (
        <nav className="bottombar mob-only" aria-label="Sections">
          {bottom.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isCurrent(pathname, n.href) ? "page" : undefined}>
              <b aria-hidden="true">{n.icon}</b>
              {n.short}
            </Link>
          ))}
          {more.length > 0 && (
            <button type="button" onClick={() => setSheet("more")} aria-current={moreCurrent ? "page" : undefined}>
              <b aria-hidden="true">&#8943;</b>More
            </button>
          )}
        </nav>
      )}

      {sheet === "more" && (
        <Sheet title="More" onClose={close}>
          <MoreList items={more} />
        </Sheet>
      )}
      {/* "My account", kept apart from Setup: larger text, help, password, log out. */}
      {sheet === "account" && (
        <Sheet title="My account" onClose={close}>
          <MyAccount displayName={displayName} onDone={close} />
        </Sheet>
      )}
    </>
  );
}

function MoreList({ items }: { items: NavItem[] }) {
  return (
    <div className="grid gap-2">
      {items.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          className="block rounded-[10px] border border-line bg-paper p-3 text-ink no-underline"
        >
          <b>{n.label}</b>
          <br />
          <span className="text-[.82rem] text-ink-soft">{n.sub}</span>
        </Link>
      ))}
    </div>
  );
}

/**
 * Box labels print a little off on some printers: move every label by this
 * much (inches) on this device. Check with the Alignment test on the Box
 * Label Report.
 */
function PrinterOffset() {
  const [o, setO] = useState(() => getLabelOffset());
  const field = (axis: "x" | "y", label: string, hint: string) => (
    <label className="grid gap-1">
      <span className="small">{label}</span>
      <input
        className="field num w-24!"
        inputMode="decimal"
        defaultValue={o[axis] ? String(o[axis]) : "0"}
        aria-describedby="offset-hint"
        onBlur={(e) => {
          const v = Number(e.target.value.replace(/[^0-9.-]/g, ""));
          const next = { ...o, [axis]: Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0 };
          setO(next);
          setLabelOffset(next);
        }}
      />
      <span className="text-[.78rem] text-ink-soft">{hint}</span>
    </label>
  );
  return (
    <div className="mt-4 border-t border-line pt-4">
      <b>Box label printer</b>
      <p id="offset-hint" className="small muted mt-1 mb-2">
        If labels print a little off, move them here (inches, this device only). Check with the Alignment test on the Box Label
        Report.
      </p>
      <div className="flex gap-4">
        {field("x", "Move right", "minus moves left")}
        {field("y", "Move down", "minus moves up")}
      </div>
    </div>
  );
}

function MyAccount({ displayName, onDone }: { displayName: string; onDone: () => void }) {
  // Only rendered after a tap, never on the server, so reading the DOM here is safe.
  const [large, setLarge] = useState(() => document.documentElement.classList.contains("large"));

  function toggleLarge(on: boolean) {
    setLarge(on);
    document.documentElement.classList.toggle("large", on);
    try {
      localStorage.setItem("uvl:large", on ? "1" : "0");
    } catch {
      // Private browsing: the setting just won't be remembered.
    }
  }

  return (
    <div>
      <label className="flex min-h-[44px] items-center gap-3 text-[1.05rem]">
        <input
          type="checkbox"
          checked={large}
          onChange={(e) => toggleLarge(e.target.checked)}
          className="h-6 w-6 accent-forest"
        />
        Larger text
      </label>

      <Link href="/help" className="mt-3 flex min-h-[44px] items-center text-[1.05rem] text-forest underline">
        How to use this
      </Link>

      <PrinterOffset />

      <div className="mt-4 border-t border-line pt-4">
        <p className="muted mb-2">
          Logged in as <b className="text-ink">{displayName || "you"}</b>.
        </p>
        <Link
          href="/password"
          onClick={onDone}
          className="mb-2 flex min-h-[44px] items-center text-[1.05rem] text-forest underline"
        >
          Change my password
        </Link>
        <form action={logout}>
          <button type="submit" className="btn ghost">
            Log out
          </button>
        </form>
      </div>

      <div className="mt-4 flex justify-end">
        <button type="button" className="btn" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
