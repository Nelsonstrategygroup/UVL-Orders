// The printer offset for box labels (My account), kept on this device: the
// printer is attached to this computer, and some print a little off.
// Inches; +x moves labels right, +y down. Default 0.

import type { Offset } from "@/lib/labels/avery5963";

const KEY = "uvl:labelOffset";

export function getLabelOffset(): Offset {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Offset> | null;
    const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0);
    return { x: n(v?.x), y: n(v?.y) };
  } catch {
    return { x: 0, y: 0 };
  }
}

export function setLabelOffset(o: Offset) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    // Private browsing: the offset just won't be remembered.
  }
}
