-- CCF Saturday shift changed to 8 AM-5 PM, so the recurring template is 9h.
-- Scope: default weekly templates only. Existing dashboard/history rows are not
-- touched; this only changes future autofill from the Templates page.

with target_slots as (
  select ts.id
  from public.template_slots ts
  join public.weekly_templates wt
    on wt.id = ts.template_id
   and wt.user_id = ts.user_id
   and wt.is_default
  join public.custom_jobs cj
    on cj.id = ts.custom_job_id
   and cj.user_id = ts.user_id
  where ts.day_index = 6
    and ts.job_type = 'custom'
    and cj.name ilike '%ccf%'
)
update public.template_slots ts
set pay_type = 'regular',
    hours_or_units = 9,
    regular_hours = 9,
    overtime_hours = 0,
    incentive_mode = 'none',
    incentive_rate = 0,
    incentive_amount = 0,
    updated_at = now()
from target_slots target
where ts.id = target.id;
