-- Undo 20261018000200_whole_loin_cleanup.sql. Run BEFORE the step 1 revert.
-- Values are from backups/20261015T212656Z_*.json (the state before the fix).
-- Run with: npx supabase db query --linked -f supabase/rollback/20261018000200_revert.sql
-- Never touches orders or order lines.

begin;

-- Le Trim's old shoulder draw (0.1 shoulder per lb).
insert into public.product_part_uses (product_id, part_id, qty)
select 'cp-le-trim', 'shoulder', 0.1 where exists (select 1 from public.products where id = 'cp-le-trim')
on conflict (product_id, part_id) do update set qty = excluded.qty;

-- Drives the count, as before (hind shank was already false).
update public.parts set drives_count = true where id in ('rack', 'loin', 'fshank');

-- The two parts added in Setup on 10/15, as they were.
insert into public.parts (id, name, per_lamb, unit, balance_check, drives_count, confirmed, sort, source_note)
values
  ('carcass-lamb-vzg5', 'Carcass lamb', 1, 'each', false, false, true, 9, 'Added in Setup.'),
  ('whole-loins-ooky', 'Whole Loins', 2, 'each', false, true, true, 10, 'Added in Setup.')
on conflict (id) do nothing;

-- New products off again. If anyone has ordered them, they stay on and this says so.
update public.products p set active = false
where p.id in ('cp-chop-ready-rack', 'cp-carcass-lamb')
  and not exists (select 1 from public.order_lines l where l.product_id = p.id);
select p.id as still_on_because_ordered from public.products p
where p.id in ('cp-chop-ready-rack', 'cp-carcass-lamb') and p.active;

drop function if exists public.whole_loin_model_cleanup();

-- Let `supabase db push` forget step 2 so it can be applied again later.
delete from supabase_migrations.schema_migrations where version = '20261018000200';

commit;
