-- Requested lines for a later week (change request 10/22/26, part B).
--
-- A customer asks for something that can't be filled this week but can be
-- next week. "Move to next week" takes the line off this week's order and
-- adds it to the customer's next week as a request; Kathy can also request
-- a line for any future week directly. A request:
--   - counts toward that week's lamb count, product totals, and the cut sheet
--     ("Put these on this set"), because it's cut and frozen that week;
--   - is not on Packing or the box labels until it's confirmed, so nothing
--     ships before it's frozen (Lucas, 10/22/26);
--   - leaves the customer "Not called" for that week until confirmed.
-- Confirming adds it to the order as a normal line. Requests live in their
-- own table so saving an order (set_order) never touches them.
-- Undo: supabase/rollback/20261023000100_revert.sql

create table public.order_requests (
  id uuid primary key default gen_random_uuid(),
  week_id date not null references public.weeks (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete cascade,
  product_id text not null references public.products (id) on delete restrict,
  qty numeric not null check (qty > 0),
  -- Taken in another unit than the product's own (like order_lines.unit).
  unit text check (unit in ('each', 'pack', 'lb', 'case')),
  requested_at timestamptz not null default now(),
  requested_by uuid references public.profiles (id) default auth.uid(),
  -- Set when it came from "Move to next week": the week it was moved from.
  moved_from_week date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index order_requests_week on public.order_requests (week_id);
create index order_requests_moved_from on public.order_requests (moved_from_week) where moved_from_week is not null;

alter table public.order_requests enable row level security;
create policy "order_requests: read" on public.order_requests for select to authenticated
  using ((select public.can_view_any(array['orders', 'calls', 'week', 'cutsheet', 'customers', 'downloads'])));
create policy "order_requests: change" on public.order_requests for all to authenticated
  using ((select public.can_change('orders') or public.can_change('calls')))
  with check ((select public.can_change('orders') or public.can_change('calls')));
revoke all on public.order_requests from anon;
grant select, insert, update, delete on public.order_requests to authenticated, service_role;

create trigger order_requests_updated_at before update on public.order_requests
  for each row execute function public.set_updated_at();
create trigger order_requests_audit after insert or update or delete on public.order_requests
  for each row execute function public.audit_row();

alter publication supabase_realtime add table public.order_requests;

-- Add (or add to) a line on a customer's order for a week, as set_order does,
-- and mark the order ordered if it was not called or no order.
create or replace function public.add_to_order(p_week date, p_customer uuid, p_product text, p_qty numeric, p_unit text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (public.can_change('orders') or public.can_change('calls')) then
    raise exception 'You don''t have permission to change orders.' using errcode = '42501';
  end if;
  insert into public.weeks (id) values (p_week) on conflict (id) do nothing;
  insert into public.orders (week_id, customer_id) values (p_week, p_customer)
    on conflict (week_id, customer_id) do nothing;
  select o.id into v_id from public.orders o where o.week_id = p_week and o.customer_id = p_customer for update;
  insert into public.order_lines (order_id, product_id, qty, unit)
  values (v_id, p_product, p_qty, p_unit)
  on conflict (order_id, product_id) do update set qty = public.order_lines.qty + excluded.qty;
  update public.orders set status = 'ordered' where id = v_id and status in ('todo', 'none');
end;
$$;

-- "Move to next week": the line comes off this week's order and becomes a
-- request on the customer's order for the week after. Returns the request.
create or replace function public.move_line_to_next_week(p_week date, p_customer uuid, p_product text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_qty numeric;
  v_unit text;
  v_id uuid;
begin
  if not (public.can_change('orders') or public.can_change('calls')) then
    raise exception 'You don''t have permission to change orders.' using errcode = '42501';
  end if;
  delete from public.order_lines l
  using public.orders o
  where o.id = l.order_id and o.week_id = p_week and o.customer_id = p_customer and l.product_id = p_product
  returning l.qty, l.unit into v_qty, v_unit;
  if v_qty is null then
    raise exception 'That line isn''t on this week''s order any more.' using errcode = 'P0002';
  end if;
  insert into public.weeks (id) values (p_week + 7) on conflict (id) do nothing;
  insert into public.order_requests (week_id, customer_id, product_id, qty, unit, moved_from_week)
  values (p_week + 7, p_customer, p_product, v_qty, v_unit, p_week)
  returning id into v_id;
  return v_id;
end;
$$;

-- Undo "Move to next week": the line goes back on the week it came from.
create or replace function public.undo_move_line(p_request uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  r public.order_requests;
begin
  if not (public.can_change('orders') or public.can_change('calls')) then
    raise exception 'You don''t have permission to change orders.' using errcode = '42501';
  end if;
  delete from public.order_requests where id = p_request returning * into r;
  if r.id is null or r.moved_from_week is null then
    raise exception 'That move can''t be undone any more.' using errcode = 'P0002';
  end if;
  perform public.add_to_order(r.moved_from_week, r.customer_id, r.product_id, r.qty, r.unit);
end;
$$;

-- Request a line for a later week directly. Returns the request.
create or replace function public.request_line(p_week date, p_customer uuid, p_product text, p_qty numeric, p_unit text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not (public.can_change('orders') or public.can_change('calls')) then
    raise exception 'You don''t have permission to change orders.' using errcode = '42501';
  end if;
  insert into public.weeks (id) values (p_week) on conflict (id) do nothing;
  insert into public.order_requests (week_id, customer_id, product_id, qty, unit)
  values (p_week, p_customer, p_product, p_qty, nullif(p_unit, (select p.unit from public.products p where p.id = p_product)))
  returning id into v_id;
  return v_id;
end;
$$;

-- Confirm a request: it becomes a normal line on that week's order (with the
-- amount confirmed on the call, if different).
create or replace function public.confirm_request(p_request uuid, p_qty numeric default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  r public.order_requests;
begin
  if not (public.can_change('orders') or public.can_change('calls')) then
    raise exception 'You don''t have permission to change orders.' using errcode = '42501';
  end if;
  delete from public.order_requests where id = p_request returning * into r;
  if r.id is null then
    raise exception 'That request isn''t there any more.' using errcode = 'P0002';
  end if;
  if coalesce(p_qty, r.qty) > 0 then
    perform public.add_to_order(r.week_id, r.customer_id, r.product_id, coalesce(p_qty, r.qty), r.unit);
  end if;
end;
$$;

revoke execute on function public.add_to_order(date, uuid, text, numeric, text) from public, anon;
grant execute on function public.add_to_order(date, uuid, text, numeric, text) to authenticated, service_role;
revoke execute on function public.move_line_to_next_week(date, uuid, text) from public, anon;
revoke execute on function public.undo_move_line(uuid) from public, anon;
revoke execute on function public.request_line(date, uuid, text, numeric, text) from public, anon;
revoke execute on function public.confirm_request(uuid, numeric) from public, anon;
grant execute on function public.move_line_to_next_week(date, uuid, text) to authenticated, service_role;
grant execute on function public.undo_move_line(uuid) to authenticated, service_role;
grant execute on function public.request_line(date, uuid, text, numeric, text) to authenticated, service_role;
grant execute on function public.confirm_request(uuid, numeric) to authenticated, service_role;

-- "Put these on this set" also adds the linked customers' requests for the
-- week: they're cut and frozen that week (Lucas, 10/22/26). Returns how many
-- requested lines went in, so the screen can say "includes requested".
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
