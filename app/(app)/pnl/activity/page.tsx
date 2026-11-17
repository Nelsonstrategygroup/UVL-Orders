import { Suspense } from "react";
import { requireUser } from "@/lib/auth/current-user";
import ActivityScreen from "./ActivityScreen";

export const metadata = { title: "P&L activity · Umpqua Valley Lamb" };

// Every change that affects the P&L (Lucas, 11/16/26). Admins only, like the P&L.
export default async function PnlActivityPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <p className="note">Only an admin can see the weekly P&amp;L.</p>;
  return (
    <Suspense fallback={<div className="empty">Loading...</div>}>
      <ActivityScreen />
    </Suspense>
  );
}
