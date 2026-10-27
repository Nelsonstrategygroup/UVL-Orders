# Status and decisions

Where the UVL Orders app stands, and the decisions behind it, newest first.
The full rules are in `docs/SPEC.md`; open questions for Kathy and Chris are
in `docs/questions-for-kathy-and-chris.md`.

## Status (10/25/26)

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

Built 10/25/26, not live yet: the Le Trim plan (see below).

Built 10/26/26, not live yet: scan-to-pallet routing (see below).

Waiting on Kathy and Chris: weights per pack for Heart, Liver and Kidney; box
limits marked "needs checking"; delivery days; pallet groups; see the
questions doc.

## Decisions

### Reconciling 10/26 against Chris's pack sheet (10/26/26)
Chris's handwritten sheet (145 rows, every weight confirmed by Chris)
against the 141 boxes in the app: 133 matched on location, product and
weight; no box in the app was missing from the sheet; no wrong-store scans
were left.
Fixed (migration 20261026000700, logged as Lucas): GL Village Front Shanks
13.10 and Bellevue Tongue 2.65 added; the Edmonds Racks 21.05 box put on P1
(logged: "Mohawk labeled as Necks, contents are Racks"); Key City Ground
Lamb scanned box 20.00 -> 20.10 and a 20.25 box added; Key City's 19.65 lb
box Hind Shanks -> Labeled Hind Shanks.
Not changed: Ballard Front 8.55 / Hind 9.20 (the labels were right; the
sheet had the rows swapped). On hold (Lucas): Emerson BNLS Shoulder 34.22
(sheet 34.60) and the Emerson 35.75 lb box (BNLS Legs by barcode, BI Legs
on the sheet).
After the fix (144 boxes, none off a pallet): every location matches the
sheet except Emerson (the two held boxes), Redmond and Burien (+10.00 lb
each: pepper sticks weighed from Mohawk's label, no weight on the sheet),
and Edmonds (+0.05 lb, scale 21.05 vs sheet 21.0).
Open: Labeled and plain Hind Shanks share Mohawk's barcode, so a scan
comes in as Hind Shanks; the combined H/L/K box is recorded as Kidney, so
Heart and Liver show unpacked on Packing; the sheet's #02 Kirkland and #25
Madison Valley are #23 and #22 in the app; boxes for a product not on the
order don't show as a row on Packing.

### Manifests against the app (10/26/26)
Checked every pallet this week: the Pallets page, the manifest, Print and
download > Pallet manifest and Print all build from one shared function on
the same packing week (the week is passed in the link; nothing filters by
date, so the Thursday switch doesn't affect it). Database and manifest agree
box for box (EMERSON 9, P1 40, P2 42, P3 41, P4 8). Moved boxes show under
their new store and pallet; lines packed into more boxes than planned get
one row per box.
Root cause of what was missing: a box with no pallet was on no manifest,
with no warning. On 10/26 Chris deleted the scan of a box recorded as #13
Edmonds Necks 21.05 lb (on P1) and typed it on Packing as Racks; a weight
typed on Packing gets no pallet, so it dropped off P1's manifest. Also, a
manifest printed with no signal comes from the phone's saved copy and didn't
say how old it was.
Fixed: every manifest warns about boxes on no pallet (listing them), Print
all adds a "Boxes on no pallet" page, and each manifest prints "Data as of"
with a warning when it's the phone's saved copy. The manifest page fits a
phone screen.
Open: the Necks barcode (…88885) or that box's label may be wrong (Chris
re-entered it as Racks); weights typed on Packing could go on the store's
pallet automatically; reconciling against Chris's 10/26 sheet (waiting for
the file).

### Boxes on the wrong store (10/26/26)
What happened: three boxes packed on Mon Oct 26 were recorded for a
different store than the label on the box (Columbia instead of Ballard,
Fremont instead of Bellevue, Key City instead of Redmond).
Cause: scan-first routing can't read the store from Mohawk's barcode, so
it suggested the store furthest behind on its order, pre-selected it, and
one tap saved it. The card showed the suggested store's label number, not
the box's. Two boxes went to that guess; the third was picked by hand onto a
customer that hadn't ordered it, past a small warning.
Fixed:
- Data (migration 20261026000600): each box moved to the store on its label,
  its labelled box and planned pallet; the 11.30 lb neck weight typed for
  Bellevue (the same box, Lucas) removed. Logged as Lucas. Reprint the P1,
  P2 and P3 manifests.
