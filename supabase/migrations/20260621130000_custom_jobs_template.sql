-- Custom jobs in the weekly autofill template. replace_default_template_slots
-- accepts job_type='custom' + customJobId (same custom<->id invariant the table
-- check enforces); apply_default_template_to_week copies custom_job_id into the
-- materialized earn_slots so an autofilled custom shift prices + colors like a
-- manual one. Behavior-preserving for non-custom slots.

create or replace function public.replace_default_template_slots(p_slots jsonb)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_template_id uuid;
  v_inserted_count integer := 0;
begin
  if v_user_id is null then raise exception 'Authentication required to save template slots.'; end if;
  if jsonb_typeof(coalesce(p_slots, '[]'::jsonb)) <> 'array' then raise exception 'Template slots payload must be a JSON array.'; end if;
  select wt.id into v_template_id from public.weekly_templates wt
    where wt.user_id = v_user_id and wt.is_default order by wt.created_at limit 1;
  if v_template_id is null then raise exception 'Default weekly template not found.'; end if;

  if exists (
    select 1 from (
      select
        (payload.slot ->> 'dayIndex')::integer as day_index,
        (payload.slot ->> 'slotIndex')::integer as slot_index,
        (payload.slot ->> 'jobType') as job_type,
        (payload.slot ->> 'payType') as pay_type,
        coalesce((payload.slot ->> 'hoursOrUnits')::numeric, 0) as hours_or_units,
        coalesce((payload.slot ->> 'regularHours')::numeric, 0) as regular_hours,
        coalesce((payload.slot ->> 'overtimeHours')::numeric, 0) as overtime_hours,
        coalesce(payload.slot ->> 'incentiveMode', 'none') as incentive_mode,
        coalesce((payload.slot ->> 'incentiveRate')::numeric, 0) as incentive_rate,
        coalesce((payload.slot ->> 'incentiveAmount')::numeric, 0) as incentive_amount,
        nullif(payload.slot ->> 'customJobId', '')::uuid as custom_job_id
      from jsonb_array_elements(p_slots) as payload(slot)
    ) parsed
    where parsed.day_index not between 0 and 6
      or parsed.slot_index not between 0 and 3
      or parsed.job_type not in ('ability','prestige','prestige_ilst','incentive','other','custom','none')
      or parsed.pay_type not in ('regular','overtime','split','unit','none')
      or parsed.incentive_mode not in ('none','rate','lump_sum')
      or parsed.hours_or_units < 0 or parsed.regular_hours < 0 or parsed.overtime_hours < 0
      or parsed.incentive_rate < 0 or parsed.incentive_amount < 0
      or (parsed.job_type = 'custom' and parsed.custom_job_id is null)
      or (parsed.job_type <> 'custom' and parsed.custom_job_id is not null)
      or (parsed.pay_type = 'split' and (
            parsed.job_type not in ('ability','prestige','prestige_ilst','custom')
            or parsed.regular_hours <= 0 or parsed.overtime_hours <= 0))
  ) then
    raise exception 'Template slots payload contains invalid values.';
  end if;

  delete from public.template_slots where user_id = v_user_id and template_id = v_template_id;

  insert into public.template_slots (
    user_id, template_id, day_index, slot_index, job_type, pay_type,
    hours_or_units, regular_hours, overtime_hours, incentive_mode,
    incentive_rate, incentive_amount, custom_job_id
  )
  select distinct on (parsed.day_index, parsed.slot_index)
    v_user_id, v_template_id, parsed.day_index, parsed.slot_index,
    parsed.job_type::public.job_type, parsed.pay_type::public.pay_type,
    case when parsed.pay_type = 'split' then parsed.regular_hours + parsed.overtime_hours else parsed.hours_or_units end,
    parsed.regular_hours, parsed.overtime_hours,
    case when parsed.job_type = 'ability' then parsed.incentive_mode else 'none' end,
    case when parsed.job_type = 'ability' and parsed.incentive_mode = 'rate' then parsed.incentive_rate else 0 end,
    case when parsed.job_type = 'ability' and parsed.incentive_mode = 'lump_sum' then parsed.incentive_amount else 0 end,
    case when parsed.job_type = 'custom' then parsed.custom_job_id else null end
  from (
    select
      (payload.slot ->> 'dayIndex')::integer as day_index,
      (payload.slot ->> 'slotIndex')::integer as slot_index,
      (payload.slot ->> 'jobType') as job_type,
      (payload.slot ->> 'payType') as pay_type,
      coalesce((payload.slot ->> 'hoursOrUnits')::numeric, 0) as hours_or_units,
      coalesce((payload.slot ->> 'regularHours')::numeric, 0) as regular_hours,
      coalesce((payload.slot ->> 'overtimeHours')::numeric, 0) as overtime_hours,
      coalesce(payload.slot ->> 'incentiveMode', 'none') as incentive_mode,
      coalesce((payload.slot ->> 'incentiveRate')::numeric, 0) as incentive_rate,
      coalesce((payload.slot ->> 'incentiveAmount')::numeric, 0) as incentive_amount,
      nullif(payload.slot ->> 'customJobId', '')::uuid as custom_job_id
    from jsonb_array_elements(p_slots) as payload(slot)
  ) parsed
  where parsed.job_type <> 'none'
    and (case when parsed.pay_type = 'split' then parsed.regular_hours + parsed.overtime_hours else parsed.hours_or_units end) > 0
  order by parsed.day_index, parsed.slot_index;

  get diagnostics v_inserted_count = row_count;
  return v_inserted_count;
