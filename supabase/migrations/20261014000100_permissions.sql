-- Permissions: roles with default access per area, and per-person overrides.
--
-- Each screen area has a level: 0 Off, 1 View, 2 Change. A role is a set of
-- defaults (role_permissions, editable by an admin on the Users screen); a
-- person can have overrides (user_permissions). The database enforces it:
-- every policy and function below asks can_view(area) / can_change(area)
-- instead of "is this office or admin?".
--
-- Fixed rules, whatever the overrides say:
--   * Admins always have Change everywhere, and only admins manage users,
--     export all data, and change Setup (others get at most View there).
--   * Downloads is View at most (it only reads).

-- ---------------------------------------------------------------------------
-- A view-only role.
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'office', 'packing', 'viewer'));

-- ---------------------------------------------------------------------------
-- The areas, in the order the Users screen lists them.
-- ---------------------------------------------------------------------------
create or replace function public.permission_areas()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['calls', 'orders', 'week', 'cutsheet', 'packing', 'halfwhole', 'freezer',
               'customers', 'callnotes', 'downloads', 'setup'];
$$;

create table public.role_permissions (
  role text not null check (role in ('office', 'packing', 'viewer')),
  area text not null check (area = any (public.permission_areas())),
  level smallint not null check (level between 0 and 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (role, area)
);

create table public.user_permissions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  area text not null check (area = any (public.permission_areas())),
  level smallint not null check (level between 0 and 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (user_id, area)
);

create trigger role_permissions_updated_at before update on public.role_permissions
  for each row execute function public.set_updated_at();
create trigger role_permissions_audit after insert or update or delete on public.role_permissions
  for each row execute function public.audit_row('role', 'area');
create trigger user_permissions_updated_at before update on public.user_permissions
  for each row execute function public.set_updated_at();
create trigger user_permissions_audit after insert or update or delete on public.user_permissions
  for each row execute function public.audit_row('user_id', 'area');

-- Defaults: exactly what each role could do before, plus the new Viewer.
insert into public.role_permissions (role, area, level)
select r.role, a.area,
  case r.role
    when 'office' then case a.area when 'downloads' then 1 when 'setup' then 1 else 2 end
    when 'packing' then case a.area when 'packing' then 2 else 0 end
    when 'viewer' then case a.area when 'setup' then 0 else 1 end
  end
from (values ('office'), ('packing'), ('viewer')) as r(role)
cross join unnest(public.permission_areas()) as a(area);

-- ---------------------------------------------------------------------------
-- The check. Security definer so it can read the permission tables whatever
-- the caller's own access is.
-- ---------------------------------------------------------------------------
create or replace function public.perm(p_area text)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when p.role = 'admin' then 2
      else least(
        coalesce(
          (select u.level from public.user_permissions u where u.user_id = p.id and u.area = p_area),
          (select r.level from public.role_permissions r where r.role = p.role and r.area = p_area),
          0),
        case when p_area in ('setup', 'downloads') then 1 else 2 end)
    end
    from public.profiles p
    where p.id = auth.uid() and p.active
  ), 0)::smallint;
$$;

create or replace function public.can_view(p_area text)
returns boolean language sql stable security definer set search_path = ''
as $$ select public.perm(p_area) >= 1; $$;

create or replace function public.can_change(p_area text)
returns boolean language sql stable security definer set search_path = ''
as $$ select public.perm(p_area) >= 2; $$;

create or replace function public.can_view_any(p_areas text[])
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from unnest(p_areas) a where public.perm(a) >= 1); $$;

-- Everything the logged-in person can do: {area: level}. The screens use it.
create or replace function public.my_permissions()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(a, public.perm(a)), '{}'::jsonb)
  from unnest(public.permission_areas()) a;
$$;

revoke execute on function public.perm(text), public.can_view(text), public.can_change(text),
  public.can_view_any(text[]), public.my_permissions(), public.permission_areas() from public, anon;
grant execute on function public.perm(text), public.can_view(text), public.can_change(text),
  public.can_view_any(text[]), public.my_permissions(), public.permission_areas() to authenticated, service_role;