- When more than one store needs the scanned product, nothing is chosen:
  big store buttons sorted by PCC number, each with its label number, and
  Chris taps the store on the label. With only one store, it's chosen for
  him (still a tap).
- Over the order: a box that would put a store over what it ordered stops
  with the store's ordered and packed counts: Pick a different store, or
  Yes, add it anyway. In lock mode too.
- Move (Scan boxes, Last boxes scanned) now changes the store as well as the
  pallet: stores that still need the product by PCC number (or all), the
  pallet follows the store, the box and label number follow too; going over
  is warned, not blocked. Logged in the audit log, like lot changes.
- Scanning a box again shows it as recorded (product, weight, lot, store,
  pallet) with big buttons: That's right, Wrong store, Wrong pallet, Remove
  scan (takes it off its store into Unassigned, after a yes).
Tested at phone width with test stores; test data deleted.

### Scan-to-pallet routing (10/26/26)
What changed:
- Scan boxes now suggests who each box is for and which pallet it goes on,
  after the scan. The pallet tag shows very large ("→ P3") with the
  customer, the label number and "needs 2 of 3 boxes". One tap confirms.
  Runner-ups, "Pick customer anyway" and "Unassigned" are below; anything
  but the suggestion is logged. Nothing is assigned without a tap.
- The suggestion: soonest ship date, then the customer furthest behind on
  their whole order (boxes packed over boxes planned), then by name.
- Pallets have tags Chris writes on them and a status (planned, open, full,
  shipped). "Start pallet for ..." asks for the tag; "Pallet full" moves the
  next box to a new pallet. A pallet belongs to a shipment, and a shipment can
  have several pallets.
- Lock to a customer keeps the old customer-first flow.
- Setup > Ships to (was Pallet groups): Direct, or a distributor. "PCC
  distributor" is set up and every PCC location ships to it; rename it when
  the real name is known.
- New Pallets page with a printable manifest; a distributor's pallets list
  boxes by store.
- Each scanned box records its pallet, box type and how it was routed.
- Box types and pallets have blank size fields, and there's an empty
  pallet_plan_lines table, ready for a planner later.
- Works offline like the rest of Packing. Two phones over-packing, or using
  the same tag, are flagged for Kathy, not refused.
- Migration 20261026000200. It only adds: the old pallet group columns stay
  until a cleanup migration, so nothing breaks between the db push and the
  deploy.

