-- Use the caller's local "today" (passed from the app) instead of the
-- database server's current_date, which can drift hours ahead in UTC.

create or replace function public.cleanup_expired_projections(p_today date default current_date)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then return 0; end if;

  update public.days
  set
    manual_spend_adjustment = 0,
    is_projected_spend = false
  where user_id = v_user_id
    and is_projected_spend = true
    and date <= p_today;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.cleanup_expired_projections(date) to authenticated;

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
  v_last_week_spend numeric;
  v_per_day numeric;
  v_count integer;
begin
  if v_user_id is null then return 0; end if;

  select coalesce(spend_total, 0)
    into v_last_week_spend
  from public.v_week_totals
  where user_id = v_user_id
    and status = 'closed'
  order by start_date desc
  limit 1;

  v_per_day := coalesce(round(v_last_week_spend / 7.0, 2), 0);
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
