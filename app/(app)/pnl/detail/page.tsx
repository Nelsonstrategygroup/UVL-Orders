import { Suspense } from "react";
import { requireUser } from "@/lib/auth/current-user";
import DetailReport from "./DetailReport";

export const metadata = { title: "P&L detail · Umpqua Valley Lamb" };

// The week's P&L detail, to review on paper (Lucas, 11/15/26). Admins only, like the P&L.
export default async function PnlDetailPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <p className="note">Only an admin can see the weekly P&amp;L.</p>;
  return (
    <Suspense fallback={<div className="empty">Loading...</div>}>
      <DetailReport />
    </Suspense>
  );
}