- Fix the same day, from the first real scans: a PCC shipment fills several
  pallets, each with its own stores (P1: #10, #11, #13, #15, #19, #23; P2:
  #24, #17...). A store's boxes now go to the pallet that already has that
  store's boxes; a store with none yet gets the newest open pallet. The card
  has "Different pallet" (the shipment's other open pallets, with the stores
  on each, and New pallet), and a scanned box can be moved with "Move to...".

- Plan pallets for the week (Pallets page): add pallets by tag and choose the
  pallet for each store; "Start from last week's pallets" copies last
  week's. Scan boxes sends a store's boxes to its planned pallet. Chris
  plans it at Mohawk, or Kathy ahead. Not printed on box labels. Migration
  20261026000400 (pallet_customers).

- Pallet shipping manifest: one shared page, opened from Pallets (Print
  Manifest on each pallet) and Print and download (Pallet manifest, with a
  pallet picker, print all, save as PDF, and a CSV of the boxes). Ship date
  is a line to write on (ship dates aren't set); ship-from address is a new
  setting in Setup > Ships to (migration 20261026000500); ship-to is the
  name only (no addresses stored).

Decided (Lucas, 10/26/26):
- Pallets switch from "Pallet X of Y" to tags; pallet groups are replaced by
  Ships to; each box records its box type; the typed pallet note on Packing
  is retired; a box can be unassigned.
- A pallet can ship direct to a customer: set the customer to Direct.
- Ship dates can wait. Shipments have a ship date field, blank for now.
- "Needs X of Y" counts boxes where the box count is known, pounds where a
  weight is known, otherwise open until the line is marked done.
- Show X of Y boxes on screen; use how far along the order is behind the
  scenes.
- Extras: Unassigned for now, given to a customer on Pallets.

Open:
- A ship day per customer, when the suggestion should go soonest first.
- What unassigned boxes become (the freezer, or extras for another order).
- A per-week override of Ships to (one store shipping direct for one week).
- A cleanup migration to drop the old pallet group table and columns.

### A weight for every box (10/26/26)
What changed:
- The paper packing copy is now the backup for when the internet is down
  (Lucas: Chris scans every weight; the paper is for when that can't work).
  One row per product per customer: a blank for each box with its label
  number printed above it, then Total lbs. Rows wrap when there are more
  blanks than fit. Blanks are 0.8" x 0.6", seven across beside the product,
  big enough to write in with gloves on. Pallet and Initials boxes per
  customer; Done and Not filled boxes per product.
- Known box count (the product has a box size): one blank per box, plus 2
  spare blanks with an empty "Label #" above them.
- Unknown box count (no box size): 6 blanks with an empty "Label #", marked
  "box count unknown". Products ordered by the pound follow the same rules
  (Lucas, 10/26/26: a pound product with a box size counts as known, e.g.
  Le Trim at 45 lb a box).
- Setup > Boxes: blanks when the box count isn't known (6), spare blanks
  (2), and a different number for any one product.
- Label numbers come from the Box Label Report's numbering. Opening Packing
  or the paper copy with internet numbers any boxes that don't have one yet,
  the same way, so the paper always matches the labels, and the phone keeps
  them for printing offline.
- New "Type in from paper" screen (Packing, and Print and download), laid out
  exactly like the paper: same customers and products in the same order, the
  same blanks and label numbers, Tab straight across, the total adding up,
  "+ Add a box". Saved on the phone first, like the rest of Packing.
- Each box's weight is stored on its own with the box it went in and its
  label number (migration 20261026000100). Scans go into the next empty box
  of that customer's product automatically, so every scan is tied to a box.
  The weigh panel does the same.
- No mixed boxes: two different products never share a box (Kathy, via
  Lucas, 10/26/26). The weigh panel's "Which box?" choice is gone.
- The Packing record report has a Box weights column ("#14 22.4 · #15 21.9").

Open:
- Weights typed in from paper have no lot (scans read it from the label).
  If trace needs a lot for every box, the paper may need a lot space too.
- The migration must be applied before this goes live.

### Le Trim plan (10/25/26)
What changed:
- New Le Trim screen for each week (This week > Le Trim step). It shows Le
  Trim ordered, extra shoulders, extra legs (and how many half legs they
  make), and extra trim, marked Estimated until Kathy types the actual trim
  from the kill sheet.
- Kathy types what she used: shoulders, half legs, trim. The app checks it
  in plain words (pieces vs packs, shoulders and half legs vs extras, trim
  left over or short) but never stops her saving.
- Suggest fills the boxes: shoulders first, then half legs, one per 10 lb
  pack, trim from Setup. Nothing saves until she taps Save.
- Saved, the plan comes out of the week's extras and puts "Bone out N
  shoulders for Le Trim" and "Halve N legs for Le Trim" at the top of the cut
  sheet. It can be changed any time in the week; a change after sending
  shows as changed since sent.
- It doesn't change the lamb count. Kathy works out Le Trim's share herself
  for now.
- Until a plan is saved, This week says Le Trim isn't planned yet.
- Setup > Le Trim: trim with each shoulder (5 lb) and each half leg (6.5 lb),
  used only for the estimate and Suggest.
- Migration 20261025000100 (table `le_trim_plans`, two settings). It must be
  applied before the code goes live.

Decided: Kathy enters what she actually used, so the history can show what's
routine later (Lucas, 10/25/26). Extra trim is labelled Estimated, as
suggested.

Open:
- What a "component" is: does each 10 lb pack take one shoulder or one half
  leg? Suggest and the first check assume one per pack.
- Which shoulders count as extra: every spare shoulder in the balance (what
  it does now), or only those not going to the freezer, grind, or half and
  whole orders?
- The trim per shoulder and per half leg (5 and 6.5 lb) need Kathy's
  confirmation.
- Whether Le Trim should one day add to the lamb count.

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
