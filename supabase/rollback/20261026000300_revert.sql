-- Undo 20261026000300_suggested_order_no_fk.sql. Warning: putting the foreign
-- key back breaks loading orders with their boxes (two links between the
-- tables). Only run this together with 20261026000200's revert.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261026000300_revert.sql

begin;
alter table public.packing_weights
  add constraint packing_weights_suggested_order_id_fkey foreign key (suggested_order_id) references public.orders (id) on delete set null;
delete from supabase_migrations.schema_migrations where version = '20261026000300';
commit;
