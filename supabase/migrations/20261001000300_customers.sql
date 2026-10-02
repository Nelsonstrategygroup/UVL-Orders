-- Customers and CRM (4.3).

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'Other' check (type in ('Retail', 'Wholesale', 'Restaurant', 'Distributor', 'Other')),
  call_day text check (call_day in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
  notes text not null default '',
  active boolean not null default true,
  parent_customer_id uuid references public.customers (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  check (parent_customer_id is null or parent_customer_id <> id)
);

create index customers_parent_idx on public.customers (parent_customer_id);

create table public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  name text not null default '',
  role text not null default '',
  phone text not null default '',
  email text not null default '',
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index customer_contacts_customer_idx on public.customer_contacts (customer_id);

-- Contact log: nobody can hard-delete. "Delete" sets deleted_at.
-- Only the author can edit an entry; every edit is kept in audit_log.
create table public.contact_log (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  kind text not null check (kind in ('call', 'email', 'visit', 'note')),
  summary text not null default '',
  follow_up_date date,
  follow_up_note text not null default '',
  follow_up_done boolean not null default false,
  created_by uuid not null default auth.uid() references public.profiles (id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create index contact_log_customer_idx on public.contact_log (customer_id, created_at desc);
create index contact_log_follow_up_idx on public.contact_log (follow_up_date) where not follow_up_done and deleted_at is null;

-- Triggers
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();
create trigger customers_audit after insert or update or delete on public.customers
  for each row execute function public.audit_row();

create trigger customer_contacts_updated_at before update on public.customer_contacts
  for each row execute function public.set_updated_at();
create trigger customer_contacts_audit after insert or update or delete on public.customer_contacts
  for each row execute function public.audit_row();

create trigger contact_log_updated_at before update on public.contact_log
  for each row execute function public.set_updated_at();
create trigger contact_log_audit after insert or update or delete on public.contact_log
  for each row execute function public.audit_row();

-- RLS
alter table public.customers enable row level security;
alter table public.customer_contacts enable row level security;
alter table public.contact_log enable row level security;

create policy "customers: staff all" on public.customers
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "customers: packing read" on public.customers
  for select to authenticated using (public.app_role() = 'packing');

create policy "customer_contacts: staff all" on public.customer_contacts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "contact_log: staff read" on public.contact_log
  for select to authenticated using (public.is_staff());
create policy "contact_log: staff insert as self" on public.contact_log
  for insert to authenticated with check (public.is_staff() and created_by = auth.uid());
create policy "contact_log: author update" on public.contact_log
  for update to authenticated
  using (public.is_staff() and created_by = auth.uid())
  with check (public.is_staff() and created_by = auth.uid());
-- No delete policy: hard deletes are not allowed.

-- Grants
revoke all on public.customers, public.customer_contacts, public.contact_log from anon;
grant select, insert, update, delete on public.customers, public.customer_contacts to authenticated;
grant select, insert, update on public.contact_log to authenticated;
