-- Future-day spend projection should use the median of the last six included
-- closed weeks, not only the immediately previous week.

create or replace function public.apply_future_day_projection(
  p_week_id uuid,
  p_today date default current_date
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_median_week_spend numeric;
  v_per_day numeric;
  v_count integer;
begin
  if v_user_id is null then return 0; end if;

  select percentile_cont(0.5) within group (order by recent.spend_for_projection)
    into v_median_week_spend
  from (
    select spend_for_projection
    from public.v_projection_weeks
    where user_id = v_user_id
      and spend_for_projection is not null
    order by start_date desc
    limit 6
  ) recent;

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
$$;

grant execute on function public.apply_future_day_projection(uuid, date) to authenticated;
