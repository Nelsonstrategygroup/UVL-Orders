-- Undo 20261114000400_chain_prices.sql: price_on() goes back to the store's
-- own price, else the default. Chain prices (rows on PCC) stay in the table
-- but no longer apply to the stores; delete them first if that's the goal.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261114000400_revert.sql

begin;
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
    (select price from public.prices
      where product_id = p_product and customer_id is null and effective_from <= p_date
      order by effective_from desc limit 1));
$$;
delete from supabase_migrations.schema_migrations where version = '20261114000400';
commit;
