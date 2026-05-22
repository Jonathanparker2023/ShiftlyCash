-- Cached AI coach-review surfaces for ShiftlyCal.
--
-- Replaces no prior table — net-new feature. Two surfaces:
--   - scope='week' — weekly pattern read, regenerates on week-data
--     observation hash change or day-boundary cross.
--   - scope='day'  — focused-day commentary, regenerates whenever
--     entries/totals/verdict hash changes.
--
-- The (user_id, scope, period_key, observations_hash) tuple is the
-- cache key: rendering reads the freshest row matching scope +
-- period_key, regenerates only when the observations_hash for new
-- data differs from the cached row. style_seed is cosmetic and is
-- NOT part of the cache key — it derives from the hash + date so
-- equivalent observations don't regenerate endlessly.

create table if not exists public.cal_coach_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null check (scope in ('week', 'day')),
  -- "Period key" = ISO date for scope=day, ISO Monday for scope=week.
  period_key text not null,
  observations_hash text not null,
  style_seed text not null,
  body text not null,
  suggestion_kind text,
  suggestion_text text,
  created_at timestamptz not null default now()
);

-- Cache lookup index: read latest row for (user, scope, period).
create index if not exists cal_coach_reviews_lookup_idx
  on public.cal_coach_reviews (user_id, scope, period_key, created_at desc);

-- Per-hash uniqueness so we never store two rows for the exact same
-- observation state. Concurrent regenerations conflict-and-skip.
create unique index if not exists cal_coach_reviews_hash_unique
  on public.cal_coach_reviews (user_id, scope, period_key, observations_hash);

alter table public.cal_coach_reviews enable row level security;

drop policy if exists cal_coach_reviews_own on public.cal_coach_reviews;
create policy cal_coach_reviews_own on public.cal_coach_reviews for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.cal_coach_reviews to authenticated;
grant all on public.cal_coach_reviews to service_role;