alter table public.role_permissions enable row level security;
alter table public.user_permissions enable row level security;
create policy "role_permissions: active read" on public.role_permissions
  for select to authenticated using ((select public.is_active_user()));
create policy "role_permissions: admin write" on public.role_permissions
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "user_permissions: own or admin read" on public.user_permissions
  for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy "user_permissions: admin write" on public.user_permissions
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.role_permissions, public.user_permissions from anon;
grant select, insert, update, delete on public.role_permissions, public.user_permissions to authenticated;

-- ---------------------------------------------------------------------------
-- Table rules. (select ...) around each check lets Postgres work it out once
-- per query instead of once per row.
-- ---------------------------------------------------------------------------

-- The catalog: everyone logged in can read it; only Setup can change it.
-- A new cut sheet instruction can also be added from the cut sheet.
do $$
declare t text;
begin
  foreach t in array array['parts', 'products', 'product_part_uses', 'product_cut_specs', 'size_classes', 'cut_specs'] loop
    execute format('drop policy if exists "%1$s: staff all" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: packing read" on public.%1$I', t);
    execute format('create policy "%1$s: read" on public.%1$I for select to authenticated using ((select public.is_active_user()))', t);
    execute format('create policy "%1$s: setup change" on public.%1$I for all to authenticated using ((select public.can_change(''setup''))) with check ((select public.can_change(''setup'')))', t);
  end loop;
end $$;
create policy "cut_specs: cut sheet add" on public.cut_specs
  for insert to authenticated with check ((select public.can_change('cutsheet')));

drop policy "app_settings: staff read" on public.app_settings;
create policy "app_settings: read" on public.app_settings
  for select to authenticated using ((select public.is_active_user()));

-- Customers and contacts.
drop policy "customers: staff all" on public.customers;
drop policy "customers: packing read" on public.customers;
create policy "customers: read" on public.customers for select to authenticated
  using ((select public.can_view_any(array['customers', 'calls', 'orders', 'week', 'cutsheet', 'packing', 'downloads'])));
create policy "customers: change" on public.customers for all to authenticated
  using ((select public.can_change('customers'))) with check ((select public.can_change('customers')));

drop policy "customer_contacts: staff all" on public.customer_contacts;
create policy "customer_contacts: read" on public.customer_contacts for select to authenticated
  using ((select public.can_view_any(array['customers', 'calls', 'orders', 'downloads'])));
create policy "customer_contacts: change" on public.customer_contacts for all to authenticated
  using ((select public.can_change('customers'))) with check ((select public.can_change('customers')));

-- Call notes (the contact log).
drop policy "contact_log: staff read" on public.contact_log;
drop policy "contact_log: staff insert as self" on public.contact_log;
drop policy "contact_log: author update" on public.contact_log;
create policy "contact_log: read" on public.contact_log for select to authenticated
  using ((select public.can_view('callnotes')));
create policy "contact_log: insert as self" on public.contact_log for insert to authenticated
  with check ((select public.can_change('callnotes')) and created_by = (select auth.uid()));
create policy "contact_log: author update" on public.contact_log for update to authenticated
  using ((select public.can_change('callnotes')) and created_by = (select auth.uid()))
  with check ((select public.can_change('callnotes')) and created_by = (select auth.uid()));

-- Weeks, orders, and order lines. Calls and Orders both take orders.
drop policy "weeks: staff all" on public.weeks;
drop policy "weeks: packing read" on public.weeks;
create policy "weeks: read" on public.weeks for select to authenticated
  using ((select public.can_view_any(array['week', 'orders', 'calls', 'packing', 'cutsheet', 'downloads'])));
create policy "weeks: change" on public.weeks for all to authenticated
  using ((select public.can_change('week') or public.can_change('orders') or public.can_change('calls') or public.can_change('cutsheet')))
  with check ((select public.can_change('week') or public.can_change('orders') or public.can_change('calls') or public.can_change('cutsheet')));

drop policy "orders: staff all" on public.orders;
drop policy "orders: packing read" on public.orders;
create policy "orders: read" on public.orders for select to authenticated
  using ((select public.can_view_any(array['orders', 'calls', 'week', 'packing', 'cutsheet', 'customers', 'downloads'])));
