-- Autofill spending: take the median of a CLEANED weekly dataset.
--
-- The projection took the median of every week in the year, outliers included.
-- Relying on the median alone to absorb them is not enough when the tail is
-- heavy: five of thirty-three weeks this year ran past $1,800 against a $823
-- median -- a Tesla deposit week, a tints-and-DMV week, the crash week -- and
-- they drag the middle of the distribution up with them.
--
-- This trims the dataset before taking the median, using the standard IQR
-- fence: anything below Q1 - 1.5*IQR or above Q3 + 1.5*IQR is not a typical
-- week and does not get a vote. Whatever survives is what "typical" is measured
-- from.
--
-- The trim is RECOMPUTED EVERY RUN, not a one-time list of excluded weeks. As
-- new weeks close, the fences move with them and a week that was extreme in a
-- quiet stretch stops being extreme once the surrounding weeks catch up. That
-- is the difference between cleaning the dataset and hand-deleting rows.
--
-- Manual exclusions still apply first: v_projection_weeks nulls out anything
-- switched off by hand, so trimming operates on what is left. Deliberate
-- judgement outranks the formula.
--
-- Guard: below 8 candidate weeks the quartiles are too unstable to fence with,
-- so the untrimmed median is used rather than gutting a thin sample.
create or replace function public.apply_future_day_projection(
  p_week_id uuid,
  p_today date default current_date
)
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_year_weeks integer;
  v_median_week_spend numeric;
  v_per_day numeric;
  v_count integer;
begin
  if v_user_id is null then return 0; end if;

  select count(*)
    into v_year_weeks
  from public.v_projection_weeks
  where user_id = v_user_id
    and spend_for_projection is not null
    and start_date >= date_trunc('year', p_today)::date;

  -- Trim outliers, then take the median of what survives. Done entirely in
  -- CTEs. A first cut of this used a temp table, which is fine in a SQL console
  -- and unreliable inside a function running per-request behind a pooler --
  -- exactly the kind of thing that passes every test you run by hand and then
  -- fails in production.
  with pool as (
    select spend
    from (
      select spend_for_projection as spend, start_date
      from public.v_projection_weeks
      where user_id = v_user_id
        and spend_for_projection is not null
        and (v_year_weeks < 4 or start_date >= date_trunc('year', p_today)::date)
      order by start_date desc
      limit (case when v_year_weeks >= 4 then 1000000 else 12 end)
    ) s
  ),
  bounds as (
    select
      count(*) as n,
      percentile_cont(0.25) within group (order by spend)::numeric as q1,
      percentile_cont(0.75) within group (order by spend)::numeric as q3
    from pool
  ),
  kept as (
    -- Below 8 weeks the quartiles are too unstable to fence with, so keep
    -- everything rather than gutting a thin sample.
    select p.spend
    from pool p, bounds b
    where b.n < 8
       or p.spend between (b.q1 - 1.5 * (b.q3 - b.q1))
                      and (b.q3 + 1.5 * (b.q3 - b.q1))
  )
  select percentile_cont(0.5) within group (order by spend)
    into v_median_week_spend
  from kept;

  v_per_day := coalesce(round(v_median_week_spend / 7.0, 2), 0);
  if v_per_day <= 0 then return 0; end if;

  update public.days
  set
    manual_spend_adjustment = v_per_day,
    is_projected_spend = true
  where user_id = v_user_id
    and week_id = p_week_id
    and date > p_today
    and manual_spend_adjustment = 0
    and not is_projected_spend;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- Clear already-projected future days so the cleaned figure lands on the next
-- dashboard load instead of only on days nobody has touched yet.
update public.days d
set manual_spend_adjustment = 0, is_projected_spend = false
where d.is_projected_spend
  and d.date > (now() at time zone 'America/New_York')::date;
