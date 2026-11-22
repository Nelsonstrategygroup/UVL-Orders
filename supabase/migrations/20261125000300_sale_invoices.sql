-- Stand-alone sale invoices (Lucas, 11/20/26; docs/stand-alone-invoices-plan.md).
--
-- An invoice for products sold with no order in the week: boxes pulled from
-- the freezer and sold, say. It's an ordinary invoice with a sale number
-- (invoices.sale_no), so printing, Finalize, Mark sent, Payments, Void,
-- Reopen and Open invoices all work as they do. What's different:
--
-- - Packing never touches it: the live-draft functions don't refill it from
--   the box records and never delete it for "nothing packed". It doesn't
--   count toward one invoice per location per week, so a location can have
--   its weekly invoice and any number of sales in the same week.
-- - It belongs to the order week holding its invoice date. While it's a
--   draft, changing the date moves it to that week (and a new sale number).
-- - Number: the week's number, the location code and -S1, -S2
--   ("3005-EMER-S1"); a reissue adds -R1. Changeable like any number.
-- - Lines: 'inventory' lines (a product, the amount in its price unit, boxes
--   optional), priced from Setup > Prices like a packed line, plus lines
--   added by hand. No freight and no box list from packing at Finalize.
--
-- Adds: invoices.sale_no, sale_number_for(), make_sale_invoice(), the
-- invoices_sale_week trigger. Changes: invoices_one_per_week (sales left
-- out), sync_invoice_draft(), sync_invoice_drafts(), draft_for_location(),
-- invoice_fingerprints(), finalize_invoice(), reissue_invoice(). No existing
-- row changes. No new tables. No new foreign keys.
--
-- Undo: supabase/rollback/20261125000300_revert.sql

-- ---------------------------------------------------------------------------
-- The sale number, and one live invoice per location per week for the rest.
-- ---------------------------------------------------------------------------
alter table public.invoices add column sale_no int check (sale_no > 0);
comment on column public.invoices.sale_no is
  'A stand-alone sale (no order): its number within the location and week (-S1, -S2). Blank: the weekly invoice made from packing.';

drop index public.invoices_one_per_week;
create unique index invoices_one_per_week on public.invoices (week_id, customer_id)
  where status <> 'void' and sale_no is null;
create unique index invoices_one_sale on public.invoices (week_id, customer_id, sale_no)
  where status <> 'void' and sale_no is not null;

-- A sale's product line: an amount above 0 in the product's price unit.
alter table public.invoice_lines add constraint invoice_lines_inventory
  check (kind <> 'inventory' or (quantity > 0 and price_unit is not null));

-- "3005-EMER-S1", "3005-EMER-S1-R1". Null when the week has no number or the location no code.
create or replace function public.sale_number_for(p_week date, p_customer uuid, p_sale int, p_reissue int default 0)
returns text
language sql
stable
set search_path = ''
as $$
  select w.invoice_number::text || '-' || b.invoice_code || '-S' || p_sale::text
    || case when p_reissue > 0 then '-R' || p_reissue::text else '' end
  from public.weeks w, public.customer_billing b
  where w.id = p_week and b.customer_id = p_customer
    and w.invoice_number is not null and b.invoice_code is not null;
$$;
revoke execute on function public.sale_number_for(date, uuid, int, int) from public, anon;
grant execute on function public.sale_number_for(date, uuid, int, int) to authenticated, service_role;

