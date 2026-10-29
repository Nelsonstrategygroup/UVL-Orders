-- Invoicing stage 2: drafts (SPEC 15, docs/invoicing-plan.md).
--
-- An invoice per location per week, made from the week's box records: one
-- line per product. Per lb bills the sum of the boxes' net weights, per case
-- one case per box, per each the pieces packed (the count typed on Packing;
-- none typed: quantity blank, "Count needed"). An ordered product with
-- nothing packed is a shorted line at $0. A product packed but not ordered is
-- billed and marked "not on the order". Manual lines (a fee, a credit) need a
-- note; any line can take a discount (a dollar amount or a percent) with a
-- note.
--
-- A draft's packed lines carry no price: the screen looks it up on the
-- invoice date (Setup > Prices), so a price entered later shows up at once.
-- Finalizing (stage 3) copies the prices onto the lines.
--
-- A fingerprint of the box records an invoice was made from tells when the
-- packing changed since ("Out of date", Update draft). Updating keeps manual
-- lines and each product's discount.
--
-- No second foreign key between two tables already linked (10/26 outage):
-- invoices -> weeks, invoices -> customers, invoice_lines -> invoices,
-- invoice_lines -> products, one each.

-- ---------------------------------------------------------------------------
-- Invoices.
-- ---------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  week_id date not null references public.weeks (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  number text check (number is null or btrim(number) <> ''),
  reissue int not null default 0 check (reissue >= 0),
  status text not null default 'draft' check (status in ('draft', 'finalized', 'sent', 'void')),
  invoice_date date not null,
  memo text not null default '',
  fingerprint text not null default '',
  made_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create unique index invoices_number_key on public.invoices (number);
-- One live invoice per location per week; a voided one can be reissued.
create unique index invoices_one_per_week on public.invoices (week_id, customer_id) where status <> 'void';
create index invoices_customer on public.invoices (customer_id);
comment on table public.invoices is
  'One per location per week, made from the box records. number: the week number and the location code as made ("3001-NEWP"), changeable, unique; blank when the week has no number or the location no code.';
comment on column public.invoices.fingerprint is
  'The box records, piece counts and order lines it was made from; when it no longer matches, the draft is out of date.';

create trigger invoices_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row execute function public.audit_row();

alter table public.invoices enable row level security;
create policy "invoices: read" on public.invoices for select to authenticated
  using ((select public.can_view('invoices')));
create policy "invoices: add" on public.invoices for insert to authenticated
  with check ((select public.can_change('invoices')));
create policy "invoices: change" on public.invoices for update to authenticated
  using ((select public.can_change('invoices'))) with check ((select public.can_change('invoices')));
-- Only a draft can be deleted; a finalized invoice is voided instead (stage 3).
create policy "invoices: delete draft" on public.invoices for delete to authenticated
  using ((select public.can_change('invoices')) and status = 'draft');
revoke all on public.invoices from anon;
grant select, insert, update, delete on public.invoices to authenticated;
grant all on public.invoices to service_role;

-- ---------------------------------------------------------------------------
-- Invoice lines.
-- ---------------------------------------------------------------------------
create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  kind text not null check (kind in ('packed', 'shorted', 'manual', 'inventory')),
  product_id text references public.products (id) on delete restrict,
  description text not null default '',
  ordered_qty numeric,
  ordered_unit text not null default '',
  boxes int not null default 0 check (boxes >= 0),
  quantity numeric(12, 3),
  price_unit text check (price_unit in ('lb', 'case', 'each')),
  unit_price numeric(12, 4),
  discount_kind text check (discount_kind in ('amount', 'percent')),
  discount numeric(12, 4) check (discount > 0),
  not_on_order boolean not null default false,
  note text not null default '',
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint invoice_lines_product check (kind = 'manual' or product_id is not null),
  constraint invoice_lines_manual check (
    kind <> 'manual' or (btrim(note) <> '' and btrim(description) <> '' and quantity is not null and unit_price is not null)),
  constraint invoice_lines_discount check ((discount_kind is null) = (discount is null)),
  constraint invoice_lines_discount_note check (discount is null or btrim(note) <> ''),
  constraint invoice_lines_percent check (discount_kind is distinct from 'percent' or discount <= 100)
);
create index invoice_lines_invoice on public.invoice_lines (invoice_id);
create index invoice_lines_product on public.invoice_lines (product_id) where product_id is not null;
comment on column public.invoice_lines.quantity is
  'What''s billed: lb (the boxes'' weight), cases (boxes) or pieces (counted on Packing). Blank: Count needed.';
