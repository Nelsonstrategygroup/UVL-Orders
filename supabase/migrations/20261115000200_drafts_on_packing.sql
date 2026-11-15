-- Invoice drafts as soon as boxes are packed (Lucas, 11/15/26). Before this, a
-- location's draft was made the first time someone opened the week on the
-- Invoices page. Now every change to packing (a box weighed, scanned, moved or
-- deleted; a piece count) makes or refreshes that location's draft at once,
-- the same way opening the week does (sync_invoice_drafts()).
--
-- Packing always comes first: if anything goes wrong with the draft, the box
-- still saves (the error becomes a warning in the database log) and the draft
-- catches up the next time the week is opened on Invoices.
--
-- Only ADDS one function, one trigger function and six triggers. How drafts are
-- built, numbered, finalized and voided doesn't change. A finalized invoice is
-- never touched (it still shows "Packing changed after this invoice was
-- finalized"). Each change to a location's packing rewrites its draft lines,
-- so the audit log gets more invoice line entries.
--
-- Undo: supabase/rollback/20261115000200_revert.sql

-- One location's draft, brought up to date with its packing. As
-- sync_invoice_drafts() does for the whole week: a draft is made when the
-- location is packed and has no invoice yet (a voided one is reissued by hand);
-- a draft with nothing packed goes, unless someone added a line or a note.
create or replace function public.draft_for_location(p_week date, p_customer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- One at a time per week, as sync_invoice_drafts().
  perform pg_advisory_xact_lock(hashtext('invoices:' || p_week::text));

  if public.location_packed(p_week, p_customer)
    and not exists (select 1 from public.invoices where week_id = p_week and customer_id = p_customer) then
    insert into public.invoices (week_id, customer_id, invoice_date, made_by)
    values (p_week, p_customer, p_week + 1, auth.uid());
  end if;

  select id into v_id from public.invoices
  where week_id = p_week and customer_id = p_customer and status = 'draft';
  if v_id is null then
    return;
  end if;

  if not public.location_packed(p_week, p_customer) then
    delete from public.invoices i
    where i.id = v_id
      and btrim(i.memo) = ''
      and not exists (select 1 from public.invoice_lines l where l.invoice_id = i.id and l.kind = 'manual');
    if not found then
      perform public.sync_invoice_draft(v_id);
    end if;
    return;
  end if;
  perform public.sync_invoice_draft(v_id);
end;
$$;
revoke execute on function public.draft_for_location(date, uuid) from public, anon, authenticated;
grant execute on function public.draft_for_location(date, uuid) to service_role;

-- After a statement changes packing: each location it touched, once.
create or replace function public.packing_drafts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orders uuid[] := '{}';
  v_add uuid[];
  r record;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select array_agg(distinct order_id) into v_add from new_rows where order_id is not null;
    v_orders := v_orders || coalesce(v_add, '{}');
  end if;
  if tg_op in ('DELETE', 'UPDATE') then
    select array_agg(distinct order_id) into v_add from old_rows where order_id is not null;
    v_orders := v_orders || coalesce(v_add, '{}');
  end if;

  for r in
    select distinct o.week_id, o.customer_id from public.orders o where o.id = any (v_orders)
  loop
    begin
      perform public.draft_for_location(r.week_id, r.customer_id);
    exception when others then
      -- Never stop packing: the draft catches up when the week is opened on Invoices.
      raise warning 'Invoice draft not updated (week %, customer %): %', r.week_id, r.customer_id, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;
revoke execute on function public.packing_drafts() from public, anon, authenticated;

create trigger packing_weights_drafts_ins after insert on public.packing_weights
  referencing new table as new_rows for each statement execute function public.packing_drafts();
create trigger packing_weights_drafts_upd after update on public.packing_weights
  referencing old table as old_rows new table as new_rows for each statement execute function public.packing_drafts();
create trigger packing_weights_drafts_del after delete on public.packing_weights
  referencing old table as old_rows for each statement execute function public.packing_drafts();

create trigger packing_lines_drafts_ins after insert on public.packing_lines
  referencing new table as new_rows for each statement execute function public.packing_drafts();
create trigger packing_lines_drafts_upd after update on public.packing_lines
  referencing old table as old_rows new table as new_rows for each statement execute function public.packing_drafts();
create trigger packing_lines_drafts_del after delete on public.packing_lines
  referencing old table as old_rows for each statement execute function public.packing_drafts();
