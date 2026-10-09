-- Cut sheet functions (Phase 4): the 6.3 table, fill a set from orders with
-- undo, copy a sheet, add an instruction, mark as sent, and who may do it.

begin;
select plan(17);

-- The balance parts (present already when the seed has run).
insert into public.parts (id, name, per_lamb, unit, balance_check, sort) values
  ('leg', 'Leg', 2, 'each', true, 0), ('shoulder', 'Shoulder', 2, 'each', true, 1),
  ('rack', 'Rack', 2, 'each', true, 2), ('loin', 'Short loin', 2, 'each', true, 3),
  ('fshank', 'Front shank', 2, 'each', true, 4), ('hshank', 'Hind shank', 2, 'each', true, 5)
on conflict (id) do nothing;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'cs-office@test.local'),
  ('00000000-0000-4000-8000-0000000000b2', 'cs-packing@test.local');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Office', 'office'),
  ('00000000-0000-4000-8000-0000000000b2', 'Packing', 'packing');

insert into public.cut_specs (id, text, use_type) values
  ('t-bi', 'Test legs bone in', 'leg'),
  ('t-wl', 'Test whole loins', 'wholeloin'),
  ('t-fs', 'Test front shanks', 'fshank');
insert into public.products (id, name, unit, group_name, cut_spec_id, sort) values
  ('t-bi', 'Test legs bone in', 'each', 'Legs', 't-bi', 0),
  ('t-wl', 'Test whole loins', 'each', 'Loins', 't-wl', 1),
  ('t-fs', 'Test front shanks', 'each', 'Shanks', 't-fs', 2),
  ('t-ground', 'Test ground', 'lb', 'Ground and trim', null, 3);
-- Customer products link to Mohawk lines through product_cut_specs.
insert into public.product_cut_specs (product_id, cut_spec_id, units_per_cut) values
  ('t-bi', 't-bi', 1), ('t-wl', 't-wl', 1), ('t-fs', 't-fs', 1);
insert into public.customers (id, name) values ('00000000-0000-4000-8000-0000000000c3', 'CS Test Co-op');

insert into public.weeks (id) values ('2099-03-02');
insert into public.orders (id, week_id, customer_id, status)
  values ('00000000-0000-4000-8000-0000000000d4', '2099-03-02', '00000000-0000-4000-8000-0000000000c3', 'ordered');
insert into public.order_lines (order_id, product_id, qty) values
  ('00000000-0000-4000-8000-0000000000d4', 't-bi', 4),
  ('00000000-0000-4000-8000-0000000000d4', 't-wl', 4),
  ('00000000-0000-4000-8000-0000000000d4', 't-fs', 4),
  ('00000000-0000-4000-8000-0000000000d4', 't-ground', 10);

-- 6.3 table ----------------------------------------------------------------------
select is(
  (select string_agg(part_id || '=' || mult, ',' order by part_id) from public.cut_use_parts('allshank')),
  'fshank=0.5,hshank=0.5', 'any shank is half front, half hind');
select is(
  (select string_agg(part_id || '=' || mult, ',' order by part_id) from public.cut_use_parts('leg', true)),
  'hshank=1,leg=1', 'a plain leg with shank on also uses a hind shank');
select is(
  (select count(*)::int from public.cut_use_parts('carcass')), 6, 'a carcass uses all six balance parts');
select is(
  (select count(*)::int from public.cut_use_parts('none')), 0, 'necks and notes use nothing');

-- As the office user ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';

select lives_ok($$ select public.start_cut_sheet('2099-03-02', null) $$, 'office can start a blank sheet');
select is((select count(*)::int from public.cut_sets where week_id = '2099-03-02'), 1, 'a blank sheet has one empty set');

insert into public.cut_set_customers (set_id, customer_id)
select id, '00000000-0000-4000-8000-0000000000c3' from public.cut_sets where week_id = '2099-03-02';
insert into public.cut_set_lines (set_id, kind, cut_spec_id, qty, side_note, shank_on, sort)
select id, 'line', 't-bi', 0, 'keep me', true, 0 from public.cut_sets where week_id = '2099-03-02';

create temp table fill_result on commit drop as
select public.fill_cut_set((select id from public.cut_sets where week_id = '2099-03-02')) as r;

select is((select (r ->> 'added')::int from fill_result), 3, 'three products with cut specs were added; ground lamb was not');
select is(
  (select string_agg(cut_spec_id || '=' || qty || ':' || side_note, ',' order by l.sort)
   from public.cut_set_lines l join public.cut_sets s on s.id = l.set_id where s.week_id = '2099-03-02'),
  't-bi=4:keep me,t-wl=4:,t-fs=4:',
  'an existing line gets the quantity added and keeps its note; new lines go at the end');
select is(
  (select lambs || ':' || filled_week from public.cut_sets where week_id = '2099-03-02'),
  '2:2099-03-02', 'lambs went from 0 to ceil(4 / 2) and the set is marked filled this week');

select public.restore_cut_set((select r -> 'before' from fill_result));
select is(
  (select s.lambs || ':' || coalesce(s.filled_week::text, '-') || ':' || (select count(*) from public.cut_set_lines l where l.set_id = s.id)
     || ':' || (select count(*) from public.cut_set_customers c where c.set_id = s.id)
   from public.cut_sets s where s.week_id = '2099-03-02'),
  '0:-:1:1', 'undo puts the set back exactly, keeping its linked customer');

update public.cut_sheets set inv_number = '9999', pulled_large = 3, sent_at = now(), sent_hash = 'x' where week_id = '2099-03-02';
insert into public.cut_sheet_banners (week_id, text, sort) values ('2099-03-02', 'Banner', 0);
select is(public.copy_cut_sheet('2099-03-02', '2099-03-09'), 1, 'copy duplicates the sets');
select is(
  (select inv_number || ':' || coalesce(pulled_large::text, '-') || ':' || coalesce(sent_at::text, '-')
     || ':' || (select count(*) from public.cut_sheet_banners b where b.week_id = '2099-03-09')
     || ':' || (select count(*) from public.cut_set_lines l join public.cut_sets s on s.id = l.set_id where s.week_id = '2099-03-09')
     || ':' || (select count(*) from public.cut_set_customers c join public.cut_sets s on s.id = c.set_id where s.week_id = '2099-03-09')
   from public.cut_sheets where week_id = '2099-03-09'),
  ':-:-:1:1:1', 'copy clears INV#, pulled counts, and sent; keeps banners, lines, and linked customers');
select throws_ok($$ select public.copy_cut_sheet('2099-03-02', '2099-03-09') $$, '23505', null, 'copy will not overwrite an existing sheet');

create temp table new_spec on commit drop as select public.add_cut_spec('Test osso bucco', 'allshank') as id;
select ok(
  (select s.use_type = 'allshank' and not exists (select 1 from public.products p where p.cut_spec_id = s.id)
   from public.cut_specs s where s.id = (select id from new_spec)),
  'a new instruction is only a cut sheet line; it does not make a product');

select public.mark_cut_sheet_sent('2099-03-09', 'abc');
select is(
  (select sent_by::text || ':' || sent_hash from public.cut_sheets where week_id = '2099-03-09'),
  '00000000-0000-4000-8000-0000000000a1:abc', 'marking sent records who and the fingerprint');

-- As the packing user -------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select throws_ok(
  $$ select public.fill_cut_set((select id from public.cut_sets limit 1)) $$,
  '42501', null, 'packing cannot change the cut sheet');
select throws_ok(
  $$ select public.add_cut_spec('Sneaky', 'leg') $$,
  '42501', null, 'packing cannot add instructions');

reset role;
select * from finish();
rollback;
