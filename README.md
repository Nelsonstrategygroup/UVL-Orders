# Umpqua Valley Lamb: Orders App

The internal app for weekly lamb orders, the Mohawk cut sheet, and packing.
What to build is in [docs/SPEC.md](docs/SPEC.md). The approved look and wording are in
[reference/demo-prototype.html](reference/demo-prototype.html).

Stack: Next.js 16 (App Router), TypeScript, Tailwind CSS 4, Supabase (Postgres, Auth,
Row Level Security, Realtime), hosted on Vercel. Unit tests use Vitest.

## First-time setup

You need Node.js 20 or newer (24 recommended), npm, and git. The Supabase CLI is installed
with the project, so run it as `npx supabase`.

1. **Install packages**

   ```bash
   npm install
   ```

2. **Create a Supabase project** at supabase.com. Then copy `.env.example` to `.env.local`
   and fill in the values from the dashboard, under Project Settings > API Keys:

   | Variable | Where it comes from |
   |---|---|
   | `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` locally, `https://uvl.nelsonstrategygroup.com` on Vercel |
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (or the legacy anon key) |
   | `SUPABASE_SERVICE_ROLE_KEY` | Secret key (or the legacy service_role key). **Server only.** Never prefix it with `NEXT_PUBLIC_`. |

3. **Build the database** from the migrations in `supabase/migrations`:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

4. **Load the starting data** (parts, cut specs, products, size classes, the saving goal,
   and Mohawk's details). It does not add any cut sheet, order, or week. Kathy's 9/30/2026
   sample sheet stays in `reference/seed-data.json` for the calculation tests only:

   ```bash
   npm run seed
   ```

   It is safe to run again. It only adds what is missing and never overwrites changes made
   on the Setup screen.

5. **Create the first admin** (nobody can log in until this exists):

   ```bash
   npm run create-admin -- "Lucas Nelson" you@example.com
   ```

   It prints a temporary password. Log in with it, then set your own on the Users screen.

6. **Run the app**

   ```bash
   npm run dev
   ```

   Open http://localhost:3000, log in, go to **Users**, and add Kathy and Eric (Admin or
   Office) and Chris (Packing). Chris only ever sees the Packing screen.

7. **Apply the Supabase dashboard settings** below.

## Supabase dashboard settings

Set these by hand in the Supabase dashboard. They are not stored in the repo.

**Authentication > Sign In / Providers**

- Email provider: on.
- "Allow new users to sign up": **off**. Admins add people from the Users screen.
- "Confirm email": does not matter. Accounts made from the Users screen are already confirmed.

**Authentication > Sessions**

- "Time-box user sessions": **36 hours**. A safety net only; the app itself signs everyone out
  at 3:00 AM Pacific each morning.
- "Inactivity timeout": **off**. Nobody should be logged out in the middle of the work day.
- "Single session per user": **off**. People use both a phone and a tablet.

**Authentication > URL Configuration**

- Site URL: `https://uvl.nelsonstrategygroup.com`
- Redirect URLs: `https://uvl.nelsonstrategygroup.com` and `http://localhost:3000`

**Authentication > Passwords** (optional): minimum length 8, to match the Users screen.

## How login works

- Every page except `/login` needs a login. There is no public sign-up.
- Once logged in, a person stays logged in for the rest of the day, through browser
  restarts. At **3:00 AM Pacific** the next morning they are signed out and see
  "Good morning. Please log in for today."
- The cutoff hour is one constant, `DAILY_SIGN_OUT_HOUR` in
  [lib/auth/session.ts](lib/auth/session.ts).
- Each login stamps `profiles.last_login_at`. The proxy ([proxy.ts](proxy.ts), the Next.js 16
  name for middleware) refreshes the session on every request, signs out anyone whose last
  login is before the most recent 3:00 AM, and signs out anyone whose login was turned off.
- Roles: **Admin** (everything, including Users and settings), **Office** (everything but
  Users; Setup is view-only), **Packing** (Packing screen only, no other navigation), and
  **Viewer** (looks at everything but Setup and Users, changes nothing).
- Each role is a set of defaults: for each area (Calls, Orders, This week, Cut sheet, Packing,
  Half and whole, Freezer, Customers, Call notes, Downloads, Setup) it is Off, View, or Change.
  On the Users screen an admin can change any area for one person (marked "custom access") or
  change a role's defaults for everyone ("What each role can do by default").
- Fixed rules: admins always have everything; only admins manage users, export all data, and
  change Setup; Downloads is view-only.
- The database enforces all of it with Row Level Security (`perm()`, `can_view()`,
  `can_change()` in migration `20261014000100_permissions.sql`), so hiding a screen is never
  the only lock. Tests: `supabase/tests/database/permissions.test.sql`.

