-- Undo 20261026000700_reconcile_10_26.sql: removes the three boxes added,
-- takes the Edmonds Racks box off P1, puts Key City's Ground Lamb back to
-- 20.00 and its 19.65 lb box back to Hind Shanks.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261026000700_revert.sql

begin;
delete from public.packing_weights where id in ('a1c26000-0000-4000-8000-000000000001', 'a1c26000-0000-4000-8000-000000000002', 'a1c26000-0000-4000-8000-000000000003');
update public.packing_weights set pallet_id = null where id = '292cbff2-d222-49c3-880e-663861cbbcfc';
update public.packing_weights set weight = 20 where id = 'f660ecb7-a2e9-4eb0-b01e-88c8fe70a157';
update public.packing_weights set product_id = 'cp-hind-shanks', label_no = null, off_order = true where id = 'f645ecf1-861d-4b7f-862c-4516bb3f948e';
delete from supabase_migrations.schema_migrations where version = '20261026000700';
commit;
