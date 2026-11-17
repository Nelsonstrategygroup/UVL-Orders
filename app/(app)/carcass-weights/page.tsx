import { requireArea } from "@/lib/auth/current-user";
import WeighSheetsScreen from "./WeighSheetsScreen";

export const metadata = { title: "Carcass weights · Umpqua Valley Lamb" };

// Carcass weights (was Weigh sheets; Lucas, 11/17/26): anyone with View on
// Carcass weights; changing needs Change (the database checks both).
export default async function CarcassWeightsPage() {
  await requireArea("carcass");
  return <WeighSheetsScreen />;
}
