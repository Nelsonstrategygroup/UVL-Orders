// POST /api/ask { question, history? } -> { answer, queries } or { error }.
// The database reader is picked from the signed-in person's role, read from
// their profile on the server (never from the request). The service role key
// is not used here.

import { getCurrentUser } from "@/lib/auth/current-user";
import { ask } from "@/lib/ai/ask";
import { canAsk } from "@/lib/ai/readers";

export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Please log in again." }, { status: 401 });
  if (!canAsk(user.role)) {
    return Response.json({ error: "Ask isn't turned on for your role yet." }, { status: 403 });
  }

  let body: { question?: unknown; history?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Type a question first." }, { status: 400 });
  }

  const result = await ask(user.role, typeof body.question === "string" ? body.question : "", body.history);
  if (!result.ok) return Response.json({ error: result.error }, { status: 200 });
  return Response.json({ answer: result.answer, queries: result.queries });
}