create policy "orders: change" on public.orders for all to authenticated
  using ((select public.can_change('orders') or public.can_change('calls')))
  with check ((select public.can_change('orders') or public.can_change('calls')));

drop policy "order_lines: staff all" on public.order_lines;
drop policy "order_lines: packing read" on public.order_lines;
create policy "order_lines: read" on public.order_lines for select to authenticated
  using ((select public.can_view_any(array['orders', 'calls', 'week', 'packing', 'cutsheet', 'customers', 'downloads'])));
create policy "order_lines: change" on public.order_lines for all to authenticated
  using ((select public.can_change('orders') or public.can_change('calls')))
  with check ((select public.can_change('orders') or public.can_change('calls')));

-- Packing.
drop policy "packing_lines: active users all" on public.packing_lines;
drop policy "packing_orders: active users all" on public.packing_orders;
create policy "packing_lines: read" on public.packing_lines for select to authenticated
  using ((select public.can_view_any(array['packing', 'orders', 'week', 'downloads'])));
create policy "packing_lines: change" on public.packing_lines for all to authenticated
  using ((select public.can_change('packing'))) with check ((select public.can_change('packing')));
create policy "packing_orders: read" on public.packing_orders for select to authenticated
  using ((select public.can_view_any(array['packing', 'orders', 'week', 'downloads'])));
create policy "packing_orders: change" on public.packing_orders for all to authenticated
  using ((select public.can_change('packing'))) with check ((select public.can_change('packing')));

-- The cut sheet. This week shows its totals, so Week can read it too.
do $$
declare t text;
begin
  foreach t in array array['cut_sheets', 'cut_sets', 'cut_set_lines', 'cut_sheet_banners', 'cut_set_customers', 'saving_goals'] loop
    execute format('drop policy if exists "%1$s: staff all" on public.%1$I', t);
    execute format('create policy "%1$s: read" on public.%1$I for select to authenticated using ((select public.can_view_any(array[''cutsheet'', ''week'', ''downloads''])))', t);
    execute format('create policy "%1$s: change" on public.%1$I for all to authenticated using ((select public.can_change(''cutsheet''))) with check ((select public.can_change(''cutsheet'')))', t);
  end loop;
end $$;

-- Half and whole orders; the freezer. Marking an order filled logs freezer
-- withdrawals tied to the order, so Half and whole may write those rows.
drop policy "half_whole_orders: staff all" on public.half_whole_orders;
drop policy "half_whole_choices: staff all" on public.half_whole_choices;
create policy "half_whole_orders: read" on public.half_whole_orders for select to authenticated
  using ((select public.can_view_any(array['halfwhole', 'week', 'orders', 'freezer', 'downloads'])));
create policy "half_whole_orders: change" on public.half_whole_orders for all to authenticated
  using ((select public.can_change('halfwhole'))) with check ((select public.can_change('halfwhole')));
create policy "half_whole_choices: read" on public.half_whole_choices for select to authenticated
  using ((select public.can_view_any(array['halfwhole', 'week', 'orders', 'freezer', 'downloads'])));
create policy "half_whole_choices: change" on public.half_whole_choices for all to authenticated
  using ((select public.can_change('halfwhole'))) with check ((select public.can_change('halfwhole')));

drop policy "freezer_log: staff all" on public.freezer_log;
create policy "freezer_log: read" on public.freezer_log for select to authenticated
  using ((select public.can_view_any(array['freezer', 'halfwhole', 'week', 'orders', 'downloads'])));
create policy "freezer_log: change" on public.freezer_log for all to authenticated
  using ((select public.can_change('freezer')) or (half_whole_order_id is not null and (select public.can_change('halfwhole'))))
  with check ((select public.can_change('freezer')) or (half_whole_order_id is not null and (select public.can_change('halfwhole'))));

