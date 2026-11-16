-- Weekly P&L stage B (Lucas, 11/15/26): adjustments, one-off lines, and
-- attachments. The owners are paid as producers, so a calculated number is
-- never edited in place: a correction is its own line with a reason, who and
-- when, and the P&L shows "calculated + adjustments = total".
--
-- Only ADDS: two tables, two trigger functions, and a private file bucket.
-- Changes no existing table, column or row. Admins only (is_admin()).
--
--   pnl_adjustments   An adjustment to one P&L line for a week (line_key:
--                     income, producer, charge:<name>, category:<id>), or a
--                     one-off income or expense line (kind one_off, a label).
--                     Never deleted: voided with a reason, and still shown.
--   pnl_expense_files Files attached to an expense entry (a bill, a receipt).
--
-- Undo: supabase/rollback/20261115000400_revert.sql

create table public.pnl_adjustments (
  id uuid primary key default gen_random_uuid(),
  week_id date not null check (extract(isodow from week_id) = 1),
  kind text not null check (kind in ('adjustment', 'one_off')),
  line_key text check (line_key is null or line_key = any (array['income', 'producer']) or line_key ~ '^(charge|category):.+$'),
  side text not null check (side in ('income', 'expense')),
  label text not null default '',
  amount numeric(12, 2) not null check (amount <> 0),
  reason text not null check (btrim(reason) <> ''),
  attachment_path text,
  attachment_name text not null default '',
  created_by uuid default auth.uid(),
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  voided_by_name text not null default '',
  void_reason text not null default '',
  updated_at timestamptz,
  constraint pnl_adjustments_line check ((kind = 'one_off') = (line_key is null)),
  constraint pnl_adjustments_label check (kind <> 'one_off' or btrim(label) <> ''),
  constraint pnl_adjustments_side check (line_key is null or side = case when line_key = 'income' then 'income' else 'expense' end),
  constraint pnl_adjustments_void check (voided_at is null or btrim(void_reason) <> '')
);
create index pnl_adjustments_week on public.pnl_adjustments (week_id);
comment on table public.pnl_adjustments is
  'P&L stage B: an adjustment to one line of a week''s P&L (line_key), or a one-off income or expense line (kind one_off, label). amount: + adds to the line, - takes off. Voided, never deleted.';

-- Who and when come from the signed-in person. Once added, only voiding (with
-- a reason) can change a row, and a voided row stays voided.
create or replace function public.pnl_adjustments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := coalesce((select display_name from public.profiles where id = auth.uid()), '');
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_by_name := v_name;
    new.created_at := now();
    new.voided_at := null;
    new.voided_by := null;
    new.voided_by_name := '';
    new.void_reason := '';
    return new;
  end if;
  if old.voided_at is not null then
    raise exception 'This adjustment is voided already.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - array['voided_at', 'voided_by', 'voided_by_name', 'void_reason', 'updated_at'])
    is distinct from (to_jsonb(old) - array['voided_at', 'voided_by', 'voided_by_name', 'void_reason', 'updated_at']) then
    raise exception 'An adjustment can''t be changed. Void it and add a new one.' using errcode = '42501';
  end if;
  if new.voided_at is null then
    raise exception 'Only voiding can change an adjustment.' using errcode = '42501';
  end if;
  new.voided_at := now();
  new.voided_by := auth.uid();
  new.voided_by_name := v_name;
  return new;
end;
$$;

create trigger pnl_adjustments_guard before insert or update on public.pnl_adjustments
  for each row execute function public.pnl_adjustments_guard();
create trigger pnl_adjustments_updated_at before update on public.pnl_adjustments
  for each row execute function public.set_updated_at();
create trigger pnl_adjustments_audit after insert or update or delete on public.pnl_adjustments
  for each row execute function public.audit_row();

alter table public.pnl_adjustments enable row level security;
create policy "pnl_adjustments: read" on public.pnl_adjustments for select to authenticated
  using ((select public.is_admin()));
create policy "pnl_adjustments: add" on public.pnl_adjustments for insert to authenticated
  with check ((select public.is_admin()));
create policy "pnl_adjustments: void" on public.pnl_adjustments for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- No delete policy: an adjustment is voided, never deleted.
revoke all on public.pnl_adjustments from anon;
grant select, insert, update on public.pnl_adjustments to authenticated;
grant all on public.pnl_adjustments to service_role;

-- ---------------------------------------------------------------------------
-- Files on an expense entry
-- ---------------------------------------------------------------------------
create table public.pnl_expense_files (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.pnl_expenses (id) on delete cascade,
  path text not null,
  name text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create index pnl_expense_files_expense on public.pnl_expense_files (expense_id);
comment on table public.pnl_expense_files is 'P&L stage B: a file (bill, receipt) attached to an expense entry, in the private pnl-files bucket.';

create trigger pnl_expense_files_updated_at before update on public.pnl_expense_files
  for each row execute function public.set_updated_at();
create trigger pnl_expense_files_audit after insert or update or delete on public.pnl_expense_files
  for each row execute function public.audit_row();

alter table public.pnl_expense_files enable row level security;
create policy "pnl_expense_files: admin" on public.pnl_expense_files for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.pnl_expense_files from anon;
grant select, insert, update, delete on public.pnl_expense_files to authenticated;
grant all on public.pnl_expense_files to service_role;

alter publication supabase_realtime add table public.pnl_adjustments, public.pnl_expense_files;

-- File bucket: private, admins only; photos and PDFs up to 10 MB. Skipped
-- where Supabase Storage isn't installed (the test database).
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('pnl-files', 'pnl-files', false, 10485760, array['image/jpeg', 'image/webp', 'image/png', 'application/pdf'])
  on conflict (id) do nothing;
  execute $p$
    create policy "pnl-files: read" on storage.objects for select to authenticated
      using (bucket_id = 'pnl-files' and (select public.is_admin()))
  $p$;
  execute $p$
    create policy "pnl-files: add" on storage.objects for insert to authenticated
      with check (bucket_id = 'pnl-files' and (select public.is_admin()))
  $p$;
  execute $p$
    create policy "pnl-files: delete" on storage.objects for delete to authenticated
      using (bucket_id = 'pnl-files' and (select public.is_admin()))
  $p$;
end $$;
