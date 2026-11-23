-- Aggregated usage numbers for the admin dashboard in Settings.
--
-- Returns counts only: no e-mail addresses, names, user ids or game contents.
-- The function is callable ONLY with the service-role key, which lives in the
-- server environment of the Vercel function `web/api/admin.ts` and never in
-- the browser. anon and authenticated users get "permission denied".
--
-- NOT applied automatically. Run once in the Supabase SQL editor (or ask Claude
-- to apply it) after reviewing it.
create or replace function public.admin_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with
  now_ms as (select (extract(epoch from now()) * 1000)::bigint as v),
  users as (
    select id, created_at, last_sign_in_at, email_confirmed_at
    from auth.users
    where coalesce(is_anonymous, false) = false
  ),
  -- Per-user aggregate of what the device synced (live games only).
  per_user as (
    select
      u.id,
      u.created_at,
      coalesce(g.games, 0) as games,
      coalesce(g.analysed, 0) as analysed,
      greatest(
        coalesce(s.last_sync_ms, 0),
        coalesce((extract(epoch from u.last_sign_in_at) * 1000)::bigint, 0)
      ) as last_seen_ms
    from users u
    left join (
      select user_id,
             count(*) filter (where not deleted) as games,
             count(*) filter (where not deleted and data->'summary_json'->>'analysis_status' = 'completed') as analysed
      from public.sync_records
      where kind = 'game'
      group by user_id
    ) g on g.user_id = u.id
    left join (
      select user_id, max(updated_at) as last_sync_ms
      from public.sync_records
      group by user_id
    ) s on s.user_id = u.id
  ),
  days as (
    select generate_series(current_date - 59, current_date, interval '1 day')::date as d
  )
select jsonb_build_object(
  'generatedAt', (select v from now_ms),
  'users', jsonb_build_object(
    'total', (select count(*) from users),
    'confirmed', (select count(*) from users where email_confirmed_at is not null),
    'signups1d', (select count(*) from users where created_at > now() - interval '1 day'),
    'signups7d', (select count(*) from users where created_at > now() - interval '7 days'),
    'signups30d', (select count(*) from users where created_at > now() - interval '30 days'),
    'signupsByDay', (
      select jsonb_agg(jsonb_build_object('day', d, 'n', coalesce(c.n, 0)) order by d)
      from days left join (
        select created_at::date as day, count(*) as n from users group by 1
      ) c on c.day = days.d
    )
  ),
  'activity', jsonb_build_object(
    'active1d', (select count(*) from per_user where last_seen_ms > (select v from now_ms) - 86400000::bigint),
    'active7d', (select count(*) from per_user where last_seen_ms > (select v from now_ms) - 7 * 86400000::bigint),
    'active30d', (select count(*) from per_user where last_seen_ms > (select v from now_ms) - 30 * 86400000::bigint),
    -- Of the users who signed up at least 7 days ago: share seen in the last 7 days.
    'oldUsers', (select count(*) from per_user where created_at < now() - interval '7 days'),
    'oldUsersActive7d', (select count(*) from per_user where created_at < now() - interval '7 days' and last_seen_ms > (select v from now_ms) - 7 * 86400000::bigint),
    'activeByDay', (
      select jsonb_agg(jsonb_build_object('day', d, 'n', coalesce(c.n, 0)) order by d)
      from days left join (
        select (to_timestamp(updated_at / 1000.0) at time zone 'UTC')::date as day, count(distinct user_id) as n
        from public.sync_records
        group by 1
      ) c on c.day = days.d
    )
  ),
  'funnel', jsonb_build_object(
    'signedUp', (select count(*) from per_user),
    'synced', (select count(*) from per_user where last_seen_ms > 0 and (games > 0)),
    'analysed', (select count(*) from per_user where analysed > 0),
    'analysedMany', (select count(*) from per_user where analysed >= 20)
  ),
  'games', jsonb_build_object(
    'total', (select coalesce(sum(games), 0) from per_user),
    'analysed', (select coalesce(sum(analysed), 0) from per_user),
    'perUserAvg', (select coalesce(round(avg(games)::numeric, 1), 0) from per_user),
    'perUserMedian', (select coalesce(percentile_cont(0.5) within group (order by games), 0) from per_user),
    'analysedPerUserMedian', (select coalesce(percentile_cont(0.5) within group (order by analysed), 0) from per_user),
    -- Buckets keep individual users unrecognisable.
    'buckets', jsonb_build_array(
      jsonb_build_object('label', '0', 'n', (select count(*) from per_user where games = 0)),
      jsonb_build_object('label', '1-9', 'n', (select count(*) from per_user where games between 1 and 9)),
      jsonb_build_object('label', '10-49', 'n', (select count(*) from per_user where games between 10 and 49)),
      jsonb_build_object('label', '50-199', 'n', (select count(*) from per_user where games between 50 and 199)),
      jsonb_build_object('label', '200+', 'n', (select count(*) from per_user where games >= 200))
    ),
    'syncedByDay', (
      select jsonb_agg(jsonb_build_object('day', d, 'n', coalesce(c.n, 0)) order by d)
      from days left join (
        select (to_timestamp(updated_at / 1000.0) at time zone 'UTC')::date as day, count(*) as n
        from public.sync_records
        where kind = 'game' and not deleted
        group by 1
      ) c on c.day = days.d
    )
  ),
  'storage', jsonb_build_object(
    'records', (select count(*) from public.sync_records),
    'tableBytes', pg_total_relation_size('public.sync_records'),
    'deletedGames', (select count(*) from public.sync_records where kind = 'game' and deleted)
  )
);
$$;

revoke all on function public.admin_stats() from public, anon, authenticated;
grant execute on function public.admin_stats() to service_role;