comment on column public.invoice_lines.unit_price is
  'Manual lines: as typed. Packed lines: blank on a draft (the price list on the invoice date), copied in when finalized.';
comment on column public.invoice_lines.discount is
  'A dollar amount, or a percent of the line (rounded half up to the cent). Needs a note.';

create trigger invoice_lines_updated_at before update on public.invoice_lines
  for each row execute function public.set_updated_at();
create trigger invoice_lines_audit after insert or update or delete on public.invoice_lines
  for each row execute function public.audit_row();

-- Lines change only while the invoice is a draft.
create or replace function public.invoice_lines_draft_only()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.invoices
  where id = case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  -- The invoice itself is being deleted (cascade): nothing to protect.
  if v_status is null then
    return coalesce(new, old);
  end if;
  if v_status <> 'draft' then
    raise exception 'This invoice is finalized; its lines can''t change.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger invoice_lines_draft_only before insert or update or delete on public.invoice_lines
  for each row execute function public.invoice_lines_draft_only();

alter table public.invoice_lines enable row level security;
create policy "invoice_lines: read" on public.invoice_lines for select to authenticated
  using ((select public.can_view('invoices')));
create policy "invoice_lines: change" on public.invoice_lines for all to authenticated
  using ((select public.can_change('invoices'))) with check ((select public.can_change('invoices')));
revoke all on public.invoice_lines from anon;
grant select, insert, update, delete on public.invoice_lines to authenticated;
grant all on public.invoice_lines to service_role;

-- ---------------------------------------------------------------------------
-- What a location's invoice is made from, and its fingerprint.
-- ---------------------------------------------------------------------------

