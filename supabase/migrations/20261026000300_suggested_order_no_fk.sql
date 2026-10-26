-- Fix for 20261026000200 (10/26/26): packing_weights.suggested_order_id had a
-- foreign key to orders, a second link between orders and packing_weights.
-- The API then couldn't tell which link to use when loading an order's boxes
-- ("more than one relationship was found"), so Packing, This week and the
-- reports failed to load. The column stays (what the app suggested, when the
-- packer chose another); it just isn't a link any more.
-- Undo: supabase/rollback/20261026000300_revert.sql

alter table public.packing_weights drop constraint if exists packing_weights_suggested_order_id_fkey;
comment on column public.packing_weights.suggested_order_id is 'The order the app suggested, when the packer chose another. Not a foreign key, so orders and packing_weights have one link (order_id).';
