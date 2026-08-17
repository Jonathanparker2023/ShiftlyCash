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
  v_q1 numeric;
  v_q3 numeric;
  v_iqr numeric;
  v_candidates integer;
begin
  if v_user_id is null then return 0; end if;

  select count(*)
    into v_year_weeks
  from public.v_projection_weeks
  where user_id = v_user_id
    and spend_for_projection is not null
    and start_date >= date_trunc('year', p_today)::date;

  -- The candidate pool: the year so far, or the trailing twelve weeks when the
  -- year is too new to stand on its own.
  create temp table if not exists _spend_pool (spend numeric) on commit drop;
  delete from _spend_pool;

  if v_year_weeks >= 4 then
    insert into _spend_pool (spend)
    select spend_for_projection
    from public.v_projection_weeks
    where user_id = v_user_id
      and spend_for_projection is not null
      and start_date >= date_trunc('year', p_today)::date;
  else
    insert into _spend_pool (spend)
    select spend_for_projection
    from public.v_projection_weeks
    where user_id = v_user_id
      and spend_for_projection is not null
    order by start_date desc
    limit 12;
  end if;

  select count(*) into v_candidates from _spend_pool;
  if v_candidates = 0 then return 0; end if;

  if v_candidates >= 8 then
    select
      percentile_cont(0.25) within group (order by spend)::numeric,
      percentile_cont(0.75) within group (order by spend)::numeric
      into v_q1, v_q3
    from _spend_pool;

    v_iqr := v_q3 - v_q1;

    -- Median of the trimmed set.
    select percentile_cont(0.5) within group (order by spend)
      into v_median_week_spend
    from _spend_pool
    where spend between (v_q1 - 1.5 * v_iqr) and (v_q3 + 1.5 * v_iqr);
  end if;

  -- Thin sample, or a fence that somehow excluded everything: fall back to the
  -- untrimmed median rather than returning nothing.
  if v_median_week_spend is null then
    select percentile_cont(0.5) within group (order by spend)
      into v_median_week_spend
    from _spend_pool;
  end if;

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
