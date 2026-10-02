# Umpqua Valley Lamb: Orders App

Read `docs/SPEC.md` in full before writing any code. It is the source of truth for what to build.

## What this is

An internal web app for a small pasture-raised lamb company in Oregon. Kathy takes weekly orders by phone, works out how many lambs to process, and hand-delivers a cut sheet to the meat plant (Mohawk). Chris packs the orders at the plant on a tablet. The users are not comfortable with technology. Simple, large, forgiving screens matter more than features.

## Stack (do not change without asking)

- Next.js (App Router), TypeScript, Tailwind CSS
- Supabase: Postgres, Auth, Row Level Security, Realtime
- `@supabase/ssr` for cookie-based auth in Next.js
- Supabase CLI migrations, committed in `supabase/migrations`
- Hosted on Vercel
- Vitest for unit tests of the calculation code

## Reference files

- `reference/demo-prototype.html` is a working single-file prototype that Kathy has already seen and approved in principle. Match its screens, wording, flow, and visual design. Its JavaScript contains the calculation logic; port that logic into typed, tested functions. Do not copy its storage layer.
- `reference/seed-data.json` holds the real starting data (parts, cut specs, products, size classes) and Kathy's real 9/30/2026 cut sheet. Seed the database from it.

## How to work

1. Build in the phases listed in SPEC.md, in order. Stop at the end of each phase, summarize what was built, list anything you were unsure about, and wait for review before starting the next phase.
2. When the spec is silent or unclear, ask. Do not invent business rules about meat cutting, lamb counts, or pricing. Items marked OPEN in the spec must stay configurable, not hard-coded.
3. Every table gets Row Level Security enabled in the same migration that creates it, with policies written at the same time.
4. The service role key is used only in server-side code (server actions, route handlers). Never expose it to the browser, never prefix it with `NEXT_PUBLIC_`.
5. All calculation logic lives in `lib/calc/` as pure functions with unit tests. The tests in SPEC.md section 9 must pass.
6. Use the `America/Los_Angeles` time zone for dates. Weeks start on Monday.
7. Write user-facing text in plain, short sentences. No jargon. Match the prototype's wording where it exists.
8. Commit after each meaningful step with a clear message.

@AGENTS.md