-- The next sale number for a location and week (void ones count, so numbers aren't reused).
create or replace function public.next_sale_no(p_week date, p_customer uuid)
returns int
language sql
stable
set search_path = ''
as $$
  select coalesce(max(sale_no), 0) + 1 from public.invoices
  where week_id = p_week and customer_id = p_customer and sale_no is not null;
$$;
revoke execute on function public.next_sale_no(date, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- New sale: a draft for a customer on a date, in the order week holding it.
-- ---------------------------------------------------------------------------
create or replace function public.make_sale_invoice(p_customer uuid, p_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week date := public.order_week(p_date);
  v_sale int;
  v_id uuid;
begin
  if not public.can_change('invoices') then
    raise exception 'Not allowed to make invoices' using errcode = '42501';
  end if;
  if p_date is null then
    raise exception 'Pick the invoice date.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.customers where id = p_customer) then
    raise exception 'Pick who it''s for.' using errcode = '22023';
  end if;
  if public.week_is_closed(v_week) then
    raise exception 'The week of % is closed on the P&L. Pick another date, or ask an admin to reopen that week.', v_week using errcode = '22023';
  end if;
  insert into public.weeks (id) values (v_week) on conflict (id) do nothing;
  -- One at a time per week, as the weekly drafts.
  perform pg_advisory_xact_lock(hashtext('invoices:' || v_week::text));
  v_sale := public.next_sale_no(v_week, p_customer);
  insert into public.invoices (week_id, customer_id, sale_no, number, invoice_date, made_by)
  values (v_week, p_customer, v_sale, public.sale_number_for(v_week, p_customer, v_sale), p_date, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.make_sale_invoice(uuid, date) from public, anon;
grant execute on function public.make_sale_invoice(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A sale stays a sale. A draft sale whose date moves to another order week
-- goes with it: that week, its next sale number, and the number that goes
-- with them (unless typed by hand). Runs after invoices_guard (by name).
-- ---------------------------------------------------------------------------
create or replace function public.invoices_sale_week()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fn boolean := coalesce(current_setting('uvl.invoice_fn', true), '') = 'on';
  v_week date;
begin
  if old.sale_no is null and new.sale_no is null then
    return new;
  end if;
  if not v_fn and new.sale_no is distinct from old.sale_no then
    raise exception 'A sale invoice stays a sale.' using errcode = '42501';
  end if;
  if new.sale_no is not null and new.status = 'draft' and new.invoice_date is distinct from old.invoice_date then
    v_week := public.order_week(new.invoice_date);
    if v_week <> new.week_id then
      insert into public.weeks (id) values (v_week) on conflict (id) do nothing;
      new.week_id := v_week;
      new.sale_no := public.next_sale_no(v_week, new.customer_id);
      new.reissue := 0;
      if not new.number_by_hand then
        new.number := public.sale_number_for(v_week, new.customer_id, new.sale_no);
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.invoices_sale_week() from public, anon, authenticated;
create trigger invoices_sale_week before update on public.invoices
  for each row execute function public.invoices_sale_week();

-- ---------------------------------------------------------------------------
-- Bring one draft up to date (as in 20261108000100). A sale has nothing from
-- packing: only its number follows the week's (unless typed by hand).
-- ---------------------------------------------------------------------------
create or replace function public.sync_invoice_draft(p_invoice uuid, p_force boolean default false)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v public.invoices%rowtype;
  v_auto text;
begin
  select * into v from public.invoices where id = p_invoice for update;
  if not found or v.status <> 'draft' then
    return;
  end if;
  perform set_config('uvl.invoice_fn', 'on', true);
  if v.sale_no is null and (p_force or v.fingerprint <> public.invoice_fingerprint(v.week_id, v.customer_id)) then
    perform public.refill_invoice_lines(p_invoice);
  end if;
  if not v.number_by_hand then
    v_auto := case
      when v.sale_no is null then public.invoice_number_for(v.week_id, v.customer_id, v.reissue)
      else public.sale_number_for(v.week_id, v.customer_id, v.sale_no, v.reissue)
    end;
    if v_auto is distinct from v.number then
      begin
        update public.invoices set number = v_auto where id = p_invoice;
      exception when unique_violation then
        -- Another invoice has typed this number: keep the old one.
        null;
      end;
    end if;
  end if;
  perform set_config('uvl.invoice_fn', '', true);
end;
$$;
revoke execute on function public.sync_invoice_draft(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The week's drafts, live (as in 20261116000100). A sale doesn't stand in
-- for the location's weekly invoice, and is never deleted for "nothing packed".
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
      and not exists (select 1 from public.invoices i
        where i.week_id = p_week and i.customer_id = o.customer_id and i.sale_no is null)
  loop
    insert into public.invoices (week_id, customer_id, invoice_date, made_by)
    values (p_week, r.customer_id, p_week + 1, auth.uid());
    v_made := v_made + 1;
  end loop;

  -- Nothing packed any more: the draft goes, unless someone added a line or a note.
  delete from public.invoices i
  where i.week_id = p_week and i.status = 'draft' and i.sale_no is null
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
-- After packing changes, one location (as in 20261115000300): sales left out.
-- ---------------------------------------------------------------------------
create or replace function public.draft_for_location(p_week date, p_customer uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_gone int;
  v_src text := current_setting('uvl.source', true);
begin
  -- One at a time per week, as sync_invoice_drafts().
  perform pg_advisory_xact_lock(hashtext('invoices:' || p_week::text));

  if public.location_packed(p_week, p_customer)
    and not exists (select 1 from public.invoices
      where week_id = p_week and customer_id = p_customer and sale_no is null) then
    perform set_config('uvl.source', 'Draft made from packing', true);
    insert into public.invoices (week_id, customer_id, invoice_date, made_by)
    values (p_week, p_customer, p_week + 1, auth.uid());
    perform set_config('uvl.source', coalesce(v_src, ''), true);
  end if;

  select id into v_id from public.invoices
  where week_id = p_week and customer_id = p_customer and status = 'draft' and sale_no is null;
  if v_id is null then
    return;
  end if;

  if not public.location_packed(p_week, p_customer) then
    perform set_config('uvl.source', 'Draft removed: nothing packed', true);
    delete from public.invoices i
    where i.id = v_id
      and btrim(i.memo) = ''
      and not exists (select 1 from public.invoice_lines l where l.invoice_id = i.id and l.kind = 'manual');
    get diagnostics v_gone = row_count;
    perform set_config('uvl.source', coalesce(v_src, ''), true);
    if v_gone > 0 then
      return;
    end if;
  end if;

  -- The refresh itself: a copy of packing, not logged.
  perform set_config('uvl.skip_draft_audit', 'on', true);
  perform public.sync_invoice_draft(v_id);
  perform set_config('uvl.skip_draft_audit', '', true);
exception when others then
  perform set_config('uvl.skip_draft_audit', '', true);
  raise;
end;
$$;
revoke execute on function public.draft_for_location(date, uuid) from public, anon, authenticated;
grant execute on function public.draft_for_location(date, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Fingerprints (as in 20261029000100): a sale has no packing, so its own
-- (blank) fingerprint comes back and it never shows "Packing changed".
-- ---------------------------------------------------------------------------
create or replace function public.invoice_fingerprints(p_week date)
returns table (invoice_id uuid, fingerprint text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view('invoices') then
    raise exception 'Not allowed to see invoices' using errcode = '42501';
  end if;
  return query
    select i.id, case when i.sale_no is null then public.invoice_fingerprint(i.week_id, i.customer_id) else i.fingerprint end
    from public.invoices i
    where i.week_id = p_week;
end;
$$;
revoke execute on function public.invoice_fingerprints(date) from public, anon;
grant execute on function public.invoice_fingerprints(date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Finalize (as in 20261120000100). A sale needs at least one line; it gets
-- no Freight line and no boxes from packing (both come from the location's
-- weekly boxes).
-- ---------------------------------------------------------------------------
create or replace function public.finalize_invoice(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices%rowtype;
  s public.invoice_settings%rowtype;
  b public.customer_billing%rowtype;
  v_n int;
  v_terms int;
  v_name text;
begin
  if not public.can_change('invoices') then
    raise exception 'Not allowed to finalize invoices' using errcode = '42501';
  end if;
  select * into v from public.invoices where id = p_invoice for update;
  if not found then
    raise exception 'That invoice isn''t there any more.' using errcode = 'P0002';
  end if;
  if v.status <> 'draft' then
    raise exception 'This invoice is already finalized.' using errcode = '22023';
  end if;
  -- What's packed now, and the number as it should be.
  perform public.sync_invoice_draft(p_invoice);
  select * into v from public.invoices where id = p_invoice;
  if v.number is null or btrim(v.number) = '' then
    raise exception 'This invoice needs a number first.' using errcode = '22023';
  end if;
  if v.sale_no is not null and not exists (select 1 from public.invoice_lines where invoice_id = p_invoice) then
    raise exception 'Add a product first.' using errcode = '22023';
  end if;
  select count(*) into v_n from public.invoice_lines
  where invoice_id = p_invoice and kind <> 'shorted' and quantity is null;
  if v_n > 0 then
    raise exception '% line(s) need a count (Count needed).', v_n using errcode = '22023';
  end if;
  select count(*) into v_n from public.invoice_lines
  where invoice_id = p_invoice and kind <> 'shorted' and unit_price is null
    and public.price_on(product_id, v.customer_id, v.invoice_date) is null;
  if v_n > 0 then
    raise exception '% line(s) have no price (Price needed). Set them in Setup > Prices.', v_n using errcode = '22023';
  end if;

  -- The prices on the invoice date, onto the lines (still a draft here).
  update public.invoice_lines
  set unit_price = public.price_on(product_id, v.customer_id, v.invoice_date)
  where invoice_id = p_invoice and kind <> 'shorted' and unit_price is null;

  -- Per-carcass charges (Mohawk), one line under each product line that has
  -- one on the invoice date: carcasses x the charge. None when it's 0 (PCC).
  insert into public.invoice_lines (
    invoice_id, kind, product_id, description, ordered_qty, ordered_unit,
    boxes, quantity, price_unit, unit_price, not_on_order, note, sort, detail)
  select p_invoice, 'charge', l.product_id, ch.name, null, '',
    0, coalesce(l.ordered_qty, l.boxes), 'each', ch.amount, false, '', l.sort, ''
  from public.invoice_lines l
  cross join lateral public.charge_on(l.product_id, v.customer_id, v.invoice_date) ch
  where l.invoice_id = p_invoice and l.kind = 'packed' and ch.amount > 0
    and coalesce(l.ordered_qty, l.boxes) > 0;

  -- Freight (Lucas, 11/16/26): one line at the end, when the location (or its
  -- chain) has freight set on the invoice date. Pallets: those carrying its
  -- boxes this week; boxes; lb: the boxes' weight; delivery: 1. Not on a sale.
  insert into public.invoice_lines (
    invoice_id, kind, product_id, description, ordered_qty, ordered_unit,
    boxes, quantity, price_unit, unit_price, not_on_order, note, sort, detail)
  select p_invoice, 'freight', null, 'Freight', null, '',
    0, q.qty, case when f.method = 'per_lb' then 'lb' else 'each' end, f.amount, false, '', 100000, ''
  from public.freight_on(v.customer_id, v.invoice_date) f
  cross join lateral (
    select case f.method
      when 'per_delivery' then 1
      when 'per_box' then count(w.id)
      when 'per_pallet' then count(distinct w.pallet_id)
      when 'per_lb' then coalesce(sum(w.weight), 0)
    end as qty
    from public.packing_weights w
    join public.orders o on o.id = w.order_id
    where o.week_id = v.week_id and o.customer_id = v.customer_id
  ) q
  where v.sale_no is null and f.method <> 'none' and f.amount > 0 and q.qty > 0;

  -- The boxes, as they are now (not on a sale: they're the weekly invoice's).
  insert into public.invoice_boxes (invoice_id, box_id, product_id, weight, lot, pack_date, serial, label_no, case_no, source)
  select p_invoice, w.id, w.product_id, w.weight, w.lot, w.pack_date, w.serial, w.label_no, w.case_no, w.source
  from public.packing_weights w
  join public.orders o on o.id = w.order_id
  where v.sale_no is null and o.week_id = v.week_id and o.customer_id = v.customer_id;

  select * into s from public.invoice_settings limit 1;
  select * into b from public.customer_billing where customer_id = v.customer_id;
  v_terms := coalesce(b.terms_days, s.default_terms_days, 15);
  select coalesce(p.name || ': ', '') || c.name into v_name
  from public.customers c left join public.customers p on p.id = c.parent_customer_id
  where c.id = v.customer_id;

  perform set_config('uvl.invoice_fn', 'on', true);
  update public.invoices set
    status = 'finalized',
    terms_days = v_terms,
    due_date = v.invoice_date + v_terms,
    total = (
      select coalesce(sum(public.invoice_line_total(kind, quantity, unit_price, discount_kind, discount)), 0)
      from public.invoice_lines where invoice_id = p_invoice),
    issued = jsonb_build_object(
      'customer_name', v_name,
      'bill_to', coalesce(b.bill_to_address, ''),
      'box_detail', coalesce(b.box_detail, false),
      'business_name', s.business_name,
      'business_address', s.business_address,
      'business_phone', s.business_phone,
      'business_email', s.business_email,
      'remit_to', s.remit_to,
      'invoice_note', s.invoice_note),
    finalized_at = now(),
    finalized_by = auth.uid()
  where id = p_invoice;
  perform set_config('uvl.invoice_fn', '', true);
end;
$$;
revoke execute on function public.finalize_invoice(uuid) from public, anon;
grant execute on function public.finalize_invoice(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reissue (as in 20261108000100). A sale is reissued as the same sale
-- (-S1-R1) with its lines copied; there's no packing to rebuild from.
-- ---------------------------------------------------------------------------
create or replace function public.reissue_invoice(p_invoice uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices%rowtype;
  v_n int;
  v_base text;
  v_auto text;
  v_number text;
  v_id uuid;
begin
  if not public.can_change('invoices') then
    raise exception 'Not allowed to make invoices' using errcode = '42501';
  end if;
  select * into v from public.invoices where id = p_invoice;
  if not found or v.status <> 'void' then
    raise exception 'Only a void invoice can be reissued.' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoices
    where week_id = v.week_id and customer_id = v.customer_id and status <> 'void'
      and sale_no is not distinct from v.sale_no) then
    raise exception '%', case when v.sale_no is null then 'This location already has an invoice this week.'
      else 'This sale has already been reissued.' end using errcode = '23505';
  end if;
  select coalesce(max(reissue), 0) + 1 into v_n from public.invoices
  where week_id = v.week_id and customer_id = v.customer_id and sale_no is not distinct from v.sale_no;
  v_auto := case
    when v.sale_no is null then public.invoice_number_for(v.week_id, v.customer_id, v_n)
    else public.sale_number_for(v.week_id, v.customer_id, v.sale_no, v_n)
  end;
  v_base := nullif(regexp_replace(coalesce(v.number, ''), '-R[0-9]+$', ''), '');
  v_number := coalesce(v_base || '-R' || v_n, v_auto);
  insert into public.invoices (week_id, customer_id, sale_no, number, number_by_hand, reissue, invoice_date, memo, replaces_id, made_by)
  values (v.week_id, v.customer_id, v.sale_no, v_number, v_number is distinct from v_auto,
    v_n, v.invoice_date, v.memo, v.id, auth.uid())
  returning id into v_id;
  -- The old lines as a start (packing lines keep their discounts; prices come
  -- from the price list again). Charge and Freight lines are added again at
  -- Finalize.
  insert into public.invoice_lines (
    invoice_id, kind, product_id, description, ordered_qty, ordered_unit, boxes, quantity,
    price_unit, unit_price, discount_kind, discount, not_on_order, note, sort, detail)
  select v_id, kind, product_id, description, ordered_qty, ordered_unit, boxes, quantity,
    price_unit, case when kind = 'manual' then unit_price end, discount_kind, discount, not_on_order, note, sort, detail
  from public.invoice_lines where invoice_id = p_invoice and kind not in ('charge', 'freight');
  perform public.sync_invoice_draft(v_id, true);
  return v_id;
end;
$$;
revoke execute on function public.reissue_invoice(uuid) from public, anon;
grant execute on function public.reissue_invoice(uuid) to authenticated, service_role;
