-- A box for a product that wasn't on the customer's order can be checked and
-- marked correct for the shipment (Lucas, 10/26/26), without changing the
-- order. Shown on Packing, never on the manifest.
-- extra_ok_by is deliberately not a foreign key: packing_weights already
-- links to profiles (created_by), and a second link between two tables
-- breaks the API's embeds (the 10/26 outage).
-- Undo: supabase/rollback/20261026000800_revert.sql

alter table public.packing_weights
  add column extra_ok_by uuid,
  add column extra_ok_at timestamptz;
comment on column public.packing_weights.extra_ok_by is 'Who checked that this box, for a product not on the order, is correct for the shipment (a profiles id; no foreign key on purpose).';
comment on column public.packing_weights.extra_ok_at is 'When it was checked. Null: not checked yet.';
