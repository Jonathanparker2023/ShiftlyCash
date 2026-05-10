-- Monday default order: Tony, Ability split, Joe.
-- The current active week already has this order; this fixes future presets.

create temporary table if not exists pg_temp.monday_template_order (
  user_id uuid not null,
  template_id uuid not null,
  slot_index integer not null,
  job_type public.job_type not null,
  pay_type public.pay_type not null,
  hours_or_units numeric not null,
  regular_hours numeric not null,
  overtime_hours numeric not null,
  label text not null
) on commit drop;

truncate table pg_temp.monday_template_order;

insert into pg_temp.monday_template_order (
  user_id,
  template_id,
  slot_index,
  job_type,
  pay_type,
  hours_or_units,
  regular_hours,
  overtime_hours,
  label
)
select wt.user_id, wt.id, 0, 'prestige'::public.job_type, 'regular'::public.pay_type, 9, 9, 0, 'Tony'
from public.weekly_templates wt
where wt.is_default
union all
select wt.user_id, wt.id, 1, 'ability'::public.job_type, 'split'::public.pay_type, 6, 4, 2, 'Sunrise Cottage'
from public.weekly_templates wt
where wt.is_default
union all
select wt.user_id, wt.id, 2, 'prestige'::public.job_type, 'regular'::public.pay_type, 4, 4, 0, 'Joe'
from public.weekly_templates wt
where wt.is_default;

insert into public.template_slots (
  user_id,
  template_id,
  day_index,
  slot_index,
  job_type,
  pay_type,
  hours_or_units,
  regular_hours,
  overtime_hours
)
select
  user_id,
  template_id,
  1,
  slot_index,
  job_type,
  pay_type,
  hours_or_units,
  regular_hours,
  overtime_hours
from pg_temp.monday_template_order
on conflict (template_id, day_index, slot_index) do update
  set
    job_type = excluded.job_type,
    pay_type = excluded.pay_type,
    hours_or_units = excluded.hours_or_units,
    regular_hours = excluded.regular_hours,
    overtime_hours = excluded.overtime_hours,
    updated_at = now();

insert into public.sticky_labels (user_id, day_index, slot_index, label)
select user_id, 1, slot_index, label
from pg_temp.monday_template_order
on conflict (user_id, day_index, slot_index) do update
  set label = excluded.label, updated_at = now();
