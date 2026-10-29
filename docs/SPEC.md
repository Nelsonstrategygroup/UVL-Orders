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
- Quick actions that can't be put back another way (no order this week, same as last week on the order screen, deleting a set, line, freezer entry or contact entry, filling a set, copying or starting a cut sheet, finishing a goal, marking a half or whole filled, a follow-up done) show a toast with an Undo button for 30 seconds, with a ✕ to close it. Actions you can simply change back (a status, a weight on Packing) show a plain message (Lucas, 10/22/26).
- A per-device "Larger text" setting stored in `localStorage`.
- Installable as a home screen app: web manifest, icons (use a sheep or "UV" mark in forest green), `display: standalone`, theme color forest green.

## 4. Data model

Create these tables with Supabase migrations. Use `uuid` primary keys with `gen_random_uuid()` unless noted. Every table has `created_at timestamptz default now()` and `updated_at timestamptz` maintained by trigger. Enable RLS on every table.

### 4.1 People and settings

- `profiles`: `id uuid` (PK, references `auth.users`), `display_name text`, `role text check in ('admin','office','packing')`, `active boolean default true`, `last_login_at timestamptz`.
- `app_settings`: single row. `processor_name text default 'Mohawk'`, `processor_email text`, `standing_instructions text` (printed on every cut sheet), `company_name text default 'Umpqua Valley Lamb'`.

### 4.2 Catalog

- `parts`: `id text` PK (`leg`, `shoulder`, `rack`, `loin`, `fshank`, `hshank`, `neck`, `trim`, `denver`, and any added in Setup), `name`, `per_lamb numeric`, `unit text` (`each` or `lb`), `balance_check boolean` (counts in set and half/whole balance), `drives_count boolean` (false for byproducts such as neck, trim, Denver ribs: tracked per lamb but never set the lamb count; hind shank starts false until Kathy confirms), `confirmed boolean`, `source_note text`, `sort int`, `made_from text` (references `parts`: the part this one is cut from; rack and short loin are cut from `wholeloin`, one of each per whole loin; a part cut from another never sets the lamb count). Since 10/15/26 one lamb gives 2 legs, 2 shoulders, 2 whole loins (`wholeloin`), 2 front shanks; only legs, shoulders and whole loins set the count.
- `cut_specs`: Mohawk's instruction lines. `id text` PK, `text text` (exact wording printed on the cut sheet), `use_type text` (see 6.3), `active boolean`, `sort int`.
- `products`: customer products (change requests 10/2026): what customers order, in their words. `id text` PK, `name` (the name customers see), `short_name`, `unit` (`each`, `pack`, `lb`, `case`; old rows may have `leg`, `loin`, `lamb`), `alt_unit` (a second unit it may be ordered in, or null), `lb_per_unit` (about how much one unit weighs, to turn pounds into pieces), `pieces_per_pack`, `order_step` (Le Trim: 10), `billed_by_weight`, `counts_toward_lambs`, `not_lamb` (pepper sticks), `group_name` (free text), `fresh_only`, `active`, `confirmed` (false = listed under Needs checking in Setup), `sort`, `note` (shown behind an info button on the order screen), `per_box` (how many fit in a box; products never share a box), `fill_note` (when set, Kathy fills it from extras, e.g. Le Trim: it takes nothing from the balance and is listed on its own with this note), `carcass` (an uncut carcass lamb: uses no parts, adds one lamb on top of the lambs for parts). `cut_spec_id` is the old single link, replaced by `product_cut_specs`. The 36 original products (copies of Mohawk lines) are turned off and kept for history; the starting list comes from `seed_customer_products()`.
- `product_cut_specs`: `product_id`, `cut_spec_id`, `units_per_cut` (how much of the product's unit one Mohawk line gives: Chops 2.5 lb per short loin), `sort`. A product can link to several Mohawk lines. Mohawk wording appears only on the cut sheet.
- `product_part_uses`: `product_id`, `part_id`, `qty numeric`. PK (`product_id`, `part_id`). How much of each part one unit consumes (Chops: 0.4 short loin per lb). Setup lets it be entered either way round.
- `size_classes`: `id text` PK (`XL`, `Large`, `Medium`, `Small`, `XS`), `label`, `weight_range`, `sort`.

Seed all of the above from `reference/seed-data.json`. When a user adds a new cut spec from the cut sheet screen, also create a matching product (same text, `cut_spec_id` set, part uses derived from `use_type`), as the prototype's `newSpec` does.

### 4.3 Customers and CRM

- `customers`: `name`, `type` (Retail, Wholesale, Restaurant, Distributor, Other), `call_day` (weekday name or null), `notes text` (standing notes), `active boolean`, `parent_customer_id uuid` nullable self-reference. A parent such as "PCC Community Markets" has child locations (each PCC store), and each location places its own order.
- `customer_contacts`: `customer_id`, `name`, `roles text[]` (any of orders, receiving, billing; checkboxes), `phone`, `email`, `sort`. `customers.bills_for_locations` marks a parent that pays for its locations.
- `contact_log`: `customer_id`, `kind` (`call`, `email`, `visit`, `note`), `summary text`, `follow_up_date date`, `follow_up_note text`, `follow_up_done boolean default false`, `created_by uuid`. Only the author can edit an entry. Every edit is preserved in the audit log (4.7). No one can hard-delete; "delete" sets `deleted_at` and hides the entry.

### 4.4 Weekly orders and packing

- `weeks`: `id date` PK (the packing Monday; the order week runs Thursday through Wednesday around it: orders Thursday, Mohawk processes and staff pack Monday, invoices Tuesday, ships Tuesday or Wednesday (Thursday before 10/2026); Lucas, 10/20/26), `process_date date`, `producer text`, `lamb_override int` nullable, `notes text`.
- `orders`: `week_id`, `customer_id`, `status` (`todo`, `ordered`, `none`, `callback`), `notes text`. Unique (`week_id`, `customer_id`).
- `order_lines`: `order_id`, `product_id`, `qty numeric check (qty > 0)`, `unit` (null = the product's unit; set when taken in its other unit, for example a BLS Shoulder in pounds). PK (`order_id`, `product_id`). Delete the row when qty becomes 0.
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

- `admin`, `office` (change request 10/21/26, stage 2): the phone bottom bar is Week, Calls, Orders, Packing, More. More lists, in order: Cut sheet, Print and download, Half and whole, Freezer, Customers, Setup, Users (admin). Wide screens show the same order across the top.
- `packing`: Packing only, with no other navigation.
- The button at the top right is "My account": larger text, How to use this, change password, log out. It is separate from Setup.

A week picker appears on Calls, This week, Orders, Cut sheet, Packing, and the Box Label Report. Default to the current week. It is one line (change request 10/21/26): "‹ Week of Oct 19 · Inv 3000 ›", leaving out the invoice part when the week's cut sheet has no INV#. On another week, a small "Back to this week" chip sits next to it. The schedule (the week's days on wide screens; "Orders Thu · Pack Mon · Invoice Tue · Ships Tue or Wed" on phones) shows only on This week.

**Which week is "now"** (Kathy, 10/21/26): an order week runs Thursday through Wednesday and is named by its packing Monday. The current week switches at 12:00 AM Thursday, Pacific time: Thu Oct 15 through Wed Oct 21 is "Packing Mon Oct 19" (orders Thu Oct 15, pack Mon Oct 19, invoice Tue Oct 20, ship Tue or Wed). On Monday, "this week's orders" means the orders taken the Thursday before. The switchover day is one constant (`WEEK_STARTS` in `lib/dates.ts`), and every screen and download uses it: the picker's default, "last week" and "Same as last week" (the week before, by packing Monday), follow-ups due "this week" (up to its Wednesday), and the Print and download date range. A screen left open on the current week moves to the new week when Thursday starts.

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
- "Does the carcass balance?" table: each part's need, what the lambs for parts give, and a status tag, in two groups (main cuts; what comes with every lamb). Rack and short loin show as sub-rows under Whole loin. Below it: extra main cuts with links to the freezer, cut sheet, and half and whole orders; products filled from extras (Le Trim, in lb and 10 lb units, "Kathy fills from extra shoulders or legs."); and any pound lines that can't be counted because the product has no weight per piece.
- With carcass lambs ordered, the headline adds a line such as "78 for parts + 2 carcass = 80 lambs"; the producer message uses the total.
- Leg breakdown line under the table: bone-in, AO, boneless, and other leg products, then the total, because Kathy summarizes legs this way.
- Follow-ups due this week (by its Wednesday) or overdue, with Done buttons.

Layout, the weekly overview (change request 10/21/26, stage 2), with no subtabs:

1. The lamb count (with the override field), then the carcass balance in a line: each short part with the amount ("Front shank short 56"), or "Every part comes out even or extra." Then "Show the full balance", which opens the table: closed on phones, open on wide screens.
2. This week's steps, one row each with its status, tapping through to its page: Orders ("20 of 23 customers answered", to Calls); Cut sheet (not started, in progress, sent to Mohawk, or changed since sent; to the Cut sheet); Box labels (not printed, printed, or orders changed since you printed; to the Box Label Report); Packing ("3 of 152 lines packed", to Packing). A step shows only to people who can open its page. Shipping and invoices come later.
3. Planning: producer, processing day, producer message, extra cuts and where they go, what's filled from extras (Le Trim), and cuts added for half and whole orders.
4. Follow-ups.

### 5.5 Cut sheet

Port the prototype's Cut sheet screen exactly. Key behaviors:

- Empty week: "Copy the week of [most recent week with a cut sheet]" (large button) or "Start a blank sheet." Copying duplicates banners, sets, lines, and set customers; clears INV#, pulled counts, and sent fields.
- Header: total lambs and breakdown by size, INV# field, overall status ("Every set adds up to whole lambs" or which sets don't), sent status.
- Instructions: active saving goals (editable, "Finished" button), this week's banners (add, edit, remove).
- Sets, in order, each with name, lambs, size, move up and down, delete (with undo), yellow headline, and lines. A line has qty, a cut spec picker grouped by part (plus "Note line, no count" and "Add a new instruction..."), side note, highlight cycle (none, yellow, blue, green), "shank on" checkbox on plain leg lines, move up, delete. Under the lines, the balance chips (6.3). Below that, linked customers with "Link a customer..." and, when they have orders this week, the "Put these on this set" action (6.4).
- Bottom: pulled-from-inventory counts and UVL notes.
- "What Mohawk gets" preview rendered in Mohawk's paper layout (see the prototype's `csHTML`), with **Print or save as PDF as the primary button**, because Kathy hand-delivers the sheet. Secondary: "Email to Mohawk" (opens a `mailto:` with a plain-text version), "Copy as text," and "I sent it another way." After printing or emailing, the app asks "Did this go to Mohawk?" (Yes / Not yet); only Yes (or "I sent it another way") marks the sheet as sent. Use print CSS so only the sheet prints, with colors.
- If anything changes after it was sent, show "Changed after you sent it on [time]. Send an update." and mark the next email subject "(UPDATED)".

