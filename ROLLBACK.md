# Rolling back the carcass balance fix (10/15/26)

The fix has two parts that go live separately:

| Step | What | Where |
|---|---|---|
| 1 | Migration `20261018000100_whole_loin_model.sql`: adds the Whole loin part, "cut from" links for rack and short loin, `fill_note` (Le Trim) and `carcass` columns, Chop Ready Rack and Carcass Lamb (off). Only adds; the old app keeps its lamb count. | applied before merge |
| 2 | The new app (branch `fix/carcass-balance`) | merged to `main`, deployed by Vercel |
| 3 | Migration `20261018000200_whole_loin_cleanup.sql`: Le Trim stops drawing on shoulders, racks / short loins / front shanks stop setting the count, the two mistaken parts ("Carcass lamb", "Whole Loins") are deleted, the two new products turn on. | applied after merge |

Nothing in any step touches `orders` or `order_lines`.

Backups of every table these steps change, taken just before: `backups/20261015T212656Z_*.json`
(parts, products, product_part_uses, product_cut_specs, cut_specs, half_whole_choices).

## Undo, newest first

Run only as far back as you need.

### 1. Undo step 3 (cleanup migration)

```bash
npx supabase db query --linked -f supabase/rollback/20261018000200_revert.sql
```

Puts back Le Trim's 0.1 shoulder per lb, lets rack, short loin and front shank set the count again, re-creates the two mistaken parts as they were, and turns the two new products off (unless they're already on an order; it lists any it left on).

### 2. Undo the app

In Vercel: project **uvl-orders** → Deployments → find the last production deployment **before** the merge of `fix/carcass-balance` (commit `61cae17`, "Order form: What they usually buy is grouped by type too") → ⋯ → **Promote to Production** (or Instant Rollback). That app still works after step 1's migration; it shows one extra "Whole loin" row.

Then revert the merge on `main` so the next push doesn't bring it back:

```bash
git revert -m 1 17c82ce
```

### 3. Undo step 1 (model migration)

Only after step 3 is undone and the old app is back in production:

```bash
npx supabase db query --linked -f supabase/rollback/20261018000100_revert.sql
```

Removes the Whole loin part and its uses, the "cut from" links, the `fill_note` and `carcass` columns, and Chop Ready Rack and Carcass Lamb. It stops with a message if either product is on an order; in that case leave those two products in place (see the comment in the file).

Each revert file also removes its migration from Supabase's list, so `npx supabase db push` would apply it again later.

## Checking it worked

- This week for the week of Oct 12, 2026 shows 78 lambs set by shoulder (155 needed) on the old model, and 79 set by whole loins on the new one (see `lib/calc/wholeLoin.test.ts`).
- `npx supabase migration list --linked` shows which of the two migrations are applied.
