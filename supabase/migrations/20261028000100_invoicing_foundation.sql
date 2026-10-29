-- Invoicing, stage 1: the foundation (change request 10/28/26, SPEC 15,
-- docs/invoicing-plan.md). Nothing is billed yet and no prices are entered.
--   * Two new permission areas, Invoices and Prices, and a Billing role.
--     Nobody's role changes (everyone stays Admin until Lucas changes it).
--   * The invoice number for each week (weeks.invoice_number): 10/19/26 is
--     3000 and 10/26/26 is 3001. Changeable any time; unique.
--   * Each location's invoice code, bill-to address, terms and box detail
--     (customer_billing). Codes are changeable any time; unique.
--   * Business and remit-to details and the default terms, Net 15
--     (invoice_settings).
--   * A price unit on each product (per lb, per case, per each).
--   * Prices: a default per product and optional customer prices, each with
--     an effective-from date. None are entered.
-- Every new table has Row Level Security and an audit trigger. No new
-- foreign key adds a second link between two tables the app loads together.
-- Undo: supabase/rollback/20261028000100_revert.sql

-- ---------------------------------------------------------------------------
-- Permissions: the Invoices and Prices areas, and the Billing role.
-- ---------------------------------------------------------------------------
create or replace function public.permission_areas()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['calls', 'orders', 'week', 'cutsheet', 'packing', 'halfwhole', 'freezer',
               'customers', 'callnotes', 'downloads', 'setup', 'invoices', 'prices'];
$$;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'office', 'packing', 'viewer', 'billing'));

-- The area checks were written against the old list; re-create them so the
-- new areas are allowed.
alter table public.role_permissions drop constraint if exists role_permissions_role_check;
alter table public.role_permissions add constraint role_permissions_role_check
  check (role in ('office', 'packing', 'viewer', 'billing'));
alter table public.role_permissions drop constraint if exists role_permissions_area_check;
alter table public.role_permissions add constraint role_permissions_area_check
  check (area = any (public.permission_areas()));
alter table public.user_permissions drop constraint if exists user_permissions_area_check;
alter table public.user_permissions add constraint user_permissions_area_check
  check (area = any (public.permission_areas()));

-- Defaults for the new areas. Office and Viewer: Invoices and Prices view
-- for Office, off for Viewer; Packing: off (Packing never sees prices).
insert into public.role_permissions (role, area, level) values
  ('office', 'invoices', 1), ('office', 'prices', 1),
  ('packing', 'invoices', 0), ('packing', 'prices', 0),
  ('viewer', 'invoices', 0), ('viewer', 'prices', 0)
on conflict (role, area) do nothing;

-- Billing: invoices and prices; looks at orders, packing, the week,
-- customers, print and download, and Setup (to reach Prices).
insert into public.role_permissions (role, area, level)
select 'billing', a,
  case a
    when 'invoices' then 2 when 'prices' then 2
    when 'orders' then 1 when 'packing' then 1 when 'week' then 1 when 'customers' then 1
    when 'downloads' then 1 when 'setup' then 1
    else 0
  end
from unnest(public.permission_areas()) a
on conflict (role, area) do nothing;

-- ---------------------------------------------------------------------------
-- The invoice number for each week.
-- ---------------------------------------------------------------------------
alter table public.weeks add column invoice_number int check (invoice_number > 0);
create unique index weeks_invoice_number_key on public.weeks (invoice_number);
comment on column public.weeks.invoice_number is
  'The week''s invoice number (3001 on 10/26/26); each invoice adds the location code: 3001-NEWP. Changeable; unique.';

update public.weeks set invoice_number = 3000 where id = '2026-10-19';
update public.weeks set invoice_number = 3001 where id = '2026-10-26';

-- Billing may set a week's number without being able to change the week.
create or replace function public.set_week_invoice_number(p_week date, p_number int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.can_change('invoices') or public.can_change('week')) then
    raise exception 'Not allowed to change invoice numbers' using errcode = '42501';
  end if;
  if p_number is not null and p_number <= 0 then
    raise exception 'An invoice number is a whole number above 0' using errcode = '22023';
  end if;
  if exists (select 1 from public.weeks where invoice_number = p_number and id <> p_week) then
    raise exception 'Invoice number % is already used by another week', p_number using errcode = '23505';
  end if;
  insert into public.weeks (id, invoice_number) values (p_week, p_number)
  on conflict (id) do update set invoice_number = excluded.invoice_number;
