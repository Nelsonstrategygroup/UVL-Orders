# Invoicing plan (draft for review, 10/28/26)

Nothing is built yet. This is the plan for review before any code. Prices are
not known yet: none are seeded, guessed or invented; a missing price shows
"Price needed".

## What's already in the app

- **Box records**: every box is its own row (`packing_weights`): customer
  (through its order), product, net weight, pallet, lot, pack date, serial,
  label number, and how it was recorded (scanned, typed on the Label won't
  scan form, or typed on Packing / from paper). On 10/26: 140 scanned boxes
  (3,168.82 lb) and 4 typed (57.05 lb). On 10/19: only 4 typed boxes
  (172.90 lb); that week was packed before scanning, so it can't make full
  invoices.
- **Not filled**: `packing_lines.shorted` (the X). None were marked on 10/26,
  even for lines that didn't ship (Key City's Pet Mix).
- **Products**: unit (each, pack, lb, case) and `billed_by_weight` (true for
  everything except the two pepper stick products, which are by the case).
- **Customers**: locations under a chain (PCC's 16 stores), Ships to (Plymouth
  or Direct), delivery day, `bills_for_locations` (off for every chain). No
  addresses are stored for customers.
- **Half and whole lamb customers (households)** aren't customers in the app:
  they're names on half and whole orders. So "Billing can't see households"
  just means the Half and whole screen is off for Billing.
- **Invoice number**: the only place is "INV#" on each week's cut sheet
  (`cut_sheets.inv_number`, typed in). Only 10/12 has a cut sheet, with no
  INV#; 10/19 and 10/26 have none. So 3000 and 3001 aren't stored anywhere.
- **Roles**: Admin, Office, Packing, Viewer, with per-area levels (Off, View,
  Change) that the database enforces. All four people (Kathy, Lucas, Raven,
  Chris) are Admin today.
- **Audit**: every table change is logged (who, when, old and new values).
- **Settings**: company name, ship-from address (blank) in `app_settings`.

## Conflicts with what's built

1. **Everyone is Admin.** A Billing role for Raven, and "Packing can't see
   prices", only take effect once Raven is Billing and Chris is Packing.
   Changing roles is your call; I won't change them unless you say so.
2. **The invoice number lives on the cut sheet**, which most weeks don't have.
   Plan: move it to the week (`weeks.invoice_number`, one per week, unique),
   with the cut sheet's INV# box showing and editing the same number.
   10/19 = 3000 and 10/26 = 3001 are set by a migration; each new week
   suggests the last number + 1. Copying a cut sheet no longer clears it.
3. **"Delivery groups billed together" (Key City + Port Townsend as
   "Bellingham Stores")** isn't the same as Ships to: today Key City and Port
   Townsend ship through Plymouth with the PCC stores. Plan: a separate
   **billing group** (name and code, e.g. Bellingham Stores, BELL) that a
   location can belong to, plus the per-customer setting "one invoice per
   location / one per billing group". Ships to stays about pallets only.
4. **"Billing by GS1 net weight from scanned boxes"**: typed boxes (no barcode)
   also have a recorded weight (4 on 10/26, all confirmed against Chris's
   sheet). Plan: bill every box record, scanned or typed; the box detail page
   shows which were typed.
5. **Products already have `billed_by_weight`.** Plan: replace it with a price
   unit (per lb, per case, per each), migrated: per lb where it's true, per
   case for the two pepper stick products.
6. **No customer addresses.** An invoice normally has a bill-to address. Plan:
   a bill-to address on each location (and billing group); blank prints the
   name only.
7. **"Not filled" isn't marked consistently.** Plan: any ordered product with
   no boxes shows as shorted at $0 (marked X or not), so the customer always
   sees what didn't ship.
8. **The money must be exact**: JavaScript numbers aren't. Plan: weights and
   money are `numeric` in the database; finalizing totals each line in the
   database (exact decimals); the screens compute in whole cents and
   hundredths of a pound, never floating point.
9. **Prices page in Setup**: Setup is view-only for everyone but Admin. Plan:
   the Prices page sits in Setup but uses its own "Prices" permission, so
   Billing can edit it.
10. **Store numbers**: every PCC location has one, but Chris's sheet calls #23
    Kirkland "#02" and #22 Madison Valley "#25" (open question). The codes
    below use the app's numbers.

## Location invoice codes (for Kathy to approve)

3 to 5 capital letters or digits, unique. PCC stores: PCC + store number.

