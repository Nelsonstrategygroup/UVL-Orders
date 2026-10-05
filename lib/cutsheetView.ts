// Shared by the Cut sheet screen and This week's cut sheet card, so both
// agree on whether the sheet adds up and whether it changed after sending.

import { cutSheetText, sentStatus, setAddsUp, type CutSpecLite, type SentStatus } from "./calc/cutsheet";
import type { CutSheetData, SheetSet } from "./db/cutsheet";
import type { Catalog } from "./db/types";

export function specMapOf(catalog: Catalog): Map<string, CutSpecLite> {
  return new Map(catalog.cutSpecs.map((s) => [s.id, s]));
}

/** The plain-text sheet: email body, "Copy as text", and what "sent" is checked against. */
export function sheetText(data: CutSheetData, catalog: Catalog, specs: Map<string, CutSpecLite>, updated = false): string {
  const sh = data.sheet!;
  return cutSheetText(
    {
      week: data.week,
      processDate: data.processDate,
      inv: sh.inv_number,
      notes: sh.notes,
      pulled: { large: sh.pulled_large, medium: sh.pulled_medium, small: sh.pulled_small },
      goals: data.goals.map((g) => g.text),
      banners: data.banners.map((b) => b.text),
      standing: catalog.settings?.standing_instructions ?? "",
      sets: data.sets,
      sizes: catalog.sizes,
    },
    specs,
    { updated },
  );
}

export function sheetStatus(data: CutSheetData, catalog: Catalog, specs: Map<string, CutSpecLite>): SentStatus {
  const sh = data.sheet!;
  return sentStatus(sh.sent_at, sh.sent_hash, sheetText(data, catalog, specs));
}

/** Sets that don't add up to whole lambs (6.3). */
export function sheetProblems(data: CutSheetData, catalog: Catalog, specs: Map<string, CutSpecLite>): SheetSet[] {
  const perLamb = Object.fromEntries(catalog.parts.map((p) => [p.id, p.per_lamb]));
  return data.sets.filter((s) => !setAddsUp(s, specs, perLamb));
}

/** "Parts 2A", or "The 40 XL set" for a set with no name. */
export function setTitle(s: SheetSet, catalog: Catalog): string {
  return s.name || ["The", s.lambs, catalog.sizes.find((z) => z.id === s.size_class_id)?.label, "set"].filter(Boolean).join(" ");
}