### 5.6 Packing

Port the prototype's Packing screen. Grouped by customer (and location), one large row per line: tap anywhere on the row to mark packed, with undo. "Packed a different amount?" appears after a row is checked and opens a number picker. Partial and over states are shown in words. Per customer: boxes stepper, pallet field, "All packed" banner, who packed it and when. Filters: To pack, Done, All. Progress bar. Printing the page prints a checklist with blanks for packed count, boxes, pallet, and initials.

Packing is only for packing (change request 10/21/26, stage 1). At the top, in order: "Scan boxes" (large), then "3 of 152 lines packed" with the progress bar, then the To pack / Done / All filter, so the first customer shows without scrolling on a phone. The Box Label Report and "Print a paper copy" links are not on Packing; both pages still work at their own addresses, and This week links to the Box Label Report.

### 5.7 Half and whole

Port from the prototype: list of orders, "New order," guided form with half or whole, one dropdown per slot for each balance part, freezer availability per slot ("In freezer" or "Cut fresh"), automatic ground lamb from trim, need-by date, status, notes, "Mark filled." Shortfalls feed the weekly totals (6.2).

### 5.8 Freezer

On hand, held for pending half and whole orders, and free, per product. "Add or take out" form. Recent changes with remove.

### 5.8a Print and download

Everything to print or download, at `/print` (`/downloads` redirects there), with the week picker at the top. One card per stage of the week; an item shows only to people who can open its page, and an empty card isn't shown:

- Thursday, orders: order sheets (print, `/orders/sheet`); this week's orders (download); order grid (Excel download).
- Weekend, cut sheet: cut sheet for Mohawk (opens the cut sheet, which keeps its own Print); product totals (download).
- Before packing day: Box Label Report (print, `/packing/labels`).
- Monday, packing: paper packing copy (print, `/packing/print`); packing record (download).
- Anytime: customer list, one customer's history, sales over a date range, freezer on hand, box sizes.
- Box sizes (10/21/26): the Setup > Boxes grid on paper, products down the side in their groups, box types across, each cell as entered ("6", "25 lb", "—" never fits, "Check" still to confirm), the product's unit and weight per piece, and a blank Notes column for corrections by hand. "45 lb maximum per box" and the date printed at the top. Landscape, 11 pt, shaded rows and column lines. Open, Print and Download.
- Later, Tuesday, shipping and billing: manifest and invoices.

Every report with a spreadsheet also has Open (10/21/26): the same table as a page at `/print/report/<report>`, with the same week picker or filters, a Print button, and Download kept on it. On a phone, narrow reports read as one card per customer, product or week; the order grid and sales over a date range scroll sideways with the first column fixed, with "Easier to read on a laptop" at the top. On paper: letter, portrait (landscape for the order grid and sales), 11 pt, table headers repeated on each page. The Download button and the page build the table in one place (`app/(app)/print/reports.ts`), so they always match.

Orders and Packing have no print or download buttons. The "Spreadsheet grid" layout on Orders is for entering orders and stays there.

### 5.8b Last order, order sheets, delivery day (change request 10/22/26)

- **Last order**: a customer's most recent week with an order (status ordered, at least one product) before the week being viewed, looking back up to 26 weeks. Never ordered: nothing shown. (`lib/calc/lastOrder.ts`)
- Order screen: "Last order (Mon Oct 19): 12 packs Front Shanks, 6 BNLS Legs, ..." above the status buttons, to read back; each product they ordered then shows "Last: 12 packs" in small grey text. "Same as last week" is unchanged (it copies the week right before).
- Order sheets: columns Product, Comes in, Last order, How many, Note. For a customer, "What they usually buy" first (the order screen's rule: anything they have ever ordered, or have on this week's order), in the order form's groups, then "Other products"; blank sheets and customers who never ordered keep the normal order with Last order empty. The header has Customer, Scheduled delivery, Invoice batch (the week's INV#), Contact, Called, Call day, and Last order (its packing date). A "Print all customers (N)" button sits next to "Who it's for". "Comes in" is sized for "packs of 2" and wraps longer entries; "How many" is 1 in wide. With 35 products a sheet runs to two pages at a writable row height.
- **Delivery day** (`customers.delivery_day`): a weekday, set on the customer page. A chain's locations use the chain's day unless they have their own (PCC: Saturday). Scheduled delivery on a sheet is the first delivery day after the week's packing Monday (packing Mon Oct 26, Saturday: Sat Oct 31); no delivery day leaves it blank, never the packing date. Blank sheets leave Scheduled delivery and Invoice batch blank.

