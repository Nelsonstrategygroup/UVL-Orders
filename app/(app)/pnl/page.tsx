import { requireArea } from "@/lib/auth/current-user";
import PnlScreen from "./PnlScreen";

export const metadata = { title: "Weekly P&L · Umpqua Valley Lamb" };

// Lamb cost stage 3 (SPEC 16.6): admins only, like the tables behind it.
export default async function PnlPage() {
  await requireArea("pnl");
  return <PnlScreen />;
}
