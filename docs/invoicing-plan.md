# Invoicing plan (for review, updated 10/28/26 with Lucas's answers)

Nothing is built yet. This is the plan for review before any code. Prices are
not known yet: none are seeded, guessed or invented; a missing price shows
"Price needed".

## Decided (Lucas, 10/28/26)

1. **Roles stay as they are** (everyone Admin). The Billing role and the
   Invoices and Prices permissions are built, but nobody is moved to Billing
   or Packing; Lucas will change roles later.
2. **No billing groups.** There's no Bellingham Stores chain. Every location
   gets its own invoice. Billing groups can be added later if needed.
3. **Terms: Net 15 by default**, changeable per customer (blank uses the
   default).
4. **Price unit per product: per lb (most), per case or per each**, set on
   the product in Setup > Products. A pepper-stick box is always one case.
5. **The invoice date can be changed** on each invoice. It starts as the
   Tuesday after packing.
6. **Each location pays its own invoice**, PCC stores included. A chain's
   parent is only billed if products ship to the parent directly.
7. **Bill what went out on the delivery, never what was ordered.** Per each
   bills the pieces packed (the count typed on Packing). Backorders aren't
   billed, since they didn't ship.
8. **No bill-to address yet**: a blank address prints the name only.
9. **Remit-to and business details are editable** in Setup > Invoicing.
10. **Nothing is taxable.** No tax is built.
11. **Codes and numbers can always be changed.** A location's invoice code,
    a week's invoice number, and an invoice's own number can each be
    changed later (logged, still unique). Nothing is locked for good.
    Madison Valley is #22 (confirmed); Kirkland is unsure and editable.
12. **Freezer pulls** are billed at the product's price per lb, like any
    other box.
13. **Discounts per line**: any line can have a discount, with a note.

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
- **Piece counts**: `packing_lines.packed_qty`, an optional count per order
  line (not per box), typed on Packing.
- **Products**: unit (each, pack, lb, case) and `billed_by_weight` (true for
  everything except the two pepper stick products, which are by the case).
- **Customers**: locations under a chain (PCC's 16 stores), Ships to (Plymouth
  or Direct), delivery day, `bills_for_locations` (off for every chain). No
  addresses are stored for customers.
- **Half and whole lamb customers (households)** aren't customers in the app:
  they're names on half and whole orders. They get no invoices.
- **Invoice number**: the only place is "INV#" on each week's cut sheet
  (`cut_sheets.inv_number`, typed in). Only 10/12 has a cut sheet, with no
  INV#; 10/19 and 10/26 have none. So 3000 and 3001 aren't stored anywhere.
- **Roles**: Admin, Office, Packing, Viewer, with per-area levels (Off, View,
  Change) that the database enforces. All four people are Admin.
- **Audit**: every table change is logged (who, when, old and new values).
- **Settings**: company name, ship-from address (blank) in `app_settings`.

## Conflicts with what's built, and the plan for each

1. **Everyone is Admin**, so "Packing can't see prices" has no effect until
   roles change. Built now, takes effect when Lucas changes roles.
2. **The invoice number lives on the cut sheet**, which most weeks don't have.
   Built (stage 1): the week has its own number (`weeks.invoice_number`, one
   per week, unique), set in Setup > Invoicing; 10/19 = 3000 and 10/26 = 3001;
   the next week suggests the last number + 1. **The cut sheet's INV# is left
   as it is, separate**: Kathy's 9/30/26 sheet has INV# 2403, which doesn't
   fit the 3000s, so it may be a different number (open question).
