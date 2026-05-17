-- Sunrise Ability autofill is slot-pattern based, not only hour based:
-- Sunday 8h, Thursday 2h, and all 10h Ability template slots get Sunrise.
-- Generic 6h/12h Ability filler slots stay unlabeled.

delete from public.sticky_labels sl
using public.weekly_templates wt,
      public.template_slots ts
where wt.is_default
  and wt.user_id = sl.user_id
  and ts.user_id = wt.user_id
  and ts.template_id = wt.id
  and ts.day_index = sl.day_index
  and ts.slot_index = sl.slot_index
  and ts.job_type::text = 'ability'
  and not (
    ts.hours_or_units = 10
    or (ts.day_index = 0 and ts.hours_or_units = 8)
    or (ts.day_index = 4 and ts.hours_or_units = 2)
  );

insert into public.sticky_labels (user_id, day_index, slot_index, label)
select
  wt.user_id,
  ts.day_index,
  ts.slot_index,
  'Sunrise Cottage'
from public.weekly_templates wt
join public.template_slots ts
  on ts.user_id = wt.user_id
  and ts.template_id = wt.id
where wt.is_default
  and ts.job_type::text = 'ability'
  and (
    ts.hours_or_units = 10
    or (ts.day_index = 0 and ts.hours_or_units = 8)
    or (ts.day_index = 4 and ts.hours_or_units = 2)
  )
on conflict (user_id, day_index, slot_index) do update
  set label = excluded.label, updated_at = now();

update public.earn_slots es
  set label = case
      when es.hours_or_units = 10
        or (d.day_index = 0 and es.hours_or_units = 8)
        or (d.day_index = 4 and es.hours_or_units = 2)
        then 'Sunrise Cottage'
      else null
    end,
    updated_at = now()
from public.days d
join public.weeks w on w.id = d.week_id
where es.day_id = d.id
  and es.user_id = d.user_id
  and es.job_type::text = 'ability'
  and es.source = 'template'
  and w.start_date >= '2026-05-17'::date
  and (
    (
      (
        es.hours_or_units = 10
        or (d.day_index = 0 and es.hours_or_units = 8)
        or (d.day_index = 4 and es.hours_or_units = 2)
      )
      and coalesce(es.label, '') <> 'Sunrise Cottage'
    )
    or (
      not (
        es.hours_or_units = 10
        or (d.day_index = 0 and es.hours_or_units = 8)
        or (d.day_index = 4 and es.hours_or_units = 2)
      )
      and es.label is not null
    )
  );

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

grant execute on function public.apply_default_template_to_week(uuid) to authenticated;
