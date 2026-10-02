# Umpqua Valley Lamb Orders App: Build Specification

Version 1, October 2026. Prepared for Claude Code.

## 1. Purpose and users

Umpqua Valley Lamb (UVL) sells pasture-raised lamb to grocery stores, butcher shops, restaurants, and distributors, plus half and whole lambs to households. Each week:

1. Kathy phones each customer and records what they want.
2. She works out how many lambs are needed, and of what size, and tells the producer.
3. She builds a cut sheet that tells the meat plant (Mohawk) exactly how to cut every lamb, organized in "sets." She usually hand-delivers it on paper.
4. At the plant, Chris packs each customer's order onto pallets and confirms what was packed.

Users and roles:

| Role | Who | Can do |
|---|---|---|
| `admin` | Kathy, Eric (owners), Lucas (builder) | Everything, including managing users and settings |
| `office` | Anyone taking orders | Everything except managing users and app settings |
| `packing` | Chris | Packing screen only. Reads orders, products, customer names. Writes packing records |

Kathy prefers paper and is learning. Chris will use a tablet at the plant. Design for large tap targets, one task per screen, plain words, and undo for every destructive or quick action.

Expected volume: about 70 lambs per week, 20 to 60 customers including individual store locations, one cut sheet per week.

## 2. Authentication and sessions

Requirements:

- Login is required for every page except the login page.
- No public sign-up. Admins create accounts from a Users screen.
- Login method: email and password. Large fields, a "show password" toggle, and a clear error message. Admins can set or reset a user's password from the Users screen (server action using the service role key).
- **Once logged in, a person stays logged in for the rest of the day.** They are signed out at 3:00 AM Pacific the following morning, then log in once again. Nobody should be logged out in the middle of the work day.

Implementation:

- Use `@supabase/ssr` with cookie storage and Next.js middleware that refreshes the session on every request, following Supabase's current Next.js guide.
- Store the time of each successful login in `profiles.last_login_at` (set in the login server action).
- In middleware, after confirming the Supabase session, sign the user out if `last_login_at` is before the most recent 3:00 AM `America/Los_Angeles`. Redirect to `/login` with a friendly message: "Good morning. Please log in for today."
- Supabase dashboard settings (Lucas will set these; document them in the README): Auth, Sessions, "Time-box user sessions" = 36 hours as a safety net. Leave "Inactivity timeout" off. Leave "Single session per user" off, because people will use both a phone and a tablet.
- Make the 3:00 AM cutoff a single constant in `lib/auth/session.ts` so it is easy to change.
- Deactivated users (`profiles.active = false`) are signed out by middleware and cannot log in.

## 2.1 Hosting, domain, and moving it later

- For now the app runs at `https://uvl.nelsonstrategygroup.com`, hosted under Nelson Strategy Group's Vercel and Supabase accounts. It will later move to a domain and accounts owned by Umpqua Valley Lamb.
- Never hard-code the domain. Read it from `NEXT_PUBLIC_SITE_URL`. All links, redirects, the web manifest, and email links use that variable.
- Keep every piece of configuration in environment variables and every database change in `supabase/migrations`, so a fresh Supabase project can be built from the repo alone and loaded from a data export.
- The README must include a "Moving to new accounts" section: transfer the Vercel project, transfer the Supabase project to another organization (or create a new project, run the migrations, and import the CSV export), update environment variables, update Supabase Auth URL settings, and point the new domain.
- The app shows Umpqua Valley Lamb branding only. Nothing in the interface depends on the hosting domain.
- Supabase Auth URL settings (Lucas sets these, and the README documents them): Site URL `https://uvl.nelsonstrategygroup.com`; Redirect URLs include that address plus `http://localhost:3000` for development.

## 3. Visual design

Match `reference/demo-prototype.html`:

- Fonts: Fraunces (headings), Work Sans (body), from Google Fonts via `next/font`.
- Colors: forest `#3B5E27`, linen background `#F1EFE3`, paper `#FBFAF4`, field `#E8EAE0`, wool `#DDD9C9`, wool dark `#8C8672`, barn red `#7A3327`. Include the prototype's dark mode tokens.
- Mobile first. Bottom navigation on phones, top tabs on wider screens.
- Minimum tap target 44px; primary action buttons 56 to 60px tall on Calls and Packing.
- Every quick action (mark packed, same as last week, delete a line, delete a set) shows a toast with an Undo button for 6 seconds.
- A per-device "Larger text" setting stored in `localStorage`.
- Installable as a home screen app: web manifest, icons (use a sheep or "UV" mark in forest green), `display: standalone`, theme color forest green.

