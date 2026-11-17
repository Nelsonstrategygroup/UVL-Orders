-- Weekly P&L stage C (Lucas, 11/16/26): review and close a week. Any admin
-- can mark a week "Reviewed by me", close it, or reopen it (Chris stays an
-- admin; Eric gets a login later). Closing saves a snapshot of the whole P&L
-- and its detail, and the closed week shows that snapshot. While a week is
-- closed the database refuses changes that would affect it: orders, packing,
-- invoices, weigh sheets, expenses, other income and adjustments. Reopening
-- needs a reason. Every review, close and reopen is in pnl_week_events.
--
-- Only ADDS: three tables, a week_is_closed() check, the close / reopen /
-- review functions, and guard triggers on the week's tables; and
-- sync_invoice_drafts() skips a closed week (it would otherwise try to bring
-- its drafts up to date when the invoices are opened). No existing row
-- changes. No foreign keys.
--
-- Undo: supabase/rollback/20261116000100_revert.sql

-- ---------------------------------------------------------------------------
-- Tables (admins read; written only by the functions below)
-- ---------------------------------------------------------------------------
create table public.pnl_closed_weeks (
  week_id date primary key check (extract(isodow from week_id) = 1),
  closed_at timestamptz not null default now(),
  closed_by uuid,
  closed_by_name text not null default '',
  -- The P&L as it was when closed (what the screen and P&L detail show).
  snapshot jsonb not null,
  -- The checks still failing when it was closed, in words.
  missing text[] not null default '{}',
  updated_at timestamptz
);
comment on table public.pnl_closed_weeks is
  'P&L stage C: a closed week (a row while closed; reopening removes it). snapshot: the P&L as it was when closed. missing: the checks still failing then.';

create table public.pnl_week_reviews (
  week_id date not null check (extract(isodow from week_id) = 1),
  user_id uuid not null,
  name text not null default '',
  reviewed_at timestamptz not null default now(),
  primary key (week_id, user_id)
);
comment on table public.pnl_week_reviews is 'P&L stage C: who has marked a week "Reviewed by me", and when.';

create table public.pnl_week_events (
  id uuid primary key default gen_random_uuid(),
  week_id date not null check (extract(isodow from week_id) = 1),
  action text not null check (action in ('reviewed', 'review_removed', 'closed', 'reopened')),
  reason text not null default '',
  missing text[] not null default '{}',
  by_user uuid,
  by_name text not null default '',
  at timestamptz not null default now()
);
create index pnl_week_events_week on public.pnl_week_events (week_id, at);
comment on table public.pnl_week_events is
  'P&L stage C: every review, close and reopen of a week, with who, when, the reason (reopen) and what was missing (close). Never changed.';

create trigger pnl_closed_weeks_updated_at before update on public.pnl_closed_weeks
  for each row execute function public.set_updated_at();

alter table public.pnl_closed_weeks enable row level security;
alter table public.pnl_week_reviews enable row level security;
alter table public.pnl_week_events enable row level security;
create policy "pnl_closed_weeks: read" on public.pnl_closed_weeks for select to authenticated
  using ((select public.is_admin()));
create policy "pnl_week_reviews: read" on public.pnl_week_reviews for select to authenticated
  using ((select public.is_admin()));
create policy "pnl_week_events: read" on public.pnl_week_events for select to authenticated
  using ((select public.is_admin()));
revoke all on public.pnl_closed_weeks, public.pnl_week_reviews, public.pnl_week_events from anon, authenticated;
grant select on public.pnl_closed_weeks, public.pnl_week_reviews, public.pnl_week_events to authenticated;
grant all on public.pnl_closed_weeks, public.pnl_week_reviews, public.pnl_week_events to service_role;

alter publication supabase_realtime add table public.pnl_closed_weeks, public.pnl_week_reviews, public.pnl_week_events;

