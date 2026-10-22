-- Label numbers and printing for the Box Label Report (change request
-- 10/23/26: Avery 5963 labels).
--
-- Each box row on the report gets a label number for its week (1, 2, 3...),
-- kept with the box it belongs to: customer | product | box number ("key").
-- A number is given out once, in report order, and never reused or moved,
-- so when an order changes the other labels keep their numbers. Printing
-- records when and by whom each label was last printed, with a fingerprint of
-- what it said, so the report can flag "Changed since printed"; every print
-- is logged, first print or reprint.
-- Labels are never edited directly: corrections go through the order.
-- Undo: supabase/rollback/20261023000200_revert.sql

create table public.box_labels (
  week_id date not null references public.weeks (id) on delete cascade,
  number int not null check (number > 0),
  key text not null,
  created_at timestamptz not null default now(),
  printed_at timestamptz,
  printed_by uuid references public.profiles (id),
  -- What the label said when it was last printed (lib/calc/labels.ts LabelRow.print).
  printed_print text,
  primary key (week_id, number),
  unique (week_id, key)
);

create table public.label_prints (
  id uuid primary key default gen_random_uuid(),
  week_id date not null references public.weeks (id) on delete cascade,
  number int not null,
  printed_at timestamptz not null default now(),
  printed_by uuid references public.profiles (id) default auth.uid(),
  reprint boolean not null
);
create index label_prints_week on public.label_prints (week_id, number);

alter table public.box_labels enable row level security;
alter table public.label_prints enable row level security;
create policy "box_labels: read" on public.box_labels for select to authenticated
  using ((select public.can_view_any(array['packing', 'week', 'orders'])));
create policy "box_labels: change" on public.box_labels for all to authenticated
  using ((select public.can_change('packing') or public.can_change('week') or public.can_change('orders')))
  with check ((select public.can_change('packing') or public.can_change('week') or public.can_change('orders')));
create policy "label_prints: read" on public.label_prints for select to authenticated
  using ((select public.can_view_any(array['packing', 'week', 'orders'])));
create policy "label_prints: add" on public.label_prints for insert to authenticated
  with check ((select public.can_change('packing') or public.can_change('week') or public.can_change('orders')));
revoke all on public.box_labels, public.label_prints from anon;
grant select, insert, update on public.box_labels to authenticated, service_role;
grant select, insert on public.label_prints to authenticated, service_role;

create trigger box_labels_audit after insert or update or delete on public.box_labels
  for each row execute function public.audit_row('week_id', 'number');

-- Give a number to every box row that doesn't have one yet, in the order
-- given (the report's order), after the week's highest number. Returns the
-- numbers and print state for the keys asked about.
create or replace function public.assign_box_labels(p_week date, p_keys text[])
returns table (key text, number int, printed_at timestamptz, printed_print text, printed_by_name text)
language plpgsql
set search_path = ''
as $$
declare
  v_next int;
begin
  if not (public.can_change('packing') or public.can_change('week') or public.can_change('orders')) then
    raise exception 'You don''t have permission to number box labels.' using errcode = '42501';
  end if;
  -- One numbering at a time per week, so two screens can't hand out the same number.
  perform pg_advisory_xact_lock(hashtext('box_labels:' || p_week::text));
  insert into public.weeks (id) values (p_week) on conflict (id) do nothing;
  select coalesce(max(b.number), 0) into v_next from public.box_labels b where b.week_id = p_week;
  insert into public.box_labels (week_id, number, key)
  select p_week, v_next + row_number() over (order by k.ord), k.key
  from unnest(p_keys) with ordinality as k(key, ord)
  where not exists (select 1 from public.box_labels b where b.week_id = p_week and b.key = k.key);

  return query
  select b.key, b.number, b.printed_at, b.printed_print, p.display_name
  from public.box_labels b
  left join public.profiles p on p.id = b.printed_by
  where b.week_id = p_week and b.key = any (p_keys);
end;
$$;

-- After printing: log each label (first print or reprint) and remember what it said.
-- p_items: [{"number": 14, "print": "123..."}]
create or replace function public.record_label_print(p_week date, p_items jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not (public.can_change('packing') or public.can_change('week') or public.can_change('orders')) then
    raise exception 'You don''t have permission to print box labels.' using errcode = '42501';
  end if;
  insert into public.label_prints (week_id, number, reprint)
  select p_week, (i ->> 'number')::int, b.printed_at is not null
  from jsonb_array_elements(p_items) i
  join public.box_labels b on b.week_id = p_week and b.number = (i ->> 'number')::int;

  update public.box_labels b
  set printed_at = now(), printed_by = auth.uid(), printed_print = i ->> 'print'
  from jsonb_array_elements(p_items) i
  where b.week_id = p_week and b.number = (i ->> 'number')::int;
end;
$$;

revoke execute on function public.assign_box_labels(date, text[]) from public, anon;
revoke execute on function public.record_label_print(date, jsonb) from public, anon;
grant execute on function public.assign_box_labels(date, text[]) to authenticated, service_role;
grant execute on function public.record_label_print(date, jsonb) to authenticated, service_role;