## 4. Data model

Create these tables with Supabase migrations. Use `uuid` primary keys with `gen_random_uuid()` unless noted. Every table has `created_at timestamptz default now()` and `updated_at timestamptz` maintained by trigger. Enable RLS on every table.

### 4.1 People and settings

- `profiles`: `id uuid` (PK, references `auth.users`), `display_name text`, `role text check in ('admin','office','packing')`, `active boolean default true`, `last_login_at timestamptz`.
- `app_settings`: single row. `processor_name text default 'Mohawk'`, `processor_email text`, `standing_instructions text` (printed on every cut sheet), `company_name text default 'Umpqua Valley Lamb'`.

### 4.2 Catalog

- `parts`: `id text` PK (`leg`, `shoulder`, `rack`, `loin`, `fshank`, `hshank`, `neck`, `trim`), `name`, `per_lamb numeric`, `unit text` (`each` or `lb`), `balance_check boolean` (counts in set and half/whole balance), `confirmed boolean`, `source_note text`, `sort int`.
- `cut_specs`: Mohawk's instruction lines. `id text` PK, `text text` (exact wording printed on the cut sheet), `use_type text` (see 6.3), `active boolean`, `sort int`.
- `products`: what customers order. `id text` PK, `name`, `short_name`, `unit` (`each`, `lb`, `leg`, `loin`, `lamb`), `group_name` (Legs, Shoulders, Racks, Loins, Shanks, Ground and trim, Whole lambs, Other), `cut_spec_id text` nullable FK (most products are exactly one cut spec), `fresh_only boolean default false` (never filled from the freezer), `active boolean`, `sort int`, `note text`.
- `product_part_uses`: `product_id`, `part_id`, `qty numeric`. PK (`product_id`, `part_id`). How much of each part one unit consumes.
- `size_classes`: `id text` PK (`XL`, `Large`, `Medium`, `Small`, `XS`), `label`, `weight_range`, `sort`.

Seed all of the above from `reference/seed-data.json`. When a user adds a new cut spec from the cut sheet screen, also create a matching product (same text, `cut_spec_id` set, part uses derived from `use_type`), as the prototype's `newSpec` does.

### 4.3 Customers and CRM

- `customers`: `name`, `type` (Retail, Wholesale, Restaurant, Distributor, Other), `call_day` (weekday name or null), `notes text` (standing notes), `active boolean`, `parent_customer_id uuid` nullable self-reference. A parent such as "PCC Community Markets" has child locations (each PCC store), and each location places its own order.
- `customer_contacts`: `customer_id`, `name`, `role` (Orders, Receiving, Billing, free text), `phone`, `email`, `sort`.
- `contact_log`: `customer_id`, `kind` (`call`, `email`, `visit`, `note`), `summary text`, `follow_up_date date`, `follow_up_note text`, `follow_up_done boolean default false`, `created_by uuid`. Only the author can edit an entry. Every edit is preserved in the audit log (4.7). No one can hard-delete; "delete" sets `deleted_at` and hides the entry.

### 4.4 Weekly orders and packing

- `weeks`: `id date` PK (the Monday), `process_date date`, `producer text`, `lamb_override int` nullable, `notes text`.
- `orders`: `week_id`, `customer_id`, `status` (`todo`, `ordered`, `none`, `callback`), `notes text`. Unique (`week_id`, `customer_id`).
- `order_lines`: `order_id`, `product_id`, `qty numeric check (qty > 0)`. PK (`order_id`, `product_id`). Delete the row when qty becomes 0.
- `packing_lines`: `order_id`, `product_id`, `packed_qty numeric`, `packed_by uuid`, `packed_at timestamptz`. PK (`order_id`, `product_id`).
- `packing_orders`: `order_id` PK, `boxes int`, `pallet text`, `updated_by uuid`.

