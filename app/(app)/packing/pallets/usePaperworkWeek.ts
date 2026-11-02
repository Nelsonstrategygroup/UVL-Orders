"use client";

// The week a paperwork page is opened for (?week=, from Print and download
// or a pallet), the pallets it covers (?pallet= one, ?date= a ship date or
// "none"), and ?print=1 opening the print dialog once it's drawn.

import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { usePackingBundle } from "@/components/offline/usePackingBundle";
import { useWeek } from "@/components/Week";

export function usePaperworkWeek() {
  const params = useSearchParams();
  const { week, setWeek } = useWeek();
  const asked = params.get("week");
  useEffect(() => {
    if (asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked !== week) setWeek(asked);
    // Only when opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  const onWeek = !asked || asked === week;
  const bundle = usePackingBundle(week);
  return { week, onWeek, bundle, palletId: params.get("pallet"), date: params.get("date"), print: params.get("print") === "1" };
}

/** Open the print dialog once, when `ready`. */
export function usePrintOnce(print: boolean, ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (!print || done.current || !ready) return;
    done.current = true;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [print, ready]);
}

/** "Monday, Nov 4", or "no ship date yet". */
export const dateWords = (d: string | null, longDate: (d: string) => string) => (d ? longDate(d) : "no ship date yet");