end;
$$;
grant execute on function public.replace_default_template_slots(jsonb) to authenticated;


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

  with template_rows as (
    select
      ts.*,
      case
        when ts.job_type::text = 'ability'
          and (
            ts.hours_or_units = 10
            or (ts.day_index = 0 and ts.hours_or_units = 8)
            or (ts.day_index = 4 and ts.hours_or_units = 2)
          )
          then 'Sunrise Cottage'
        when ts.job_type::text = 'ability'
          then null
        else sl.label
      end as autofill_label
    from public.template_slots ts
    left join public.sticky_labels sl
      on sl.user_id = v_user_id
      and sl.day_index = ts.day_index
      and sl.slot_index = ts.slot_index
    where ts.user_id = v_user_id
      and ts.template_id = v_template_id
  ),
  updated as (
    update public.earn_slots es
      set
        job_type = tr.job_type,
        pay_type = tr.pay_type,
        hours_or_units = tr.hours_or_units,
        regular_hours = tr.regular_hours,
        overtime_hours = tr.overtime_hours,
        incentive_mode = tr.incentive_mode,
        incentive_rate = tr.incentive_rate,
        incentive_amount = tr.incentive_amount,
        custom_job_id = tr.custom_job_id,
        label = tr.autofill_label,
        source = 'template',
        updated_at = now()
    from public.days d
    join template_rows tr
      on tr.day_index = d.day_index
    where d.user_id = v_user_id
      and d.week_id = p_week_id
      and es.user_id = v_user_id
      and es.day_id = d.id
      and es.slot_index = tr.slot_index
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
      regular_hours,
      overtime_hours,
      incentive_mode,
      incentive_rate,
      incentive_amount,
      custom_job_id,
      label,
      source
    )
    select
      v_user_id,
      d.id,
      tr.slot_index,
      tr.job_type,
      tr.pay_type,
      tr.hours_or_units,
      tr.regular_hours,
      tr.overtime_hours,
      tr.incentive_mode,
      tr.incentive_rate,
      tr.incentive_amount,
      tr.custom_job_id,
      tr.autofill_label,
      'template'
    from public.days d
    join template_rows tr
      on tr.day_index = d.day_index
    where d.user_id = v_user_id
      and d.week_id = p_week_id
      and not exists (
        select 1
        from public.earn_slots es
        where es.user_id = v_user_id
          and es.day_id = d.id
          and es.slot_index = tr.slot_index
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
