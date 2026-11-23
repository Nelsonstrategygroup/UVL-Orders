"use client";

// The round Ask button in the corner of wide screens (computer, tablet), and
// the panel it opens on the right, beside whatever screen you're on. Phones
// don't get the button (it would cover the screen); they open Ask from More.

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import AskChat from "./AskChat";
import { useAsk } from "./AskProvider";

export default function AskLauncher() {
  const pathname = usePathname();
  const { busy } = useAsk();
  const [open, setOpen] = useState(false);
  const onAskScreen = pathname === "/ask";
  const shown = open && !onAskScreen;

  // Make room for the panel on screens wide enough to show both side by side.
  useEffect(() => {
    document.documentElement.classList.toggle("ask-open", shown);
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.documentElement.classList.remove("ask-open");
      document.removeEventListener("keydown", onKey);
    };
  }, [shown]);

  if (onAskScreen) return null;

  return (
    <>
      {!shown && (
        <button type="button" className="askfab noprint" onClick={() => setOpen(true)} aria-label="Ask a question about your data">
          <span aria-hidden="true">💬</span>
          {busy ? "Looking it up…" : "Ask"}
        </button>
      )}
      {shown && (
        <aside className="askpanel noprint" role="dialog" aria-label="Ask a question">
          <div className="mb-2 flex items-center justify-end">
            <button type="button" className="iconbtn" onClick={() => setOpen(false)} aria-label="Close Ask">
              &#10005;
            </button>
          </div>
          <AskChat autoFocus />
        </aside>
      )}
    </>
  );
}