## For the people using it

- **How to use this**: a short guide with screenshots, at `/help` and under Settings. Its
  screenshots live in `public/help/`; retake them if a screen changes a lot.
- **Home screen**: the app installs like an app (web manifest in `app/manifest.ts`, icons drawn
  by `app/icons/[size]/route.tsx`). On iPhone or iPad: Safari, Share, Add to Home Screen. On
  Android: Chrome menu, Install app.
- **Larger text**: Settings, Larger text. Saved on that device only.
- **Downloads** (office and admin, under More): spreadsheets for people, with names instead of
  ID codes. The week's orders with customer details, product totals, packing record, customer
  list, one customer's order history, sales over a date range, and freezer on hand. Built in
  `lib/reports.ts` (tested in `lib/reports.test.ts`). The Orders screen and each customer's page
  also have their own download button.
- **Export all data** (admins): Setup, Your records. Downloads every table as a CSV file in one
  zip, with a README listing the order to load them into a new database.
- **Questions waiting on Kathy and Chris**: [docs/questions-for-kathy-and-chris.md](docs/questions-for-kathy-and-chris.md).

## Tests

```bash
npm test          # unit tests (Vitest): calculations, the 3 AM rule, roles, seed data
npm run typecheck
npm run lint
```

The database security test,
[supabase/tests/database/rls_packing.test.sql](supabase/tests/database/rls_packing.test.sql),
proves a Packing user cannot read the contact log or change order lines. Run it against the
linked project (it runs in a transaction and rolls everything back):

```bash
npx supabase test db --linked
```

If it says pgTAP is missing, turn on the `pgtap` extension under Database > Extensions.
With Docker installed you can instead run a local Supabase (`npx supabase start`) and use
`npm run test:db`.

## Deploying to Vercel

1. Import the repo into Vercel.
2. Add the four environment variables from `.env.example` under Project Settings >
   Environment Variables. Set `NEXT_PUBLIC_SITE_URL` to the real address.
3. Add the domain `uvl.nelsonstrategygroup.com` under Project Settings > Domains and
   follow Vercel's DNS instructions.
4. Server code runs in Portland (`pdx1`, set in `vercel.json`), next to the Supabase
   project in Oregon (`us-west-2`). If the database ever moves region, change this to match.
5. Database changes are not deployed by Vercel. After adding a migration, run
   `npx supabase db push`.

## Moving to new accounts

The app is built so Umpqua Valley Lamb can take it over with nothing left behind: every
setting is an environment variable, every database change is a migration in
`supabase/migrations`, and the domain is never hard-coded.

1. **Vercel.** Transfer the project to the new team (Project Settings > General > Transfer
   Project), or import the repo into a new Vercel account.
2. **Supabase.** Either:
   - transfer the project to the new organization (Project Settings > General > Transfer
     project). Keys and data stay the same; or
   - create a new project, run `npx supabase link --project-ref NEW_REF` and
     `npx supabase db push`, then load the data export (the CSV zip from Setup > "Export all
     data", built in Phase 6) table by table with the Supabase Table Editor's CSV import or `psql \copy`.
     Load in this order so links line up: parts, size_classes, cut_specs, products,
     product_part_uses, customers, customer_contacts, weeks, orders, order_lines,
     cut_sheets, then the rest. Logins are not in the export: recreate people with
     `npm run create-admin` and the Users screen, then load `profiles` rows only for
     matching ids, or skip `profiles` and re-add people.
3. **Environment variables.** Update all four in Vercel with the new Supabase URL and keys
   and the new site address.
4. **Supabase Auth URL settings.** Set the Site URL and Redirect URLs to the new domain,
   and repeat the session settings above.
5. **Domain.** Add the new domain in Vercel and point its DNS at Vercel. Update
   `NEXT_PUBLIC_SITE_URL` and redeploy.

## Project layout

```
app/                 Screens (App Router). app/(app)/ holds everything behind login.
app/login/           Login page and the login/logout server actions.
components/          Shared UI (app frame, sheets).
lib/auth/            Session rule (3 AM), roles, current user.
lib/calc/            Business calculations, pure functions with unit tests (Phase 2 on).
lib/seed/            Builds seed rows from reference/seed-data.json.
lib/supabase/        Supabase clients: browser, server (cookie session), admin (service role, server only).
proxy.ts             Runs before every request: session refresh, 3 AM rule, role routing.
scripts/             seed and create-admin.
supabase/migrations/ Every database change, with Row Level Security.
supabase/tests/      Database security tests (pgTAP).
reference/           The approved prototype and the real starting data.
```
