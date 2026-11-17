-- Undo 20261121000100_pnl_owners.sql: removes the owners list; any admin can
-- review again (review_pnl_week() as in 20261116000100). Audit log rows stay.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261121000100_revert.sql

begin;
create or replace function public.review_pnl_week(p_week date, p_reviewed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can review the P&L.' using errcode = '42501';
  end if;
  if p_reviewed then
    insert into public.pnl_week_reviews (week_id, user_id, name)
    values (p_week, auth.uid(), public.pnl_my_name())
    on conflict (week_id, user_id) do nothing;
  else
    delete from public.pnl_week_reviews where week_id = p_week and user_id = auth.uid();
  end if;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    insert into public.pnl_week_events (week_id, action, by_user, by_name)
    values (p_week, case when p_reviewed then 'reviewed' else 'review_removed' end, auth.uid(), public.pnl_my_name());
  end if;
end;
$$;

drop function if exists public.is_pnl_owner();
alter publication supabase_realtime drop table public.pnl_owners;
drop table if exists public.pnl_owners;
delete from supabase_migrations.schema_migrations where version = '20261121000100';
commit;
