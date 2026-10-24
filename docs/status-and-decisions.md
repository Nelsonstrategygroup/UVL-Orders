# Status and decisions

Where the UVL Orders app stands, and the decisions behind it, newest first.
The full rules are in `docs/SPEC.md`; open questions for Kathy and Chris are
in `docs/questions-for-kathy-and-chris.md`.

## Status (10/23/26)

Live at uvl.nelsonstrategygroup.com: orders, Calls, This week, cut sheet,
Packing (with scanning and offline use), half and whole, freezer, customers,
Setup, Print and download, the Box Label Report, requested lines for a later
week, and last order on the order screen and order sheets.

Live: printing box labels on Avery 5963 sheets (10/23/26), with the new label
layout (10/24/26) waiting on review.

Fixed 10/23/26: Packing hadn't been updating live since 10/20 (it listened to
tables the database doesn't send live changes for). Freezer, Half and whole,
and two Setup lists had the same problem; migration 20261023000300 turns on
live changes for their tables.

Waiting on Kathy and Chris: weights per pack for Heart, Liver and Kidney; box
limits marked "needs checking"; delivery days; pallet groups; see the
questions doc.

## Decisions

### Box label layout (10/24/26)
- The destination prints as one bold name, customer and location together
  ("PCC #10 Issaquah"), so distributors don't miss the store. 22 pt, wrapping
  to two lines before shrinking, sitting just above the rule.
- The quantity is in a black box, the product in a forest green band, so the
  item stands out.
- Orders that take more than one box get a barn red "BOX 2 OF 3" tag; single
  boxes say plain "Box 1 of 1".
- The label number moved to the middle of the bottom line as "label 14" (no
  "#", which was confusing next to PCC store numbers). It's for the office.
- The box type is in an outlined tag on the right, uppercase. A label never shows
  a question mark: when the box type isn't known, the tag is left off (the
  Box Label Report still shows "?").
- Changing a product's unit in Setup changes how its existing order lines read
  (a line only stores its unit when it differs from the product's). On 10/24
  Chops went from lb to packs; Key City's "20" now reads 20 packs, which is
  what was ordered, so nothing was changed.
- Labels print customers as stored in Customers: "Port Townsend" is its own
  customer with no chain, so its label shows only that.

### Box labels on Avery 5963 (10/23/26)
- One label per box row on the Box Label Report, in report order, on Avery
  5963 (4" x 2", 10 per Letter sheet). The PDF is drawn in code at exact
  sizes; print at Actual size / 100%.
- Each row has a label number for its week. A number stays with its box
  (customer, product, box number) and is never reused, so an order change
  doesn't renumber other labels.
- Print all or selected, starting at any position on a partly used sheet.
- Every print is logged (first print or reprint); rows changed after
  printing say "Changed since printed".
- Labels are never edited directly: corrections go through the order.
- The printer offset is set per device in My account, with an alignment test
  page.
- The label shows the box type as named in Setup > Boxes: MVM, Roll Stock,
  Jerky, White, Baby. These names are correct; some paperwork calls the first
  two "Mohawk" and "Rollstock", but they stay MVM and Roll Stock (Lucas,
  10/23/26). The customer line is the chain or business ("PCC"),
  the location line is the store ("#02 Kirkland"), blank for single-location
  customers.

### Undo (10/22/26)
- Undo lasts 30 seconds, with a ✕ to close it, and only appears where there's
  no other way back (clearing an order, replacing lines, deletions, filling a
  set, starting or copying a cut sheet, finishing a goal, marking a half or
  whole filled, a follow-up done, moving a line, dropping a request).

### Requested lines for a later week (10/22/26)
- "Move to next week" and "Request for a later week" put a line on a later
  week as requested. Requests count toward that week's lamb count, product
  totals and cut sheet (they're cut and frozen that week), but aren't on
  Packing or the box labels until confirmed.
- "Same as last week", "Last order" and "What they usually buy" use confirmed
  lines only.

### Order screen quantity boxes (10/22/26)
- Any number of digits can be typed. Products sold in steps (Le Trim, 10 lb)
  keep what's typed, with a gentle note suggesting the nearest step.

### Last order and order sheets (10/22/26)
- "Last order" is the customer's most recent week with an order before the
  week being looked at (up to 26 weeks back).
- Order sheets: Last order column, what they usually buy first, Invoice batch
  (the week's INV#) and Scheduled delivery (from the customer's delivery day;
  a chain's stores use the chain's day; PCC is Saturday).

### Box labels report (10/21/26)
- A box marked "needs checking" in Setup is simply not used when splitting.
- Products with no box size get normal tables with box "?", one label per
  customer.
- Shanks show in packs on This week.

### Phone layout and navigation (10/21/26)
- Bottom bar: Week, Calls, Orders, Packing, More. Packing is only for packing.
- Print and download holds every report, grouped by when in the week it's
  used; each opens as a readable page.
- This week is the weekly overview; Setup is a menu of pages.

### The order week (10/20/26 to 10/21/26)
- A week runs Thursday through Wednesday, named by its packing Monday, and
  switches at 12:00 AM Thursday, Pacific time. Orders filed under the old
  Monday-start week were moved forward one week with Kathy's agreement.
