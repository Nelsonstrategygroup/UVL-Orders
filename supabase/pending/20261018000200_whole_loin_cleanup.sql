-- Carcass balance fix, step 2 of 2 ("contract"). Revert: supabase/rollback/20261018000200_revert.sql
--
-- Run only after the new app (whole loin model) is live: the app before it
-- would count lambs wrongly without these rows. Nothing here touches orders
-- or order lines.

-- As a function so a fresh install can run it again after seeding. Safe to run more than once.
create or replace function public.whole_loin_model_cleanup()
returns void
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  -- Le Trim no longer draws on shoulders (it is filled from extras).
  delete from public.product_part_uses where product_id = 'cp-le-trim' and part_id = 'shoulder';

  -- Racks and short loins are cut from whole loins, and front shanks never set
  -- the count ("We will not kill lambs to get shanks", Kathy 10/14). Hind
  -- shanks already don't.
  update public.parts set drives_count = false where id in ('rack', 'loin', 'fshank', 'hshank');

  -- Two parts added in Setup by mistake on 10/15. Removed only if nothing uses
  -- them (checked 10/15: no product part uses, no half and whole choices).
  delete from public.parts p
  where p.id in ('carcass-lamb-vzg5', 'whole-loins-ooky')
    and not exists (select 1 from public.product_part_uses u where u.part_id = p.id)
    and not exists (select 1 from public.half_whole_choices c where c.part_id = p.id);

  -- The two new products can be ordered now.
  update public.products set active = true where id in ('cp-chop-ready-rack', 'cp-carcass-lamb');
end;
$fn$;

revoke all on function public.whole_loin_model_cleanup() from public, anon, authenticated;
grant execute on function public.whole_loin_model_cleanup() to service_role;

select public.whole_loin_model_cleanup();
