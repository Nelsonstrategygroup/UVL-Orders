-- Live invoice drafts (Lucas, 11/8/26).
--
-- A draft is no longer a copy made once with Make drafts. Until it's
-- finalized, an invoice follows packing: every time the week's invoices are
-- opened or printed, sync_invoice_drafts(week) makes a draft for every
-- location with something packed, brings each draft's packing lines up to
-- date with the box records (lines added by hand and each product's
-- discount kept, as Update from packing did), keeps its number as the week's
-- number plus the location code (unless typed by hand), and drops a draft
-- whose location has nothing packed any more (unless it has added lines or
-- a note). Prices were already looked up live on a draft.
--
-- Finalize brings the draft up to date first, then locks it as before.
-- An admin can reopen a finalized (or sent) invoice with no payments: it
-- becomes a live draft again, its prices and kept boxes cleared, with who
-- and when kept on the invoice (and in the audit log).
--
-- On 11/8/26 the stored drafts (10/26: 20, 11/2: 18) have no hand edits: no
-- added lines, discounts, notes or memos, default dates and numbers. They
-- become live drafts as they are, with number_by_hand off.
--
-- No new foreign keys.

-- ---------------------------------------------------------------------------
-- New columns.
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column number_by_hand boolean not null default false,
  add column reopened_at timestamptz,
  add column reopened_by uuid,
  add column reopened_by_name text not null default '';
comment on column public.invoices.number_by_hand is
  'The number was typed on the invoice. Off: a draft''s number follows the week''s number and the location code.';
comment on column public.invoices.reopened_at is
  'The last time an admin reopened it after finalizing (reopened_by, reopened_by_name: who). Every reopen is in the audit log.';

-- ---------------------------------------------------------------------------
-- The guard: a number typed by hand is kept (blank: back to automatic).
-- Otherwise as before.
-- ---------------------------------------------------------------------------
create or replace function public.invoices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fn boolean := coalesce(current_setting('uvl.invoice_fn', true), '') = 'on';
  v_free text[] := array['invoice_date', 'number', 'number_by_hand', 'due_date', 'updated_at', 'memo'];
begin
  if v_fn then
    return new;
  end if;
  if new.number is distinct from old.number then
    new.number_by_hand := new.number is not null;
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

-- ---------------------------------------------------------------------------
-- Refill sets the fingerprint only; numbers are kept by sync_invoice_draft.
-- ---------------------------------------------------------------------------
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

  update public.invoices set fingerprint = public.invoice_fingerprint(v.week_id, v.customer_id)
  where id = p_invoice;
end;
$$;
revoke execute on function public.refill_invoice_lines(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Bring one draft up to date: its packing lines (when packing changed, or
-- p_force) and its number (unless typed by hand). Writes nothing when it's
-- already up to date, so opening a page doesn't set off live updates.
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
  if p_force or v.fingerprint <> public.invoice_fingerprint(v.week_id, v.customer_id) then
    perform public.refill_invoice_lines(p_invoice);
  end if;
  if not v.number_by_hand then
    v_auto := public.invoice_number_for(v.week_id, v.customer_id, v.reissue);
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

-- What counts as packed for a location this week (boxes, or pieces counted on a per each product).
create or replace function public.location_packed(p_week date, p_customer uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o
    where o.week_id = p_week and o.customer_id = p_customer
      and (
        exists (select 1 from public.packing_weights w where w.order_id = o.id)
        or exists (
          select 1 from public.packing_lines l join public.products p on p.id = l.product_id
          where l.order_id = o.id and p.price_unit = 'each' and l.packed_qty > 0)
      ));
$$;
revoke execute on function public.location_packed(date, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The week's drafts, live: run whenever the week's invoices are opened or
-- printed. Anyone who can see invoices runs it (it only follows packing).
-- Returns how many drafts were made.
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

-- The old buttons, kept working for anything still calling them.
create or replace function public.make_invoice_drafts(p_week date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_change('invoices') then
    raise exception 'Not allowed to make invoices' using errcode = '42501';
  end if;
  return public.sync_invoice_drafts(p_week);
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
  perform public.sync_invoice_draft(p_invoice, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Finalize: up to date with packing first, then as before.
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

-- ---------------------------------------------------------------------------
-- Reopen (admins only): a finalized or sent invoice with no payments goes
-- back to a live draft. Its lines follow packing and the price list again;
-- added lines, discounts, the date, the note and the number stay.
-- ---------------------------------------------------------------------------
create or replace function public.reopen_invoice(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can reopen an invoice.' using errcode = '42501';
  end if;
  select status into v_status from public.invoices where id = p_invoice for update;
  if v_status is null then
    raise exception 'That invoice isn''t there any more.' using errcode = 'P0002';
  end if;
  if v_status not in ('finalized', 'sent') then
    raise exception 'Only a finalized invoice can be reopened.' using errcode = '22023';
  end if;
  if exists (select 1 from public.payments where invoice_id = p_invoice) then
    raise exception 'This invoice has payments. Delete them first, then reopen it.' using errcode = '22023';
  end if;

  perform set_config('uvl.invoice_fn', 'on', true);
  update public.invoices set
    status = 'draft',
    terms_days = null,
    due_date = null,
    total = null,
    issued = null,
    finalized_at = null,
    finalized_by = null,
    sent_at = null,
    sent_by = null,
    reopened_at = now(),
    reopened_by = auth.uid(),
    reopened_by_name = coalesce((select display_name from public.profiles where id = auth.uid()), '')
  where id = p_invoice;
  perform set_config('uvl.invoice_fn', '', true);

  -- Prices from the price list again (lines added by hand keep theirs).
  update public.invoice_lines set unit_price = null
  where invoice_id = p_invoice and kind <> 'manual' and unit_price is not null;
  delete from public.invoice_boxes where invoice_id = p_invoice;
  perform public.sync_invoice_draft(p_invoice, true);
end;
$$;
revoke execute on function public.reopen_invoice(uuid) from public, anon;
grant execute on function public.reopen_invoice(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reissue: as before, the number marked typed when it isn't the automatic one.
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
    where week_id = v.week_id and customer_id = v.customer_id and status <> 'void') then
    raise exception 'This location already has an invoice this week.' using errcode = '23505';
  end if;
  select coalesce(max(reissue), 0) + 1 into v_n from public.invoices
  where week_id = v.week_id and customer_id = v.customer_id;
  v_base := nullif(regexp_replace(coalesce(v.number, ''), '-R[0-9]+$', ''), '');
  v_number := coalesce(v_base || '-R' || v_n, public.invoice_number_for(v.week_id, v.customer_id, v_n));
  insert into public.invoices (week_id, customer_id, number, number_by_hand, reissue, invoice_date, memo, replaces_id, made_by)
  values (v.week_id, v.customer_id, v_number,
    v_number is distinct from public.invoice_number_for(v.week_id, v.customer_id, v_n),
    v_n, v.invoice_date, v.memo, v.id, auth.uid())
  returning id into v_id;
  -- The old lines as a start (packing lines keep their discounts; prices come from the price list again).
  insert into public.invoice_lines (
    invoice_id, kind, product_id, description, ordered_qty, ordered_unit, boxes, quantity,
    price_unit, unit_price, discount_kind, discount, not_on_order, note, sort, detail)
  select v_id, kind, product_id, description, ordered_qty, ordered_unit, boxes, quantity,
    price_unit, case when kind = 'manual' then unit_price end, discount_kind, discount, not_on_order, note, sort, detail
  from public.invoice_lines where invoice_id = p_invoice;
  perform public.sync_invoice_draft(v_id, true);
  return v_id;
end;
$$;
