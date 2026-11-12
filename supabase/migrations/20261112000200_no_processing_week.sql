-- A week with no orders, cutting or packing (Thanksgiving: orders Thu Nov 19,
-- packing Mon Nov 23, 2026; Lucas, 11/11/26). Kathy marks the week "No
-- processing this week" on This week, with a note. Every screen then says so
-- for that week, Calls lists nobody to call, and This week leaves out its
-- steps. Nothing is deleted or blocked: turning it off brings the week back.

alter table public.weeks
  add column no_processing boolean not null default false,
  add column no_processing_note text not null default '';
comment on column public.weeks.no_processing is 'No orders, cutting or packing this week (a holiday). Set on This week; shown on every screen for the week.';
comment on column public.weeks.no_processing_note is 'Why, in a few words ("Thanksgiving").';
