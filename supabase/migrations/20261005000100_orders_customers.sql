-- Phase 2: saving orders, customer views, and the spreadsheet import.
-- Functions run as the caller (security invoker), so Row Level Security
-- still decides what each person may change.

-- ---------------------------------------------------------------------------
-- set_order: save one customer's order for a week in a single transaction.
--   p_status  null = keep the current status (but see below)
--   p_notes   null = keep the current notes
--   p_lines   null = keep the current lines; otherwise the complete set of
--             lines as {"product_id": qty}. Products missing or at 0 are removed.
-- When lines are saved without a status and the order was "todo" or "none",
-- it becomes "ordered" (the prototype's flushOrder rule).
-- Creates the week and the order row when they don't exist yet.
-- ---------------------------------------------------------------------------
create or replace function public.set_order(
  p_week date,
  p_customer uuid,
  p_status text default null,
  p_notes text default null,
  p_lines jsonb default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_new_status text;
  v_has_lines boolean;
begin
  if not public.is_staff() then
    raise exception 'Only office and admin users can change orders.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('todo', 'ordered', 'none', 'callback') then
    raise exception 'Unknown order status: %', p_status using errcode = '22023';
  end if;
  if p_lines is not null and jsonb_typeof(p_lines) <> 'object' then
    raise exception 'Order lines must be an object of product id to quantity.' using errcode = '22023';
  end if;

  insert into public.weeks (id) values (p_week) on conflict (id) do nothing;
  insert into public.orders (week_id, customer_id) values (p_week, p_customer)
    on conflict (week_id, customer_id) do nothing;

  select o.id, o.status into v_id, v_status
  from public.orders o
  where o.week_id = p_week and o.customer_id = p_customer
  for update;

  if p_lines is not null then
    delete from public.order_lines l
    where l.order_id = v_id
      and not exists (
        select 1 from jsonb_each_text(p_lines) e
        where e.key = l.product_id and e.value::numeric > 0
      );

    insert into public.order_lines (order_id, product_id, qty)
    select v_id, e.key, e.value::numeric
    from jsonb_each_text(p_lines) e
    where e.value::numeric > 0
    on conflict (order_id, product_id) do update
      set qty = excluded.qty
      where public.order_lines.qty is distinct from excluded.qty;
  end if;

  select exists (select 1 from public.order_lines l where l.order_id = v_id) into v_has_lines;

  v_new_status := coalesce(p_status, v_status);
  if p_status is null and v_has_lines and v_status in ('todo', 'none') then
    v_new_status := 'ordered';
  end if;

  update public.orders o
  set status = v_new_status,
      notes = coalesce(p_notes, o.notes)
  where o.id = v_id
    and (o.status is distinct from v_new_status or (p_notes is not null and o.notes is distinct from p_notes));

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Views. security_invoker makes them follow the caller's RLS, so packing
-- users get nothing from the contact log views.
-- ---------------------------------------------------------------------------

-- Most recent contact log entry per customer (Calls, order editor, Customers).
create view public.customer_last_contact with (security_invoker = true) as
select distinct on (c.customer_id)
  c.customer_id, c.id, c.kind, c.summary, c.created_at, c.created_by
from public.contact_log c
where c.deleted_at is null
order by c.customer_id, c.created_at desc;

-- Open follow-ups per customer (Customers list).
create view public.customer_open_follow_ups with (security_invoker = true) as
select c.customer_id, count(*)::int as open_count
from public.contact_log c
where c.deleted_at is null and c.follow_up_date is not null and not c.follow_up_done
group by c.customer_id;

-- Products each customer has ever ordered ("What they usually buy").
create view public.customer_usual_products with (security_invoker = true) as
select distinct o.customer_id, l.product_id
from public.order_lines l
join public.orders o on o.id = l.order_id;

-- ---------------------------------------------------------------------------
-- import_customers: admin-only spreadsheet import, all or nothing.
-- p_rows: [{name, type, call_day, parent, notes, contacts: [{name, role, phone, email}]}]
-- Parents named in the file are found by name, or created. A customer that
-- already exists (same name, same parent) is skipped, never changed.
-- ---------------------------------------------------------------------------
create or replace function public.import_customers(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r jsonb;
  k jsonb;
  v_parent uuid;
  v_id uuid;
  v_sort int;
  n_created int := 0;
  n_skipped int := 0;
  n_parents int := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins can import customers.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Expected a list of customers.' using errcode = '22023';
  end if;

  -- Customers without a parent first, so a parent listed in the file is
  -- created with its own details before its locations look for it.
  for r in
    select e.value
    from jsonb_array_elements(p_rows) with ordinality as e(value, n)
    order by (coalesce(trim(e.value ->> 'parent'), '') <> ''), e.n
  loop
    if coalesce(trim(r ->> 'name'), '') = '' then
      continue;
    end if;

    v_parent := null;
    if coalesce(trim(r ->> 'parent'), '') <> '' then
      select c.id into v_parent
      from public.customers c
      where c.parent_customer_id is null and lower(trim(c.name)) = lower(trim(r ->> 'parent'))
      order by c.created_at
      limit 1;
      if v_parent is null then
        insert into public.customers (name, type)
        values (trim(r ->> 'parent'), coalesce(nullif(r ->> 'type', ''), 'Other'))
        returning id into v_parent;
        n_parents := n_parents + 1;
      end if;
    end if;

    if exists (
      select 1 from public.customers c
      where lower(trim(c.name)) = lower(trim(r ->> 'name'))
        and c.parent_customer_id is not distinct from v_parent
    ) then
      n_skipped := n_skipped + 1;
      continue;
    end if;

    insert into public.customers (name, type, call_day, notes, parent_customer_id)
    values (
      trim(r ->> 'name'),
      coalesce(nullif(r ->> 'type', ''), 'Other'),
      nullif(r ->> 'call_day', ''),
      coalesce(r ->> 'notes', ''),
      v_parent
    )
    returning id into v_id;

    v_sort := 0;
    for k in select value from jsonb_array_elements(coalesce(r -> 'contacts', '[]'::jsonb)) loop
      insert into public.customer_contacts (customer_id, name, role, phone, email, sort)
      values (
        v_id,
        coalesce(k ->> 'name', ''),
        coalesce(k ->> 'role', ''),
        coalesce(k ->> 'phone', ''),
        coalesce(k ->> 'email', ''),
        v_sort
      );
      v_sort := v_sort + 1;
    end loop;

    n_created := n_created + 1;
  end loop;

  return jsonb_build_object('created', n_created, 'skipped', n_skipped, 'parents_created', n_parents);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke execute on function public.set_order(date, uuid, text, text, jsonb) from public, anon;
grant execute on function public.set_order(date, uuid, text, text, jsonb) to authenticated, service_role;

revoke execute on function public.import_customers(jsonb) from public, anon;
grant execute on function public.import_customers(jsonb) to authenticated, service_role;

revoke all on public.customer_last_contact, public.customer_open_follow_ups, public.customer_usual_products from anon;
grant select on public.customer_last_contact, public.customer_open_follow_ups, public.customer_usual_products to authenticated, service_role;
