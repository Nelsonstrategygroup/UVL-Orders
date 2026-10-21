-- Undo 20261021000200_shank_packs.sql: shanks back to pieces, as in
-- backups/20261021T055452Z_shank_products.json. Order lines were never touched.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261021000200_revert.sql

begin;

update public.products set unit = 'each', pieces_per_pack = 2 where id in ('cp-hind-shanks', 'cp-labeled-hind-shanks');
update public.products set unit = 'each', pieces_per_pack = null where id = 'cp-front-shanks';

update public.product_part_uses set qty = 1
where (product_id, part_id) in (('cp-front-shanks', 'fshank'), ('cp-hind-shanks', 'hshank'), ('cp-labeled-hind-shanks', 'hshank'));

update public.product_cut_specs set units_per_cut = 1
where product_id in ('cp-front-shanks', 'cp-hind-shanks', 'cp-labeled-hind-shanks');

drop function if exists public.shanks_in_packs();

delete from supabase_migrations.schema_migrations where version = '20261021000200';

commit;
