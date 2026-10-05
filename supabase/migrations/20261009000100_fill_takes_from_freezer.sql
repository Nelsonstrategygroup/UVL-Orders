-- Phase 5 review (Option A): a filled half or whole order takes from the
-- freezer only what the freezer had; the rest was cut fresh. What it took is
-- logged as freezer entries tied to the order, so the freezer log is the one
-- record of what's in the freezer and never goes below zero from a fill.

alter table public.freezer_log
  add column half_whole_order_id uuid references public.half_whole_orders (id) on delete cascade;

create index freezer_log_half_whole_idx on public.freezer_log (half_whole_order_id)
  where half_whole_order_id is not null;

-- Change an order's status. Marking it filled logs p_takes ({product_id: qty},
-- worked out by the app as min(needed, on hand)) as freezer withdrawals for
-- this order. Any other status removes those withdrawals, so Undo and
-- un-filling put the cuts back. One transaction.
create or replace function public.set_half_whole_status(p_id uuid, p_status text, p_takes jsonb default '{}'::jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text;
begin
  if not public.is_staff() then
    raise exception 'Only office and admin users can change half and whole orders.' using errcode = '42501';
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
$$;

-- Saving the form may not mark an order filled (that goes through
-- set_half_whole_status so the freezer is updated). Saving an order as
-- pending or cancelled puts back anything it took from the freezer.
create or replace function public.save_half_whole(p_order jsonb, p_choices jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_order ->> 'id', '')::uuid;
  v_status text := coalesce(p_order ->> 'status', 'pending');
  v_old text;
begin
  if not public.is_staff() then
    raise exception 'Only office and admin users can change half and whole orders.' using errcode = '42501';
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
$$;

revoke execute on function public.set_half_whole_status(uuid, text, jsonb) from public, anon;
grant execute on function public.set_half_whole_status(uuid, text, jsonb) to authenticated, service_role;
