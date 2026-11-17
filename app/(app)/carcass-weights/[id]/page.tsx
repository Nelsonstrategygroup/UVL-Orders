import { requireArea } from "@/lib/auth/current-user";
import SheetScreen from "./SheetScreen";

export const metadata = { title: "Carcass weights · Umpqua Valley Lamb" };

// One carcass weights sheet: anyone with View on Carcass weights.
export default async function CarcassWeightsSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireArea("carcass");
  return <SheetScreen id={id} />;
}