end;
$$;
revoke execute on function public.set_week_invoice_number(date, int) from public, anon;
grant execute on function public.set_week_invoice_number(date, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Each location's billing details.
-- ---------------------------------------------------------------------------
create table public.customer_billing (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  invoice_code text unique check (invoice_code ~ '^[A-Z0-9]{3,5}$'),
  bill_to_address text not null default '',
  terms_days int check (terms_days between 0 and 365),
  box_detail boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
comment on table public.customer_billing is
  'Invoice code (3-5 capitals or digits, changeable), bill-to address (blank: the name only), terms in days (blank: the default), and whether the invoice gets a box detail page.';

create trigger customer_billing_updated_at before update on public.customer_billing
  for each row execute function public.set_updated_at();
create trigger customer_billing_audit after insert or update or delete on public.customer_billing
  for each row execute function public.audit_row('customer_id');

alter table public.customer_billing enable row level security;
create policy "customer_billing: read" on public.customer_billing for select to authenticated
  using ((select public.can_view_any(array['invoices', 'prices', 'customers'])));
create policy "customer_billing: change" on public.customer_billing for all to authenticated
  using ((select public.can_change('invoices'))) with check ((select public.can_change('invoices')));
revoke all on public.customer_billing from anon;
grant select, insert, update, delete on public.customer_billing to authenticated;
grant all on public.customer_billing to service_role;

-- Starting codes (Kathy to approve; changeable). PCC stores: PCC + number.
insert into public.customer_billing (customer_id, invoice_code)
select c.id, v.code
from (values
  ('Emerson', null, 'EMER'), ('Key City', null, 'KEYC'), ('McClendons', null, 'MCCL'),
  ('Newport Ave', null, 'NEWP'), ('Port Townsend', null, 'PTWN'), ('Seven Feathers', null, 'SEVF'),
  ('#05 View Ridge', 'PCC', 'PCC05'), ('#09 Green Lake', 'PCC', 'PCC09'), ('#10 Issaquah', 'PCC', 'PCC10'),
  ('#11 Fremont', 'PCC', 'PCC11'), ('#12 Redmond', 'PCC', 'PCC12'), ('#13 Edmonds', 'PCC', 'PCC13'),
  ('#14 GL Village', 'PCC', 'PCC14'), ('#15 Columbia', 'PCC', 'PCC15'), ('#16 Bothell', 'PCC', 'PCC16'),
  ('#17 Burien', 'PCC', 'PCC17'), ('#18 Ballard', 'PCC', 'PCC18'), ('#19 West Seattle', 'PCC', 'PCC19'),
  ('#20 Bellevue', 'PCC', 'PCC20'), ('#22 Madison Valley', 'PCC', 'PCC22'), ('#23 Kirkland', 'PCC', 'PCC23'),
  ('#24 Central District', 'PCC', 'PCC24')
) as v(name, parent, code)
join public.customers c on c.name = v.name
left join public.customers p on p.id = c.parent_customer_id
where (v.parent is null and c.parent_customer_id is null) or p.name = v.parent
on conflict (customer_id) do nothing;

-- ---------------------------------------------------------------------------
-- Business and remit-to details, and the default terms. One row.
-- ---------------------------------------------------------------------------
create table public.invoice_settings (
  id boolean primary key default true check (id),
  business_name text not null default 'Umpqua Valley Lamb',
  business_address text not null default E'PO Box 1120\nRiddle, OR 97469',
  business_phone text not null default '',
  business_email text not null default '',
  remit_to text not null default '',
  default_terms_days int not null default 15 check (default_terms_days between 0 and 365),
  invoice_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
comment on column public.invoice_settings.remit_to is 'Where to send payment. Blank: the business name and address.';
comment on column public.invoice_settings.invoice_note is 'Printed at the bottom of every invoice (for example "Thank you").';

create trigger invoice_settings_updated_at before update on public.invoice_settings
  for each row execute function public.set_updated_at();
create trigger invoice_settings_audit after insert or update or delete on public.invoice_settings
  for each row execute function public.audit_row();

alter table public.invoice_settings enable row level security;
create policy "invoice_settings: read" on public.invoice_settings for select to authenticated
  using ((select public.can_view_any(array['invoices', 'prices'])));
create policy "invoice_settings: change" on public.invoice_settings for update to authenticated
  using ((select public.can_change('invoices'))) with check ((select public.can_change('invoices')));
revoke all on public.invoice_settings from anon;
grant select, update on public.invoice_settings to authenticated;
grant all on public.invoice_settings to service_role;

insert into public.invoice_settings default values;

-- ---------------------------------------------------------------------------
-- Price unit per product. billed_by_weight is kept (no longer used by the
-- app) so a screen still open on the old version keeps working; a later
-- cleanup drops it.
-- ---------------------------------------------------------------------------
alter table public.products
  add column price_unit text not null default 'lb' check (price_unit in ('lb', 'case', 'each'));
comment on column public.products.price_unit is
  'How it''s billed: lb (the boxes'' net weight), case (one case per box), each (the pieces packed).';
update public.products set price_unit = case when billed_by_weight then 'lb' else 'case' end;

-- ---------------------------------------------------------------------------
-- Prices. A row is a price from a date on: customer_id blank is the default
-- list. An invoice line uses the newest price on or before the invoice date,
-- the customer's own before the default.
-- ---------------------------------------------------------------------------
create table public.prices (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete cascade,
  price numeric(12, 4) not null check (price >= 0),
  effective_from date not null,
  note text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create unique index prices_one_per_day on public.prices
  (product_id, coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), effective_from);
create index prices_customer on public.prices (customer_id) where customer_id is not null;
comment on table public.prices is
  'Price per price unit from effective_from on. customer_id blank: the default price. The newest effective on the invoice date wins, the customer''s own first.';

create trigger prices_updated_at before update on public.prices
  for each row execute function public.set_updated_at();
create trigger prices_audit after insert or update or delete on public.prices
  for each row execute function public.audit_row();

alter table public.prices enable row level security;
create policy "prices: read" on public.prices for select to authenticated
  using ((select public.can_view_any(array['prices', 'invoices'])));
create policy "prices: change" on public.prices for all to authenticated
  using ((select public.can_change('prices'))) with check ((select public.can_change('prices')));
revoke all on public.prices from anon;
grant select, insert, update, delete on public.prices to authenticated;
grant all on public.prices to service_role;

-- Live updates for the new tables.
alter publication supabase_realtime add table
  public.customer_billing,
  public.invoice_settings,
  public.prices;