### 4.5 Cut sheet

- `cut_sheets`: `week_id date` PK, `inv_number text`, `notes text` (the pink "UVL Notes" box), `pulled_large int`, `pulled_medium int`, `pulled_small int`, `sent_at timestamptz`, `sent_hash text`, `sent_by uuid`.
- `cut_sheet_banners`: `week_id`, `text`, `sort`. This week's top-of-sheet instructions.
- `saving_goals`: `text`, `active boolean`. Ongoing collection goals (bones, bellies, necks) that print at the top of every week's sheet until marked finished.
- `cut_sets`: `week_id`, `name`, `lambs int`, `size_class_id`, `headline text` (the yellow bar), `sort int`, `filled_week date` (set when lines were added from orders this week).
- `cut_set_lines`: `set_id`, `kind` (`line` or `note`), `cut_spec_id` (null for notes), `qty numeric` nullable, `text` (notes only), `side_note text`, `highlight` (null, `yellow`, `blue`, `green`), `shank_on boolean default false`, `sort int`.
- `cut_set_customers`: `set_id`, `customer_id`. Which customers a set is for.

### 4.6 Half and whole lambs, freezer

- `half_whole_orders`: `customer_name`, `phone`, `size` (`half`, `whole`), `status` (`pending`, `filled`, `cancelled`), `need_by date`, `notes`, `created_by`.
- `half_whole_choices`: `order_id`, `part_id`, `slot int`, `product_id`. One row per slot (a whole lamb has 2 leg slots, 2 shoulder slots, and so on).
- `freezer_log`: `entry_date date`, `product_id`, `qty numeric` (positive in, negative out), `note`, `created_by`.

### 4.7 Audit

- `audit_log`: `table_name`, `row_id text`, `action` (`insert`, `update`, `delete`), `old_data jsonb`, `new_data jsonb`, `user_id uuid`, `at timestamptz`. Populate with a trigger on every business table. Readable by admins only. This is the company's record of who changed what; the owners care about this.

### 4.8 Row Level Security

- A helper SQL function `app_role()` returns the current user's role from `profiles`, or null if inactive.
- `admin` and `office`: full read and write on business tables. Only `admin` can write `profiles` and `app_settings`.
- `packing`: read `orders`, `order_lines`, `products`, `weeks`, and `customers` (all columns are fine for now); read and write `packing_lines` and `packing_orders`. No access to anything else.
- `contact_log`: update allowed only where `created_by = auth.uid()`.
- Write a SQL test or script that proves a `packing` user cannot read `contact_log` or write `order_lines`.

### 4.9 Realtime

Enable Supabase Realtime on `orders`, `order_lines`, `packing_lines`, `packing_orders`, `cut_sets`, `cut_set_lines`, `cut_sheets`. When Kathy enters an order on one device, Chris's packing screen updates within a couple of seconds, and vice versa.

## 5. Screens

Port each screen from the prototype. Navigation by role:

- `admin`, `office`: Calls, This week, Orders, Cut sheet, Packing, Half and whole, Freezer, Customers, Setup (plus Users for admin).
- `packing`: Packing only, with no other navigation.

A week picker (previous, "Week of Oct 19", next) appears on Calls, This week, Orders, Cut sheet, and Packing. Default to the current week.

### 5.1 Calls (home for office users)

One customer at a time, in this order: customers whose call day is today and who are not done, then call-backs, then others not done, then done. Show the customer name, standing notes, last contact, a large tap-to-call button for the first contact with a phone number, and last week's order in large type. Buttons:

- "Same as last week" copies last week's lines and sets status `ordered`.
- "Different order this week" (or "Enter their order") opens the order editor.
- "No order this week" sets status `none` and clears lines.
- "Call back later" asks for an optional note and sets status `callback`.

After any of these, show "Saved. Read this back to them:" with the order in large type, an Undo, and a "Next: [customer]" button. Below the card, list everyone this week with status.

### 5.2 Order editor

Opened from Calls, Orders, or a customer. Shows the customer's standing notes, last contact, a "Log this call" button, status buttons, and "Same as last week." Lists products the customer has ordered before first, under "What they usually buy," then "Show N other cuts," grouped by `group_name`. Each product row: name, unit, minus button, number field, plus button. Saves automatically as the user types (debounce about 500 ms). Ends with a large read-back of the order.

