-- Chain prices (Lucas, 11/14/26): a price set on a chain (a customer with
-- locations, like PCC) applies to every one of its stores; a store can still
-- have its own price where it differs.
--
-- The price a line gets on a date is now: the store's own newest on or before
-- the date, else its chain's, else the default. A store's own price wins
-- while it exists, even over a newer chain price. Customers that aren't a
-- location of anything work exactly as before. lib/calc/prices.ts priceFor()
-- does the same on the screens.
--
-- Changes only public.price_on(); no table, column or row changes.
-- Undo: supabase/rollback/20261114000400_revert.sql

create or replace function public.price_on(p_product text, p_customer uuid, p_date date)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select price from public.prices
      where product_id = p_product and customer_id = p_customer and effective_from <= p_date
      order by effective_from desc limit 1),
    (select pr.price from public.prices pr
      join public.customers c on c.parent_customer_id = pr.customer_id
      where pr.product_id = p_product and c.id = p_customer and pr.effective_from <= p_date
      order by pr.effective_from desc limit 1),
    (select price from public.prices
      where product_id = p_product and customer_id is null and effective_from <= p_date
      order by effective_from desc limit 1));
$$;
comment on function public.price_on(text, uuid, date) is
  'The price on a date: the store''s own, else its chain''s (parent customer), else the default. Null: Price needed.';
