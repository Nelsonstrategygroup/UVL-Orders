// Ask: type or say a question, get an answer from the app's data (lib/ai).
// Opened from My account, the More list on phones, or the Ask button. Roles
// Ask isn't turned on for get a plain message.

import { requireUser } from "@/lib/auth/current-user";
import { canAsk } from "@/lib/ai/readers";
import AskScreen from "./AskScreen";

export const metadata = { title: "Ask · Umpqua Valley Lamb" };

export default async function AskPage() {
  const user = await requireUser();
  if (!canAsk(user.role)) {
    return (
      <div className="card">
        <h2>Ask a question</h2>
        <p className="muted">Ask isn&apos;t turned on for your role yet.</p>
      </div>
    );
  }
  return <AskScreen />;
}
