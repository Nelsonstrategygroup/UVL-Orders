"use client";

// Box label numbers for the paper packing copy (change request 10/26/26):
// boxes not numbered yet get the next numbers, the same way the Box Label
// Report hands them out, so the paper and the labels always match. Needs
// signal; offline, the copy on the phone keeps the numbers it has.

import { useEffect, useMemo } from "react";
import { getDb } from "@/components/data/StaffData";
import type { PackingBundle } from "@/components/offline/usePackingBundle";
import { assignBoxLabels } from "@/lib/db/labels";
import { sheetLabels } from "@/lib/db/packing";

export function useLabelNumbers(week: string, bundle: PackingBundle | null, refresh: () => void, canNumber: boolean) {
  const missing = useMemo(() => {
    if (!bundle) return [];
    return sheetLabels(bundle.packing, bundle.boxes)
      .map((l) => l.key)
      .filter((k) => !bundle.packing.labelNumbers.has(k));
  }, [bundle]);
  const sig = missing.join(",");

  useEffect(() => {
    if (!canNumber || !bundle || !missing.length) return;
    let live = true;
    // Every box key in report order, so new numbers follow the report.
    const keys = sheetLabels(bundle.packing, bundle.boxes).map((l) => l.key);
    void assignBoxLabels(getDb(), week, keys).then((map) => {
      if (live && map) refresh();
    });
    return () => {
      live = false;
    };
    // sig stands for the missing keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, week, canNumber]);

  return { missing: missing.length };
}