| Location | Suggested code |
|---|---|
| Emerson | EMER |
| Key City | KEYC |
| McClendons | MCCL |
| Newport Ave | NEWP |
| Port Townsend | PTWN |
| Seven Feathers | SEVF |
| PCC #05 View Ridge | PCC05 |
| PCC #09 Green Lake | PCC09 |
| PCC #10 Issaquah | PCC10 |
| PCC #11 Fremont | PCC11 |
| PCC #12 Redmond | PCC12 |
| PCC #13 Edmonds | PCC13 |
| PCC #14 GL Village | PCC14 |
| PCC #15 Columbia | PCC15 |
| PCC #16 Bothell | PCC16 |
| PCC #17 Burien | PCC17 |
| PCC #18 Ballard | PCC18 |
| PCC #19 West Seattle | PCC19 |
| PCC #20 Bellevue | PCC20 |
| PCC #22 Madison Valley | PCC22 (sheet says #25) |
| PCC #23 Kirkland | PCC23 (sheet says #02) |
| PCC #24 Central District | PCC24 |
| PCC (the chain itself) | PCC, only if PCC is ever billed as one |
| Billing group: Bellingham Stores | BELL |

No PCC location is missing a store number. "TEST Le Trim" is a test customer
and gets no code; I'd delete it after the Le Trim test.

## Schema changes (one migration per stage, each with an undo file)

- `weeks.invoice_number int unique` (from the cut sheet's INV#; 10/19 = 3000,
  10/26 = 3001).
- `customers`: `invoice_code` (unique, checked format), `bill_to_address`,
  `billing_group_id`, `invoice_per` ('location' or 'group'), `terms_days`
  (blank: the default), `box_detail` (default off).
- `billing_groups`: name, invoice code, bill-to address, terms.
- `app_settings`: business name, address, phone, remit-to, default terms
  days. Starting values: Umpqua Valley Lamb, PO Box 1120, Riddle OR 97469.
- `products.price_unit` ('lb', 'case', 'each'), replacing `billed_by_weight`.
- `prices`: product, customer (blank: the default list), price (`numeric`),
  effective from (date), who and when. The price for an invoice is the
  newest one effective on its invoice date: the customer's own, else the
  default.