### 5.3 Orders

Default layout: "One customer at a time," a list of customer cards with status and a summary of their order; tapping opens the order editor. Kathy prefers this. A toggle switches to "Spreadsheet grid" on wide screens: customers down the side, products across the top, Tab moves across, Enter moves down, half and whole shortfall row, totals row. Child locations show as "PCC: Fremont" style names, grouped under the parent.

### 5.4 This week

- Large "lambs to order" number with the part that sets it, an override field, producer name, and processing day.
- When a cut sheet exists for the week, the producer message uses the cut sheet's total by size: "Please bring 70 lambs for processing on Wednesday, Oct 21: 40 Large, 16 Medium, ..." Otherwise it uses the order-based count. Copy button.
- "Does the carcass balance?" table: each part's need, what the lamb count gives, and a status tag.
- Leg breakdown line under the table: bone-in, AO, boneless, and other leg products, then the total, because Kathy summarizes legs this way.
- Progress: customers answered, lines packed, cuts added for half and whole orders.
- Follow-ups due this week or overdue, with Done buttons.
- Cut sheet summary card with sent status and a link to the Cut sheet screen.

### 5.5 Cut sheet

Port the prototype's Cut sheet screen exactly. Key behaviors:

- Empty week: "Copy the week of [most recent week with a cut sheet]" (large button) or "Start a blank sheet." Copying duplicates banners, sets, lines, and set customers; clears INV#, pulled counts, and sent fields.
- Header: total lambs and breakdown by size, INV# field, overall status ("Every set adds up to whole lambs" or which sets don't), sent status.
- Instructions: active saving goals (editable, "Finished" button), this week's banners (add, edit, remove).
- Sets, in order, each with name, lambs, size, move up and down, delete (with undo), yellow headline, and lines. A line has qty, a cut spec picker grouped by part (plus "Note line, no count" and "Add a new instruction..."), side note, highlight cycle (none, yellow, blue, green), "shank on" checkbox on plain leg lines, move up, delete. Under the lines, the balance chips (6.3). Below that, linked customers with "Link a customer..." and, when they have orders this week, the "Put these on this set" action (6.4).
- Bottom: pulled-from-inventory counts and UVL notes.
- "What Mohawk gets" preview rendered in Mohawk's paper layout (see the prototype's `csHTML`), with **Print or save as PDF as the primary button**, because Kathy hand-delivers the sheet. Secondary: "Email to Mohawk" (opens a `mailto:` with a plain-text version), "Copy as text," and "I sent it another way." Printing or emailing marks the sheet as sent. Use print CSS so only the sheet prints, with colors.
- If anything changes after it was sent, show "Changed after you sent it on [time]. Send an update." and mark the next email subject "(UPDATED)".

### 5.6 Packing

Port the prototype's Packing screen. Grouped by customer (and location), one large row per line: tap anywhere on the row to mark packed, with undo. "Packed a different amount?" appears after a row is checked and opens a number picker. Partial and over states are shown in words. Per customer: boxes stepper, pallet field, "All packed" banner, who packed it and when. Filters: To pack, Done, All. Progress bar. "Print a paper copy" prints a checklist with blanks for packed count, boxes, pallet, and initials.

### 5.7 Half and whole

Port from the prototype: list of orders, "New order," guided form with half or whole, one dropdown per slot for each balance part, freezer availability per slot ("In freezer" or "Cut fresh"), automatic ground lamb from trim, need-by date, status, notes, "Mark filled." Shortfalls feed the weekly totals (6.2).

### 5.8 Freezer

On hand, held for pending half and whole orders, and free, per product. "Add or take out" form. Recent changes with remove.

### 5.9 Customers

List with type, call day, last contact, and open follow-ups. Customer page: contacts with tap-to-call and email, standing notes (edit, save), "Log a contact" form (kind, what was said, follow-up date and note), and a history timeline that merges contact log entries with weekly orders. Edit details: name, type, call day, parent customer, active, contacts (add, remove). Admins also get **"Import customers from a spreadsheet"**: upload a CSV with columns `name, type, call_day, parent, contact_name, contact_role, phone, email, notes`, preview the rows, then import. Kathy is emailing her customer list, so this is needed in Phase 2.

