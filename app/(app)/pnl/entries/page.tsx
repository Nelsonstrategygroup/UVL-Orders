import { Suspense } from "react";
import { requireArea } from "@/lib/auth/current-user";
import EntriesScreen from "./EntriesScreen";

export const metadata = { title: "P&L entries · Umpqua Valley Lamb" };

// The week's entries and adjustments (Lucas, 11/17/26). Admins only, like the P&L.
export default async function PnlEntriesPage() {
  await requireArea("pnl");
  return (
    <Suspense fallback={<div className="empty">Loading...</div>}>
      <EntriesScreen />
    </Suspense>
  );
}
