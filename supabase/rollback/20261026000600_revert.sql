-- Undo 20261026000600_fix_box_stores_1026.sql: puts the three boxes back
-- where they were recorded on 10/26 and restores the typed Bellevue neck
-- weight.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261026000600_revert.sql

begin;
update public.packing_weights
set order_id = 'ccca8ba6-5729-4294-ad16-f7178cf447e6', pallet_id = 'ac9c3282-1e4b-4ed4-9e11-034852bf8b72',
    slot = 1, label_no = 20, route = 'suggested', off_order = false
where id = '0fc55aa9-f8ae-4350-9bb9-890b50782628';
update public.packing_weights
set order_id = 'b34e53e4-d84d-4cb4-a9ba-a9e278168df8', pallet_id = 'ac9c3282-1e4b-4ed4-9e11-034852bf8b72',
    slot = 1, label_no = 158, route = 'suggested', off_order = false
where id = 'd78bd731-4485-4608-bb05-bc7a50371cce';
update public.packing_weights
set order_id = '5cd348e5-2c29-4e98-938a-462a5ee0c598', pallet_id = 'ad935f5d-6711-4cb2-b50c-b60f7a6f7485',
    slot = 1, label_no = null, route = 'picked', off_order = true
where id = 'b6bdddfe-d20b-46f6-82b9-4d78d623da55';
insert into public.packing_weights (id, order_id, product_id, weight, slot, label_no, source, client_id, created_by, created_at, off_order)
values ('603eda59-04a9-4902-b78a-0a03c1854018', '69c85bec-ccf4-4d25-9aa5-5a6a761e51d1', 'cp-necks', 11.3, 1, 161, 'weigh',
        'aeb78345-db17-4542-a508-98b05fdf1bc9', '7182190a-5556-4e1d-a4dd-27ac78db6393', '2026-10-26T21:11:33.272672+00:00', false)
on conflict (id) do nothing;
delete from supabase_migrations.schema_migrations where version = '20261026000600';
commit;
