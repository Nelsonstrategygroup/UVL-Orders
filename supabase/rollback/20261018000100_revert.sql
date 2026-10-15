-- Undo 20261018000100_whole_loin_model.sql. If step 2 was applied, run
-- 20261018000200_revert.sql first.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261018000100_revert.sql
-- Never touches orders or order lines. Stops if anyone has ordered the two
-- new products (an order line can't point at a deleted product).

begin;

do $$
begin
  if exists (select 1 from public.order_lines where product_id in ('cp-chop-ready-rack', 'cp-carcass-lamb')) then
    raise exception 'Chop Ready Rack or Carcass Lamb is on an order. Leave those products in place: comment out the product delete below and run again.';
  end if;
end $$;

delete from public.product_part_uses where product_id in ('cp-chop-ready-rack', 'cp-carcass-lamb');
delete from public.products where id in ('cp-chop-ready-rack', 'cp-carcass-lamb');

-- Whole loin uses go (Whole Lamb and Whole Loin used none before).
delete from public.product_part_uses where part_id = 'wholeloin';
update public.parts set made_from = null where made_from is not null;
delete from public.parts where id = 'wholeloin';

alter table public.products drop column if exists fill_note, drop column if exists carcass;
alter table public.parts drop constraint if exists parts_made_from_not_self, drop column if exists made_from;

drop function if exists public.whole_loin_model_expand();

delete from supabase_migrations.schema_migrations where version = '20261018000100';

commit;
