-- Mixed Shanks in the carcass balance (Chris, 11/11/26: its orders weren't
-- counted against the shanks, so the week came up short).
--
-- products.draws_from: the parts a product may be cut from, any of them
-- (Mixed Shanks: front shank and hind shank). Such a product uses none of
-- them in the balance; This week shows it on its own row against what those
-- parts have left between them, and the cut sheet says how many are ordered.
-- Which part it takes first isn't decided (to confirm with Kathy), so the
-- front and hind rows are not changed. Empty for every other product.
-- A customer who wants only front shanks is entered as Front Shanks.

alter table public.products add column draws_from text[] not null default '{}';
comment on column public.products.draws_from is 'Parts this product may be cut from, any of them (Mixed Shanks: fshank, hshank). It uses none of them in the balance; it gets its own row against what they have left. Empty for a product with fixed part uses.';

update public.products set draws_from = array['fshank', 'hshank'] where name = 'Mixed Shanks' and draws_from = '{}';
