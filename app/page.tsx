import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { homeFor } from "@/lib/auth/roles";

// The proxy normally sends people straight to their home screen.
export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? homeFor(user.role) : "/login");
}
