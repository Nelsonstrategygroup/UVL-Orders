-- Shanks in packs (SPEC 12.4, Lucas 10/20/26). Revert: supabase/rollback/20261021000200_revert.sql
-- Backup before this change: backups/20261021T055452Z_shank_products.json
--
-- Front Shanks, Hind Shanks and Labeled Hind Shanks are ordered and counted
-- in packs of 2; one pack counts as one.
-- - Order lines are not touched: they already use the product's unit, so the
--   numbers entered stay and now mean packs (Lucas: the orders were meant as packs).
-- - The carcass balance still counts shanks per lamb: one pack uses 2 shanks.
-- - Mohawk's cut sheet lines stay in shanks: one cut sheet line unit (a
--   shank) is half a pack, so "Put these on this set" turns 10 packs into 20.
-- - Half and whole lambs still take loose shanks: one shank slot is half a pack.

create or replace function public.shanks_in_packs()
returns void
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  update public.products set unit = 'pack', pieces_per_pack = 2
  where id in ('cp-front-shanks', 'cp-hind-shanks', 'cp-labeled-hind-shanks');

  update public.product_part_uses set qty = 2
  where (product_id, part_id) in (('cp-front-shanks', 'fshank'), ('cp-hind-shanks', 'hshank'), ('cp-labeled-hind-shanks', 'hshank'));

  update public.product_cut_specs set units_per_cut = 0.5
  where product_id in ('cp-front-shanks', 'cp-hind-shanks', 'cp-labeled-hind-shanks');
end;
$fn$;
revoke all on function public.shanks_in_packs() from public, anon, authenticated;
grant execute on function public.shanks_in_packs() to service_role;

select public.shanks_in_packs();
