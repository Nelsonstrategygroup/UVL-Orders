-- Order lines that fill only from extras (Lucas, 11/8/26).
--
-- An order line can be "Only if extra": it doesn't count toward the lamb
-- count, the carcass balance or Le Trim, and gets what's left over after
-- every firm line and Le Trim, up to what was asked. A customer can default
-- its new lines to it (Emerson). What a line will get is worked out by the
-- app (lib/calc/extras.ts, the same calculation as the lamb count) and kept
-- here in fill_qty, so packing, labels, manifests, the cut sheet and
-- invoices all use the same amount. It's worked out again whenever orders
-- change, until packing starts for that line (fill_locked).
--
-- Decided 11/8/26: partial fills (a setting, on by default); half and whole
-- shortfalls stay firm; when lines compete for the same part, Kathy splits
-- what's there (fill_chosen); until she does, they fill in the shared
-- customer order.
--
-- No new foreign keys.

alter table public.customers
  add column lines_only_if_extra boolean not null default false;
comment on column public.customers.lines_only_if_extra is
  'New order lines start as "Only if extra" (Emerson). Any line can still be changed.';

alter table public.order_lines
  add column only_if_extra boolean not null default false,
  add column fill_qty numeric check (fill_qty >= 0),
  add column fill_chosen numeric check (fill_chosen >= 0),
  add column fill_locked boolean not null default false;
comment on column public.order_lines.only_if_extra is
  'Filled only from extras after every firm line and Le Trim; doesn''t count toward the lamb count.';
comment on column public.order_lines.fill_qty is
  'Only if extra: what it will get, in the product''s own unit, kept by the app. Blank: not worked out yet (0).';
comment on column public.order_lines.fill_chosen is
  'Only if extra: Kathy''s share when lines compete for the same extras (product''s unit). Blank: not chosen.';
comment on column public.order_lines.fill_locked is
  'Packing started on this line: what it will get no longer changes.';

alter table public.app_settings
  add column extra_fill_partial boolean not null default true;
comment on column public.app_settings.extra_fill_partial is
  'Only if extra lines can get part of what they asked for. Off: all or none.';

-- ---------------------------------------------------------------------------
-- A new line starts as the customer's default.
-- ---------------------------------------------------------------------------
create or replace function public.order_lines_default_extra()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.only_if_extra then
    select coalesce(c.lines_only_if_extra, false) into new.only_if_extra
    from public.orders o join public.customers c on c.id = o.customer_id
    where o.id = new.order_id;
    new.only_if_extra := coalesce(new.only_if_extra, false);
  end if;
  return new;
end;
$$;
create trigger order_lines_default_extra before insert on public.order_lines
  for each row execute function public.order_lines_default_extra();

