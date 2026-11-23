# Ask (the question assistant)

Staff type a question in plain words; Claude writes read-only SQL against the
app's data and answers. Safety comes from the database, not from trusting the model.

## How it fits together

| Piece | Where |
|---|---|
| Views the assistant may read (schema `ai`), one login role per app role, grants that follow the Users screen's role defaults | `supabase/migrations/20261126000100_ask_readers.sql` (undo: `supabase/rollback/20261126000100_revert.sql`) |
| The SQL check (second lock): Postgres's own parser, one SELECT only, schema `ai` only, no sleep/file/settings/sequence functions, 500-row cap | `sqlGuard.ts` |
| Running a query: the reader for the person's role, `READ ONLY` transaction, 5 s limit | `db.ts`, `readers.ts` |
| The Anthropic API (the only place it's called), the `run_query` tool and the loop | `ask.ts` |
| Follow-up questions: the last 10 questions and answers go back with each question, each answer with the queries it ran (not their rows) | `history.ts` |
| The data guide sent to the model: General notes, only the views that role can read, and "How the app works out its numbers" sections (lamb count, expected boxes, draft invoice total, producer pay, freezer value, weekly P&L), each sent only when the role can read every view it lists in `needs` | `data-guide.md` (hand notes; columns generated), `dataGuide.ts` (generated), `guide.ts` |
| Server route: picks the reader from the signed-in person's profile | `app/api/ask/route.ts` |
| Screen | `/ask` (phones: More list and My account), and a round Ask button on wide screens that opens the same conversation in a side panel (`components/ask/`). The conversation lives in the app shell (`AskProvider`), so it carries on between screens; it isn't saved |
| Voice | Talk and Read out loud use the browser's own speech (`components/ask/speech.ts`), no extra service. Listening works in Chrome, Edge and Safari (Chrome sends the audio to Google); not Firefox. A spoken question sends `spoken: true`, which asks for a short answer that sounds right read aloud; `spoken.ts` strips formatting before reading |

Who can use Ask: `ASK_ROLES` in `readers.ts` (Admin, Accountant, Packing; not
Operations lead or Viewer yet). What each role sees follows the app: a role reads
a view when its role defaults give View in any screen area that opens that
table. One exception: household names and phones (`half_whole_contacts`) are not
opened by the Freezer area, so Packing never sees households. Per-person
overrides don't apply to Ask. Admins read everything.

Tests: `npm test` runs `sqlGuard.test.ts`, `guide.test.ts` and `readers.db.test.ts`
(every migration on a local PGlite database, then, as each reader role:
INSERT/UPDATE/DELETE fail at the database, public tables, auth and storage are
refused, and each role sees what its screens allow).

After changing the views, run `npm run ai:guide` (rebuilds the column lists).

Limits per question (`ask.ts`): 25 queries, 15 rounds, and no new round after
95 s (the route allows 120 s). They're set for digging into why a number is
what it is, not for cost.

When the way the app works out a number changes in `lib/calc`, change its
section under "How the app works out its numbers" in `data-guide.md` too, then
run `npm run ai:guide`. Those notes are what Ask uses to explain a number.

## Setting it up (Lucas, by hand)

1. **Push the migration** after review: `npx supabase db push`.
2. **Set a password for each reader Ask uses** (admin, billing, packing). Make a
   password in PowerShell, letters and digits only so it needs no escaping:

   ```powershell
   -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
   ```

   Then in the Supabase dashboard, SQL Editor, run one line per role with its own password:

   ```sql
   alter role ai_reader_admin with password 'PASTE-PASSWORD-HERE';
   ```

   Same for `ai_reader_billing` and `ai_reader_packing`. Nothing else is needed for
   office and viewer until Ask is turned on for them.
3. **Build each connection string** from the dashboard's Connect > Transaction
   pooler string, changing the user and password:

   `postgresql://ai_reader_admin.<project-ref>:<password>@<pooler-host>:6543/postgres?sslmode=require`

   The user is the role name, a dot, then the project ref (the same ref as in the
   `postgres.<project-ref>` user the dashboard shows).
4. **Set the environment variables** in Vercel (Production) and in `.env.local`:

   | Variable | Value |
   |---|---|
   | `AI_DB_URL_ADMIN` | the `ai_reader_admin` string |
   | `AI_DB_URL_BILLING` | the `ai_reader_billing` string |
   | `AI_DB_URL_PACKING` | the `ai_reader_packing` string |
   | `ANTHROPIC_API_KEY` | already in Vercel; add to `.env.local` too |
   | `AI_MODEL` | already in Vercel; optional, defaults to `claude-haiku-5-5` |

   Then redeploy, so Vercel picks the new variables up.
5. **Check** (reads `.env.local`; prints no secrets): `npm run ai:check`. Each
   reader should log in as itself, be read-only with a 5 s limit, read its views,
   and have DELETE and public tables refused.

Never use the service role key for Ask, and never give these variables a
`NEXT_PUBLIC_` prefix.
