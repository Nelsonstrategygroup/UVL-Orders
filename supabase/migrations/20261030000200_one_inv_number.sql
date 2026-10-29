-- One INV# per week (Lucas, 10/29/26): the cut sheet, the manifest and the
-- invoices all show the week's invoice number (weeks.invoice_number). The
-- cut sheet's own INV# (cut_sheets.inv_number) is no longer read or written;
-- a later cleanup drops it. Anyone who can change the cut sheet can now set
-- the week's number from it, as well as Billing (Setup > Invoicing).
--
-- A number already typed on a cut sheet (whole number, not used by another
-- week) is copied onto its week if the week has none. On 10/29/26 only the
-- 10/12 sheet exists, with no INV#, so nothing is copied.

-- Copy any typed cut sheet INV# onto its week.
insert into public.weeks (id, invoice_number)
select cs.week_id, btrim(cs.inv_number)::int
from public.cut_sheets cs
where btrim(cs.inv_number) ~ '^[1-9][0-9]{0,8}$'
  and not exists (select 1 from public.weeks w where w.invoice_number = btrim(cs.inv_number)::int)
on conflict (id) do update set invoice_number = excluded.invoice_number
where public.weeks.invoice_number is null;

comment on column public.cut_sheets.inv_number is
  'No longer used (10/29/26): the INV# is weeks.invoice_number. Kept until a cleanup drops it.';

create or replace function public.set_week_invoice_number(p_week date, p_number int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.can_change('invoices') or public.can_change('week') or public.can_change('cutsheet')) then
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

-- Screens showing the INV# update when it changes.
alter publication supabase_realtime add table public.weeks;
