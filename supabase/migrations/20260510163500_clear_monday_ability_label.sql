-- Monday Ability split should load without a label. Prestige labels stay intact.

delete from public.sticky_labels
where day_index = 1
  and slot_index = 1;

update public.earn_slots es
set
  label = null,
  updated_at = now()
from public.days d
join public.weeks w on w.id = d.week_id
where es.day_id = d.id
  and w.start_date = '2026-05-10'::date
  and d.day_index = 1
  and es.slot_index = 1
  and es.job_type::text = 'ability';
