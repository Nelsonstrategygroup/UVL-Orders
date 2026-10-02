"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { navFor, type NavItem, type Role } from "@/lib/auth/roles";
import { logout } from "@/app/login/actions";
import Sheet from "./Sheet";

function isCurrent(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

export default function AppShell({
  role,
  displayName,
  children,
}: {
  role: Role;
  displayName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const nav = navFor(role);
  const bottom = nav.filter((n) => n.bottom);
  const more = nav.filter((n) => !n.bottom);
  const moreCurrent = more.some((n) => isCurrent(pathname, n.href));

  // A sheet belongs to the screen it was opened on, so it closes after moving to another screen.
  const [opened, setOpened] = useState<{ kind: "more" | "settings"; path: string } | null>(null);
  const sheet = opened && opened.path === pathname ? opened.kind : null;
  const setSheet = (kind: "more" | "settings") => setOpened({ kind, path: pathname });
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
          onClick={() => setSheet("settings")}
        >
          Settings
        </button>
      </header>

      <main className="mx-auto max-w-[1280px] px-4 pt-4 pb-24">{children}</main>

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
      {sheet === "settings" && (
        <Sheet title="Settings for this device" onClose={close}>
          <DeviceSettings displayName={displayName} onDone={close} />
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

function DeviceSettings({ displayName, onDone }: { displayName: string; onDone: () => void }) {
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

      <div className="mt-4 border-t border-line pt-4">
        <p className="muted mb-2">
          Logged in as <b className="text-ink">{displayName || "you"}</b>.
        </p>
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
