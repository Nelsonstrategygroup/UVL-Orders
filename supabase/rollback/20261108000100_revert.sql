-- Undo 20261108000100_live_invoice_drafts.sql: drafts are stored copies again
-- (Make drafts, Update from packing), Finalize refuses an out-of-date draft,
-- and Reopen is gone. Drafts, finalized invoices and their lines stay as they
-- are; a reopened invoice stays a draft. Box records, orders and prices are
-- not touched.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261108000100_revert.sql

begin;
drop function if exists public.reopen_invoice(uuid);
drop function if exists public.sync_invoice_drafts(date);
drop function if exists public.sync_invoice_draft(uuid, boolean);
drop function if exists public.location_packed(date, uuid);

create or replace function public.invoices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fn boolean := coalesce(current_setting('uvl.invoice_fn', true), '') = 'on';
  v_free text[] := array['invoice_date', 'number', 'due_date', 'updated_at', 'memo'];
begin
  if v_fn then
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'Use Finalize, Mark sent or Void to change an invoice.' using errcode = '42501';
  end if;
  if old.status <> 'draft' then
    if (to_jsonb(new) - v_free) is distinct from (to_jsonb(old) - v_free) then
      raise exception 'This invoice is finalized; only its date and number can change.' using errcode = '42501';
    end if;
    if new.memo is distinct from old.memo then
      raise exception 'This invoice is finalized; only its date and number can change.' using errcode = '42501';
    end if;
    if new.invoice_date is distinct from old.invoice_date then
      new.due_date := new.invoice_date + coalesce(new.terms_days, 0);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.refill_invoice_lines(p_invoice uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v public.invoices%rowtype;
  v_manual int;
  v_kept jsonb;
begin
  select * into v from public.invoices where id = p_invoice;
  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', l.product_id, 'discount_kind', l.discount_kind, 'discount', l.discount, 'note', l.note)), '[]')
    into v_kept
    from public.invoice_lines l
    where l.invoice_id = p_invoice and l.kind in ('packed', 'shorted')
      and (l.discount is not null or btrim(l.note) <> '');

  delete from public.invoice_lines where invoice_id = p_invoice and kind in ('packed', 'shorted');

  insert into public.invoice_lines (
    invoice_id, kind, product_id, description, ordered_qty, ordered_unit,
    boxes, quantity, price_unit, not_on_order, sort, detail,
    discount_kind, discount, note
  )
  select p_invoice, f.kind, f.product_id, f.description, f.ordered_qty, f.ordered_unit,
    f.boxes, f.quantity, f.price_unit, f.not_on_order, f.sort, f.detail,
    -- A discount stays only while the product is still billed.
    case when f.kind = 'packed' then k.discount_kind end,
    case when f.kind = 'packed' then k.discount end,
    case when f.kind = 'packed' or k.discount is null then coalesce(k.note, '') else '' end
  from public.invoice_lines_from_packing(v.week_id, v.customer_id) f
  left join jsonb_to_recordset(v_kept) as k(product_id text, discount_kind text, discount numeric, note text)
    on k.product_id = f.product_id;

  -- Manual lines after the packing lines.
  select coalesce(max(sort), 0) into v_manual from public.invoice_lines
  where invoice_id = p_invoice and kind in ('packed', 'shorted');
  update public.invoice_lines l set sort = v_manual + s.n
  from (
    select id, row_number() over (order by sort, created_at) as n
    from public.invoice_lines where invoice_id = p_invoice and kind not in ('packed', 'shorted')
  ) s
  where l.id = s.id and l.sort <> v_manual + s.n;

  update public.invoices set
    fingerprint = public.invoice_fingerprint(v.week_id, v.customer_id),
    number = coalesce(number, public.invoice_number_for(v.week_id, v.customer_id, v.reissue))
  where id = p_invoice;
end;
$$;
revoke execute on function public.refill_invoice_lines(uuid) from public, anon;

create or replace function public.make_invoice_drafts(p_week date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_id uuid;
  v_made int := 0;
begin
  if not public.can_change('invoices') then
    raise exception 'Not allowed to make invoices' using errcode = '42501';
  end if;
  for r in
    select distinct o.customer_id
    from public.orders o
    where o.week_id = p_week
      and (
        exists (select 1 from public.packing_weights w where w.order_id = o.id)
        or exists (
          select 1 from public.packing_lines l join public.products p on p.id = l.product_id
          where l.order_id = o.id and p.price_unit = 'each' and l.packed_qty > 0)
      )
      and not exists (
        select 1 from public.invoices i
        where i.week_id = p_week and i.customer_id = o.customer_id and i.status <> 'void')
  loop
    insert into public.invoices (week_id, customer_id, invoice_date, made_by)
    values (p_week, r.customer_id, p_week + 1, auth.uid())
    returning id into v_id;
    perform public.refill_invoice_lines(v_id);
    v_made := v_made + 1;
  end loop;
  return v_made;
end;
$$;

create or replace function public.update_invoice_draft(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not public.can_change('invoices') then
    raise exception 'Not allowed to change invoices' using errcode = '42501';
  end if;
  select status into v_status from public.invoices where id = p_invoice;
  if v_status is null then
    raise exception 'That invoice isn''t there any more.' using errcode = 'P0002';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only a draft can be updated.' using errcode = '42501';
  end if;
  perform public.refill_invoice_lines(p_invoice);
end;
$$;

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
  if v.number is null or btrim(v.number) = '' then
    raise exception 'This invoice needs a number first.' using errcode = '22023';
  end if;
  if v.fingerprint <> public.invoice_fingerprint(v.week_id, v.customer_id) then
    raise exception 'Packing changed since this draft was made. Update from packing first.' using errcode = '22023';
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

  -- The boxes, as they are now.
  insert into public.invoice_boxes (invoice_id, box_id, product_id, weight, lot, pack_date, serial, label_no, case_no, source)
  select p_invoice, w.id, w.product_id, w.weight, w.lot, w.pack_date, w.serial, w.label_no, w.case_no, w.source
  from public.packing_weights w
  join public.orders o on o.id = w.order_id
  where o.week_id = v.week_id and o.customer_id = v.customer_id;

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
    where week_id = v.week_id and customer_id = v.customer_id and status <> 'void') then
    raise exception 'This location already has an invoice this week.' using errcode = '23505';
  end if;
  select coalesce(max(reissue), 0) + 1 into v_n from public.invoices
  where week_id = v.week_id and customer_id = v.customer_id;
  v_base := nullif(regexp_replace(coalesce(v.number, ''), '-R[0-9]+$', ''), '');
  insert into public.invoices (week_id, customer_id, number, reissue, invoice_date, memo, replaces_id, made_by)
  values (v.week_id, v.customer_id,
    coalesce(v_base || '-R' || v_n, public.invoice_number_for(v.week_id, v.customer_id, v_n)),
    v_n, v.invoice_date, v.memo, v.id, auth.uid())
  returning id into v_id;
  -- The old lines as a start (packing lines keep their discounts; prices come from the price list again).
  insert into public.invoice_lines (
    invoice_id, kind, product_id, description, ordered_qty, ordered_unit, boxes, quantity,
    price_unit, unit_price, discount_kind, discount, not_on_order, note, sort, detail)
  select v_id, kind, product_id, description, ordered_qty, ordered_unit, boxes, quantity,
    price_unit, case when kind = 'manual' then unit_price end, discount_kind, discount, not_on_order, note, sort, detail
  from public.invoice_lines where invoice_id = p_invoice;
  perform public.refill_invoice_lines(v_id);
  return v_id;
end;
$$;

alter table public.invoices
  drop column if exists number_by_hand,
  drop column if exists reopened_at,
  drop column if exists reopened_by,
  drop column if exists reopened_by_name;
delete from supabase_migrations.schema_migrations where version = '20261108000100';
commit;