### 5.10 Setup (admin and office can view; admin edits)

Parts per lamb with confirmed flags, cut specs (edit text, activate or deactivate), products (edit names, group, fresh only, part uses, active), size classes, processor name, email, and standing instructions. Admin only: Users (create, set role, reset password, deactivate) and "Export all data" (download every table as CSV in one zip, because the owners must always be able to take their records with them).

## 6. Business rules and calculations

Port these from the prototype into `lib/calc/` with unit tests.

### 6.1 Weekly lamb guide (order based)

For the selected week:

1. `totals[product]` = sum of `order_lines.qty` across all orders, plus the half and whole shortfall (6.2).
2. `need[part]` = sum over products of `totals[product] * product_part_uses.qty`.
3. `lambs[part]` = `ceil(need[part] / parts.per_lamb)` when need > 0.
4. Recommended = max of `lambs`. The part with that max "sets the count."
5. Final = `weeks.lamb_override` if set, else recommended.
6. For each part: supply = final * per_lamb; left over = supply minus need. Status: short, sets the count, comes out even, or extra.

### 6.2 Half and whole shortfall and freezer

- On hand per product = sum of `freezer_log.qty` minus quantities in half and whole orders with status `filled`.
- Pending need per product = sum over `pending` half and whole orders.
- Shortfall per product = `max(0, pending need - on hand)`. Shortfalls are added to the week's totals and shown as a separate row.
- `fresh_only` products are never treated as available from the freezer.
- Half and whole slots: for each part with `balance_check = true`, slots = `per_lamb * (1 for whole, 0.5 for half)`. Slot options are products with exactly one part use, of that part, with qty 1. Ground lamb (from trim) is added automatically: trim `per_lamb * fraction` pounds.

### 6.3 Cut set balance

Each cut spec has a `use_type`. Multipliers per unit:

