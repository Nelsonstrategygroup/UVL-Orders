-- Ship-from address for the pallet manifest (change request 10/26/26). Set
-- in Setup > Ships to; blank prints a line to write it on. Nothing else
-- changes.
-- Undo: supabase/rollback/20261026000500_revert.sql

alter table public.app_settings
  add column ship_from_address text not null default '';
comment on column public.app_settings.ship_from_address is 'Printed as "Ship from" on pallet manifests. Blank: a line to write it on.';
