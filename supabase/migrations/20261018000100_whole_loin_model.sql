-- Carcass balance fix, step 1 of 2 ("expand"). Revert: supabase/rollback/20261018000100_revert.sql
--
-- The model confirmed by Kathy and Chris on 10/15/26: one lamb gives 2 legs,
-- 2 shoulders, 2 whole loins, 2 front shanks. Racks and short loins are cut
-- from whole loins (one of each per whole loin). Le Trim is filled from
-- extras and takes nothing from the balance. A carcass lamb goes out uncut
-- and is counted on top of the lambs for parts.
--
-- This step only ADDS. The app running before this change keeps its lamb
-- count; it shows one extra "Whole loin" row in its balance table. Nothing
-- here touches orders or order lines. Step 2 (20261018000200) removes the
-- old pieces once the new app is live.
--
-- parts and products already have RLS and policies; new columns change neither.

-- New columns ---------------------------------------------------------------
alter table public.parts
  add column made_from text references public.parts (id) on delete set null,
  add constraint parts_made_from_not_self check (made_from is null or made_from <> id);
comment on column public.parts.made_from is
  'The part this one is cut from (rack and short loin: wholeloin). One of the parent gives one of this. Parts cut from another never set the lamb count.';

alter table public.products
  add column fill_note text not null default '',
  add column carcass boolean not null default false;
comment on column public.products.fill_note is
  'When set, Kathy fills this product from extras: it takes nothing from the carcass balance and is listed on its own with this note.';
comment on column public.products.carcass is
  'An uncut carcass lamb: uses no parts, and each one adds a lamb on top of the lambs needed for parts.';

-- The data changes, as a function so a fresh install can run them again after
-- its catalog is seeded (scripts/seed.ts). Safe to run more than once.
create or replace function public.whole_loin_model_expand()
returns void
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  -- Whole loin part ------------------------------------------------------------
  insert into public.parts (id, name, per_lamb, unit, balance_check, drives_count, confirmed, sort, source_note)
  values ('wholeloin', 'Whole loin', 2, 'each', false, true, true, 2,
          'Kathy and Chris, 10/15/26: 2 per lamb. Racks and short loins are cut from it.')
  on conflict (id) do nothing;

  update public.parts set made_from = 'wholeloin' where id in ('rack', 'loin');

  -- Whole Lamb (cut and boxed): add its 2 whole loins. It already has 2 legs,
  -- 2 shoulders, 2 front shanks and no hind shanks.
  insert into public.product_part_uses (product_id, part_id, qty)
  select p.id, 'wholeloin', 2 from public.products p where p.id = 'cp-whole-lamb'
  on conflict (product_id, part_id) do update set qty = excluded.qty;

  -- Whole Loin product: one whole loin.
  insert into public.product_part_uses (product_id, part_id, qty)
  select p.id, 'wholeloin', 1 from public.products p where p.name = 'Whole Loin'
  on conflict (product_id, part_id) do update set qty = excluded.qty;

  -- Le Trim: filled from extras. Its old shoulder draw stays until step 2;
  -- the new app ignores it because of this note.
  update public.products set fill_note = 'Kathy fills from extra shoulders or legs.' where id = 'cp-le-trim';

  -- New products, off until step 2 -----------------------------------------------
  insert into public.products
    (id, name, short_name, unit, group_name, sort, billed_by_weight, counts_toward_lambs, not_lamb, confirmed, active, order_step, note)
  values
    ('cp-chop-ready-rack', 'Chop Ready Rack', '', 'each', 'Racks', 320, true, true, false, false, false, 1,
     'A rack with the ribs cut off.'),
    ('cp-carcass-lamb', 'Carcass Lamb', '', 'each', 'Whole lambs', 110, true, true, false, false, false, 1,
     'One entire lamb, sent uncut. Not part of the carcass balance; adds one lamb to the count.')
  on conflict (id) do nothing;
  update public.products set carcass = true where id = 'cp-carcass-lamb';

  insert into public.product_part_uses (product_id, part_id, qty)
  select 'cp-chop-ready-rack', 'rack', 1
  where exists (select 1 from public.products where id = 'cp-chop-ready-rack')
    and exists (select 1 from public.parts where id = 'rack')
  on conflict (product_id, part_id) do nothing;
end;
$fn$;

revoke all on function public.whole_loin_model_expand() from public, anon, authenticated;
grant execute on function public.whole_loin_model_expand() to service_role;

select public.whole_loin_model_expand();
