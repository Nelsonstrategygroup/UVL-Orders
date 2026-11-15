import { requireUser } from "@/lib/auth/current-user";
import WeighSheetsScreen from "./WeighSheetsScreen";

export const metadata = { title: "Weigh sheets · Umpqua Valley Lamb" };

// Lamb cost (SPEC 16.3): admins only, like the tables behind it.
export default async function WeighSheetsPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <p className="note">Only an admin can see weigh sheets.</p>;
  return <WeighSheetsScreen />;
}
