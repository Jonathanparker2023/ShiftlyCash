-- Future-day spend projection for the active week.
-- When a new week is created, future days (date > today) get a projected
-- spend = last closed week's total spend / 7. The flag is_projected_spend
-- marks these so they can be auto-cleared as the calendar advances.
-- Cleanup runs on every dashboard load: any day with the flag whose date
-- has reached or passed today gets reset (manual_spend_adjustment = 0,
-- flag = false) so real Plaid transactions can populate it.

alter table public.days
  add column if not exists is_projected_spend boolean not null default false;

create or replace function public.cleanup_expired_projections()
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
    and date <= current_date;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.cleanup_expired_projections() to authenticated;

create or replace function public.apply_future_day_projection(p_week_id uuid)
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

  -- Most recent closed week's total spend
  select coalesce(spend_total, 0)
    into v_last_week_spend
  from public.v_week_totals
  where user_id = v_user_id
    and status = 'closed'
  order by start_date desc
  limit 1;

  v_per_day := coalesce(round(v_last_week_spend / 7.0, 2), 0);

  if v_per_day <= 0 then
    return 0;
  end if;

  update public.days
  set
    manual_spend_adjustment = v_per_day,
    is_projected_spend = true
  where user_id = v_user_id
    and week_id = p_week_id
    and date > current_date
    and manual_spend_adjustment = 0
    and not is_projected_spend;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.apply_future_day_projection(uuid) to authenticated;

-- Update ensure_current_active_week to apply projections on new week creation
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
    perform public.apply_future_day_projection(v_week_id);
  end if;

  -- Always run cleanup so projections clear as the calendar advances.
  perform public.cleanup_expired_projections();

  return v_week_id;
end;
$$;

grant execute on function public.ensure_current_active_week(date) to authenticated;

-- Apply projections to the CURRENT active week so the user sees them now,
-- even though wk18 was created before this feature existed.
do $$
declare
  v_user_id uuid;
  v_active_id uuid;
  v_per_day numeric;
  v_last_week_spend numeric;
begin
  select id into v_user_id from auth.users where lower(email) = 'jay1park1@gmail.com' limit 1;
  if v_user_id is null then return; end if;

  select id into v_active_id from public.weeks
    where user_id = v_user_id and status = 'active' order by start_date desc limit 1;
  if v_active_id is null then return; end if;

  select coalesce(spend_total, 0) into v_last_week_spend
  from public.v_week_totals
  where user_id = v_user_id and status = 'closed'
  order by start_date desc limit 1;

  v_per_day := coalesce(round(v_last_week_spend / 7.0, 2), 0);
  if v_per_day <= 0 then return; end if;

  update public.days
  set manual_spend_adjustment = v_per_day,
      is_projected_spend = true
  where user_id = v_user_id
    and week_id = v_active_id
    and date > current_date
    and manual_spend_adjustment = 0
    and not is_projected_spend;
end $$;
