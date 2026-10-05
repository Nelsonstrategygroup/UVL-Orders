import { requireAdmin } from "@/lib/auth/current-user";
import ImportScreen from "./ImportScreen";

export const metadata = { title: "Import customers · Umpqua Valley Lamb" };

export default async function ImportPage() {
  await requireAdmin();
  return <ImportScreen />;
}
