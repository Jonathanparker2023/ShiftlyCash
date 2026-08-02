-- Make the weekly template genuinely standalone.
--
-- The defect: template_slots had no label column. Shift names lived in
-- sticky_labels, keyed ONLY by (user_id, day_index, slot_index) with no
-- reference to a template. So a label was pinned to a POSITION on the grid
-- rather than to the shift occupying it.
--
-- Two consequences, both of which Jon hit:
--
--   1. Reordering shifts moved the job between slot_index values while the
--      labels stayed pinned to the old positions, so names landed on the wrong
--      shifts — the "jumbled up" symptom.
--
--   2. apply_default_template_to_week read its labels from sticky_labels, so a
--      newly created week could be named by whatever last wrote that table
--      rather than by the template itself.
--
-- On top of that, the apply function carried a hardcoded heuristic that named
-- any 'ability' slot "Sunrise Cottage" when its hours matched certain values,
-- and NULL otherwise — overriding the template outright. That guesswork is
-- removed here; the template says what a shift is called, full stop.
--
-- sticky_labels is left in place rather than dropped: it still carries the
-- historical record, and nothing is gained by destroying it.

alter table public.template_slots
  add column if not exists label text;

-- Backfill each slot's label from the sticky label that currently sits at its
-- position, so the migration is invisible to the user.
update public.template_slots ts
set label = sl.label
from public.sticky_labels sl
where sl.user_id = ts.user_id
  and sl.day_index = ts.day_index
  and sl.slot_index = ts.slot_index
  and ts.label is null;

-- Rewrite the apply function to read the template's OWN label.
create or replace function public.apply_default_template_to_week(p_week_id uuid)
returns integer
language plpgsql
set search_path to 'public'
as $function$
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
    -- The template is the single source of truth for a new week. No join to
    -- sticky_labels, no hardcoded name guessing.
    select ts.*
    from public.template_slots ts
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
        label = nullif(btrim(coalesce(tr.label, '')), ''),
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
      nullif(btrim(coalesce(tr.label, '')), ''),
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
$function$;

-- The save RPC deletes and re-inserts every slot, so it has to carry the label
-- through or each save would wipe the names it just stored.
create or replace function public.replace_default_template_slots(p_slots jsonb)
returns integer
language plpgsql
set search_path to 'public'
as $function$
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
    incentive_rate, incentive_amount, custom_job_id, label
  )
  select distinct on (parsed.day_index, parsed.slot_index)
    v_user_id, v_template_id, parsed.day_index, parsed.slot_index,
    parsed.job_type::public.job_type, parsed.pay_type::public.pay_type,
    case when parsed.pay_type = 'split' then parsed.regular_hours + parsed.overtime_hours else parsed.hours_or_units end,
    parsed.regular_hours, parsed.overtime_hours,
    case when parsed.job_type = 'ability' then parsed.incentive_mode else 'none' end,
    case when parsed.job_type = 'ability' and parsed.incentive_mode = 'rate' then parsed.incentive_rate else 0 end,
    case when parsed.job_type = 'ability' and parsed.incentive_mode = 'lump_sum' then parsed.incentive_amount else 0 end,
    case when parsed.job_type = 'custom' then parsed.custom_job_id else null end,
    parsed.label
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
      nullif(payload.slot ->> 'customJobId', '')::uuid as custom_job_id,
      nullif(btrim(coalesce(payload.slot ->> 'label', '')), '') as label
    from jsonb_array_elements(p_slots) as payload(slot)
  ) parsed
  where parsed.job_type <> 'none'
    and (case when parsed.pay_type = 'split' then parsed.regular_hours + parsed.overtime_hours else parsed.hours_or_units end) > 0
  order by parsed.day_index, parsed.slot_index;

  get diagnostics v_inserted_count = row_count;
  return v_inserted_count;
end;
$function$;
