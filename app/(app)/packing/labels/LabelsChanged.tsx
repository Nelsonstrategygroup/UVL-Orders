"use client";

// "Orders changed since you printed labels" (SPEC 12.5): shown on Packing,
// This week, and the label list when the labels printed for this week no
// longer match the orders.

import Link from "next/link";
import { formatWhen } from "@/lib/format";

export default function LabelsChanged({
  hash,
  printedHash,
  printedAt,
  link = false,
}: {
  hash: string;
  printedHash: string | null | undefined;
  printedAt: string | null | undefined;
  /** Add a link to the label list. */
  link?: boolean;
}) {
  if (!printedHash || printedHash === hash) return null;
  return (
    <p className="note bad mt-2" role="status">
      <b>Orders changed since you printed labels</b>
      {printedAt ? ` (${formatWhen(printedAt)})` : ""}. Print them again so every box has the right label.
      {link && (
        <>
          {" "}
          <Link href="/packing/labels" className="copy">
            Box labels
          </Link>
        </>
      )}
    </p>
  );
}
