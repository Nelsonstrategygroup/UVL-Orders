// Earlier questions and answers on the Ask screen, cleaned before they go
// back to the model. They come from the browser, so nothing in them is
// trusted: they're only text for the model, and any SQL in them still goes
// through the SQL check and the read-only reader if it's run again.

export type AskQuery = { purpose: string; sql: string; rowCount?: number; truncated?: boolean; error?: string };
/** An earlier question or answer. An answer may carry the queries it ran, so a follow-up builds on the same rows. */
export type AskTurn = { role: "user" | "assistant"; content: string; queries?: AskQuery[] };

/** Earlier messages sent along: the last 10 questions and their answers. */
const MAX_HISTORY = 20;
/** Earlier queries listed after each earlier answer (the newest). */
const MAX_HISTORY_QUERIES = 25;

/** An earlier answer's queries, as text after it: what each looked up and the SQL (not the rows; run it again for those). */
export function queriesNote(queries: unknown): string {
  if (!Array.isArray(queries)) return "";
  const lines = queries
    .filter((q): q is AskQuery => !!q && typeof q.sql === "string" && q.sql.trim() !== "" && !q.error)
    .slice(-MAX_HISTORY_QUERIES)
    .map((q, i) => {
      const rows = typeof q.rowCount === "number" ? `, ${q.rowCount}${q.truncated ? "+" : ""} rows` : "";
      const purpose = typeof q.purpose === "string" ? q.purpose.slice(0, 300) : "";
      return `${i + 1}. ${purpose}${rows}\n${q.sql.slice(0, 3000)}`;
    });
  return lines.length ? `\n\n[Queries run for this answer:\n${lines.join("\n")}]` : "";
}

/** Earlier turns as model messages: the newest 20, starting with a question, each answer followed by its queries. */
export function cleanHistory(history: unknown): { role: "user" | "assistant"; content: string }[] {
  if (!Array.isArray(history)) return [];
  const turns = history
    .filter((t): t is AskTurn =>
      !!t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim() !== "")
    .slice(-MAX_HISTORY)
    .map((t) => ({
      role: t.role,
      content: t.content.slice(0, 4000) + (t.role === "assistant" ? queriesNote(t.queries) : ""),
    }));
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}