3. **Typed boxes** (no barcode) also have a recorded weight (4 on 10/26, all
   confirmed against Chris's sheet). Bill every box record, scanned or typed;
   the box detail page shows which were typed.
4. **Products already have `billed_by_weight`.** Replace it with a price unit
   (lb, case, each): lb where it's true, case for the two pepper stick
   products. Editable in Setup > Products.
5. **No customer addresses.** Add a bill-to address to each location; blank
   prints the name only.
6. **"Not filled" isn't marked consistently.** Any ordered product with no
   boxes shows as shorted at $0 (marked X or not), so the customer always
   sees what didn't ship.
7. **The money must be exact**: JavaScript numbers aren't. Weights and money
   are `numeric` in the database; totals are worked out in the database
   (exact decimals); the screens work in whole cents and hundredths of a
   pound, never floating point.
8. **Prices page in Setup**: Setup is view-only for everyone but Admin. The
   Prices page sits in Setup but uses its own "Prices" permission, so Billing
   can edit it.
9. **Store numbers**: Chris's sheet calls #23 Kirkland "#02" and #22 Madison
   Valley "#25". Madison Valley is #22 (confirmed); Kirkland is unsure. Codes
   can be changed any time; an invoice already made keeps its number unless
   it's changed on the invoice.

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

The PCC chain itself gets no code (each store pays its own). "TEST Le Trim"
is a test customer and gets no code; it's deleted after the Le Trim test.

## Schema changes (one migration per stage, each with an undo file)

- `weeks.invoice_number int unique` (from the cut sheet's INV#; 10/19 = 3000,
  10/26 = 3001).
- `customers`: `invoice_code` (unique, checked format), `bill_to_address`,
  `terms_days` (blank: the default), `box_detail` (default off).
- `app_settings`: business name, address, phone, remit-to, default terms
  days (15). Starting values: Umpqua Valley Lamb, PO Box 1120, Riddle OR
  97469.
- `products.price_unit` ('lb', 'case', 'each'), replacing `billed_by_weight`.
- `prices`: product, customer (blank: the default list), price (`numeric`),
  effective from (date), who and when. The price for an invoice line is the
  newest one effective on the invoice date: the customer's own, else the
  default.
- `invoices`: week, customer, the full invoice number as issued
  ("3001-NEWP", "3001-NEWP-R1"; changeable, unique), the invoice it replaces, status (Draft,
  Finalized, Sent, Partially paid, Paid, Void), invoice date (starts as the
  Tuesday after packing, changeable), terms and due date, bill-to and
  business details as issued, totals, a fingerprint of the boxes it was made
  from (to tell when it's out of date), who and when for each step, void
  reason.
- `invoice_lines`: kind (packed, shorted, manual, and **inventory**, left
  for bills from freezer stock but not built), product, description as
  issued, ordered amount (reference), box count, billed quantity, price unit,
  unit price as issued, discount (amount or percent), line total, note
  (required on manual lines and discounts), sort.
- `invoice_boxes`: the boxes on a finalized invoice, with weight, lot, pack
  date and serial as issued (for the box detail page and trace).
- `payments`: invoice, date, amount, method (ACH, check, other), reference
  (check number or ACH ref), note, who. Partial payments allowed; the status
  follows from what's been paid.
- Permissions: new areas **Invoices** (invoices and payments) and
  **Prices**; a **Billing** role: Invoices and Prices change; Orders,
  Packing, This week, Customers and Print and download view; Half and whole,
  Freezer, Calls and Cut sheet off. Packing and Viewer: Invoices and Prices
  off. Admin: everything. Nobody's role changes. Row Level Security on every
  new table, written with it.
- Audit triggers on every new table (created, finalized, voided, payment
  recorded, price changed). No new foreign key creates a second link between
  two tables the app already loads together (the 10/26 outage).

## How an invoice is made from packing

1. On Invoices, pick the week (by packing Monday) and tap **Make drafts**.
2. The week's box records are grouped by location: one invoice each.
3. Each invoice gets one line per product: box count, billed quantity, unit
   price, line total, with what was ordered shown small.
   - Per lb: billed weight = the sum of the boxes' net weights.
   - Per case: billed cases = the number of boxes (one case per box).
   - Per each: the pieces packed (the count typed on Packing). If no count
     was typed, the line shows **Count needed** and blocks finalizing.
   - Freezer pulls: billed like any other box, at the product's price per lb.
   - Ordered products with no boxes: a shorted line at $0.
   - Boxes for a product not on the order: billed normally (Newport's
     Sirloin), marked "not on the order".
4. **Line total = billed quantity x price, rounded half up to the cent**,
   once per line, less the line's discount (a dollar amount, or a percent
   rounded half up to the cent). The invoice total is the sum of the line
   totals.
5. A line with no price shows **Price needed**; the invoice is marked DRAFT
   and can't be finalized until every line has a price.
6. Manual lines (delivery fee, credit, adjustment) need a note.
7. If box records change after the draft was made (a box moved, added or
   reweighed), the draft says **Out of date** with **Update draft** (manual
   lines are kept).
8. **Invoice date**: changeable on a draft (prices are looked up again for
   the new date). On a finalized invoice it can still be changed (the due
   date follows; prices stay as issued); the change is logged.
9. **Finalize** checks every price, snapshots the lines, prices, boxes,
   bill-to and business details, and locks the lines. The invoice number can
   still be changed (logged). After that the lines never change: corrections are **Void** (with a reason) and **Reissue**
   (3001-NEWP-R1), or a credit line on a later invoice.
10. **Mark sent**, then **Record payment** (any number, partial allowed).

## Screens

- **Invoices** (Billing, Admin; in More): the week's invoices: who, number,
  status, total, missing prices, out of date, with Make drafts and Print all.
- **An invoice**: the printable invoice (one location, Letter, DRAFT across
  it until finalized), lines, manual lines, invoice date, actions, payments,
  and the box detail page when it's on for that customer.
- **Open invoices**: customer, invoice number, date, due date, total, paid,
  balance, days overdue. Sorting by invoice number groups by week, then
  customer.
- **Setup > Prices**: every active product with its unit, default price and
  effective date (blank where not set), typed straight in. Whole Lamb sits
  next to the parts so they can be compared, each with its price per lb.
  Customer prices under each product, added only where a customer differs.
- **Setup > Products**: the price unit (per lb, per case, per each) on each
  product.
- **Setup > Invoicing**: business details, remit-to, default terms (Net 15);
  each location's invoice code, bill-to address, terms, box detail. A
  printable list of invoice codes for Kathy.
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

Not built: nothing is taxable (Lucas, 10/28/26). Oregon has none. The PCC stores, Key City and Port Townsend are in
Washington; Washington doesn't tax food for people, and sales to retailers
for resale are exempt with a reseller permit. Pepper sticks are likely food
too. So probably nothing is taxable, but confirm with Raven or an accountant.
Room is left: a tax line kind can be added to invoice lines later.

## Stages (stop for review after each)

1. **Foundation**: invoice number on the week, invoice codes, terms,
   bill-to addresses, settings, price units, the Prices page, the Billing
   role and permissions (nobody moved), the code list. No prices entered.
2. **Drafts**: make drafts from packing, the invoice page and printout
   (DRAFT, Price needed), invoice date, out-of-date checking, manual lines,
   box detail. Tested against 10/26: weights and box counts must match the
   packing records and manifests (per location).
3. **Lifecycle**: finalize, void and reissue, sent, payments, Open invoices,
   exports, Print and download. Tested with a few test prices in one place
   that's wiped afterwards (a migration and its undo), leaving no prices
   behind.

## Open questions (also in SPEC section 15)

0. The cut sheet's INV# (2403 on Kathy's 9/30/26 sheet): is it the same
   number as the invoice number, or a different one? They're separate
   until we know.

1. Kirkland's store number (#23 or #02); its code is PCC23 until changed.
2. Kathy's OK on the invoice codes (changeable any time).
