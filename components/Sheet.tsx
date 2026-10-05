"use client";

import { useEffect, useRef } from "react";

// Bottom sheet on phones, centered dialog on wide screens (prototype's .sheet).
export default function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    // A field marked autoFocus keeps focus. Otherwise focus the sheet itself,
    // so screen readers announce it and no on-screen keyboard pops up.
    const box = boxRef.current;
    if (box && !box.contains(document.activeElement)) box.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet-box outline-none" role="dialog" aria-modal="true" aria-label={title} ref={boxRef} tabIndex={-1}>
        <div className="mb-2 flex items-center justify-between gap-4">
          <h3>{title}</h3>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
