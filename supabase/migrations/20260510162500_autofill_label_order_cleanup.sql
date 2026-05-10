-- Clean up autofill ordering and labels for generic Ability shifts.
-- Rule: client-specific Prestige shifts keep names; generic Ability autofills
-- stay unnamed except the end-of-day Sunrise Cottage shifts on Thu/Fri/Sat.

create temporary table if not exists pg_temp.autofill_slot_plan (
  day_index integer not null,
  slot_index integer not null,
  job_type public.job_type not null,
  pay_type public.pay_type not null,
  hours_or_units numeric not null,
  regular_hours numeric not null,
  overtime_hours numeric not null,
  label text
) on commit drop;

truncate table pg_temp.autofill_slot_plan;

insert into pg_temp.autofill_slot_plan (
  day_index,
  slot_index,
  job_type,
  pay_type,
  hours_or_units,
  regular_hours,
  overtime_hours,
  label
)
values
  (2, 0, 'prestige', 'regular', 8, 8, 0, 'Joe'),
  (2, 1, 'ability', 'overtime', 12, 0, 12, null),
  (3, 0, 'ability', 'overtime', 12, 0, 12, null),
  (3, 1, 'prestige', 'regular', 2, 2, 0, 'Mike'),
  (4, 0, 'prestige', 'regular', 10, 10, 0, 'Mike'),
  (4, 1, 'ability', 'overtime', 6, 0, 6, null),
  (4, 2, 'ability', 'regular', 2, 2, 0, 'Sunrise Cottage'),
  (5, 0, 'prestige_ilst', 'split', 12, 4, 8, 'Nate'),
  (5, 1, 'ability', 'regular', 10, 10, 0, 'Sunrise Cottage'),
  (6, 0, 'ability', 'overtime', 6, 0, 6, null),
  (6, 1, 'ability', 'regular', 10, 10, 0, 'Sunrise Cottage');

delete from public.template_slots ts
using public.weekly_templates wt
where ts.template_id = wt.id
  and wt.is_default
  and ts.day_index between 2 and 6;

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
  wt.user_id,
  wt.id,
  plan.day_index,
  plan.slot_index,
  plan.job_type,
  plan.pay_type,
  plan.hours_or_units,
  plan.regular_hours,
  plan.overtime_hours
from public.weekly_templates wt
cross join pg_temp.autofill_slot_plan plan
where wt.is_default;

delete from public.sticky_labels
where day_index between 2 and 6;

insert into public.sticky_labels (user_id, day_index, slot_index, label)
select
  wt.user_id,
  plan.day_index,
  plan.slot_index,
  plan.label
from public.weekly_templates wt
cross join pg_temp.autofill_slot_plan plan
where wt.is_default
  and plan.label is not null
on conflict (user_id, day_index, slot_index) do update
  set label = excluded.label, updated_at = now();

delete from public.earn_slots es
using public.days d, public.weeks w
where es.day_id = d.id
  and w.id = d.week_id
  and w.start_date = '2026-05-10'::date
  and d.day_index between 2 and 6;

insert into public.earn_slots (
  user_id,
  day_id,
  slot_index,
  job_type,
  pay_type,
  hours_or_units,
  regular_hours,
  overtime_hours,
  label,
  source
)
select
  d.user_id,
  d.id,
  plan.slot_index,
  plan.job_type,
  plan.pay_type,
  plan.hours_or_units,
  plan.regular_hours,
  plan.overtime_hours,
  plan.label,
  'template'
from public.weeks w
join public.days d
  on d.week_id = w.id
cross join pg_temp.autofill_slot_plan plan
where w.start_date = '2026-05-10'::date
  and d.day_index = plan.day_index;
