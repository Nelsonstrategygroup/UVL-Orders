import { requireUser } from "@/lib/auth/current-user";
import SheetScreen from "./SheetScreen";

export const metadata = { title: "Weigh sheet · Umpqua Valley Lamb" };

// Lamb cost (SPEC 16.3): admins only, like the tables behind it.
export default async function WeighSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (user.role !== "admin") return <p className="note">Only an admin can see weigh sheets.</p>;
  return <SheetScreen id={id} />;
}
