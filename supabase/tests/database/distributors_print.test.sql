-- Distributors on the paperwork (migration 20261102000100).

begin;
select plan(6);

select is((select code || '|' || short_name || '|' || color from public.consolidation_points where name = 'Corfini Gourmet'), 'CG|Corfini|#7A3327',
  'Corfini Gourmet: short name, code and barn red');
select throws_ok($$ update public.consolidation_points set color = 'red' where name = 'Corfini Gourmet' $$, '23514', null, 'a color is #RRGGBB');
select throws_ok($$ update public.consolidation_points set code = 'toolong' where name = 'Corfini Gourmet' $$, '23514', null, 'a code is 1 to 4 capitals or digits');
select lives_ok($$ update public.consolidation_points set code = '' where name = 'Corfini Gourmet' $$, 'a code can be blank');
select is((select contact1_name || contact2_phone from public.app_settings limit 1), '', 'contacts start blank');
select is((select count(*)::text from public.consolidation_points where name = 'Corfini Gourmet'), '1', 'one Corfini Gourmet');

select * from finish();
rollback;