-- ---------------------------------------------------------------------------
-- Functions: the same bodies as before, with the area check in place of the
-- old office-or-admin check.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_cut_spec(p_text text, p_use_type text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_spec text;
  v_text text := trim(p_text);
begin
  if not (public.can_change('cutsheet') or public.can_change('setup')) then
    raise exception 'You don''t have permission to add instructions.' using errcode = '42501';
  end if;
  if v_text = '' then
    raise exception 'Write the instruction.' using errcode = '22023';
  end if;

  insert into public.cut_specs (text, use_type, sort)
  values (v_text, p_use_type, (select coalesce(max(sort), -1) + 1 from public.cut_specs))
  returning id into v_spec;
  return v_spec;
end;
$function$;

CREATE OR REPLACE FUNCTION public.copy_cut_sheet(p_from date, p_to date)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_sets int := 0;
  s record;
  v_new uuid;
begin
  if not (public.can_change('cutsheet')) then
    raise exception 'You don''t have permission to change the cut sheet.' using errcode = '42501';
  end if;
  if exists (select 1 from public.cut_sheets where week_id = p_to) then
    raise exception 'This week already has a cut sheet.' using errcode = '23505';
  end if;

  insert into public.weeks (id) values (p_to) on conflict (id) do nothing;
  insert into public.cut_sheets (week_id, notes)
  select p_to, c.notes from public.cut_sheets c where c.week_id = p_from;
  if not found then
    raise exception 'There is no cut sheet to copy from that week.' using errcode = 'P0002';
  end if;

  insert into public.cut_sheet_banners (week_id, text, sort)
  select p_to, b.text, b.sort from public.cut_sheet_banners b where b.week_id = p_from;

  for s in select * from public.cut_sets where week_id = p_from order by sort loop
    insert into public.cut_sets (week_id, name, lambs, size_class_id, headline, sort)
    values (p_to, s.name, s.lambs, s.size_class_id, s.headline, s.sort)
    returning id into v_new;

    insert into public.cut_set_lines (set_id, kind, cut_spec_id, qty, text, side_note, highlight, shank_on, sort)
    select v_new, l.kind, l.cut_spec_id, l.qty, l.text, l.side_note, l.highlight, l.shank_on, l.sort
    from public.cut_set_lines l where l.set_id = s.id;

    insert into public.cut_set_customers (set_id, customer_id)
    select v_new, c.customer_id from public.cut_set_customers c where c.set_id = s.id;

    v_sets := v_sets + 1;
  end loop;

  return v_sets;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_customer(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v jsonb := public.customer_delete_check(p_id);
begin
  if not (public.can_change('customers')) then
    raise exception 'You don''t have permission to delete customers.' using errcode = '42501';
  end if;
  if (v ->> 'orders')::int > 0 or (v ->> 'history')::int > 0
     or (v ->> 'cut_sheet_links')::int > 0 or (v ->> 'locations')::int > 0 then
    raise exception 'This customer has records, so it can''t be deleted. Untick Active instead.' using errcode = '23503';
  end if;
  -- Contacts go with the customer (on delete cascade). The audit log keeps both.
  delete from public.customers where id = p_id;
end;
$function$;

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

  for r in
    select pc.cut_spec_id,
      ceil(sum(public.qty_in_product_unit(l.qty, l.unit, p.unit, p.lb_per_unit) / pc.units_per_cut)) as qty
    from public.cut_set_customers c
    join public.orders o on o.customer_id = c.customer_id and o.week_id = v_week
    join public.order_lines l on l.order_id = o.id
    join public.products p on p.id = l.product_id
    join public.product_cut_specs pc on pc.product_id = p.id
    where c.set_id = p_set
    group by pc.cut_spec_id
    having ceil(sum(public.qty_in_product_unit(l.qty, l.unit, p.unit, p.lb_per_unit) / pc.units_per_cut)) > 0
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
      join public.cut_specs sp on sp.id = l.cut_spec_id
      cross join lateral public.cut_use_parts(sp.use_type, l.shank_on) u
      where l.set_id = p_set and l.kind = 'line'
      group by u.part_id
    ) t;
    if coalesce(v_most, 0) > 0 then
      update public.cut_sets set lambs = ceil(v_most / 2) where id = p_set;
    end if;
  end if;

  update public.cut_sets set filled_week = v_week where id = p_set;
  return jsonb_build_object('added', v_added, 'before', v_before);
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_cut_sheet_sent(p_week date, p_hash text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_at timestamptz := now();
begin
  if not (public.can_change('cutsheet')) then
    raise exception 'You don''t have permission to send the cut sheet.' using errcode = '42501';
  end if;
  update public.cut_sheets set sent_at = v_at, sent_hash = p_hash, sent_by = auth.uid() where week_id = p_week;
  return v_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_unsent_cut_sheet(p_week date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if not (public.can_change('cutsheet')) then
    raise exception 'You don''t have permission to change the cut sheet.' using errcode = '42501';
  end if;
  delete from public.cut_sheets where week_id = p_week and sent_at is null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.restore_cut_set(p_snap jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  s jsonb := p_snap -> 'set';
  v_id uuid := (s ->> 'id')::uuid;
begin
  if not (public.can_change('cutsheet')) then
    raise exception 'You don''t have permission to change the cut sheet.' using errcode = '42501';
  end if;

  insert into public.cut_sets (id, week_id, name, lambs, size_class_id, headline, sort, filled_week)
  values (
    v_id, (s ->> 'week_id')::date, coalesce(s ->> 'name', ''), coalesce((s ->> 'lambs')::int, 0),
    s ->> 'size_class_id', coalesce(s ->> 'headline', ''), coalesce((s ->> 'sort')::int, 0),
    (s ->> 'filled_week')::date
  )
  on conflict (id) do update set
    name = excluded.name, lambs = excluded.lambs, size_class_id = excluded.size_class_id,
    headline = excluded.headline, sort = excluded.sort, filled_week = excluded.filled_week;

  delete from public.cut_set_lines where set_id = v_id;
  insert into public.cut_set_lines (id, set_id, kind, cut_spec_id, qty, text, side_note, highlight, shank_on, sort)
  select
    coalesce((l ->> 'id')::uuid, gen_random_uuid()), v_id, l ->> 'kind', l ->> 'cut_spec_id',
    (l ->> 'qty')::numeric, l ->> 'text', coalesce(l ->> 'side_note', ''), l ->> 'highlight',
    coalesce((l ->> 'shank_on')::boolean, false), coalesce((l ->> 'sort')::int, 0)
  from jsonb_array_elements(coalesce(p_snap -> 'lines', '[]'::jsonb)) l;

  delete from public.cut_set_customers where set_id = v_id;
  insert into public.cut_set_customers (set_id, customer_id)
  select v_id, c::uuid
  from jsonb_array_elements_text(coalesce(p_snap -> 'customers', '[]'::jsonb)) c
  where exists (select 1 from public.customers x where x.id = c::uuid);

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_half_whole(p_order jsonb, p_choices jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_id uuid := nullif(p_order ->> 'id', '')::uuid;
  v_status text := coalesce(p_order ->> 'status', 'pending');
  v_old text;
begin
  if not (public.can_change('halfwhole')) then
    raise exception 'You don''t have permission to change half and whole orders.' using errcode = '42501';
  end if;
  if coalesce(trim(p_order ->> 'customer_name'), '') = '' then
    raise exception 'Add the customer''s name.' using errcode = '22023';
  end if;

  if v_id is not null then
    select status into v_old from public.half_whole_orders where id = v_id;
  end if;
  if v_status = 'filled' and coalesce(v_old, '') <> 'filled' then
    raise exception 'Use Mark filled to fill an order.' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.half_whole_orders (customer_name, phone, size, status, need_by, notes)
    values (
      trim(p_order ->> 'customer_name'), coalesce(p_order ->> 'phone', ''), p_order ->> 'size',
      v_status, nullif(p_order ->> 'need_by', '')::date, coalesce(p_order ->> 'notes', '')
    )
    returning id into v_id;
  else
    update public.half_whole_orders set
      customer_name = trim(p_order ->> 'customer_name'),
      phone = coalesce(p_order ->> 'phone', ''),
      size = p_order ->> 'size',
      status = v_status,
      need_by = nullif(p_order ->> 'need_by', '')::date,
      notes = coalesce(p_order ->> 'notes', '')
    where id = v_id;
    if not found then
      raise exception 'That order no longer exists.' using errcode = 'P0002';
    end if;
  end if;

  if v_status <> 'filled' then
    delete from public.freezer_log where half_whole_order_id = v_id;
  end if;

  delete from public.half_whole_choices c
  where c.order_id = v_id
    and not exists (
      select 1 from jsonb_array_elements(coalesce(p_choices, '[]'::jsonb)) x
      where x ->> 'part_id' = c.part_id and (x ->> 'slot')::int = c.slot
    );

  insert into public.half_whole_choices (order_id, part_id, slot, product_id)
  select v_id, x ->> 'part_id', (x ->> 'slot')::int, nullif(x ->> 'product_id', '')
  from jsonb_array_elements(coalesce(p_choices, '[]'::jsonb)) x
  on conflict (order_id, part_id, slot) do update
    set product_id = excluded.product_id
    where public.half_whole_choices.product_id is distinct from excluded.product_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_follow_up_done(p_id uuid, p_done boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (public.can_change('callnotes')) then
    raise exception 'You don''t have permission to mark follow-ups.' using errcode = '42501';
  end if;
  update public.contact_log
  set follow_up_done = p_done
  where id = p_id and deleted_at is null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_half_whole_status(p_id uuid, p_status text, p_takes jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_name text;
begin
  if not (public.can_change('halfwhole')) then
    raise exception 'You don''t have permission to change half and whole orders.' using errcode = '42501';
  end if;
  if p_status not in ('pending', 'filled', 'cancelled') then
    raise exception 'Unknown status: %', p_status using errcode = '22023';
  end if;

  select customer_name into v_name from public.half_whole_orders where id = p_id for update;
  if not found then
    raise exception 'That order no longer exists.' using errcode = 'P0002';
  end if;

  delete from public.freezer_log where half_whole_order_id = p_id;

  if p_status = 'filled' then
    insert into public.freezer_log (product_id, qty, note, half_whole_order_id)
    select e.key, -(e.value::numeric), 'For ' || v_name, p_id
    from jsonb_each_text(coalesce(p_takes, '{}'::jsonb)) e
    where e.value::numeric > 0;
  end if;

  update public.half_whole_orders set status = p_status where id = p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_order(p_week date, p_customer uuid, p_status text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_lines jsonb DEFAULT NULL::jsonb, p_units jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_status text;
  v_new_status text;
  v_has_lines boolean;
begin
  if not (public.can_change('orders') or public.can_change('calls')) then
    raise exception 'You don''t have permission to change orders.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('todo', 'ordered', 'none', 'callback') then
    raise exception 'Unknown order status: %', p_status using errcode = '22023';
  end if;
  if p_lines is not null and jsonb_typeof(p_lines) <> 'object' then
    raise exception 'Order lines must be an object of product id to quantity.' using errcode = '22023';
  end if;
  if p_units is not null and jsonb_typeof(p_units) <> 'object' then
    raise exception 'Units must be an object of product id to unit.' using errcode = '22023';
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

    -- Units: only stored when they differ from the product's own. Without
    -- p_units (the grid, Calls), each line keeps the unit it already had.
    insert into public.order_lines (order_id, product_id, qty, unit)
    select v_id, e.key, e.value::numeric,
      case when p_units is null then null
           else nullif(p_units ->> e.key, (select p.unit from public.products p where p.id = e.key)) end
    from jsonb_each_text(p_lines) e
    where e.value::numeric > 0
    on conflict (order_id, product_id) do update
      set qty = excluded.qty,
          unit = case when p_units is null then public.order_lines.unit else excluded.unit end
      where public.order_lines.qty is distinct from excluded.qty
         or (p_units is not null and public.order_lines.unit is distinct from excluded.unit);
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
$function$;

CREATE OR REPLACE FUNCTION public.start_cut_sheet(p_week date, p_size text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if not (public.can_change('cutsheet')) then
    raise exception 'You don''t have permission to change the cut sheet.' using errcode = '42501';
  end if;
  insert into public.weeks (id) values (p_week) on conflict (id) do nothing;
  insert into public.cut_sheets (week_id) values (p_week);
  insert into public.cut_sets (week_id, size_class_id, sort) values (p_week, p_size, 0);
end;
$function$;