-- ---------------------------------------------------------------------------
-- What a line goes out as, in the product's own unit: an only-if-extra line
-- what it will get, any other line what was ordered.
-- ---------------------------------------------------------------------------
create or replace function public.line_will_get(p_qty numeric, p_unit text, p_extra boolean, p_fill numeric, p_product_unit text, p_lb_per_unit numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_extra then coalesce(p_fill, 0)
    else public.qty_in_product_unit(p_qty, p_unit, p_product_unit, p_lb_per_unit) end;
$$;
revoke execute on function public.line_will_get(numeric, text, boolean, numeric, text, numeric) from public, anon;
grant execute on function public.line_will_get(numeric, text, boolean, numeric, text, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Packing started on a line (a box, a count or Not filled): its fill stays.
-- Products packed together (organs) start together.
-- ---------------------------------------------------------------------------
create or replace function public.lock_extra_fill_for(p_order uuid, p_product text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.order_lines l set fill_locked = true
  where l.order_id = p_order and l.only_if_extra and not l.fill_locked
    and public.pack_group_product(l.product_id) = public.pack_group_product(p_product);
$$;
revoke execute on function public.lock_extra_fill_for(uuid, text) from public, anon, authenticated;

-- A box recorded for the line.
create or replace function public.lock_extra_fill_box()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.order_id is not null then
    perform public.lock_extra_fill_for(new.order_id, new.product_id);
  end if;
  return new;
end;
$$;
create trigger packing_weights_lock_extra after insert or update of order_id, product_id on public.packing_weights
  for each row execute function public.lock_extra_fill_box();

-- A count typed, or Not filled.
create or replace function public.lock_extra_fill_mark()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.packed_qty, 0) > 0 or new.shorted then
    perform public.lock_extra_fill_for(new.order_id, new.product_id);
  end if;
  return new;
end;
$$;
create trigger packing_lines_lock_extra after insert or update on public.packing_lines
  for each row execute function public.lock_extra_fill_mark();

-- ---------------------------------------------------------------------------
-- The app keeps the fills current: [{order_id, product_id, qty}]. Only
-- only-if-extra lines that packing hasn't started, and only real changes,
-- so an unchanged week writes nothing. Returns how many changed.
-- ---------------------------------------------------------------------------
create or replace function public.set_extra_fills(p_week date, p_fills jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not public.can_view_any(array['orders', 'calls', 'week']) then
    raise exception 'Not allowed to see orders' using errcode = '42501';
  end if;
  if jsonb_typeof(p_fills) <> 'array' then
    raise exception 'Fills must be a list.' using errcode = '22023';
  end if;
  update public.order_lines l set fill_qty = f.qty
  from jsonb_to_recordset(p_fills) as f(order_id uuid, product_id text, qty numeric), public.orders o
  where l.order_id = f.order_id and l.product_id = f.product_id
    and o.id = l.order_id and o.week_id = p_week
    and l.only_if_extra and not l.fill_locked
    and f.qty >= 0
    and l.fill_qty is distinct from f.qty;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.set_extra_fills(date, jsonb) from public, anon;
grant execute on function public.set_extra_fills(date, jsonb) to authenticated, service_role;

-- Kathy's split of contested extras: [{order_id, product_id, qty}] (qty null clears).
create or replace function public.set_extra_choices(p_week date, p_choices jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.can_change('orders') or public.can_change('calls') or public.can_change('week')) then
    raise exception 'You can''t change orders.' using errcode = '42501';
  end if;
  update public.order_lines l set fill_chosen = f.qty
  from jsonb_to_recordset(p_choices) as f(order_id uuid, product_id text, qty numeric), public.orders o
  where l.order_id = f.order_id and l.product_id = f.product_id
    and o.id = l.order_id and o.week_id = p_week and l.only_if_extra
    and (f.qty is null or f.qty >= 0)
    and l.fill_chosen is distinct from f.qty;
end;
$$;
revoke execute on function public.set_extra_choices(date, jsonb) from public, anon;
grant execute on function public.set_extra_choices(date, jsonb) to authenticated, service_role;

-- A line switched to or from "Only if extra" starts over: no fill, no share.
create or replace function public.order_lines_extra_reset()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.only_if_extra is distinct from old.only_if_extra and not old.fill_locked then
    new.fill_qty := null;
    new.fill_chosen := null;
  end if;
  return new;
end;
$$;
create trigger order_lines_extra_reset before update on public.order_lines
  for each row execute function public.order_lines_extra_reset();

-- ---------------------------------------------------------------------------
-- The cut sheet fills sets with what each line will get.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fill_cut_set(p_set uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_before jsonb;
  v_week date;
  v_lambs int;
  v_sort int;
  v_added int := 0;
  v_requested int := 0;
  v_most numeric;
  r record;
begin
  if not (public.can_change('cutsheet')) then
    raise exception 'You don''t have permission to change the cut sheet.' using errcode = '42501';
  end if;

  select s.week_id, s.lambs into v_week, v_lambs from public.cut_sets s where s.id = p_set for update;
  if v_week is null then
    raise exception 'That set no longer exists.' using errcode = 'P0002';
  end if;
  v_before := public.cut_set_snapshot(p_set);

  select coalesce(max(sort), -1) into v_sort from public.cut_set_lines where set_id = p_set;

  select count(*) into v_requested
  from public.cut_set_customers c
  join public.order_requests q on q.customer_id = c.customer_id and q.week_id = v_week
  where c.set_id = p_set;

  for r in
    select pc.cut_spec_id,
      ceil(sum(x.qty / pc.units_per_cut)) as qty
    from public.cut_set_customers c
    join (
      select o.customer_id, l.product_id,
        public.line_will_get(l.qty, l.unit, l.only_if_extra, l.fill_qty, p.unit, p.lb_per_unit) as qty
      from public.orders o
      join public.order_lines l on l.order_id = o.id
      join public.products p on p.id = l.product_id
      where o.week_id = v_week
      union all
      select q.customer_id, q.product_id, public.qty_in_product_unit(q.qty, q.unit, p.unit, p.lb_per_unit)
      from public.order_requests q
      join public.products p on p.id = q.product_id
      where q.week_id = v_week
    ) x on x.customer_id = c.customer_id
    join public.products p on p.id = x.product_id
    join public.product_cut_specs pc on pc.product_id = p.id
    where c.set_id = p_set
    group by pc.cut_spec_id
    having ceil(sum(x.qty / pc.units_per_cut)) > 0
    order by min(p.sort), min(pc.sort)
  loop
    update public.cut_set_lines
    set qty = coalesce(qty, 0) + r.qty
    where id = (
      select id from public.cut_set_lines
      where set_id = p_set and kind = 'line' and cut_spec_id = r.cut_spec_id
      order by sort limit 1
    );
    if not found then
      v_sort := v_sort + 1;
      insert into public.cut_set_lines (set_id, kind, cut_spec_id, qty, sort)
      values (p_set, 'line', r.cut_spec_id, r.qty, v_sort);
    end if;
    v_added := v_added + 1;
  end loop;

  if coalesce(v_lambs, 0) = 0 then
    select max(t.used) into v_most
    from (
      select u.part_id, sum(coalesce(l.qty, 0) * u.mult) as used
      from public.cut_set_lines l
      left join public.cut_specs sp on sp.id = l.cut_spec_id
      cross join lateral public.cut_use_parts(coalesce(sp.use_type, l.use_type), l.shank_on) u
      where l.set_id = p_set and l.kind = 'line'
      group by u.part_id
    ) t;
    if coalesce(v_most, 0) > 0 then
      update public.cut_sets set lambs = ceil(v_most / 2) where id = p_set;
    end if;
  end if;

  update public.cut_sets set filled_week = v_week where id = p_set;
  return jsonb_build_object('added', v_added, 'before', v_before, 'requested', v_requested);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Invoices: an only-if-extra line is "ordered" as what it will get; one that
-- gets nothing isn't a shorted line. Otherwise as before.
-- ---------------------------------------------------------------------------
drop function if exists public.invoice_lines_from_packing(date, uuid);
create function public.invoice_lines_from_packing(p_week date, p_customer uuid)
returns table (
  kind text, product_id text, description text, ordered_qty numeric, ordered_unit text,
  boxes int, quantity numeric, price_unit text, not_on_order boolean, sort int, detail text
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
    select l.product_id, sum(case when l.only_if_extra then coalesce(l.fill_qty, 0) else l.qty end) as qty
    from public.order_lines l
    where l.order_id in (select id from o)
      and not (l.only_if_extra and coalesce(l.fill_qty, 0) = 0)
    group by l.product_id
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
      p.id, p.name, p.unit, p.sort,
      public.pack_group_product(p.id) as grp,
      btrim(p.packed_with) <> '' as together,
      ol.qty as ordered,
      coalesce(b.boxes, 0) as boxes,
      b.lb,
      pl.packed_qty
    from ids
    join public.products p on p.id = ids.product_id
    left join b on b.product_id = ids.product_id
    left join ol on ol.product_id = ids.product_id
    left join pl on pl.product_id = ids.product_id
  ),
  g as (
    select
      x.grp,
      bool_or(x.together) as together,
      count(*) as members,
      sum(x.boxes)::int as boxes,
      sum(x.lb) as lb,
      sum(x.packed_qty) as packed_qty,
      sum(x.ordered) as ordered,
      bool_or(x.ordered is not null) as any_ordered,
      min(x.sort) as sort,
      string_agg(x.name, ', ' order by x.sort, x.name) as names,
      string_agg(trim_scale(x.packed_qty)::text || ' ' || x.name, ', ' order by x.sort, x.name)
        filter (where x.packed_qty is not null) as counted
    from x group by x.grp
  ),
  y as (
    select g.*, p.price_unit, p.name as grp_name, p.unit as grp_unit,
      (g.boxes > 0 or (p.price_unit = 'each' and coalesce(g.packed_qty, 0) > 0)) as went_out
    from g join public.products p on p.id = g.grp
  )
  select
    case when y.went_out then 'packed' else 'shorted' end,
    y.grp,
    case when y.together then y.names else y.grp_name end,
    -- Packed together: weight only, no ordered amount.
    case when y.together then null else y.ordered end,
    case when y.together then '' else y.grp_unit end,
    y.boxes,
    case
      when not y.went_out then 0
      when y.price_unit = 'lb' then round(y.lb, 3)
      when y.price_unit = 'case' then y.boxes
      else round(y.packed_qty, 3)
    end,
    y.price_unit,
    y.went_out and not y.any_ordered,
    (row_number() over (order by not y.went_out, y.sort, y.names))::int,
    case when y.together and y.went_out then coalesce(y.counted, '') else '' end
  from y
  -- Only the shorted lines of products that were ordered.
  where y.went_out or y.any_ordered;
$$;
revoke execute on function public.invoice_lines_from_packing(date, uuid) from public, anon;
grant execute on function public.invoice_lines_from_packing(date, uuid) to authenticated, service_role;

-- The fingerprint also covers what an only-if-extra line will get (firm
-- lines read exactly as before, so finalized invoices don't show as changed).
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
      select string_agg(l.product_id || ':' || l.qty::text
        || case when l.only_if_extra then ':x' || coalesce(l.fill_qty::text, '0') else '' end, '|' order by l.product_id)
      from public.order_lines l
      join public.orders o on o.id = l.order_id
      where o.week_id = p_week and o.customer_id = p_customer
    ), '') || '#' ||
    coalesce((
      select string_agg(p.id || ':' || p.price_unit || ':' || p.packed_with, '|' order by p.id)
      from public.products p
      where p.id in (
        select w.product_id from public.packing_weights w
        join public.orders o on o.id = w.order_id
        where o.week_id = p_week and o.customer_id = p_customer
        union
        select l.product_id from public.packing_lines l
        join public.orders o on o.id = l.order_id
        where o.week_id = p_week and o.customer_id = p_customer
        union
        select l.product_id from public.order_lines l
        join public.orders o on o.id = l.order_id
        where o.week_id = p_week and o.customer_id = p_customer
      )
    ), '')
  );
$$;
