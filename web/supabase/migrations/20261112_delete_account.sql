-- Lets a signed-in user delete their own account (Konto → "Konto löschen").
-- Run once in the Supabase SQL editor. Without it the app falls back to
-- deleting only the online data and asks the user to write for full deletion.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in';
  end if;
  delete from public.sync_records where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
