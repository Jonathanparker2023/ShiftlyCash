-- Backfill labels onto existing earn_slots that exactly match a template slot
-- but have a NULL label. Only touches slots where (job_type, pay_type,
-- hours_or_units) match the template AND label is null. Won't surprise the user
-- by relabeling anything customized.

update public.earn_slots es
set label = matched.label,
    updated_at = now()
from (
  select
    es2.id,
    sl.label
  from public.earn_slots es2
  join public.days d on d.id = es2.day_id and d.user_id = es2.user_id
  join public.template_slots ts
    on ts.user_id = es2.user_id
    and ts.day_index = d.day_index
    and ts.slot_index = es2.slot_index
  join public.sticky_labels sl
    on sl.user_id = es2.user_id
    and sl.day_index = d.day_index
    and sl.slot_index = es2.slot_index
  where es2.label is null
    and es2.job_type = ts.job_type
    and es2.pay_type = ts.pay_type
    and es2.hours_or_units = ts.hours_or_units
) as matched
where es.id = matched.id;
