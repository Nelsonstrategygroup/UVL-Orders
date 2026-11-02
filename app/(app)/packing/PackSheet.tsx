// A customer's notes on Packing: standing notes and this week's order notes,
// so Chris sees them while packing. (The paper packing copy that lived here
// was replaced by the Weigh Sheet and Pallet Sheet, 11/1/26: ./sheets.)

import type { PackOrder } from "@/lib/db/packing";

/** Standing notes and this week's order notes, so Chris sees them while packing. */
export function PackNotes({ o }: { o: PackOrder }) {
  if (!o.standingNotes && !o.orderNotes) return null;
  return (
    <div className="mt-1 grid gap-0.5 text-[.95rem] font-normal">
      {o.orderNotes && (
        <div>
          <b>This week:</b> {o.orderNotes}
        </div>
      )}
      {o.standingNotes && (
        <div className="whitespace-pre-wrap">
          <b>Always:</b> {o.standingNotes}
        </div>
      )}
    </div>
  );
}