| use_type | Consumes |
|---|---|
| `leg` | 1 leg (plus 1 hind shank if the line's `shank_on` is true) |
| `legshank` | 1 leg, 1 hind shank |
| `shoulder` | 1 shoulder |
| `rack` | 1 rack |
| `loin` | 1 short loin |
| `wholeloin` | 1 rack, 1 short loin |
| `saddle` | 2 short loins |
| `fshank` | 1 front shank |
| `hshank` | 1 hind shank |
| `allshank` | 0.5 front shank, 0.5 hind shank |
| `carcass` | 2 of each: leg, shoulder, rack, short loin, front shank, hind shank |
| `none` | nothing (necks, bellies, bones, notes) |

For each set and each of the six balance parts (leg, shoulder, rack, short loin, front shank, hind shank): used = sum of `qty * multiplier` over the set's lines (notes excluded); expected = `lambs * parts.per_lamb`. The set adds up when used equals expected for all six. Show a chip per part: "Legs 80 ✓" or "Front shanks 160 of 80" in red. Only check sets that have at least one counted line. Warn before sending if any set does not add up.

### 6.4 Filling a set from orders

"Put these on this set": sum the linked customers' order lines for the week. For each product that has a `cut_spec_id`, add its qty to the set line with that cut spec, or append a new line. If the set's lambs is 0, set it to `ceil(max part used / 2)`. Set `filled_week`. Products without a cut spec (ground lamb, le trim) are listed with "This comes from trim, so plan it in the grind set." If `filled_week` equals the current week, show "Added" with a small "Add them again" link instead of the button. Make the whole operation a single Postgres function (RPC) so it is atomic, and support undo by restoring the previous lines.

### 6.5 Cut sheet totals and sent tracking

- Total lambs = sum of set lambs. By size = sum of lambs grouped by size class, in size class order.
- The top-right size block on the printed sheet counts lambs in sets that contain a `carcass` line, by size. (OPEN: confirm with Kathy.)
- Sent tracking: build a canonical plain-text version of the sheet (same as the email body), hash it, and store the hash with `sent_at`. The sheet is "changed" when the current hash differs.

### 6.6 Calls queue and statuses

As described in 5.1. A customer is "done" for the week when status is `ordered` or `none`.

## 7. Open questions (keep configurable, do not hard-code)

- Whether a bone-in or AO leg keeps its hind shank. It varies by set on Kathy's sheet, so it is a per-line `shank_on` checkbox for plain leg lines, and `legshank` for "AO Leg to Vac." Kathy confirmed AO means "aitch bone out."
- Le trim is half trim and half shoulder meat. The shoulder factor (0.125 shoulder per lb) assumes about 4 lb of meat per shoulder and is unconfirmed.
- What "Lambs Pulled From Inventory" tracks (possibly live lambs being held), and where the INV# comes from.
- Possible duplicate cut specs (French Rack and Frenched Rack, two netted boneless shoulder wordings, two bone-in shoulder wordings).
- Customer-specific cut specs (Nancy's grind tubs, Dish Dash racks, Behman carcasses) may later be hidden for other customers.
- The hind shank `per_lamb` is marked unconfirmed in seed data.

## 8. Out of scope for version 1 (design the schema so these can be added)

- Select suppliers and lamb lots: producer per lot, arrival date, 60-day hold eligibility date, antibiotic identification, and producer label (Cedar Park Grazing and others) per cut set.
- Importing Mohawk's daily data file (actual weights by cut).
- Pricing and invoicing (requires actual weights).
- Offline use at the plant.
- Server-sent email and text messages.

## 9. Required unit tests

Use `sample_cut_sheet` from `reference/seed-data.json` (Kathy's real 9/30/2026 sheet):

1. Total lambs is 144. By size: 40 XL, 81 Large, 16 Medium, 2 Small, 5 XS.
2. Every set adds up except the unnamed 40 XL set, which shows front shanks 160 of 80 (the sheet lists "Front Shanks 2/pack" at 80 twice). This is a real error on the sheet and the app must catch it.
3. "Parts NEW Mid" (30 Large): the 8 loin saddles count as 16 short loins, and short loins total 60.
4. "PCC" (2 Small): whole loins count toward racks and short loins, and the bone-in leg line with `shank_on` makes hind shanks 4 of 4.
5. "Port Townsend" (1 Large): "All shanks to Osso Bucco" at 4 gives 2 front and 2 hind.

Also test 6.1 with a simple order (for example 100 bone-in legs gives 50 lambs set by legs) and 6.2 (a pending whole lamb with an empty freezer adds 2 legs, 2 shoulders, and so on to the week's totals).

## 10. Build phases

Stop after each phase for review.

**Phase 1: Foundation.** Next.js app, Tailwind, fonts and colors, layout with role-based navigation, Supabase clients (browser and server), middleware, login page, 3:00 AM daily sign-out, Users screen for admins, all migrations with RLS and the audit trigger, seed script from `seed-data.json` including the sample cut sheet as the week of 2026-09-28, README with setup steps and the Supabase dashboard settings. Acceptance: Lucas can create Kathy (office or admin) and Chris (packing); Chris sees only Packing; a login survives a browser restart and lasts until 3:00 AM.

**Phase 2: Customers and orders.** Customers (with parent locations, contacts, CSV import), Calls, order editor, Orders (list and grid), This week (6.1), week picker, realtime on orders, Setup (5.10, except Users and data export), so Kathy can correct parts and products as soon as real orders go in. Acceptance: Kathy's real customer list imports; a full week of orders can be entered on a tablet; This week matches the prototype's math.

**Phase 3: Packing.** Packing screen, realtime between devices, paper copy. Acceptance: an order entered on one device appears on the tablet within a few seconds; packing marks show on This week's progress.

**Phase 4: Cut sheet.** Everything in 5.5 and 6.3 to 6.5, saving goals, new cut specs, print layout. Acceptance: the week of 2026-09-28 prints looking like Kathy's paper sheet; the tests in section 9 pass; copying to a new week works; filling a set from linked customers works.

**Phase 5: CRM, half and whole, freezer.** Contact log with author-only edits, follow-ups on This week, half and whole flow, freezer, shortfall feeding the weekly totals.

**Phase 6: Polish.** Home screen install, larger text setting, undo everywhere listed, data export, print styles, accessibility check (labels, focus order, contrast), and a short "How to use this" page for Kathy and Chris with screenshots.