### 5.8c Requested lines for a later week (change request 10/22/26, part B)

- On the order screen each line has **Move to next week**: it comes off this week's order and is requested on the customer's order for the next week (`order_requests`, with when it was asked, who entered it, and the week it came from). Undo puts it back. **Request for a later week** adds a request directly: product, amount, and which of the next eight weeks.
- A customer with only requested lines in a week is still "Not called" for that week.
- On Calls and the order screen for that week, requested lines show at the top: "Requested on Oct 22: 10 BNLS Legs. Confirm, change, or drop." Confirm (with the amount from the call) makes it a normal line; Drop has Undo. The Orders list says "N requested to confirm".
- Requested lines count toward the week's lamb count ("Includes N requested lines not confirmed yet"), product totals ("Includes requested" column), and the cut sheet's "Put these on this set" ("includes N requested"), because they're cut and frozen that week. They're not on Packing or the box labels until confirmed, so nothing ships before it's frozen (Lucas, 10/22/26). This week warns if the cut sheet was sent while any are unconfirmed.
- Order sheets: the customer's sheet for that week has a box at the very top, "Requested, confirm on the call" (Product, Comes in, Requested with "asked Oct 22", How many, Note); those products aren't listed again below. The sheet for the week a line was moved from ends with "Moved to next week: 12 packs Front Shanks".
- "Same as last week", "Last order", and "What they usually buy" use confirmed lines only.

### 5.9 Customers

List with type, call day, last contact, and open follow-ups. Customer page: contacts with tap-to-call and email, standing notes (edit, save), "Log a contact" form (kind, what was said, follow-up date and note), and a history timeline that merges contact log entries with weekly orders. Edit details: name, type, call day, parent customer, active, contacts (add, remove). Admins also get **"Import customers from a spreadsheet"**: upload a CSV with columns `name, type, call_day, parent, contact_name, contact_role, phone, email, notes`, preview the rows, then import. Kathy is emailing her customer list, so this is needed in Phase 2.

### 5.10 Setup (admin and office can view; admin edits)

Parts per lamb with confirmed flags, cut specs (edit text, activate or deactivate), products (edit names, group, fresh only, part uses, active), size classes, processor name, email, and standing instructions. Admin only: Users (create, set role, reset password, deactivate) and "Export all data" (download every table as CSV in one zip, because the owners must always be able to take their records with them).

Layout (change request 10/21/26, stage 2): Setup opens to a short menu, each item its own page at `/setup/<page>` with a "← Setup" link: Products, Boxes, Parts per lamb, Instructions for Mohawk, Lamb sizes, Pallet groups, Box labels (GTINs), Processor, Your records (admin). Instead of one "Needs checking" list, each menu item shows how many are left to check ("Boxes · 30 to check"); Products lists its own items to check at the top of its page, and inside each page the items to check are highlighted as before. Nothing about the data or the calculations changed.

## 6. Business rules and calculations

Port these from the prototype into `lib/calc/` with unit tests.

### 6.1 Weekly lamb guide (order based)

Whole loin model, confirmed by Kathy and Chris on 10/15/26. For the selected week:

