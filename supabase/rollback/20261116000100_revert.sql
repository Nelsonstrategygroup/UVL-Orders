-- Undo 20261116000100_pnl_close_weeks.sql: removes closing and reviewing weeks
-- (the tables with their snapshots and log, the guards and functions), and
-- puts sync_invoice_drafts() back as it was. Audit log rows stay.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261116000100_revert.sql

begin;
drop trigger if exists orders_closed_week on public.orders;
drop trigger if exists order_lines_closed_week on public.order_lines;
drop trigger if exists packing_weights_closed_week on public.packing_weights;
drop trigger if exists packing_lines_closed_week on public.packing_lines;
drop trigger if exists invoices_closed_week on public.invoices;
drop trigger if exists invoice_lines_closed_week on public.invoice_lines;
drop trigger if exists kill_sheets_closed_week on public.kill_sheets;
drop trigger if exists kill_lambs_closed_week on public.kill_lambs;
drop trigger if exists kill_adjustments_closed_week on public.kill_adjustments;
drop trigger if exists pnl_expenses_closed_week on public.pnl_expenses;
drop trigger if exists pnl_income_closed_week on public.pnl_income;
drop trigger if exists pnl_adjustments_closed_week on public.pnl_adjustments;
drop function if exists public.closed_week_guard();
drop function if exists public.close_pnl_week(date, jsonb, text[]);
drop function if exists public.reopen_pnl_week(date, text);
drop function if exists public.review_pnl_week(date, boolean);
drop function if exists public.pnl_my_name();
alter publication supabase_realtime drop table public.pnl_closed_weeks, public.pnl_week_reviews, public.pnl_week_events;
drop table if exists public.pnl_week_events;
drop table if exists public.pnl_week_reviews;
drop table if exists public.pnl_closed_weeks;
create or replace function public.sync_invoice_drafts(p_week date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_made int := 0;
begin
  if not public.can_view('invoices') then
    raise exception 'Not allowed to see invoices' using errcode = '42501';
  end if;
  -- One at a time per week, so two screens opening at once don't both make a draft.
  perform pg_advisory_xact_lock(hashtext('invoices:' || p_week::text));

  -- A draft for every packed location with no invoice yet. A location whose
  -- invoice was voided gets its next one from Reissue.
  for r in
    select distinct o.customer_id
    from public.orders o
    where o.week_id = p_week
      and public.location_packed(p_week, o.customer_id)
      and not exists (select 1 from public.invoices i where i.week_id = p_week and i.customer_id = o.customer_id)
  loop
    insert into public.invoices (week_id, customer_id, invoice_date, made_by)
    values (p_week, r.customer_id, p_week + 1, auth.uid());
    v_made := v_made + 1;
  end loop;

  -- Nothing packed any more: the draft goes, unless someone added a line or a note.
  delete from public.invoices i
  where i.week_id = p_week and i.status = 'draft'
    and not public.location_packed(p_week, i.customer_id)
    and btrim(i.memo) = ''
    and not exists (select 1 from public.invoice_lines l where l.invoice_id = i.id and l.kind = 'manual');

  for r in select id from public.invoices where week_id = p_week and status = 'draft' order by created_at loop
    perform public.sync_invoice_draft(r.id);
  end loop;
  return v_made;
end;
$$;
revoke execute on function public.sync_invoice_drafts(date) from public, anon;
grant execute on function public.sync_invoice_drafts(date) to authenticated, service_role;

drop function if exists public.week_is_closed(date);
delete from supabase_migrations.schema_migrations where version = '20261116000100';
commit;
