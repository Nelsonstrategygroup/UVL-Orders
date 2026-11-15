-- Prices confirmed (Lucas, 11/14/26): a box per location on Setup > Prices,
-- unchecked by default, with who checked or unchecked it and when. Raven and
-- Kathy haven't confirmed what the non-PCC customers are charged today; an
-- invoice for a location that isn't confirmed shows a warning before it's
-- printed or sent. PCC locations start confirmed.
--
-- Only ADDS one table. Changes no existing table, column or row. One foreign
-- key to customers (deleting a customer deletes its row); no link to profiles.
-- Undo: supabase/rollback/20261114000500_revert.sql

create table public.customer_price_checks (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  confirmed boolean not null default false,
  changed_by uuid default auth.uid(),
  changed_by_name text not null default '',
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
comment on table public.customer_price_checks is
  'Prices confirmed for a location (Setup > Prices). No row: not confirmed. changed_by/_name/_at: who last checked or unchecked it.';

-- Who and when, set by the database from the signed-in person.
create or replace function public.customer_price_checks_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.confirmed is distinct from old.confirmed then
    new.changed_by := auth.uid();
    new.changed_at := now();
    new.changed_by_name := coalesce(
      (select display_name from public.profiles where id = auth.uid()), new.changed_by_name, '');
  end if;
  return new;
end;
$$;

create trigger customer_price_checks_stamp before insert or update on public.customer_price_checks
  for each row execute function public.customer_price_checks_stamp();
create trigger customer_price_checks_updated_at before update on public.customer_price_checks
  for each row execute function public.set_updated_at();
create trigger customer_price_checks_audit after insert or update or delete on public.customer_price_checks
  for each row execute function public.audit_row();

alter table public.customer_price_checks enable row level security;
create policy "customer_price_checks: read" on public.customer_price_checks for select to authenticated
  using ((select public.can_view_any(array['prices', 'invoices'])));
create policy "customer_price_checks: change" on public.customer_price_checks for all to authenticated
  using ((select public.can_change('prices'))) with check ((select public.can_change('prices')));
revoke all on public.customer_price_checks from anon;
grant select, insert, update, delete on public.customer_price_checks to authenticated;
grant all on public.customer_price_checks to service_role;
revoke execute on function public.customer_price_checks_stamp() from public, anon;

-- PCC locations start confirmed.
insert into public.customer_price_checks (customer_id, confirmed, changed_by_name)
select c.id, true, 'Starting setting (Lucas, 11/14/26)'
from public.customers c
join public.customers p on p.id = c.parent_customer_id
where p.name = 'PCC' and p.parent_customer_id is null
on conflict (customer_id) do nothing;

alter publication supabase_realtime add table public.customer_price_checks;
