-- Autofill spending: project from the YEAR's median week, not the last six.
--
-- The six-week window made the placeholder chase whatever just happened. Two
-- expensive weeks (a Tesla deposit, tints, a court payment) dragged the
-- projected daily figure to $127.21 even though the year's typical week is
-- $733.06 -> $104.72/day. A forecast that moves that far on two lumpy weeks
-- tells you about last month, not about next week.
--
-- Widening to the calendar year makes the median what it should be: the
-- typical week, resistant to one bad fortnight.
--
-- Early-January guard: with only a handful of closed weeks in a new year the
-- year median is noisier than the thing it replaced, so below four weeks it
-- falls back to the trailing twelve regardless of year boundary.
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

  if v_year_weeks >= 4 then
    -- The typical week of the year so far.
    select percentile_cont(0.5) within group (order by spend_for_projection)
      into v_median_week_spend
    from public.v_projection_weeks
    where user_id = v_user_id
      and spend_for_projection is not null
      and start_date >= date_trunc('year', p_today)::date;
  else
    -- Too early in the year for a stable year median.
    select percentile_cont(0.5) within group (order by recent.spend_for_projection)
      into v_median_week_spend
    from (
      select spend_for_projection
      from public.v_projection_weeks
      where user_id = v_user_id
        and spend_for_projection is not null
      order by start_date desc
      limit 12
    ) recent;
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

-- Re-project any future day still carrying the old six-week figure, so the
-- change takes effect now rather than on the next untouched day.
update public.days d
set manual_spend_adjustment = 0, is_projected_spend = false
where d.is_projected_spend
  and d.date > (now() at time zone 'America/New_York')::date;
