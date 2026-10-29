-- Undo 20261030000200_one_inv_number.sql: only Billing and This week can set
-- a week's invoice number again, and weeks leave live updates. The app code
-- of that change reads weeks.invoice_number; to show the cut sheet's own
-- INV# again, revert that commit too. Numbers copied onto weeks stay.
-- Run with: npx supabase db query --linked -f supabase/rollback/20261030000200_revert.sql

begin;
alter publication supabase_realtime drop table public.weeks;
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
comment on column public.cut_sheets.inv_number is null;
delete from supabase_migrations.schema_migrations where version = '20261030000200';
commit;
