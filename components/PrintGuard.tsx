"use client";

// Warnings never print (Lucas, 11/2/26). Paperwork with open warnings (a box
// ID used twice, a box with no weight) asks first when someone prints: the
// warnings listed, "Go back and fix" (the default) or "Print anyway". The
// warnings themselves show on screen only, in a banner (PrintWarnings).

import { useEffect, useRef, useState } from "react";

/** The on-screen banner of open warnings; never printed. */
export function PrintWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <div className="note bad screen-only mt-2" role="alert">
      <b>Fix before printing:</b>
      <ul className="m-0 mt-1 pl-5">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * `print()` opens the print dialog, or first the confirm when there are
 * warnings; `dialog` is the confirm to render. `then` runs before printing
 * (a toast, say).
 */
export function usePrintGuard(warnings: string[]) {
  const [open, setOpen] = useState<null | (() => void)>(null);
  const go = (then?: () => void) => {
    then?.();
    setTimeout(() => window.print(), then ? 600 : 50);
  };
  const print = (then?: () => void) => (warnings.length ? setOpen(() => () => go(then)) : go(then));
  const dialog = open ? (
    <ConfirmPrint
      warnings={warnings}
      onFix={() => setOpen(null)}
      onPrint={() => {
        const run = open;
        setOpen(null);
        run();
      }}
    />
  ) : null;
  return { print, dialog };
}

function ConfirmPrint({ warnings, onFix, onPrint }: { warnings: string[]; onFix: () => void; onPrint: () => void }) {
  const fix = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    fix.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFix();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFix]);
  return (
    <div className="pg-back screen-only" role="presentation" onClick={onFix}>
      <div className="pg-box" role="alertdialog" aria-modal="true" aria-labelledby="pg-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="pg-title" className="m-0">
          Print with {warnings.length === 1 ? "this warning" : "these warnings"}?
        </h3>
        <ul className="mt-2 pl-5">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
        <p className="small muted">The warnings don&apos;t print. Fixing them first keeps the paperwork right.</p>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button ref={fix} type="button" className="btn" onClick={onFix}>
            Go back and fix
          </button>
          <button type="button" className="btn ghost" onClick={onPrint}>
            Print anyway
          </button>
        </div>
      </div>
    </div>
  );
}
