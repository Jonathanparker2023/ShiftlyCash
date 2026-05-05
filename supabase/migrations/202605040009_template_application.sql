create or replace function public.apply_default_template_to_week(p_week_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_template_id uuid;
  v_touched_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required to apply a template.';
  end if;

  if not exists (
    select 1
    from public.weeks w
    where w.id = p_week_id
      and w.user_id = v_user_id
  ) then
    raise exception 'Week not found.';
  end if;

  select wt.id
    into v_template_id
  from public.weekly_templates wt
  where wt.user_id = v_user_id
    and wt.is_default
  order by wt.created_at
  limit 1;

  if v_template_id is null then
    raise exception 'Default weekly template not found.';
  end if;

  with updated as (
    update public.earn_slots es
      set
        job_type = ts.job_type,
        pay_type = ts.pay_type,
        hours_or_units = ts.hours_or_units,
        label = sl.label,
        source = 'template',
        updated_at = now()
    from public.days d
    join public.template_slots ts
      on ts.user_id = v_user_id
      and ts.template_id = v_template_id
      and ts.day_index = d.day_index
    left join public.sticky_labels sl
      on sl.user_id = v_user_id
      and sl.day_index = ts.day_index
      and sl.slot_index = ts.slot_index
    where d.user_id = v_user_id
      and d.week_id = p_week_id
      and es.user_id = v_user_id
      and es.day_id = d.id
      and es.slot_index = ts.slot_index
      and es.job_type = 'none'
      and es.hours_or_units = 0
    returning es.id
  ),
  inserted as (
    insert into public.earn_slots (
      user_id,
      day_id,
      slot_index,
      job_type,
      pay_type,
      hours_or_units,
      label,
      source
    )
    select
      v_user_id,
      d.id,
      ts.slot_index,
      ts.job_type,
      ts.pay_type,
      ts.hours_or_units,
      sl.label,
      'template'
    from public.days d
    join public.template_slots ts
      on ts.user_id = v_user_id
      and ts.template_id = v_template_id
      and ts.day_index = d.day_index
    left join public.sticky_labels sl
      on sl.user_id = v_user_id
      and sl.day_index = ts.day_index
      and sl.slot_index = ts.slot_index
    where d.user_id = v_user_id
      and d.week_id = p_week_id
      and not exists (
        select 1
        from public.earn_slots es
        where es.user_id = v_user_id
          and es.day_id = d.id
          and es.slot_index = ts.slot_index
      )
    returning id
  )
  select count(*)::integer
    into v_touched_count
  from (
    select id from updated
    union all
    select id from inserted
  ) touched;

  return v_touched_count;
end;
$$;

grant execute on function public.apply_default_template_to_week(uuid) to authenticated;

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
  end if;

  return v_week_id;
end;
$$;

grant execute on function public.ensure_current_active_week(date) to authenticated;

create or replace function public.replace_default_template_slots(p_slots jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_template_id uuid;
  v_inserted_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required to save template slots.';
  end if;

  if jsonb_typeof(coalesce(p_slots, '[]'::jsonb)) <> 'array' then
    raise exception 'Template slots payload must be a JSON array.';
  end if;

  select wt.id
    into v_template_id
  from public.weekly_templates wt
  where wt.user_id = v_user_id
    and wt.is_default
  order by wt.created_at
  limit 1;

  if v_template_id is null then
    raise exception 'Default weekly template not found.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_slots) as payload(slot)
    where (payload.slot ->> 'dayIndex')::integer not between 0 and 6
      or (payload.slot ->> 'slotIndex')::integer not between 0 and 3
      or (payload.slot ->> 'jobType') not in ('ability', 'prestige', 'incentive', 'other', 'none')
      or (payload.slot ->> 'payType') not in ('regular', 'overtime', 'unit', 'none')
      or (payload.slot ->> 'hoursOrUnits')::numeric < 0
  ) then
    raise exception 'Template slots payload contains invalid values.';
  end if;

  delete from public.template_slots
  where user_id = v_user_id
    and template_id = v_template_id;

  insert into public.template_slots (
    user_id,
    template_id,
    day_index,
    slot_index,
    job_type,
    pay_type,
    hours_or_units
  )
  select distinct on (parsed.day_index, parsed.slot_index)
    v_user_id,
    v_template_id,
    parsed.day_index,
    parsed.slot_index,
    parsed.job_type::public.job_type,
    parsed.pay_type::public.pay_type,
    parsed.hours_or_units
  from (
    select
      (payload.slot ->> 'dayIndex')::integer as day_index,
      (payload.slot ->> 'slotIndex')::integer as slot_index,
      (payload.slot ->> 'jobType') as job_type,
      (payload.slot ->> 'payType') as pay_type,
      (payload.slot ->> 'hoursOrUnits')::numeric as hours_or_units
    from jsonb_array_elements(p_slots) as payload(slot)
  ) parsed
  where parsed.job_type <> 'none'
    and parsed.hours_or_units > 0
  order by parsed.day_index, parsed.slot_index;

  get diagnostics v_inserted_count = row_count;

  return v_inserted_count;
end;
$$;

grant execute on function public.replace_default_template_slots(jsonb) to authenticated;
