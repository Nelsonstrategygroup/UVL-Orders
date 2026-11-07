-- Undo 20261106000100_remove_test_le_trim.sql: puts TEST Le Trim, its
-- 3/1/2027 test order and the week's lamb override (14) back as they were.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261106000100_revert.sql

begin;
insert into public.customers (id, name, type, call_day, notes, active, parent_customer_id, created_at,
  bills_for_locations, pallet_group_id, pallet_spot, pallet_sort, delivery_day, ships_to_point_id)
values ('4d3e2dc5-87d0-4358-8104-9264b76b075f', 'TEST Le Trim', 'Other', null, '', true, null,
  '2026-10-26 01:20:05.965958+00', false, null, '', 0, null, null)
on conflict (id) do nothing;
insert into public.orders (id, week_id, customer_id, status, notes, created_at)
values ('7692a89d-df02-4b9d-b972-f0c039e1665f', '2027-03-01', '4d3e2dc5-87d0-4358-8104-9264b76b075f',
  'ordered', '', '2026-10-26 01:20:05.965958+00')
on conflict (id) do nothing;
insert into public.order_lines (order_id, product_id, qty, unit, created_at) values
  ('7692a89d-df02-4b9d-b972-f0c039e1665f', 'cp-bi-legs', 22, null, '2026-10-26 01:20:05.965958+00'),
  ('7692a89d-df02-4b9d-b972-f0c039e1665f', 'cp-bls-shoulder', 10, null, '2026-10-26 01:20:05.965958+00'),
  ('7692a89d-df02-4b9d-b972-f0c039e1665f', 'cp-le-trim', 120, 'lb', '2026-10-26 01:20:05.965958+00')
on conflict do nothing;
update public.weeks set lamb_override = 14 where id = '2027-03-01' and lamb_override is null;
delete from supabase_migrations.schema_migrations where version = '20261106000100';
commit;