-- The lines packing gives for a location's week (no manual lines). Packed:
-- it has boxes, or it's per each with pieces counted.
create or replace function public.invoice_lines_from_packing(p_week date, p_customer uuid)
returns table (
  kind text, product_id text, description text, ordered_qty numeric, ordered_unit text,
  boxes int, quantity numeric, price_unit text, not_on_order boolean, sort int
)
language sql
stable
set search_path = ''
as $$
  with o as (
    select id from public.orders where week_id = p_week and customer_id = p_customer
  ),
  b as (
    select w.product_id, count(*)::int as boxes, sum(w.weight) as lb
    from public.packing_weights w where w.order_id in (select id from o)
    group by w.product_id
  ),
  ol as (
    select l.product_id, sum(l.qty) as qty from public.order_lines l
    where l.order_id in (select id from o) group by l.product_id
  ),
  pl as (
    select l.product_id, sum(l.packed_qty) as packed_qty from public.packing_lines l
    where l.order_id in (select id from o) group by l.product_id
  ),
  ids as (
    select b.product_id from b
    union select ol.product_id from ol
    union select pl.product_id from pl
      join public.products p on p.id = pl.product_id
      where p.price_unit = 'each' and pl.packed_qty > 0
  ),
  x as (
    select
      p.id, p.name, p.unit, p.price_unit, p.sort,
      ol.qty as ordered,
      coalesce(b.boxes, 0) as boxes,
      b.lb,
      pl.packed_qty,
      (b.product_id is not null or (p.price_unit = 'each' and coalesce(pl.packed_qty, 0) > 0)) as went_out
    from ids
    join public.products p on p.id = ids.product_id
    left join b on b.product_id = ids.product_id
    left join ol on ol.product_id = ids.product_id
    left join pl on pl.product_id = ids.product_id
  )
  select
    case when x.went_out then 'packed' else 'shorted' end,
    x.id,
    x.name,
    x.ordered,
    x.unit,
    x.boxes,
    case
      when not x.went_out then 0
      when x.price_unit = 'lb' then round(x.lb, 3)
      when x.price_unit = 'case' then x.boxes
      else round(x.packed_qty, 3)
    end,
    x.price_unit,
    x.went_out and x.ordered is null,
    (row_number() over (order by not x.went_out, x.sort, x.name))::int
  from x
  -- Only the shorted lines of products that were ordered (a count of 0 on
  -- a product not ordered isn't a line).
  where x.went_out or x.ordered is not null;
$$;
revoke execute on function public.invoice_lines_from_packing(date, uuid) from public, anon;
grant execute on function public.invoice_lines_from_packing(date, uuid) to authenticated, service_role;

-- A fingerprint of everything those lines come from: each box (product,
-- weight), the pieces counted, the order lines, and the price units.
create or replace function public.invoice_fingerprint(p_week date, p_customer uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select md5(
    coalesce((
      select string_agg(w.id::text || ':' || w.product_id || ':' || w.weight::text, '|' order by w.id)
      from public.packing_weights w
      join public.orders o on o.id = w.order_id
      where o.week_id = p_week and o.customer_id = p_customer
    ), '') || '#' ||
    coalesce((
      select string_agg(l.product_id || ':' || coalesce(l.packed_qty::text, '-'), '|' order by l.product_id)
      from public.packing_lines l
      join public.orders o on o.id = l.order_id
      where o.week_id = p_week and o.customer_id = p_customer
    ), '') || '#' ||
    coalesce((
      select string_agg(l.product_id || ':' || l.qty::text, '|' order by l.product_id)
      from public.order_lines l
      join public.orders o on o.id = l.order_id
      where o.week_id = p_week and o.customer_id = p_customer
    ), '') || '#' ||
    coalesce((
      select string_agg(p.id || ':' || p.price_unit, '|' order by p.id)
      from public.products p
      where p.id in (
        select w.product_id from public.packing_weights w
        join public.orders o on o.id = w.order_id
        where o.week_id = p_week and o.customer_id = p_customer
        union
        select l.product_id from public.packing_lines l
        join public.orders o on o.id = l.order_id
        where o.week_id = p_week and o.customer_id = p_customer
      )
    ), '')
  );
$$;
revoke execute on function public.invoice_fingerprint(date, uuid) from public, anon;
grant execute on function public.invoice_fingerprint(date, uuid) to authenticated, service_role;

-- Each of a week's invoices with the fingerprint of its box records now.
-- The screen marks a draft out of date when they differ.
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
    select i.id, public.invoice_fingerprint(i.week_id, i.customer_id)
    from public.invoices i
    where i.week_id = p_week;
end;
$$;
revoke execute on function public.invoice_fingerprints(date) from public, anon;
grant execute on function public.invoice_fingerprints(date) to authenticated, service_role;

-- The week number and the location code: "3001-NEWP". Null if either is missing.
create or replace function public.invoice_number_for(p_week date, p_customer uuid, p_reissue int default 0)
returns text
language sql
stable
set search_path = ''
as $$
  select w.invoice_number::text || '-' || b.invoice_code
    || case when p_reissue > 0 then '-R' || p_reissue::text else '' end
  from public.weeks w, public.customer_billing b
  where w.id = p_week and b.customer_id = p_customer
    and w.invoice_number is not null and b.invoice_code is not null;
$$;
revoke execute on function public.invoice_number_for(date, uuid, int) from public, anon;
grant execute on function public.invoice_number_for(date, uuid, int) to authenticated, service_role;

-- Put an invoice's packing lines back as they are now: manual lines stay,
-- and each product keeps its discount and note.
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
    boxes, quantity, price_unit, not_on_order, sort,
    discount_kind, discount, note
  )
  select p_invoice, f.kind, f.product_id, f.description, f.ordered_qty, f.ordered_unit,
    f.boxes, f.quantity, f.price_unit, f.not_on_order, f.sort,
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

-- Make a draft for every location with something packed this week that
-- doesn't have an invoice yet. Returns how many were made.
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
revoke execute on function public.make_invoice_drafts(date) from public, anon;
grant execute on function public.make_invoice_drafts(date) to authenticated, service_role;

-- Update a draft from the box records as they are now.
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
revoke execute on function public.update_invoice_draft(uuid) from public, anon;
grant execute on function public.update_invoice_draft(uuid) to authenticated, service_role;

-- Live updates.
alter table public.invoices replica identity full;
alter table public.invoice_lines replica identity full;
alter publication supabase_realtime add table public.invoices, public.invoice_lines;
