-- Contact roles as checkboxes, billing through a parent, and deleting
-- customers that have never been used.

-- ---------------------------------------------------------------------------
-- Contact roles: Orders, Receiving, Billing (any combination) instead of free
-- text. Existing roles are carried over by matching those words.
-- ---------------------------------------------------------------------------
alter table public.customer_contacts
  add column roles text[] not null default '{}'
  check (roles <@ array['orders', 'receiving', 'billing']::text[]);

update public.customer_contacts
set roles = array(
  select r from unnest(array['orders', 'receiving', 'billing']) as r
  where lower(role) like '%' || r || '%'
     or (r = 'orders' and lower(role) like '%order%')
)
where coalesce(role, '') <> '';

alter table public.customer_contacts drop column role;

-- ---------------------------------------------------------------------------
-- A parent that pays for its locations ("Bills for all locations").
-- ---------------------------------------------------------------------------
alter table public.customers
  add column bills_for_locations boolean not null default false;

-- ---------------------------------------------------------------------------
-- Deleting a customer. Only allowed when nothing points at it: no orders,
-- no contact log entries (even hidden ones), no cut sheet links, and no
-- locations. Otherwise the answer is to untick Active.
-- ---------------------------------------------------------------------------
create or replace function public.customer_delete_check(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'orders', (select count(*) from public.orders o where o.customer_id = p_id),
    'history', (select count(*) from public.contact_log l where l.customer_id = p_id),
    'cut_sheet_links', (select count(*) from public.cut_set_customers s where s.customer_id = p_id),
    'locations', (select count(*) from public.customers c where c.parent_customer_id = p_id)
  );
$$;

create or replace function public.delete_customer(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v jsonb := public.customer_delete_check(p_id);
begin
  if not public.is_staff() then
    raise exception 'Only office and admin users can delete customers.' using errcode = '42501';
  end if;
  if (v ->> 'orders')::int > 0 or (v ->> 'history')::int > 0
     or (v ->> 'cut_sheet_links')::int > 0 or (v ->> 'locations')::int > 0 then
    raise exception 'This customer has records, so it can''t be deleted. Untick Active instead.' using errcode = '23503';
  end if;
  -- Contacts go with the customer (on delete cascade). The audit log keeps both.
  delete from public.customers where id = p_id;
end;
$$;

-- Orders and the contact log already block a delete (on delete restrict).
-- This makes the other two rules hold for any delete, not just the button:
-- a parent keeps its locations, and cut sheet links are never dropped silently.
create or replace function public.customers_before_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.customers c where c.parent_customer_id = old.id) then
    raise exception 'Delete or move its locations first.' using errcode = '23503';
  end if;
  if exists (select 1 from public.cut_set_customers s where s.customer_id = old.id) then
    raise exception 'This customer is linked to a cut sheet set.' using errcode = '23503';
  end if;
  return old;
end;
$$;

create trigger customers_before_delete before delete on public.customers
  for each row execute function public.customers_before_delete();

revoke execute on function public.customer_delete_check(uuid), public.delete_customer(uuid) from public, anon;
grant execute on function public.customer_delete_check(uuid), public.delete_customer(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The spreadsheet import, now with contact roles as a list.
-- p_rows: [{name, type, call_day, parent, notes, contacts: [{name, roles: [...], phone, email}]}]
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
      insert into public.customer_contacts (customer_id, name, roles, phone, email, sort)
      values (
        v_id,
        coalesce(k ->> 'name', ''),
        coalesce(array(select jsonb_array_elements_text(coalesce(k -> 'roles', '[]'::jsonb))), '{}'),
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
