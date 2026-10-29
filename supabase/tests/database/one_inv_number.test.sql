-- One INV# per week (migration 20261030000200): the cut sheet sets the
-- week's invoice number; packing can't.

begin;
select plan(3);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000a5a1', 'inv-office@test.local'),
  ('00000000-0000-4000-8000-00000000a5a2', 'inv-packer@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-00000000a5a1', 'Office', 'office'),
  ('00000000-0000-4000-8000-00000000a5a2', 'Packer', 'packing');
-- Office changes the cut sheet but not invoices.
insert into public.role_permissions (role, area, level) values ('office', 'cutsheet', 2), ('office', 'invoices', 1), ('office', 'week', 1)
  on conflict (role, area) do update set level = excluded.level;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a5a1","role":"authenticated"}';
select lives_ok($$ select public.set_week_invoice_number('2099-12-07', 99501) $$, 'whoever changes the cut sheet sets the INV#');
select is((select invoice_number from public.weeks where id = '2099-12-07')::text, '99501', 'it''s the week''s invoice number');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000a5a2","role":"authenticated"}';
select throws_ok($$ select public.set_week_invoice_number('2099-12-07', 99502) $$, '42501', null, 'packing can''t');

select * from finish();
rollback;
