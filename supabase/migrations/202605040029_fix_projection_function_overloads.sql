-- Fix ambiguous overloads introduced by projection date handling.
-- 0027 created no-arg functions, then 0028 added date-default overloads.
-- Calls like cleanup_expired_projections() became ambiguous.

drop function if exists public.cleanup_expired_projections();
drop function if exists public.apply_future_day_projection(uuid);

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

  if v_created_week then
    perform public.apply_default_template_to_week(v_week_id);
    perform public.apply_future_day_projection(v_week_id, current_date);
  end if;

  perform public.cleanup_expired_projections(current_date);

  return v_week_id;
end;
$$;

grant execute on function public.ensure_current_active_week(date) to authenticated;
