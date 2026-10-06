-- Never leave the app without an admin who can log in. The Users screen
-- checks this too; this makes it hold for any change, including two admins
-- acting at the same moment and deleting the login account itself (which
-- deletes the profile by cascade).

create or replace function public.profiles_keep_an_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active) then
    -- Lock the admin rows so two changes can't both pass the check.
    perform 1 from public.profiles where role = 'admin' and active for update;
    if not exists (
      select 1 from public.profiles p
      where p.id <> old.id and p.role = 'admin' and p.active
    ) then
      raise exception 'This is the only admin who can log in. Make someone else an admin first.'
        using errcode = '23514';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger profiles_keep_an_admin before update or delete on public.profiles
  for each row execute function public.profiles_keep_an_admin();
