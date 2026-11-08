-- Undo 20261109000100_only_if_extra.sql: every order line is firm again (the
-- "Only if extra" setting, what each would get and Kathy's shares are dropped;
-- the lines keep what was asked). The customer default and the partial-fill
-- setting go too. The cut sheet fill and invoices read the asked amount again.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261109000100_revert.sql

begin;
drop trigger if exists order_lines_default_extra on public.order_lines;
drop trigger if exists order_lines_extra_reset on public.order_lines;
drop trigger if exists packing_weights_lock_extra on public.packing_weights;
drop trigger if exists packing_lines_lock_extra on public.packing_lines;
drop function if exists public.order_lines_default_extra();
drop function if exists public.order_lines_extra_reset();
drop function if exists public.lock_extra_fill_box();
drop function if exists public.lock_extra_fill_mark();
drop function if exists public.lock_extra_fill_for(uuid, text);
drop function if exists public.set_extra_fills(date, jsonb);
drop function if exists public.set_extra_choices(date, jsonb);

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
      ceil(sum(public.qty_in_product_unit(x.qty, x.unit, p.unit, p.lb_per_unit) / pc.units_per_cut)) as qty
    from public.cut_set_customers c
    join (
      select o.customer_id, l.product_id, l.qty, l.unit
      from public.orders o join public.order_lines l on l.order_id = o.id
      where o.week_id = v_week
      union all
      select q.customer_id, q.product_id, q.qty, q.unit
      from public.order_requests q
      where q.week_id = v_week
    ) x on x.customer_id = c.customer_id
    join public.products p on p.id = x.product_id
    join public.product_cut_specs pc on pc.product_id = p.id
    where c.set_id = p_set
    group by pc.cut_spec_id
    having ceil(sum(public.qty_in_product_unit(x.qty, x.unit, p.unit, p.lb_per_unit) / pc.units_per_cut)) > 0
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

drop function if exists public.line_will_get(numeric, text, boolean, numeric, text, numeric);
alter table public.order_lines drop column if exists only_if_extra, drop column if exists fill_qty,
  drop column if exists fill_chosen, drop column if exists fill_locked;
alter table public.customers drop column if exists lines_only_if_extra;
alter table public.app_settings drop column if exists extra_fill_partial;
delete from supabase_migrations.schema_migrations where version = '20261109000100';
commit;
