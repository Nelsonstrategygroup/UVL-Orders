import { requireUser } from "@/lib/auth/current-user";
import CustomersScreen from "./CustomersScreen";

export const metadata = { title: "Customers · Umpqua Valley Lamb" };

export default async function CustomersPage() {
  const user = await requireUser();
  return <CustomersScreen isAdmin={user.role === "admin"} />;
}
