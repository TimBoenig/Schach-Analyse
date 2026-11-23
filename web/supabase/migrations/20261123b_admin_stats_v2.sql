-- Admin dashboard v2: more aggregates for the charts (weekly sign-ups, hour of
-- day, return rates). Still counts only: no e-mail addresses, names, user ids
-- or game contents. Replaces admin_stats() from 20261123_admin_stats.sql.
--
-- NOT applied to production yet: needs Tim's OK.
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
  ),
  weeks as (
    select generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as w
  ),
  hours as (
    select extract(hour from (to_timestamp(updated_at / 1000.0) at time zone 'Europe/Berlin'))::int as h, count(*) as n
    from public.sync_records
    where updated_at > (select v from now_ms) - 30 * 86400000::bigint
    group by 1
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
    ),
    'signupsByWeek', (
      select jsonb_agg(jsonb_build_object('week', to_char(w.w, 'YYYY-MM-DD'), 'n', coalesce(c.n, 0)) order by w.w)
      from weeks w left join (
        select date_trunc('week', created_at) as wk, count(*) as n from users group by 1
      ) c on c.wk = w.w
    )
  ),
  'activity', jsonb_build_object(
    'active1d', (select count(*) from per_user where last_seen_ms > (select v from now_ms) - 86400000::bigint),
    'active7d', (select count(*) from per_user where last_seen_ms > (select v from now_ms) - 7 * 86400000::bigint),
    'active30d', (select count(*) from per_user where last_seen_ms > (select v from now_ms) - 30 * 86400000::bigint),
    'oldUsers', (select count(*) from per_user where created_at < now() - interval '7 days'),
    'oldUsersActive7d', (select count(*) from per_user where created_at < now() - interval '7 days' and last_seen_ms > (select v from now_ms) - 7 * 86400000::bigint),
    'activeByDay', (
      select jsonb_agg(jsonb_build_object('day', d, 'n', coalesce(c.n, 0)) order by d)
      from days left join (
        select (to_timestamp(updated_at / 1000.0) at time zone 'UTC')::date as day, count(distinct user_id) as n
        from public.sync_records
        group by 1
      ) c on c.day = days.d
    ),
    'byHour', (
      select jsonb_agg(jsonb_build_object('h', g.h, 'n', coalesce(hr.n, 0)) order by g.h)
      from generate_series(0, 23) as g(h) left join hours hr on hr.h = g.h
    )
  ),
  'retention', jsonb_build_object(
    -- Accounts old enough to judge: how many were last seen at least 1 / 7 days after signing up.
    'cohort', (select count(*) from per_user where created_at < now() - interval '8 days'),
    'back1d', (select count(*) from per_user where created_at < now() - interval '8 days' and last_seen_ms >= extract(epoch from created_at) * 1000 + 86400000),
    'back7d', (select count(*) from per_user where created_at < now() - interval '8 days' and last_seen_ms >= extract(epoch from created_at) * 1000 + 7 * 86400000)
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
