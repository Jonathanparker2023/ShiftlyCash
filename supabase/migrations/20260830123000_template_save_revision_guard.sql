-- Template edits replace the complete slot set. Protect that destructive-style
-- save from overlapping browser requests: an older snapshot must never finish
-- after a newer edit and silently restore removed shifts.

drop function if exists public.replace_default_template_slots(jsonb);

create function public.replace_default_template_slots(p_slots jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_template_id uuid;
  v_slots jsonb;
  v_expected_updated_at timestamptz;
  v_current_updated_at timestamptz;
  v_new_updated_at timestamptz;
  v_inserted_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required to save template slots.';
  end if;

  -- Refuse unversioned clients instead of accepting a save that can silently
  -- overwrite a newer template. A tab left open across deployment will show a
  -- save error and must refresh once; it cannot corrupt the stored template.
  if jsonb_typeof(coalesce(p_slots, 'null'::jsonb)) <> 'object' then
    raise exception 'Template editor is out of date. Refresh before saving.'
      using errcode = '40001';
  end if;

  v_slots := p_slots -> 'slots';
  v_expected_updated_at := nullif(p_slots ->> 'expectedUpdatedAt', '')::timestamptz;

  if v_expected_updated_at is null then
    raise exception 'Template save revision is required. Refresh before saving.'
      using errcode = '40001';
  end if;

  if jsonb_typeof(coalesce(v_slots, '[]'::jsonb)) <> 'array' then
    raise exception 'Template slots payload must be a JSON array.';
  end if;

  select wt.id, wt.updated_at
    into v_template_id, v_current_updated_at
  from public.weekly_templates wt
  where wt.user_id = v_user_id
    and wt.is_default
  order by wt.created_at
  limit 1
  for update;

  if v_template_id is null then
    raise exception 'Default weekly template not found.';
  end if;

  if v_expected_updated_at is not null
     and v_current_updated_at <> v_expected_updated_at then
    raise exception 'Template changed in another save. Refresh before editing again.'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from (
      select
        (payload.slot ->> 'dayIndex')::integer as day_index,
        (payload.slot ->> 'slotIndex')::integer as slot_index,
        payload.slot ->> 'jobType' as job_type,
        payload.slot ->> 'payType' as pay_type,
        coalesce((payload.slot ->> 'hoursOrUnits')::numeric, 0) as hours_or_units,
        coalesce((payload.slot ->> 'regularHours')::numeric, 0) as regular_hours,
        coalesce((payload.slot ->> 'overtimeHours')::numeric, 0) as overtime_hours,
        coalesce(payload.slot ->> 'incentiveMode', 'none') as incentive_mode,
        coalesce((payload.slot ->> 'incentiveRate')::numeric, 0) as incentive_rate,
        coalesce((payload.slot ->> 'incentiveAmount')::numeric, 0) as incentive_amount,
        nullif(payload.slot ->> 'customJobId', '')::uuid as custom_job_id
      from jsonb_array_elements(v_slots) as payload(slot)
    ) parsed
    where parsed.day_index not between 0 and 6
      or parsed.slot_index not between 0 and 3
      or parsed.job_type not in ('ability','prestige','prestige_ilst','incentive','other','custom','none')
      or parsed.pay_type not in ('regular','overtime','split','unit','none')
      or parsed.incentive_mode not in ('none','rate','lump_sum')
      or parsed.hours_or_units < 0
      or parsed.regular_hours < 0
      or parsed.overtime_hours < 0
      or parsed.incentive_rate < 0
      or parsed.incentive_amount < 0
      or (parsed.job_type = 'custom' and parsed.custom_job_id is null)
      or (parsed.job_type <> 'custom' and parsed.custom_job_id is not null)
      or (
        parsed.pay_type = 'split'
        and (
          parsed.job_type not in ('ability','prestige','prestige_ilst','custom')
          or parsed.regular_hours <= 0
          or parsed.overtime_hours <= 0
        )
      )
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
    hours_or_units,
    regular_hours,
    overtime_hours,
    incentive_mode,
    incentive_rate,
    incentive_amount,
    custom_job_id,
    label
  )
  select distinct on (parsed.day_index, parsed.slot_index)
    v_user_id,
    v_template_id,
    parsed.day_index,
    parsed.slot_index,
    parsed.job_type::public.job_type,
    parsed.pay_type::public.pay_type,
    case
      when parsed.pay_type = 'split' then parsed.regular_hours + parsed.overtime_hours
      else parsed.hours_or_units
    end,
    parsed.regular_hours,
    parsed.overtime_hours,
    case when parsed.job_type = 'ability' then parsed.incentive_mode else 'none' end,
    case when parsed.job_type = 'ability' and parsed.incentive_mode = 'rate' then parsed.incentive_rate else 0 end,
    case when parsed.job_type = 'ability' and parsed.incentive_mode = 'lump_sum' then parsed.incentive_amount else 0 end,
    case when parsed.job_type = 'custom' then parsed.custom_job_id else null end,
    parsed.label
  from (
    select
      (payload.slot ->> 'dayIndex')::integer as day_index,
      (payload.slot ->> 'slotIndex')::integer as slot_index,
      payload.slot ->> 'jobType' as job_type,
      payload.slot ->> 'payType' as pay_type,
      coalesce((payload.slot ->> 'hoursOrUnits')::numeric, 0) as hours_or_units,
      coalesce((payload.slot ->> 'regularHours')::numeric, 0) as regular_hours,
      coalesce((payload.slot ->> 'overtimeHours')::numeric, 0) as overtime_hours,
      coalesce(payload.slot ->> 'incentiveMode', 'none') as incentive_mode,
      coalesce((payload.slot ->> 'incentiveRate')::numeric, 0) as incentive_rate,
      coalesce((payload.slot ->> 'incentiveAmount')::numeric, 0) as incentive_amount,
      nullif(payload.slot ->> 'customJobId', '')::uuid as custom_job_id,
      nullif(btrim(coalesce(payload.slot ->> 'label', '')), '') as label
    from jsonb_array_elements(v_slots) as payload(slot)
  ) parsed
  where parsed.job_type <> 'none'
    and (
      case
        when parsed.pay_type = 'split' then parsed.regular_hours + parsed.overtime_hours
        else parsed.hours_or_units
      end
    ) > 0
  order by parsed.day_index, parsed.slot_index;

  get diagnostics v_inserted_count = row_count;

  update public.weekly_templates
  set updated_at = clock_timestamp()
  where id = v_template_id
    and user_id = v_user_id
  returning updated_at into v_new_updated_at;

  return jsonb_build_object(
    'savedCount', v_inserted_count,
    'updatedAt', v_new_updated_at
  );
end;
$function$;

grant execute on function public.replace_default_template_slots(jsonb) to authenticated;
