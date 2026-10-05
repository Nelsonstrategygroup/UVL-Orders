"use client";

// Toast messages (SPEC 3): quick actions show a toast with an Undo button
// for 6 seconds. Plain messages disappear sooner.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type ToastFn = (message: string, undo?: () => void) => void;
const Ctx = createContext<ToastFn>(() => {});

export const UNDO_MS = 6000;
const PLAIN_MS = 2200;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; undo?: () => void } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback<ToastFn>((message, undo) => {
    if (timer.current) clearTimeout(timer.current);
    const id = Date.now();
    setToast({ id, message, undo });
    timer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), undo ? UNDO_MS : PLAIN_MS);
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" role="status">
        {toast && (
          <div className="toast">
            <span>{toast.message}</span>
            {toast.undo && (
              <button
                type="button"
                className="min-h-[44px] rounded-md border border-linen px-3 font-semibold"
                onClick={() => {
                  const u = toast.undo!;
                  setToast(null);
                  u();
                }}
              >
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastFn {
  return useContext(Ctx);
}