-- ---------------------------------------------------------------------------
-- Is the week closed? (Anyone signed in may ask: the guards run as whoever
-- is making the change, packing included.)
-- ---------------------------------------------------------------------------
create or replace function public.week_is_closed(p_week date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.pnl_closed_weeks where week_id = p_week);
$$;
revoke execute on function public.week_is_closed(date) from public, anon;
grant execute on function public.week_is_closed(date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The guard: refuses a change to a closed week's rows. AFTER triggers, so a
-- week worked out from a date (weigh sheets, expenses, other income) is
-- there. Both the old and the new row are checked (moving a row out of, or
-- into, a closed week is refused too). On a closed week's invoice, only
-- marking it sent (or not sent) is allowed.
-- ---------------------------------------------------------------------------
create or replace function public.closed_week_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_week date;
  v_sent constant text[] := array['status', 'sent_at', 'sent_by', 'updated_at'];
begin
  if tg_table_name = 'invoices' and tg_op = 'UPDATE' then
    if old.week_id = new.week_id
      and old.status in ('finalized', 'sent') and new.status in ('finalized', 'sent')
      and (to_jsonb(new) - v_sent) = (to_jsonb(old) - v_sent) then
      return null;
    end if;
  end if;

  foreach v_row in array array[
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  ] loop
    continue when v_row is null;
    v_week := case tg_table_name
      when 'order_lines' then (select o.week_id from public.orders o where o.id = (v_row ->> 'order_id')::uuid)
      when 'packing_weights' then (select o.week_id from public.orders o where o.id = (v_row ->> 'order_id')::uuid)
      when 'packing_lines' then (select o.week_id from public.orders o where o.id = (v_row ->> 'order_id')::uuid)
      when 'invoice_lines' then (select i.week_id from public.invoices i where i.id = (v_row ->> 'invoice_id')::uuid)
      when 'kill_lambs' then (select s.week_id from public.kill_sheets s where s.id = (v_row ->> 'sheet_id')::uuid)
      when 'kill_adjustments' then (select s.week_id from public.kill_sheets s where s.id = (v_row ->> 'sheet_id')::uuid)
      else (v_row ->> 'week_id')::date
    end;
    if v_week is not null and public.week_is_closed(v_week) then
      raise exception 'The week of % is closed on the Weekly P&L. Reopen it there to make changes.',
        to_char(v_week, 'FMMon FMDD, YYYY') using errcode = '42501';
    end if;
  end loop;
  return null;
end;
$$;
revoke execute on function public.closed_week_guard() from public, anon, authenticated;

create trigger orders_closed_week after insert or update or delete on public.orders
  for each row execute function public.closed_week_guard();
create trigger order_lines_closed_week after insert or update or delete on public.order_lines
  for each row execute function public.closed_week_guard();
create trigger packing_weights_closed_week after insert or update or delete on public.packing_weights
  for each row execute function public.closed_week_guard();
create trigger packing_lines_closed_week after insert or update or delete on public.packing_lines
  for each row execute function public.closed_week_guard();
create trigger invoices_closed_week after insert or update or delete on public.invoices
  for each row execute function public.closed_week_guard();
create trigger invoice_lines_closed_week after insert or update or delete on public.invoice_lines
  for each row execute function public.closed_week_guard();
create trigger kill_sheets_closed_week after insert or update or delete on public.kill_sheets
  for each row execute function public.closed_week_guard();
create trigger kill_lambs_closed_week after insert or update or delete on public.kill_lambs
  for each row execute function public.closed_week_guard();
create trigger kill_adjustments_closed_week after insert or update or delete on public.kill_adjustments
  for each row execute function public.closed_week_guard();
create trigger pnl_expenses_closed_week after insert or update or delete on public.pnl_expenses
  for each row execute function public.closed_week_guard();
create trigger pnl_income_closed_week after insert or update or delete on public.pnl_income
  for each row execute function public.closed_week_guard();
create trigger pnl_adjustments_closed_week after insert or update or delete on public.pnl_adjustments
  for each row execute function public.closed_week_guard();

-- ---------------------------------------------------------------------------
-- Opening a closed week's invoices: its drafts stay as they are.
-- (As in 20261108000100_live_invoice_drafts.sql, plus the first check.)
-- ---------------------------------------------------------------------------
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
  if public.week_is_closed(p_week) then
    return 0;
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

-- ---------------------------------------------------------------------------
-- Review, close, reopen (admins)
-- ---------------------------------------------------------------------------
create or replace function public.pnl_my_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select display_name from public.profiles where id = auth.uid()), '');
$$;
revoke execute on function public.pnl_my_name() from public, anon, authenticated;

-- "Reviewed by me" (p_reviewed true), or take it back (false).
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
revoke execute on function public.review_pnl_week(date, boolean) from public, anon;
grant execute on function public.review_pnl_week(date, boolean) to authenticated;

-- Close: the P&L as shown (p_snapshot) and the checks still failing (p_missing).
create or replace function public.close_pnl_week(p_week date, p_snapshot jsonb, p_missing text[] default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can close a week.' using errcode = '42501';
  end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then
    raise exception 'Nothing to save for the week.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('pnl-week:' || p_week::text));
  if public.week_is_closed(p_week) then
    raise exception 'This week is closed already.' using errcode = '42501';
  end if;
  insert into public.pnl_closed_weeks (week_id, closed_by, closed_by_name, snapshot, missing)
  values (p_week, auth.uid(), public.pnl_my_name(), p_snapshot, coalesce(p_missing, '{}'));
  insert into public.pnl_week_events (week_id, action, missing, by_user, by_name)
  values (p_week, 'closed', coalesce(p_missing, '{}'), auth.uid(), public.pnl_my_name());
end;
$$;
revoke execute on function public.close_pnl_week(date, jsonb, text[]) from public, anon;
grant execute on function public.close_pnl_week(date, jsonb, text[]) to authenticated;

-- Reopen, with a reason. The snapshot goes; the log keeps the close.
create or replace function public.reopen_pnl_week(p_week date, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can reopen a week.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Type why the week is being reopened.' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtext('pnl-week:' || p_week::text));
  delete from public.pnl_closed_weeks where week_id = p_week;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'This week isn''t closed.' using errcode = 'P0002';
  end if;
  insert into public.pnl_week_events (week_id, action, reason, by_user, by_name)
  values (p_week, 'reopened', btrim(p_reason), auth.uid(), public.pnl_my_name());
end;
$$;
revoke execute on function public.reopen_pnl_week(date, text) from public, anon;
grant execute on function public.reopen_pnl_week(date, text) to authenticated;
