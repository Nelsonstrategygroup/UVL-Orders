-- Undo 20261102000100_distributors_print.sql: Newport Ave back to Direct,
-- Corfini Gourmet removed (only if nothing else ships through it), Plymouth
-- Poultry back to "Plymouth", and the new columns dropped.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261102000100_revert.sql

begin;
update public.customers set ships_to_point_id = null
where name = 'Newport Ave' and parent_customer_id is null
  and ships_to_point_id = (select id from public.consolidation_points where name = 'Corfini Gourmet');
delete from public.consolidation_points p
where p.name = 'Corfini Gourmet'
  and not exists (select 1 from public.customers c where c.ships_to_point_id = p.id)
  and not exists (select 1 from public.shipments s where s.ship_to_point_id = p.id);
update public.consolidation_points set name = 'Plymouth' where name = 'Plymouth Poultry';
alter table public.consolidation_points
  drop column if exists short_name,
  drop column if exists code,
  drop column if exists carrier,
  drop column if exists cross_dock,
  drop column if exists color;
alter table public.app_settings
  drop column if exists contact1_name,
  drop column if exists contact1_phone,
  drop column if exists contact1_email,
  drop column if exists contact2_name,
  drop column if exists contact2_phone,
  drop column if exists contact2_email;
delete from supabase_migrations.schema_migrations where version = '20261102000100';
commit;
