-- Clear the 'Lanesville' sticky label from Sunday (day_index = 0).
-- It's a generic Ability autofill shift; per the autofill rule, generic
-- Ability fillers should stay unlabeled (Tue–Sat already cleaned up in
-- 20260510162500_autofill_label_order_cleanup.sql; this finishes Sunday).

delete from public.sticky_labels
where day_index = 0
  and label ilike 'lanesville';

update public.earn_slots es
   set label = null
  from public.days d
  join public.weeks w on w.id = d.week_id
 where es.day_id = d.id
   and d.day_index = 0
   and w.start_date >= '2026-05-10'::date
   and es.label ilike 'lanesville';
