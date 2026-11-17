import { Suspense } from "react";
import { requireUser } from "@/lib/auth/current-user";
import EntriesScreen from "./EntriesScreen";

export const metadata = { title: "P&L entries · Umpqua Valley Lamb" };

// The week's entries and adjustments (Lucas, 11/17/26). Admins only, like the P&L.
export default async function PnlEntriesPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <p className="note">Only an admin can see the weekly P&amp;L.</p>;
  return (
    <Suspense fallback={<div className="empty">Loading...</div>}>
      <EntriesScreen />
    </Suspense>
  );
}
