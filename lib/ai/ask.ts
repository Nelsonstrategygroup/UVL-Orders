// Ask: answer a staff question from the app's data. All calls to the
// Anthropic API are in this module. Server only.
//
// The model gets one tool, run_query(sql, purpose). Each query is checked
// (sqlGuard) and run as the reader for the person's role, read only, at most
// 500 rows (db.ts). What the reader can't SELECT, the database refuses.

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Role } from "@/lib/auth/roles";
import { currentWeek, todayISO, weekName } from "@/lib/dates";
import { openReader, readerUrl } from "./db";
import { guideFor } from "./guide";
import { cleanHistory, type AskQuery } from "./history";
import { READERS } from "./readers";

/** The model, from AI_MODEL so it can change without a code change. */
export function aiModel(): string {
  return process.env.AI_MODEL?.trim() || "claude-haiku-5-5";
}

/** Most model turns per question (each may run queries). Room to dig into why a number is what it is. */
const MAX_ROUNDS = 15;
/** Most queries per question, across all turns. */
const MAX_QUERIES = 25;
const MAX_QUESTION_CHARS = 2000;
/** Stop starting new rounds after this long and answer with what's found (the route allows 120 s). */
const TIME_BUDGET_MS = 95_000;

export type { AskQuery, AskTurn } from "./history";
export type AskResult = { ok: true; answer: string; queries: AskQuery[] } | { ok: false; error: string };

const RUN_QUERY: Anthropic.Tool = {
  name: "run_query",
  description:
    "Run one read-only PostgreSQL SELECT (or WITH ... SELECT) against the views in the data guide and get the rows back " +
    "(at most 500; `truncated` says if there were more). Errors come back as text: fix the query and try again.",
  input_schema: {
    type: "object",
    properties: {
      sql: { type: "string", description: "One SELECT statement. Views are in schema ai; write names without the schema." },
      purpose: { type: "string", description: "One line in plain English: what this query looks up." },
    },
    required: ["sql", "purpose"],
    additionalProperties: false,
  },
  strict: true,
};

const INSTRUCTIONS = `You answer questions from Umpqua Valley Lamb staff about their orders app's data.
Look things up with the run_query tool; never answer from memory or guess numbers.
When someone asks why a number is what it is, dig: find the rows behind it, follow the steps under "How the app works out its numbers" where there are some, and say which inputs make it what it is (which orders, boxes, lambs, lines or entries). Run as many queries as that takes.
On a follow-up, start from the queries listed after your earlier answers so the numbers line up with what you said before; change them only as the new question needs.
If a query fails, read the error and fix it. If the views you have can't answer the question, say so plainly; don't ask about data that isn't in your guide.
Reply in plain, short sentences for people who aren't comfortable with technology. Don't show SQL, view or column names unless asked.

Data guide:

`;

/** Which reader settings are missing, by env var name (never their values). */
export function missingConfig(role: Role): string[] {
  const missing: string[] = [];
  if (!process.env.ANTHROPIC_API_KEY?.trim()) missing.push("ANTHROPIC_API_KEY");
  if (!readerUrl(role)) missing.push(READERS[role].envVar);
  return missing;
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/** How to answer a question that was spoken: the answer is read aloud. */
const SPOKEN = `This question was spoken out loud and your answer will be read out loud.
Answer in one to three short sentences that sound natural when heard. No tables, lists, headings or symbols.
Round numbers sensibly and say units in words (pounds, boxes). If the full answer is long, give the main point and say they can see the details on the screen.`;

/** Answer one question for a person with this role. Never throws. */
export async function ask(role: Role, question: string, history?: unknown, opts: { spoken?: boolean } = {}): Promise<AskResult> {
  const q = typeof question === "string" ? question.trim() : "";
  if (!q) return { ok: false, error: "Type a question first." };
  if (q.length > MAX_QUESTION_CHARS) return { ok: false, error: "That question is too long. Please make it shorter." };

  const missing = missingConfig(role);
  if (missing.length) {
    console.error(`Ask is not set up: missing ${missing.join(", ")}`);
    return { ok: false, error: "Ask isn't set up yet. Lucas needs to finish setting it up." };
  }

  const reader = openReader(readerUrl(role)!);
  const queries: AskQuery[] = [];
  try {
    const views = await reader.views();
    if (!views.length) return { ok: false, error: "There's nothing Ask can look up for your role yet." };

    const client = new Anthropic();
    const week = currentWeek();
    const system: Anthropic.TextBlockParam[] = [
      // The same for every question from this role: cached.
      { type: "text", text: INSTRUCTIONS + guideFor(views), cache_control: { type: "ephemeral" } },
      { type: "text", text: `Today is ${todayISO()}. This week is the week of ${weekName(week)} (packing Monday ${week}).` },
      ...(opts.spoken ? [{ type: "text" as const, text: SPOKEN }] : []),
    ];
    const messages: Anthropic.MessageParam[] = [
      ...cleanHistory(history).map((t) => ({ role: t.role, content: t.content })),
      { role: "user", content: q },
    ];

    const started = Date.now();
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const lastRound = round === MAX_ROUNDS - 1 || queries.length >= MAX_QUERIES || Date.now() - started > TIME_BUDGET_MS;
      const response = await client.messages.create({
        model: aiModel(),
        max_tokens: 8000,
        system,
        tools: [RUN_QUERY],
        tool_choice: lastRound ? { type: "none" } : { type: "auto" },
        messages,
      });

      if (response.stop_reason === "refusal") {
        return { ok: true, answer: "Sorry, I can't help with that one.", queries };
      }
      if (response.stop_reason !== "tool_use") {
        const answer = textOf(response.content);
        if (response.stop_reason === "max_tokens") {
          return { ok: true, answer: `${answer}\n\n(The answer was cut off. Try asking for less at once.)`.trim(), queries };
        }
        return { ok: true, answer: answer || "Sorry, I couldn't find an answer to that.", queries };
      }

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const input = block.input as { sql?: unknown; purpose?: unknown };
        const sql = typeof input?.sql === "string" ? input.sql : "";
        const purpose = typeof input?.purpose === "string" ? input.purpose.slice(0, 300) : "";
        if (block.name !== "run_query" || !sql) {
          results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: "Unknown tool or missing sql." });
          continue;
        }
        if (queries.length >= MAX_QUERIES) {
          results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: "Query limit reached. Answer with what you have." });
          continue;
        }
        const result = await reader.run(sql);
        if (result.ok) {
          queries.push({ purpose, sql, rowCount: result.rowCount, truncated: result.truncated });
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: JSON.stringify({ rows: result.rows, row_count: result.rowCount, truncated: result.truncated }),
          });
        } else {
          queries.push({ purpose, sql, error: result.error });
          results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: result.error });
        }
      }
      messages.push({ role: "user", content: results });
    }
    return { ok: true, answer: "Sorry, that took too many steps. Try asking a simpler question.", queries };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: "Ask is busy right now. Try again in a minute." };
    if (e instanceof Anthropic.AuthenticationError) {
      console.error("Ask: the Anthropic API key was refused.");
      return { ok: false, error: "Ask isn't set up correctly. Please tell Lucas." };
    }
    if (e instanceof Anthropic.APIError) {
      console.error(`Ask: Anthropic API error ${e.status}`);
      return { ok: false, error: "Ask couldn't get an answer just now. Try again." };
    }
    console.error("Ask failed:", e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/gi, "[connection]") : e);
    return { ok: false, error: "Ask couldn't reach the data just now. Try again." };
  } finally {
    await reader.end().catch(() => {});
  }
}
