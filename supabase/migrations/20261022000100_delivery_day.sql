-- Delivery day (change request 10/22/26): the weekday a customer gets its
-- boxes, for "Scheduled delivery" on the order sheet. A chain's locations
-- use the chain's day unless they have their own (lib/calc/lastOrder.ts).
-- PCC stores deliver Saturday (Lucas, 10/22/26), so it's set on the chain.
-- Undo: supabase/rollback/20261022000100_revert.sql

alter table public.customers
  add column if not exists delivery_day text
  check (delivery_day in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'));

update public.customers set delivery_day = 'Saturday'
where name = 'PCC' and parent_customer_id is null and delivery_day is null;