- `invoices`: week, customer or billing group, the full invoice number as
  issued ("3001-NEWP", "3001-NEWP-R1"), the invoice it replaces, status
  (Draft, Finalized, Sent, Partially paid, Paid, Void), invoice date
  (default the Tuesday after packing), terms and due date, bill-to and
  business details as issued, totals, a fingerprint of the boxes it was made
  from (to tell when it's out of date), who and when for each step, void
  reason.
- `invoice_lines`: kind (packed, shorted, manual, and **inventory**, left
  for bills from freezer stock but not built), product, description as
  issued, ordered amount (reference), box count, billed quantity, price unit,
  unit price as issued, line total, note (required on manual lines), sort.
- `invoice_boxes`: the boxes on a finalized invoice, with weight, lot, pack
  date and serial as issued (for the box detail page and trace).
- `payments`: invoice, date, amount, method (ACH, check, other), reference
  (check number or ACH ref), note, who. Partial payments allowed; the status
  follows from what's been paid.
- Permissions: new areas **Invoices** (invoices and payments) and
  **Prices**; a **Billing** role: Invoices and Prices change; Orders,
  Packing, This week, Customers and Print and download view; Half and whole,
  Freezer, Calls and Cut sheet off. Packing and Viewer: Invoices and Prices
  off. Admin: everything. Row Level Security on every new table, written
  with it.
- Audit triggers on every new table (created, finalized, voided, payment
  recorded, price changed). No new foreign key creates a second link between
  two tables the app already loads together (the 10/26 outage).

## How an invoice is made from packing

1. On Invoices, pick the week (by packing Monday) and tap **Make drafts**.
2. The week's box records are grouped by who's billed: each location, or its
   billing group when that location is set to invoice by group.
3. Each invoice gets one line per product: box count, billed quantity, unit
   price, line total, with what was ordered shown small.
   - Per lb: billed weight = the sum of the boxes' net weights.
   - Per case: billed cases = the number of boxes (one case per box).
   - Per each: open question (the piece count Chris types, or what was
     ordered).
   - Ordered products with no boxes: a shorted line at $0.
   - Boxes for a product not on the order: billed normally (Newport's
     Sirloin), marked "not on the order".
4. **Line total = billed quantity x price, rounded half up to the cent**,
   once per line. The invoice total is the sum of the line totals. (Goes in
   SPEC.)
5. A line with no price shows **Price needed**; the invoice is marked DRAFT
   and can't be finalized until every line has a price.
6. Manual lines (delivery fee, credit, adjustment) need a note.
7. If box records change after the draft was made (a box moved, added or
   reweighed), the draft says **Out of date** with **Update draft** (manual
   lines are kept).
8. **Finalize** checks every price, snapshots the lines, prices, boxes,
   bill-to and business details, and locks it. After that it never changes:
   corrections are **Void** (with a reason) and **Reissue** (3001-NEWP-R1),
   or a credit line on a later invoice.
9. **Mark sent**, then **Record payment** (any number, partial allowed).

## Screens

- **Invoices** (Billing, Admin; in More): the week's invoices: who, number,
  status, total, missing prices, out of date, with Make drafts and Print all.
- **An invoice**: the printable invoice (one customer, Letter, DRAFT across
  it until finalized), lines, manual lines, actions, payments, and the box
  detail page when it's on for that customer.
- **Open invoices**: customer, invoice number, date, due date, total, paid,
  balance, days overdue. Sorting by invoice number groups by week, then
  customer.
- **Setup > Prices**: every active product with its unit, default price and
  effective date (blank where not set), typed straight in. Whole Lamb sits
  next to the parts so they can be compared, each with its price per lb.
  Customer prices under each product, added only where a customer differs.
- **Setup > Invoicing**: business details, remit-to, default terms; each
  location's invoice code, bill-to address, billing group, one invoice per
  location or per group, terms, box detail; billing groups. A printable list
  of invoice codes for Kathy.
- **Print and download**, under Tuesday, invoicing: the week's invoices,
  open invoices, invoices and lines for a date range (CSV or Excel), and the
  invoice code list.
- No emailing yet.

## QuickBooks (not building an integration)

QuickBooks Online imports invoices from a CSV with one row per line:
InvoiceNo, Customer, InvoiceDate, DueDate, Terms, Memo, Item (Product/Service),
ItemDescription, ItemQuantity, ItemRate, ItemAmount, plus Taxable and Service
Date if used. Customer and item names have to match what's in QuickBooks. The
lines export would include these columns, so it can go straight in if you go
that way. (QuickBooks Desktop uses IIF files, a different format.)

## Sales tax

Not built. Oregon has none. The PCC stores, Key City and Port Townsend are in
Washington; Washington doesn't tax food for people, and sales to retailers
for resale are exempt with a reseller permit. Pepper sticks are likely food
too. So probably nothing is taxable, but confirm with Raven or an accountant.
Room is left: a tax line kind can be added to invoice lines later.

## Stages (stop for review after each)

1. **Foundation**: invoice number on the week, invoice codes, billing
   groups, settings, price units, the Prices page, the Billing role and
   permissions, the code list. No prices entered.
2. **Drafts**: make drafts from packing, the invoice page and printout
   (DRAFT, Price needed), out-of-date checking, manual lines, box detail.
   Tested against 10/26: weights and box counts must match the packing
   records and manifests (per location).
3. **Lifecycle**: finalize, void and reissue, sent, payments, Open invoices,
   exports, Print and download. Tested with a few test prices in one place
   that's wiped afterwards (a migration and its undo), leaving no prices
   behind.

## Open questions (all unresolved; also going in SPEC)

1. Roles: make Raven Billing and Chris Packing? (Today everyone is Admin.)
2. Invoice grouping: which locations invoice per billing group, and which
   groups? Is "Bellingham Stores" = Key City + Port Townsend?
3. Default payment terms (Net 30?) and any customer-specific ones.
4. Per-each products (if any end up priced per each): bill the piece count
   Chris enters, or what was ordered?
5. Pepper sticks: is one box always one case?
6. Bill-to addresses for each location, and does PCC get its stores'
   invoices sent to one place?
7. Does PCC pay each store's invoice separately, or want one statement?
8. Remit-to: the same PO box? Phone number?
9. Store numbers (#23/#02 Kirkland, #22/#25 Madison Valley).
10. Sales tax: confirm nothing is taxable.
11. Invoice date: always the Tuesday after packing, or the day it's
    finalized?
12. Backorders and freezer pulls: how they should be billed (only the line
    kind is left for them).
