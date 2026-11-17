import { requireUser } from "@/lib/auth/current-user";
import SetupScreen from "./SetupScreen";

export const metadata = { title: "Setup · Umpqua Valley Lamb" };

export default async function SetupPage() {
  const user = await requireUser();
  return <SetupScreen canEdit={user.perms.setup >= 2} isAdmin={user.role === "admin"} />;
}
