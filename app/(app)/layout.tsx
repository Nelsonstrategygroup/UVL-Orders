import AppShell from "@/components/AppShell";
import { requireUser } from "@/lib/auth/current-user";

// Every screen after login. The proxy has already checked the session,
// the 3:00 AM rule, and which screens this role may open.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <AppShell userId={user.id} role={user.role} displayName={user.displayName}>
      {children}
    </AppShell>
  );
}
