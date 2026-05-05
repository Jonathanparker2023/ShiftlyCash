-- Fix: ensure_current_active_week was re-applying the default template on every
-- dashboard load (migration 0010 removed the "if newly created" guard).
-- That caused removed shifts to come back on refresh — template re-fills any
-- empty slot every time.
-- Restore the original behavior: template applies ONLY when a new week is created.
-- All existing weeks already have their templates applied, so this is safe.

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
  v_sun_fri_base numeric(10, 2);
  v_sat_base numeric(10, 2);
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

  select s.default_base_sun_fri, s.default_base_sat
    into v_sun_fri_base, v_sat_base
  from public.settings s
  where s.user_id = v_user_id;

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
    case when gs.day_index = 6 then v_sat_base else v_sun_fri_base end,
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