1. `totals[product]` = sum of `order_lines.qty` across all orders (in each product's own unit), plus the half and whole shortfall (6.2).
2. Carcass lambs = sum of totals for products with `carcass`. They use no parts and are not in the balance.
3. Products with a `fill_note` (Le Trim) take nothing from the balance; they are listed on their own.
4. `need[part]` = sum over the other products of `totals[product] * product_part_uses.qty`.
5. For a part that others are cut from (`wholeloin`): `need[wholeloin]` = whole loins ordered intact (Whole Loin, and 2 inside each boxed Whole Lamb) + max(`need[rack]`, `need[loin]`). The other one comes out extra.
6. `lambs[part]` = `ceil(need[part] / parts.per_lamb)` for parts that drive the count: `drives_count` true and not cut from another part (legs, shoulders, whole loins). Only products that count toward lambs feed this.
7. Lambs for parts = max of `lambs`; the part with that max "sets the count." Recommended = lambs for parts + carcass lambs.
8. Final = `weeks.lamb_override` if set, else the cut sheet total, else recommended.
9. For each part: supply = (final - carcass lambs) * per_lamb (a rack or short loin gets one per whole loin that is cut: whole loins going out whole, ordered intact or inside a Whole Lamb, give none); left over = supply minus need. Status: short, sets the count, comes out even, or extra.

Front and hind shanks are shown (need vs. get) but never set the count ("We will not kill lambs to get shanks," Kathy 10/14). Hind shanks stay on the legs and are not part of a boxed Whole Lamb.

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
- Importing Mohawk's daily data file (actual weights by cut). Live scanning of box labels (section 11) is the primary capture.
- Ranch-level traceability (lots trace back to the Mohawk lot only, for now).
- Pricing and invoicing (requires actual weights).
- Offline use at the plant, except Packing and scanning (section 11.7).
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

## 11. Barcode scanning, lots, pallets, and manifests (change request 10/19/26)

Packing today uses manual weight entry only. This section adds scanning Mohawk's box labels with the phone camera, lot capture, physical pallets, and a same-day manifest. Build it in stages (11.10) and check each stage with Lucas before the next.

### 11.1 Context

- Mohawk prints a GS1-128 label on every box when it is weighed. Chris packs at Mohawk and scans with his own phone camera inside the app (no separate scanner app). A Bluetooth scanner that types into a focused field must also work, in case the camera can't read these dense barcodes reliably.
- There is no cell signal inside the Mohawk freezer. Packing and scanning must work offline (11.7).
- Manifests must be complete the same day, before the truck leaves.
- Traceability starts at the Mohawk lot. Ranch-level tracking is deferred; the data model leaves room for it (a lot can later point to its source lambs or ranch).
- Scanning must work on both iPhone and Android phones (Chris's phone type is not known): use the browser's barcode reader where it has one and a bundled reader where it doesn't.
- One packing day a week, Monday, the same day Mohawk processes (Monday and Wednesday before 10/2026). Boxes ship Tuesday or Wednesday (Thursday before 10/2026).
- Mohawk does not mix products in a box. Mohawk leaves the pieces field at 0, so pieces per box come from the product's `per_box`.

### 11.2 GS1-128 parser

- Parse by Application Identifier (AI), not by fixed position. Strip a leading `]C1` symbology identifier if present. A GS character (ASCII 29) ends a variable-length field if one is sent.
- AIs: `01` GTIN (14 digits, fixed); `11` pack date YYMMDD (6, fixed); `3202` net weight in lb with 2 decimals (6, fixed); `21` serial (variable, last in the string); `10` batch/lot (variable). Also read the other `320x` (lb, x decimals) and `310x` (kg, x decimals) weight AIs; store kg converted to lb and keep the original.
- Validate the GTIN check digit (GS1 mod-10) on every scan. A failed check is a misread: reject it and ask for a rescan.
- Serial (`21`) is YY + day of year + case number, per Mohawk: `2628710066` = 2026, day 287 (Oct 14), case 10066. Store the serial date and the case number as separate fields. The unique box ID is GTIN + full serial. The serial date is when the label printed and can differ from the pack date; store both.
- If AI `10` is present it overrides the stored lot.
- Required tests (real labels):
  1. Raw scan `]C10110602581209420112610133202001000212628720003`: GTIN 10602581209420, pack date 2026-10-13, net 10.00 lb, serial 2628720003 (2026, day 287 = Oct 14, case 20003). Snack stick, not lamb.
  2. `0110698746488816112610143202002215212628710066`: GTIN 10698746488816, pack 2026-10-14, net 22.15 lb, serial 2628710066. French rack.
  3. `0110698746489288112610143202000240212628720063`: GTIN 10698746489288, pack 2026-10-14, net 2.40 lb, serial 2628720063. Lamb fat (small weights are normal for vacuum-packed items).
  4. With and without `]C1`; with a GS separator; a bad check digit (rejected); a string with AI `10` (lot taken from it).

### 11.3 Product mapping

- GTINs differ per product and use different company prefixes. Never derive the product from the GTIN. Keep a GTIN-to-product table.
- First scan of an unknown GTIN: first warn "This product isn't known" and offer a rescan, since the wrong label may have been scanned, the wrong label may be on the box, or the wrong box may be on the pallet. Only then ask which product it is (or add a new product) and save the mapping (works offline, synced with the scan). Teaching a new GTIN, adding a product from a scan, and editing mappings are admin-only (Chris is an admin during setup).
- Store Mohawk's item number (3111, 3083, 3078, ...) on the product. It is not in the barcode.
- Each product has a normal box weight range. A box outside it gets a warning, never a block. Ranges start blank (no warnings); after the first quarter of scanning, Setup suggests a range from the weights seen, for Kathy to accept.

### 11.4 Lots

- Every box has a lot. The lot is printed on the label but not in the barcode. Never default it to the scan date or the pack date.
- On scan, look up a known lot for the same GTIN + pack date. If found, fill it in and show it on the confirmation.
- If not found, ask for the 6-digit lot from the label (number keypad, one field) and save it so later boxes with that GTIN + pack date fill in by themselves.
- Show the lot on every confirmation. A box's lot can be changed afterward, by an admin only; each change records who, when, and the old value.

### 11.5 Scan flow

(Since 10/26/26 the scan suggests the customer and pallet after each scan; picking the customer first is now "Lock to a customer". See 14.)

- Chris picks the customer location and the pallet, then scans continuously. Each scan becomes a box on that customer's order line for the matched product, with weight, GTIN, pack date, serial, serial date, case number, and lot.
- A product not on that customer's order: warn, then let him assign it anyway or cancel.
- A duplicate box (same GTIN + serial) is rejected with a clear message.
- Built for a cold room and gloves: a large scan button, fast continuous scanning, a beep and a vibration on success, a different sound on an error. The running total against the amount ordered stays visible for the current line.
- Manual entry for an unreadable label needs product, weight, and lot; a compressed photo is optional (Supabase Storage).
- The existing manual weigh panel keeps working until scanning is proven on Chris's phone.

### 11.6 Pallets and manifest

(Since 10/26/26 pallets have tags and belong to shipments, and pallet groups are replaced by Ships to. See 14.)

- Pallet groups are set per customer location (example: PCC Pallet 1 holds Kirkland, Issaquah, Fremont, Bothell, Burien). Packing order follows pallet groups. For a chain (today only PCC), a set of stores can fill more than one pallet (two pallets for three stores).
- "Pallet X of Y": Y is the number of pallets in that day's shipment, all customers together. "1 of 2" means two pallets go out that day.
- The manifest lists each pallet (X of Y), its stores, its case count, and its total weight. Pallet tags print with customer, location, "Pallet X of Y", and total cases.
- The manifest and the tags warn when any of the day's scans haven't uploaded yet.

### 11.7 Offline

- Packing and scanning work with no connection: a service worker lets the pages load offline. An offline phone stays signed in (the login already lasts until 3 a.m.).
- Before going into the freezer the phone already holds the week's orders, customers, pallets, products, the GTIN map, and known lots. It refreshes whenever there's signal and Packing shows "Last updated [time]".
- Every scan and manual weight is saved on the phone immediately (IndexedDB), never waiting on the server.
- Duplicates are checked on the phone against synced and unsent scans, and again on the server at upload.
- Unknown-GTIN and lot prompts work offline and sync with the scan.
- A large indicator: "Online" or "Offline, 12 scans waiting". Uploads start by themselves when signal returns, oldest first, retrying until confirmed. Unsent scans survive the app closing or the phone restarting.
- If two phones scanned offline and the server finds a conflict (the same box twice, or an order that changed), it is flagged for Kathy rather than overwritten.

### 11.8 Freezer and trace (later stage)

- Leftover boxes scan into Freezer inventory with their lot. Boxes pulled for half and whole orders scan out.
- When product is combined into ground lamb or Le Trim, record the input lots.
- Trace reports: which customers received lot X, and which lots went to customer Y.

### 11.9 Not yet

- End-of-day case number gap check: waiting on Mohawk to confirm whether the case counter is UVL-only and resets daily.
- Anything that depends on importing Mohawk's own label records. Live scanning is the primary capture.

### 11.10 Stages

Stage 1 is the parser (11.2) with its tests, since it can be checked without a phone. Later stages are proposed to Lucas and confirmed one at a time.

### 11.11 Data model (stage 2, migration 20261019000100)

- `products`: `mohawk_item_no`, `box_lb_min`, `box_lb_max` (blank: no weight warning).
- `gtin_products`: `gtin` (14 digits, PK) to `product_id`. Read by Packing and Setup; written by admins only.
- `lots`: `gtin`, `pack_date`, `lot` (unique per GTIN + pack date), `source_note` (room for ranch tracing). Packers add the first lot seen; admins change one.
- `pallets`: `week_id`, `ship_date`, `number` (X; Y is the count for that ship date), `pallet_group_id`, `label`, `note`.
- `packing_weights` (one row per box): `source` (`weigh`, `scan`, `manual`), `gtin`, `serial`, `serial_date`, `case_no`, `pack_date`, `lot` (required for scan and manual), `pallet_id`, `raw_scan`, `photo_path`, `client_id` (unique; made on the phone so a retried upload saves once), `scanned_at`, `off_order`. GTIN + serial is unique. Only an admin changes a lot once set; the audit log keeps who, when, and the old value.
- `packing_conflicts`: `kind` (`duplicate-box`, `order-changed`, `order-gone`, `lot-differs`, `gtin-differs`), `message`, the upload as sent (`details`), and resolution fields, for Kathy.
- `record_box(p jsonb)`: saves one scanned or hand-entered box. Returns `saved`, `already` (same client_id), `duplicate` (same GTIN + serial; flagged, not saved) or `gone` (order deleted; flagged). A box for a product no longer on the order is saved and flagged unless the packer chose "add it anyway". A lot that differs from the one on file is saved and flagged.
- Storage bucket `box-photos` (private) for photos of labels that would not scan.

## 12. Box types, box limits, the 45 lb cap, shank packs, and box labels (change request 10/20/26, part 2)

Kathy's box limits are in `reference/UVL_Box_Limits_for_Claude_Code.csv` (one row per product and box type). Invoicing and the order week (Thursday through Wednesday) are not part of this change.

### 12.1 Box types

Five types, largest first: MVM, Roll Stock, Jerky, White, Baby. White and Baby are separate boxes. (Before this change the app had one "how many fit in a box" number per product, `products.per_box`, and no box types.)

### 12.2 Box limits

- Each product and box type can have a maximum count (in the product's unit), a maximum in lb, or both.
- Loading the CSV: status `ok` loads the limit; `does_not_fit` means the product never goes in that box; `needs_checking` loads no limit, marks the cell for Kathy in Setup, and keeps the `product_note`.
- Products are matched by name. CSV products that can't be matched, and active products with no limits at all, are listed for Lucas; no product is created or renamed without asking.
- Setup shows a grid of products by box type. `needs_checking` cells stand out, with the note available.

### 12.3 The 45 lb cap and splitting an order into boxes

- No box is ever planned over 45 lb, for any product or box type. 45 is a setting, not hard-coded.
- For products ordered in pieces or packs, `lb_per_unit` checks the cap. If `lb_per_unit` is blank, the box math still runs on the count, but the line shows "can't check weight".
- A box's limit is the lowest of: its max count, what fits under its max lb, and what fits under the cap.
- Products never share a box. For each order line: the smallest box that holds it all; if it takes more than one box, full boxes of the largest type the product fits in, then the smallest box that holds the rest.
- Required tests: 8 BNLS legs = MVM 6 + White 2; 12 cap-on racks = MVM 10 + White 2; Trim 6 lb packs never go over 45 lb in an MVM box.

### 12.4 Shanks in packs

Front shanks, hind shanks, and labeled hind shanks are ordered and counted in packs: 2 shanks per pack, one pack counts as one. The carcass balance still works in shanks per lamb (2 front, 2 hind), so a pack uses 2 shanks. Every place shanks are counted in pieces is listed for Lucas before anything changes.

On This week (change request 10/21/26), the carcass balance shows front and hind shanks in packs, to match the orders: need, get, and short or extra (week of Oct 19: need 110 packs, get 82, short 28), and the summary line reads "Front shanks short 28 packs". The math stays in shanks. When another product uses shanks, a line under the table says so: "Includes 8 front shanks (4 packs) for 4 whole lambs." The pack size comes from the shank products (`pieces_per_pack`), not a fixed number.

### 12.5 Box label list (printed)

- Kathy prints a customer label for every box before packing day. Each label has two lines: the customer (with the location and store number for chain stores, e.g. "PCC #02 Kirkland"), then the count and the product's label name, e.g. "10 Single Pack Rack (Cap ON)".
- `products.label_name`: what is printed on the label. Defaults to the product name; Kathy edits it in Setup.
- A "Box Label Report" page for the selected week, linked from This week (`/packing/labels`).
- One table per product that has orders that week, in the order form's product groups. Products with no orders are left out.
- One row per box (one row = one label): label line 1 (customer and location), label line 2 (count and label name, in the product's unit; pounds shown as "45 lb"), box type, "1 of 2" when a customer gets more than one box of that product, and a checkbox.
- Within each product, customers sort by pallet group, then name.
- Header: week, invoice number if set, printed date and time, total labels.
- A `needs_checking` cell is treated as "not used" when splitting (change request 10/21/26); it is never a warning on its own.
- A product with no usable box limit (Heart, Liver, Kidney with only pound limits and no weight per pack) still gets a normal table in its usual place: one row per customer, box "?", light red, with a red note under the heading ("Box size not worked out. Needs a weight per pack in Setup > Products, or a pack count in Setup > Boxes. One label per customer for now; a large order may need more than one box."). These labels count in the total, marked "(3 products without box sizes)". A short line at the top names them and links to their tables (10/21/26).
- One line at the top, instead of "can't check weight" on each table, when some products have no weight per piece: "Weights per piece aren't set for some products, so the 45 lb limit is only checked for products sold by the pound." with a link to Setup > Products.
- Under that, when any `needs_checking` cells exist, one quiet line: "Some box sizes are still to be checked in Setup > Boxes (30)." with a link.
- Print layout: portrait, letter, 11 pt minimum, tables flowing in two columns, a table never split across a column or page, darker row lines than the current grid, row shading as on the Setup grid.
- When labels are printed, a fingerprint of the list is saved. If orders change afterward, This week and the report show "Orders changed since you printed labels".

### 12.6 Printing box labels (Avery 5963) (change request 10/23/26)

Kathy prints box labels on Avery 5963 sheets: 4" x 2", ten per US Letter sheet, 2 columns x 5 rows. Each box row on the Box Label Report is one label, printed in report order (grouped by product).

- **Sheet**: top margin 0.5", left margin 0.15625", labels 4.0" x 2.0", 0.1875" between the columns, no gap between rows. Positions 1 to 10, left to right, top to bottom.
- **PDF**: drawn in code with pdf-lib (`lib/labels/avery5963.ts`), exactly US Letter with no added margins, so browser scaling can't shift it. It opens in a new tab to print; next to the buttons: "Print at Actual size / 100%, not Fit to page."
- **On each label** (inside 0.18" padding; layout of 10/24/26, `layoutLabel` in `lib/labels/avery5963.ts`):
  - **Destination** (top): customer and location together as one name, all bold at the same size ("PCC #10 Issaquah"; just the customer when there's no location). Starts at 22 pt; wraps to a second line before shrinking; shrinks only if two lines still don't fit (14 pt, and smaller rather than cut anything off). The text sits just above a thin rule, so the destination is in the same spot on every label.
  - **Item** (middle): the quantity in a solid black rounded box (5 pt corners, 0.85" x 0.66"), white bold number about 36 pt, with its unit ("lb", "packs") smaller underneath so the number stays large. The product's label name in a forest green rounded band (#3B5E27, 5 pt corners) to the right, the same height, 0.07" from the box, out to the right padding: white bold, 19 pt down to 11 pt, up to two lines, centered.
  - **Bottom line**: left, the box count: "BOX 2 OF 3" in white bold uppercase 10 pt in a barn red rounded tag (#7A3327, 4 pt corners, 0.21" tall, 7 pt padding) when the order takes more than one box; plain "Box 1 of 1" in regular 9 pt otherwise. Center, the label number as "label 14" in small gray (6.5 pt), no "#" (it was confusing next to PCC store numbers; for the office only). Right, the box type in a small outlined tag, bold uppercase 9 pt: MVM, ROLL STOCK, JERKY, WHITE, BABY (MVM and Roll Stock are correct as named, though some paperwork says "Mohawk" and "Rollstock", Lucas 10/23/26).
  - A label never shows a question mark. A product with no box size (Heart, Liver, Kidney, or one sold in packs with only pound limits and no weight per pack) prints one label per customer with the amount, and the box type tag is left off; the Box Label Report still shows "?" so Kathy can see what needs a box size (Lucas, 10/24/26).
  - A label prints the customer exactly as it's stored: "Port Townsend" is a customer of its own with no chain, so its label says just that.
- **Label numbers**: each box row gets a number for its week (1, 2, 3...), shown on the report row ("#14") and on the label ("label 14"). A number belongs to its box (customer | product | box number), is given out once in report order, and is never reused or moved, so when an order changes the other labels keep their numbers (`box_labels`, `assign_box_labels`).
- **Choosing what to print**: "Print all" and "Print selected"; a checkbox on each row; "Select all", "Clear", "Select changed", "Select product", "Select customer", and a range box ("14-20"). "Start at label" (1 to 10) is a small 2 x 5 grid to tap, so a partly used sheet can be reused; after printing it moves on to the next empty position.
- **Print tracking**: after printing, each row shows "Printed Oct 23, 3:05 PM by Kathy". Every print is logged (`label_prints`: label number, date and time, who, first print or reprint). If an order changes after its labels were printed, the affected rows say "Changed since printed" in red, so Kathy knows to reprint them. Printing all labels also marks the week printed for This week's Box labels step.
- **Rule**: labels are never edited directly. Corrections go through the order, so the report, the labels, and the packing record agree.
- **Printer settings**: My account has a printer offset (X and Y, inches, default 0) added to every label, kept on that device. "Alignment test" prints dashed outlines of all ten positions on plain paper.
- **Numbers need signal**: the report works from the phone's copy offline, but numbering and printing labels need a connection.

## 13. Le Trim plan (change request 10/25/26)

Le Trim is made by hand from what's left over after the other orders: extra shoulders (boned out) and extra legs cut in half, each with trim. Kathy decides the mix each week. The app shows what's spare, checks what she enters, and puts it on the cut sheet. It never changes the lamb count (Kathy works the count out herself for now).

- **Screen** (`/week/le-trim`, a "Le Trim" step on This week when Le Trim is ordered): big numbers for Le Trim ordered (lb and 10 lb packs), extra shoulders, extra legs (and the most half legs they make), and extra trim. Extra trim is marked **Estimated** until Kathy types the actual figure from the kill sheet.
- **What Kathy enters**: shoulders, half legs, and trim (lb). Half legs show as "= N legs cut in half" (legs = half legs / 2, rounded up). Trim shows "About X lb" from the settings, with a button to use that figure. These are what she actually used, so over time the history shows what's routine.
- **Suggest** (optional): shoulders first, then half legs, one per pack ordered, trim from the settings. It only fills the boxes; nothing is saved until she taps Save.
- **Checks** (live, warnings only, never block saving): pieces vs packs ordered; shoulders vs extra shoulders; half legs vs what the extra legs make; trim used vs trim spare ("about" while estimated).
- **Saving**: one record per week (`le_trim_plans`: shoulders, half legs, legs, trim lb, estimated trim, actual trim, who and when). It can be changed any time in the week. Saved, it comes out of the week's extras (shoulders, legs and trim `need` go up; the lamb count does not) and adds "Bone out N shoulders for Le Trim" and "Halve N legs for Le Trim" to the top of the cut sheet. A change after the sheet was sent shows as changed since sent.
- **Before it's saved**: This week says "Le Trim isn't planned yet. Some of these extras will go to Le Trim."
- **Settings** (Setup > Le Trim): trim with each shoulder (default 5 lb) and with each half leg (default 6.5 lb). Only used for the estimate and Suggest.
- **Open**: whether a pack takes one shoulder or half leg (Suggest and the first check assume one per 10 lb pack); whether "extra shoulders" should mean every spare shoulder or only those not set aside for the freezer, grind, or half and whole orders (today: every spare shoulder in the balance); the two trim figures.

### 13.1 Le Trim by weight, and extra lambs (change request 10/29/26; migration 20261030000300)

Replaces the piece-per-pack model above. The old app counted Le Trim's shoulders (one per 10 lb, and at first half a pound of trim per pound) on top of every other order's demand instead of from what was spare, and counting all Le Trim pounds as trim gives about 145 lambs for 11/2/26: that is what Le Trim must never do again.

- **By weight** (`lib/calc/leTrim.ts`, `leTrimNeed`): from the balance worked out without Le Trim, use spare trim first (lambs x trim per lamb, less trim other products use: ground lamb, plain trim; Organ Grind uses no trim part, so it never reduces it), then spare boneless shoulders, then spare half legs, each only as many as needed. "Spare" is what no other order uses. What's still not covered is the shortfall; the extra average-size lambs that would cover it = shortfall / (trim per lamb + 2 shoulders + 2 legs), rounded up (28 lb a lamb at the defaults).
- **Settings**: trim per lamb is the Trim part (Setup > Parts, 5 lb); average boneless shoulder 5 lb (`app_settings.le_trim_shoulder_lb`) and average boneless leg 6.5 lb (`le_trim_leg_lb`, 3.25 lb a half), in Setup > Le Trim. The old two trim settings are no longer used. OPEN: the 5 lb shoulder (Chris saw about 4 lb on 10/26 with lighter lambs). OPEN: shoulders before half legs is an assumption (`LE_TRIM_USE_ORDER`).
- **Never adds lambs.** This week and the Le Trim screen say, for example, "Le Trim is short approximately 272 lb. Approximately 10 extra average-size lambs would cover it." Every count says average-size lambs: smaller or bigger lambs need more or fewer.
- **In the balance**: with no plan saved, the worked-out mix comes out of the extras, so the balance shows the shoulders and legs going to Le Trim. A saved plan (what Kathy actually used) replaces it and goes on the cut sheet as before. Suggest fills the worked-out mix; the checks are by weight. The kill sheet's actual trim, once typed, replaces the estimate.
- **Extra lambs** (`week_extra_lambs`, on This week): a number, a reason (Le Trim, Freezer stock, Small lambs, Half/whole orders, Other) and an optional note; any number of lines. They go on top of the count from orders ("55 for parts + 16 extra = 71 lambs") and so into the producer message. Their parts are supply in the balance, so Le Trim and every product use them before any shortfall; what nothing uses shows as extra. "Your number" is taken as typed (separate). Once the week has a cut sheet, Kathy puts the extra lambs in her sets; if the sets have fewer lambs than orders plus extra lambs, This week says so.
- **Results** on real orders: 10/19 and 10/26 covered by what's spare; 11/2/26: 55 lambs from orders, Le Trim 720 lb short approximately 272 lb, approximately 10 extra (65). Tests A to D in `lib/calc/leTrim.test.ts`.

### 12.7 A weight for every box (change request 10/26/26)

Chris scans every box. The paper packing copy is the backup for when the internet is down, so it gets a blank for every box's weight, not one per product.

- **Layout**: one row per product per customer: the product, what was ordered and how many boxes, a Done box and a Not filled box; then a weight blank per box with the box's label number in small type above it; then **Total lbs**. Rows wrap when there are more blanks than fit. Blanks are 0.8" x 0.6" (seven across beside the product on Letter paper) to write in with gloves on. Pallet and Initials boxes per customer.
- **Known box count** (the product has a box size, so the box label list has its boxes): one blank per box with its label number, then spare blanks (default 2) with an empty "Label #".
- **Unknown box count** (no box size): blanks (default 6, or the product's own number) with an empty "Label #", and a "box count unknown" note. Pound products follow the same rules; one with a box size counts as known.
- **Settings**: `app_settings.pack_unknown_blanks` (6), `pack_spare_blanks` (2), `products.pack_blanks` (per product, null = the setting), in Setup > Boxes.
- **Label numbers**: from `box_labels` (12.6). Packing and the paper copy number any boxes that don't have one yet, the same way the report does, so they match; the packing copy kept on the phone includes them.
- **Type in from paper** (`/packing/paper`): the same rows, customers and products in the same order, blanks with the same label numbers (an input where the paper has "Label #"), the total worked out, and "+ Add a box". Saved through the outbox like the rest of Packing.
- **Storage**: each weight is its own `packing_weights` row with `slot` (which box of the customer's product, its place on the sheet) and `label_no`. Scans and the weigh panel put a weight in the next empty box. Products never share a box. The layout is `lib/calc/packSheet.ts`.
- **Packing record**: a Box weights column lists each box ("#14 22.4 · #15 21.9").

## 14. Scan-to-pallet routing (change request 10/26/26)

Boxes come off Mohawk's roller grouped by size, not by customer. Chris scans each box and carries it to the right pallet. Direct customers get their own shipment; every PCC store ships together on pallets to a distributor, who breaks them down and sends boxes on to each store, so one pallet can carry many stores' boxes, each with its own store label. A later planner will plan pallets from box sizes; everything here is ready for it.

### 14.1 Data
- **Distributors** (`consolidation_points`), set up in Setup > Ships to. One to start, "PCC distributor"; it will be renamed. Nothing keys off the name.
- **Ships to** (`customers.ships_to_point_id`): Direct (null) or a distributor. Every PCC location starts at the PCC distributor. Replaces pallet groups.
- **Shipments**: a ship-to (the location if Direct, else the distributor) for a week, with a ship date. Ship dates are blank for now (Lucas, 10/26/26); a ship day per customer can be added later. A shipment is made when its first pallet starts.
- **Pallets**: per week, a tag Chris writes on it ("P3"), a status (planned, open, full, shipped), and blank size limits (length, width, max height, max weight). `pallet_shipments` links them, so a shipment can have several pallets and the planner could combine shipments. "Pallet X of Y" is now only printed on the manifest (counted).
- **`pallet_plan_lines`** (pallet, customer, product, box type, planned boxes): empty until the planner. Scanned boxes stay in `packing_weights`; plan lines are never overwritten with actuals.
- **Box types** get blank length, width, height and max weight; the 45 lb cap stays.
- **Each scanned box** records its customer (through its order), pallet, box type, and how it was routed: the suggestion, another customer from the list, picked by hand, locked, or unassigned, with what was suggested.
- **Unassigned boxes**: no open order needed them. Saved with the week and no order; Kathy gives each to a customer on Pallets (Lucas, 10/26/26: what extras become is open).

### 14.2 Scan flow
1. Scan; the label is read as before (GTIN, weight, pack date, serial, lot). Duplicates, unknown GTINs and lots are handled as before.
2. Customers this week that still need this product: in boxes when the box count is known (planned boxes minus boxes scanned), else in pounds (pound orders, or the product's weight per piece), else open until the line is marked done on Packing.
3. (Since 10/26/26, after three boxes went to the wrong store) More than one store needs it: nothing is chosen; big store buttons sorted by PCC number, each with its label number, and Chris taps the store on the label. Exactly one: chosen for him. A box that would put the store over its order stops for "Pick a different store" or "Yes, add it anyway". Scanning a box again shows it with That's right, Wrong store, Wrong pallet and Remove scan; Move changes the store and pallet. The ranking below is kept only as "what the app would have chosen" in the log.
   The ranking: soonest ship date first (no difference until ship dates are set), then the customer furthest behind on their whole order (boxes packed over boxes planned), then by name. Runner-ups are smaller choices below. Shown as "needs 2 of 3 boxes".
4. The pallet for that customer's shipment: (a) a planned or open pallet with a planned box still to fill for this customer and product, (b) the open pallet that already has this customer's boxes (a PCC shipment fills several pallets, each with its own stores; Lucas, 10/26/26), (c) the newest open pallet for the shipment, (d) none: "Start pallet for [shipment]" with a tag box (the next "P" number offered; a tag already used this week is warned about).
5. The card shows the pallet tag very large ("→ P3"), the customer as stored (the box's label), the label number and "needs X of Y", and "via PCC distributor" for a distributor's shipment. One tap: "Put on P3".
6. No customer needs it: "No open orders need this product", with "Save as unassigned" and "Pick customer anyway" (warns when it's more than ordered).
7. Saved as before (lot, audit trail, offline queue), plus customer, pallet, box type, box number and label number. Straight back to scanning.
8. "Different pallet" on the card lists the shipment's other open pallets with the stores on each, and New pallet. "Move to..." on a scanned box moves it to another pallet (it works offline).
9. "Pallet full" on any open pallet (Scan boxes and Pallets): the next box for that shipment asks for a new tag.
9. Never assigned without a tap. Anything but the suggestion is logged (`route`, `suggested_order_id`).
10. **Lock to a customer**: scans go straight to that customer and its shipment's open pallet, with no card (a card only to start a pallet), until unlocked. Products not on their order ask first, as before.

### 14.3 Pallets view (`/packing/pallets`)
Each pallet's tag, shipment, boxes, weight and status (Full, Open again, Shipped); a distributor's pallet shows boxes and pounds by store. **Print manifest**: one pallet per page with the tag large, ship-to, boxes and pounds; a distributor's pallet lists its boxes grouped by store (label, product, lb, lot) so the distributor can break it down. Warns when scans haven't uploaded yet. Unassigned boxes are listed with "Give to...".

### 14.5 Plan pallets for the week (Lucas, 10/26/26)
On the Pallets page, for each shipment: add pallets by tag (planned until the first box goes on) and choose the pallet for each store (`pallet_customers`; one pallet per store a week). "Start from last week's pallets" copies last week's tags and stores, for the stores ordering this week. Chris (at Mohawk) or Kathy plans it. Routing sends a store's boxes to its planned pallet first (until it's full or shipped). Nothing prints on box labels: the pallet is only useful at Mohawk, and label space is needed for the distributor and stores.

### 14.6 Pallet shipping manifest (change request 10/26/26)
One page, `/packing/pallets/manifest` (`?week=`, `?pallet=` for one pallet, none for every pallet of the week, `?print=1` opens the print dialog), drawn by one component (`app/(app)/packing/pallets/Manifest.tsx`) with the grouping and totals in `lib/calc/manifest.ts`. Opened from Pallets ("Print Manifest" on each pallet, "Print all manifests") and from Print and download ("Pallet manifest": pick a pallet, print all for the week, save as PDF through the print window, or download a CSV of the boxes: pallet, customer, box ID, lot, product, net weight).
- Header: company, pallet tag (and X of Y in its shipment), week, a ship date line (ship dates aren't set yet), ship-from address (Setup > Ships to; blank prints lines to write it on), ship-to (the distributor or customer; no addresses are stored), received by and date lines.
- Body: every scanned box on the pallet, by customer (stores as stored, "PCC #10 Issaquah", sorted by number), rows by product: box ID (the barcode serial, else the label number), lot, product, net weight to two decimals in lb. A box with no weight shows MISSING in bold, with a warning at the top. Totals per customer and for the pallet. Only recorded weights are used. Column headings repeat when a customer runs onto the next page.
- Footer: "Copy 1 ships with pallet / Copy 2 retained." One pallet per page.

### 14.4 Offline
The phone keeps the week's orders, packed boxes, label numbers, pallets, shipments and plan lines, and works out suggestions itself. Scans, new pallets and "Pallet full" queue on the phone and upload when back in range; all Packing pages are kept on the phone once Packing opens with signal. Two phones packing the same line, or using the same tag, are saved and flagged for Kathy (`over-packed`, `pallet-tag`), never refused.

## 15. Invoicing (change request 10/28/26)

The full plan, with the schema, screens and stages, is `docs/invoicing-plan.md`. Built in three stages (foundation, drafts, lifecycle), stopping for review after each. Out of scope: invoices for half and whole lamb households, sales tax, emailing invoices.

### 15.1 Rules (decided)
- Bill from the week's box records: every box, scanned or typed. One invoice per location; each location (every PCC store included) pays its own. No billing groups for now.
- Each product has a price unit: per lb (most), per case or per each, set in Setup > Products. Per lb bills the sum of the boxes' net weights; per case bills one case per box (a pepper-stick box is always one case).
- An ordered product with no boxes is a shorted line at $0, whether it was marked X or not.
- Prices: a default price per product and optional customer prices, each with an effective-from date. A line uses the newest price effective on the invoice date (the customer's own, else the default), copied onto the line when finalized. No prices are seeded; a missing price shows "Price needed" and blocks finalizing.
- Line total = billed quantity x unit price, rounded half up to the cent, once per line; the invoice total is the sum of line totals. Exact decimals (`numeric`) throughout, never floating point.
- Invoice number: one number per week (`weeks.invoice_number`; 10/19/26 = 3000, 10/26/26 = 3001; each week suggests the last + 1) plus the location's 3 to 5 character code: "3001-NEWP". A reissue adds -R1, -R2. The full number is stored on the invoice when it's made, and can be changed.
- Invoice date starts as the Tuesday after packing and can be changed. Terms default to Net 15 (Setup > Invoicing), changeable per customer; due date = invoice date + terms.
- Statuses: Draft, Finalized, Sent, Partially paid, Paid, Void. A finalized invoice's lines never change; corrections are Void (with a reason) and Reissue, or a credit line later. Manual lines need a note. Payments: ACH, check or other, with a reference; partial payments allowed. Everything is logged.
- A Billing role (Invoices and Prices change) and Invoices and Prices permission areas. Nobody's role is changed (everyone stays Admin until Lucas changes them).

### 15.2 More rules (Lucas, 10/28/26, second answers)
- Bill what went out on the delivery, never what was ordered. Per each bills the pieces packed (the count typed on Packing); with no count the line shows "Count needed" and blocks finalizing. Backorders aren't billed.
- Freezer pulls are billed at the product's price per lb, like any other box.
- Any line can take a discount (a dollar amount, or a percent rounded half up to the cent), with a note: line total = round(quantity x price) - discount.
- No bill-to addresses yet: the name only. Remit-to and business details are editable in Setup > Invoicing. Nothing is taxable.
- Invoice codes, a week's invoice number, and an invoice's own number can always be changed (logged, still unique). Madison Valley is #22.

### 15.3 Stage 1, as built (migration 20261028000100)
- Areas Invoices and Prices; role Billing (Invoices and Prices change; Orders, Packing, This week, Customers, Print and download, Setup view). Office: Invoices and Prices view. Packing and Viewer: off. Nobody's role was changed.
- `weeks.invoice_number` (unique; set with `set_week_invoice_number`, which Billing may call), `customer_billing` (code, bill-to, terms, box detail), `invoice_settings` (business, remit-to, Net 15, invoice note), `products.price_unit` (`billed_by_weight` kept for now, unused), `prices`.
- Setup > Prices, Setup > Invoicing, the price unit on each product, and "Invoice codes" on Print and download. Price lookup and exact money in `lib/calc/prices.ts`; numbers and codes in `lib/calc/invoiceNumbers.ts`.

### 15.4 Stage 2, as built (migration 20261029000100)
- `invoices` (one live invoice per location per week; number as made, changeable and unique; status draft for now; invoice date starting the Tuesday after packing; memo; fingerprint) and `invoice_lines` (packed, shorted, manual; boxes, billed quantity, price unit; unit price on manual lines only until finalizing; discount as an amount or a percent, with a note; not on the order). Lines change only while the invoice is a draft; only a draft can be deleted.
- `make_invoice_drafts(week)` makes a draft for each location with boxes (or per each pieces counted) and no invoice yet. Locations that ordered but had nothing packed get no invoice and are listed on the Invoices page. `update_invoice_draft(id)` rebuilds the packing lines, keeping manual lines and each product's discount and note. `invoice_fingerprints(week)` tells which drafts are out of date.
- A draft's packed lines are priced on screen from Setup > Prices on the invoice date (`lib/calc/invoice.ts`), so a price entered later shows at once. Price needed and Count needed lines are left out of the total ("Total so far").
- Screens: Invoices (in More: Make drafts, Update out of date, Print all, the week's boxes and weight against the box records), one invoice (the printout with DRAFT; invoice date, number, note for the customer, discounts, lines added by hand, Update from packing, Delete draft), and the box detail page for locations with it on. Invoices and invoice lines are in Export all data.

### 15.4a Packed together (Lucas, 10/29/26; migration 20261029000200)
- Heart, Liver and Kidney are packed in one box (`products.packed_with` = "Organs", set in Setup > Products as "Packed in one box with"). One box of any of them, scanned or typed, is the store's order for all of them: on Packing each of their lines counts as packed ("Packed 10.95 lb in one box with Liver, Kidney"), and scanning suggests stores that still need any of them. Box sizes don't apply to them for now. Kathy fills them from what Mohawk has, so labels wait until then.
- The box label list, the paper packing copy, Type in from paper and the boxes scanning fills show them as one item: one label per store ("8 Heart, 8 Liver, 6 Kidney", no box size), one row with one box, under the group's first product (Lucas, 10/29/26).
- One price for the group, on its first product by sort (Setup > Prices shows one row, "Heart, Liver, Kidney"). The invoice has one line for the group: boxes and weight only (no ordered amounts), with the packs counted on Packing under it if typed ("2 Heart, 5 Liver"). With no organ box, the line is Not shipped, naming what was ordered.

### 15.4b Stage 3, as built (migration 20261030000100)
- Finalize (`finalize_invoice`): needs a number, no Out of date, a price and a count on every line. Copies each line's price on the invoice date onto the line, the boxes into `invoice_boxes`, and the name, bill-to, box detail setting and business details into `invoices.issued`; sets the terms, due date and total (each line rounded half up to the cent, less its discount; `invoice_line_total`, the same as `lib/calc/invoice.ts`). After that the lines, note and what was issued never change; the invoice date (the due date follows) and number still can. A finalized invoice is never deleted.
- Status changes only through the functions: Finalize, Mark sent / Mark not sent (`mark_invoice_sent`), Void with a reason (`void_invoice`; refused while it has payments: delete them, then record them on the reissued one), Reissue (`reissue_invoice`: a new draft from packing as it is now, numbered -R1, -R2, with the same date, note, added lines and discounts).
- Payments: date, amount (cents), ACH, check or other, reference, note; partial and more than owed allowed (with a question). Paid and Partly paid come from the payments. If packing changes after finalizing, the invoice says so (Packing changed) and keeps what it was finalized with.
- Screens: the invoice page (Finalize with what's missing in plain words; Mark sent; Payments; Void; Reissue; VOID across a void one; payments and the balance on the printout), Invoices (status words, void invoices listed below), Open invoices (any week, money owed, days overdue; by number, due date or location). Print and download, "Tuesday, invoices": the week's invoices, Open invoices, and Invoice lines for QuickBooks (one row per line for a date range, in QuickBooks Online's import columns; a discount is its own row). Payments and invoice boxes are in Export all data.

### 15.5 Open questions
- DECIDED (Lucas, 10/29/26; migration 20261030000200): the cut sheet, manifest and invoices share one INV#, the week's invoice number (weeks.invoice_number). The cut sheet's INV# box sets it; cut_sheets.inv_number is no longer used.
- ON HOLD (Lucas, 10/29/26): Kirkland's store number and Kathy's OK on the invoice codes. Stage 4 (QuickBooks Online connection) is tabled until Lucas raises it again.
- OPEN: Kirkland's store number (#23 or #02); its code is PCC23 until changed.
- OPEN: Kathy's approval of the location invoice codes.
