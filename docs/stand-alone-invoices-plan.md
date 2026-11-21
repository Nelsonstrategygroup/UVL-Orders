# Stand-alone invoices: plan (for review, 11/20/26)

Nothing is built yet. This is the plan and the open questions, for Lucas's OK
before any code.

## The need

Sometimes products are sold with no order in the week: boxes pulled from the
freezer and sold, or Emerson's held boxes going to another store. Today an
invoice can only come from a week's packing (one per location per week), so
there's no way to bill these without adding an order.

## How invoices work today (what this has to fit around)

- An invoice belongs to a week and a location. The database allows only one
  live (not void) invoice per location per week (`invoices_one_per_week`).
- Drafts are live: every time a week's invoices are opened, and after every
  packing change, `sync_invoice_drafts` / `draft_for_location` make, refill
  and delete drafts from the box records. Any draft found for a location is
  refilled from that location's packing.
- Lines: packed, shorted, manual (needs a note), freight, and **inventory**,
  which was left in the database for "bills from freezer stock" but never
  built.
- Numbers: the week's number plus the location's code ("3001-NEWP"); a
  reissue adds -R1. Finalize, Mark sent, Payments, Void, Reissue and Open
  invoices all work per invoice.
- Weekly P&L income: one invoice per location for the week (finalized =
  income, packed but not finalized = projected), plus Other income typed by
  hand.

## Proposed design

1. **A stand-alone invoice is an invoice marked "sale"** (a new column on
   `invoices`, no new table, no new foreign key). Everything after it's made
   works as now: the printout, Finalize, Mark sent, Payments, Void, Open
   invoices, the QuickBooks lines export.
2. **Packing never touches it.** The live-draft functions skip sale invoices
   (never refilled, never deleted for "nothing packed"), and a sale doesn't
   count toward "one invoice per location per week", so Emerson can have its
   weekly invoice and a sale in the same week.
3. **Making one**: Invoices page, **New sale invoice**: pick the customer and
   the invoice date (starts as today). It opens the usual invoice page with
   **Add a product**.
4. **Lines**: pick a product, type the amount in its price unit (pounds,
   cases or pieces) and, optionally, the number of boxes. Priced from Setup >
   Prices on the invoice date like a packed line (the customer's price, else
   the default), copied onto the line at Finalize. Discounts and lines added
   by hand work as now. These use the existing **inventory** line kind.
5. **Void and Reissue**: a reissued sale copies its lines (there's no packing
   to rebuild from).
6. Calc in `lib/calc` (sale numbers, which week a date falls in, pricing
   inventory lines) with tests; database tests through the PGlite harness;
   RLS unchanged (same tables, same Invoices permission); a rollback script.

## Open questions

1. **Week and number.** Proposed: the sale belongs to the order week that
   holds its invoice date (stored by packing Monday), and its number is that
   week's number + the location code + "-S1", "-S2" ("3005-EMER-S1"),
   changeable like any number. Or would you rather type each sale's number?
2. **Who can it be for?** Proposed: only customers already in the app (it
   needs an invoice code for the number). Or also a one-off buyer typed by
   name, with no customer record?
3. **Lines: typed or scanned?** Proposed for now: pick the product and type
   the pounds (or cases, pieces). Scanning the Mohawk label to fill a line
   (weight, lot, serial) could come once the freezer has box records (the
   freezer Add/Count work), linked only with your OK.
4. **P&L.** Proposed: a finalized sale counts as income in the week it
   belongs to, shown as its own row ("Sale 3005-EMER-S1") under invoice
   income, and a draft sale shows as projected. Should a draft count as
   projected, or only once finalized? And should it count at all, or only
   as money owed?
5. **Freezer inventory.** Today a sale takes nothing out of the freezer; in
   the freezer work, "Sold" only takes the box out. Proposed for now: no
   link. Later, picking "Sold" on a freezer box could add it to a sale
   invoice (or a sale line could take the box out). Do you want that link,
   and which way round?
6. **Emerson's held boxes.** They're already box records on an Emerson
   order in the week they were packed, so they're on Emerson's invoice for
   that week. When one goes to another store, is that a sale to the new
   store, with Emerson's invoice left as it was (or corrected by hand)? Or
   should the box move off Emerson's invoice? (Moving boxes between weeks
   and stores already exists on Packing; this plan doesn't change it.)

## Stages (stop for review after each)

A. Migration (the sale column, skip sales in the live-draft functions, the
   one-per-week rule, numbers, reissue) + rollback + PGlite tests.
B. `lib/calc` changes + tests; the New sale invoice button and Add a product
   on the invoice page.
C. P&L income and Open invoices, per the answers above.
