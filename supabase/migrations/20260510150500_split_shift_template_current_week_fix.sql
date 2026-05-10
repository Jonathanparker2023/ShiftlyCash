-- Refine split-shift presets and backfill the already-open week of
-- 2026-05-10 through 2026-05-16.

-- Monday preset: Tony 9h, Joe 4h, then Ability split 4 REG / 2 OT.
update public.template_slots
set
  job_type = 'prestige',
  pay_type = 'regular',
  hours_or_units = 9,
  regular_hours = 9,
  overtime_hours = 0,
  updated_at = now()
where day_index = 1
  and slot_index = 0;

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
  1,
  1,
  'prestige'::public.job_type,
  'regular'::public.pay_type,
  4,
  4,
  0
from public.weekly_templates wt
where wt.is_default
on conflict (template_id, day_index, slot_index) do update
  set
    job_type = excluded.job_type,
    pay_type = excluded.pay_type,
    hours_or_units = excluded.hours_or_units,
    regular_hours = excluded.regular_hours,
    overtime_hours = excluded.overtime_hours,
    updated_at = now();

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
  1,
  2,
  'ability'::public.job_type,
  'split'::public.pay_type,
  6,
  4,
  2
from public.weekly_templates wt
where wt.is_default
on conflict (template_id, day_index, slot_index) do update
  set
    job_type = excluded.job_type,
    pay_type = excluded.pay_type,
    hours_or_units = excluded.hours_or_units,
    regular_hours = excluded.regular_hours,
    overtime_hours = excluded.overtime_hours,
    updated_at = now();

-- Friday preset: Nate remains Prestige ILST split under the hood, and
-- Sunrise moves back to the Ability slot label.
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
  5,
  0,
  'prestige_ilst'::public.job_type,
  'split'::public.pay_type,
  12,
  4,
  8
from public.weekly_templates wt
where wt.is_default
on conflict (template_id, day_index, slot_index) do update
  set
    job_type = excluded.job_type,
    pay_type = excluded.pay_type,
    hours_or_units = excluded.hours_or_units,
    regular_hours = excluded.regular_hours,
    overtime_hours = excluded.overtime_hours,
    updated_at = now();

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
  5,
  1,
  'ability'::public.job_type,
  'regular'::public.pay_type,
  10,
  10,
  0
from public.weekly_templates wt
where wt.is_default
on conflict (template_id, day_index, slot_index) do update
  set
    job_type = excluded.job_type,
    pay_type = excluded.pay_type,
    hours_or_units = excluded.hours_or_units,
    regular_hours = excluded.regular_hours,
    overtime_hours = excluded.overtime_hours,
    updated_at = now();

-- Keep labels aligned with the new template positions.
insert into public.sticky_labels (user_id, day_index, slot_index, label)
select wt.user_id, 1, 0, 'Tony'
from public.weekly_templates wt
where wt.is_default
on conflict (user_id, day_index, slot_index) do update
  set label = excluded.label, updated_at = now();

insert into public.sticky_labels (user_id, day_index, slot_index, label)
select wt.user_id, 1, 1, 'Joe'
from public.weekly_templates wt
where wt.is_default
on conflict (user_id, day_index, slot_index) do update
  set label = excluded.label, updated_at = now();

insert into public.sticky_labels (user_id, day_index, slot_index, label)
select wt.user_id, 1, 2, 'Sunrise Cottage'
from public.weekly_templates wt
where wt.is_default
on conflict (user_id, day_index, slot_index) do update
  set label = excluded.label, updated_at = now();

insert into public.sticky_labels (user_id, day_index, slot_index, label)
select wt.user_id, 5, 0, 'Nate'
from public.weekly_templates wt
where wt.is_default
on conflict (user_id, day_index, slot_index) do update
  set label = excluded.label, updated_at = now();

insert into public.sticky_labels (user_id, day_index, slot_index, label)
select wt.user_id, 5, 1, 'Sunrise Cottage'
from public.weekly_templates wt
where wt.is_default
on conflict (user_id, day_index, slot_index) do update
  set label = excluded.label, updated_at = now();

delete from public.sticky_labels
where day_index = 5
  and slot_index = 2
  and label = 'Sunrise Cottage';

-- Backfill the active week that was already created from the old template.
update public.earn_slots es
set
  job_type = 'prestige',
  pay_type = 'regular',
  hours_or_units = 9,
  regular_hours = 9,
  overtime_hours = 0,
  label = 'Tony',
  updated_at = now()
from public.days d
join public.weeks w on w.id = d.week_id
where es.day_id = d.id
  and w.start_date = '2026-05-10'::date
  and d.day_index = 1
  and es.slot_index = 0;

update public.earn_slots es
set
  job_type = 'prestige',
  pay_type = 'regular',
  hours_or_units = 4,
  regular_hours = 4,
  overtime_hours = 0,
  label = 'Joe',
  updated_at = now()
from public.days d
join public.weeks w on w.id = d.week_id
where es.day_id = d.id
  and w.start_date = '2026-05-10'::date
  and d.day_index = 1
  and es.slot_index = 1;

update public.earn_slots es
set
  job_type = 'ability',
  pay_type = 'split',
  hours_or_units = 6,
  regular_hours = 4,
  overtime_hours = 2,
  label = 'Sunrise Cottage',
  updated_at = now()
from public.days d
join public.weeks w on w.id = d.week_id
where es.day_id = d.id
  and w.start_date = '2026-05-10'::date
  and d.day_index = 1
  and es.slot_index = 2;

update public.earn_slots es
set
  job_type = 'prestige_ilst',
  pay_type = 'split',
  hours_or_units = 12,
  regular_hours = 4,
  overtime_hours = 8,
  label = 'Nate',
  updated_at = now()
from public.days d
join public.weeks w on w.id = d.week_id
where es.day_id = d.id
  and w.start_date = '2026-05-10'::date
  and d.day_index = 5
  and es.slot_index = 0;

delete from public.earn_slots es
using public.days d, public.weeks w
where es.day_id = d.id
  and w.id = d.week_id
  and w.start_date = '2026-05-10'::date
  and d.day_index = 5
  and es.slot_index = 1;

update public.earn_slots es
set
  slot_index = 1,
  job_type = 'ability',
  pay_type = 'regular',
  hours_or_units = 10,
  regular_hours = 10,
  overtime_hours = 0,
  label = 'Sunrise Cottage',
  updated_at = now()
from public.days d
join public.weeks w on w.id = d.week_id
where es.day_id = d.id
  and w.start_date = '2026-05-10'::date
  and d.day_index = 5
  and es.slot_index = 2;
