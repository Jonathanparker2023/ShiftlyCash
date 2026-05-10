-- Fix: ensure_current_active_week was seeding new days' base_amount from
-- settings.default_base_sun_fri / settings.default_base_sat, which still held
-- the legacy 52/57 constants. Closing a week therefore created a new week
-- showing $52/day base regardless of the user's current expense calculator.
--
-- Switch the function to source projected_daily_base from v_active_expense_totals
-- (the live expense calculator). All 7 days of a freshly-created week now use
-- the same calculator value. Then call apply_baseline_to_future_days to update
-- the user's currently-open week so it reflects the calculator immediately.

create or replace function public.ensure_current_active_week(p_start_date date)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_week_id uuid;
  v_week_start date;
  v_daily_base numeric(10, 2);
  v_created_week boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication required to ensure an active week.';
  end if;

  if extract(dow from p_start_date) <> 0 then
    raise exception 'Active week start_date must be a Sunday. Got %.', p_start_date;
  end if;

  insert into public.settings (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select coalesce(projected_daily_base, 0)
    into v_daily_base
  from public.v_active_expense_totals
  where user_id = v_user_id;

  v_daily_base := coalesce(v_daily_base, 0);

  select w.id, w.start_date
    into v_week_id, v_week_start
  from public.weeks w
  where w.user_id = v_user_id
    and w.status = 'active'
  order by w.start_date desc
  limit 1;

  if v_week_id is null then
    begin
      insert into public.weeks (user_id, start_date, end_date, status)
      values (v_user_id, p_start_date, p_start_date + 6, 'active')
      returning id, start_date into v_week_id, v_week_start;
      v_created_week := true;
    exception
      when unique_violation then
        select w.id, w.start_date
          into v_week_id, v_week_start
        from public.weeks w
        where w.user_id = v_user_id
          and w.status = 'active'
        order by w.start_date desc
        limit 1;

        if v_week_id is null then
          raise;
        end if;
    end;
  end if;

  insert into public.days (
    user_id,
    week_id,
    date,
    day_index,
    base_amount,
    manual_spend_adjustment,
    spend_locked
  )
  select
    v_user_id,
    v_week_id,
    v_week_start + gs.day_index,
    gs.day_index,
    v_daily_base,
    0,
    false
  from generate_series(0, 6) as gs(day_index)
  on conflict (week_id, day_index) do nothing;

  -- Apply template ONLY when a fresh week was just created.
  -- Removing this guard caused user edits to be reverted on every page load.
  if v_created_week then
    perform public.apply_default_template_to_week(v_week_id);
  end if;

  return v_week_id;
end;
$$;

grant execute on function public.ensure_current_active_week(date) to authenticated;

-- Backfill: update every user's currently-open future days to the calculator's
-- projected_daily_base. This corrects existing weeks (including Jon's just-opened
-- one) without waiting for users to manually re-save their baseline.
do $$
declare
  u record;
begin
  for u in select distinct user_id from public.expenses loop
    perform public.apply_baseline_to_future_days(u.user_id);
  end loop;
end $$;
