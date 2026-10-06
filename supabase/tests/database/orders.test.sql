-- set_order, the customer views, and import_customers (Phase 2).
-- Run with: npx supabase test db  (needs Docker), or see README.

begin;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'orders-office@test.local'),
  ('00000000-0000-4000-8000-0000000000b2', 'orders-packing@test.local'),
  ('00000000-0000-4000-8000-0000000000c3', 'orders-admin@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Office', 'office'),
  ('00000000-0000-4000-8000-0000000000b2', 'Packing', 'packing'),
  ('00000000-0000-4000-8000-0000000000c3', 'Admin', 'admin');
insert into public.products (id, name, unit, group_name) values
  ('t-leg', 'Test leg', 'each', 'Legs'),
  ('t-rack', 'Test rack', 'each', 'Racks');
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000000d4', 'Test Market');

-- As the office user -----------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ select public.set_order('2099-01-05', '00000000-0000-4000-8000-0000000000d4', null, null, '{"t-leg": 4, "t-rack": 2}') $$,
  'office can save an order for a week that does not exist yet'
);
select is(
  (select status from public.orders where week_id = '2099-01-05'),
  'ordered',
  'saving lines on a new order marks it ordered'
);
select is(
  (select sum(qty) from public.order_lines l join public.orders o on o.id = l.order_id where o.week_id = '2099-01-05'),
  6::numeric,
  'both lines were saved'
);

select public.set_order('2099-01-05', '00000000-0000-4000-8000-0000000000d4', null, null, '{"t-leg": 5, "t-rack": 0}');
select is(
  (select string_agg(product_id || '=' || qty, ',') from public.order_lines l join public.orders o on o.id = l.order_id where o.week_id = '2099-01-05'),
  't-leg=5',
  'a line at 0 is removed and changed quantities update'
);

select public.set_order('2099-01-05', '00000000-0000-4000-8000-0000000000d4', 'none', null, '{}');
select is(
  (select status from public.orders where week_id = '2099-01-05'),
  'none',
  'No order this week sets the status'
);
select is_empty(
  $$ select 1 from public.order_lines l join public.orders o on o.id = l.order_id where o.week_id = '2099-01-05' $$,
  'and clears the lines'
);

-- Undo: put back exactly what was there.
select public.set_order('2099-01-05', '00000000-0000-4000-8000-0000000000d4', 'ordered', '', '{"t-leg": 5}');
select is(
  (select o.status || ':' || l.qty from public.orders o join public.order_lines l on l.order_id = o.id where o.week_id = '2099-01-05'),
  'ordered:5',
  'undo restores status and lines together'
);

select public.set_order('2099-01-05', '00000000-0000-4000-8000-0000000000d4', 'callback', 'Wednesday after 10', null);
select is(
  (select status || ':' || notes from public.orders where week_id = '2099-01-05'),
  'callback:Wednesday after 10',
  'status and notes change without touching lines'
);
select isnt_empty(
  $$ select 1 from public.order_lines l join public.orders o on o.id = l.order_id where o.week_id = '2099-01-05' $$,
  'lines are kept when none are sent'
);

select isnt_empty(
  $$ select 1 from public.customer_usual_products where customer_id = '00000000-0000-4000-8000-0000000000d4' and product_id = 't-leg' $$,
  'usual products include what they ordered'
);

-- Explicit times: inside one transaction now() would make both entries tie.
insert into public.contact_log (customer_id, kind, summary, created_at) values ('00000000-0000-4000-8000-0000000000d4', 'call', 'First call', now() - interval '1 day');
insert into public.contact_log (customer_id, kind, summary, follow_up_date, created_at) values ('00000000-0000-4000-8000-0000000000d4', 'note', 'Second', '2099-01-09', now());
select is(
  (select summary from public.customer_last_contact where customer_id = '00000000-0000-4000-8000-0000000000d4'),
  'Second',
  'last contact is the newest entry'
);

select throws_ok(
  $$ select public.import_customers('[{"name":"Shop"}]') $$,
  '42501', null,
  'office cannot import customers'
);

-- As the packing user -------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select throws_ok(
  $$ select public.set_order('2099-01-05', '00000000-0000-4000-8000-0000000000d4', 'none', null, '{}') $$,
  '42501', null,
  'packing cannot change orders'
);
select is_empty(
  $$ select 1 from public.customer_last_contact $$,
  'packing sees no contact log through the view'
);

-- As the admin user -------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}';
select is(
  public.import_customers('[
    {"name":"Fremont","type":"Retail","call_day":"Monday","parent":"Test Chain","notes":"","contacts":[{"name":"Sam","roles":["orders","billing"],"phone":"555","email":""}]},
    {"name":"Test Chain","type":"Wholesale","call_day":null,"parent":null,"notes":"HQ","contacts":[]},
    {"name":"Test Market","type":"Retail","call_day":null,"parent":null,"notes":"","contacts":[]}
  ]'),
  '{"created": 2, "skipped": 1, "parents_created": 0}'::jsonb,
  'import creates the parent from its own row, adds the location, and skips existing customers'
);
select is(
  (select p.type || '|' || p.notes || '|' || c.name || '|' || (select count(*) from public.customer_contacts k where k.customer_id = c.id)
   from public.customers c join public.customers p on p.id = c.parent_customer_id where c.name = 'Fremont'),
  'Wholesale|HQ|Fremont|1',
  'the location is linked to the parent and has its contact'
);

reset role;
select * from finish();
rollback;
