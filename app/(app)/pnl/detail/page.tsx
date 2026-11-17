import { Suspense } from "react";
import { requireArea } from "@/lib/auth/current-user";
import DetailReport from "./DetailReport";

export const metadata = { title: "P&L detail · Umpqua Valley Lamb" };

// The week's P&L detail, to review on paper (Lucas, 11/15/26). Admins only, like the P&L.
export default async function PnlDetailPage() {
  await requireArea("pnl");
  return (
    <Suspense fallback={<div className="empty">Loading...</div>}>
      <DetailReport />
    </Suspense>
  );
}
