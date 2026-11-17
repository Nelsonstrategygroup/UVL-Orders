import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { homeFor } from "@/lib/auth/roles";

export const metadata = { title: "No access · Umpqua Valley Lamb" };

// Where a page someone may not open sends them (Lucas, 11/17/26). The data
// is protected in the database too; this just says so plainly.
export default async function NoAccessPage() {
  const user = await requireUser();
  return (
    <div className="max-w-[640px]">
      <h2>You don&apos;t have access to this</h2>
      <p>
        Your role doesn&apos;t include this page. If you need it, ask an admin to turn it on for you in Setup &gt; Users.
      </p>
      <p>
        <Link href={homeFor(user.perms, user.role)} className="btn">
          Go to your first screen
        </Link>
      </p>
    </div>
  );
}
