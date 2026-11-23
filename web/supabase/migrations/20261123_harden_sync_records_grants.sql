-- Defence in depth for public.sync_records. NOT yet applied to production.
-- Row level security already limits every read/write to the owner's rows, but
-- the table also carries broad default grants: anon may touch the table at all,
-- and TRUNCATE / REFERENCES / TRIGGER are not covered by RLS. The app only needs
-- signed-in users to select, insert, update and delete their own rows.
revoke all on table public.sync_records from anon;
revoke truncate, references, trigger on table public.sync_records from authenticated;
grant select, insert, update, delete on table public.sync_records to authenticated;
-- The trigger function is not meant to be called through the API.
revoke execute on function public.sync_records_bump_seq() from public, anon, authenticated;
