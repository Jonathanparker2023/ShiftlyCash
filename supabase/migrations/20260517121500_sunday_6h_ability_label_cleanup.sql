-- Clear the sticky label on Sunday's 6h Ability autofill shift, whatever the
-- label currently reads. Generic Ability fillers stay unlabeled per the rule
-- already applied to Tue–Sat in 20260510162500_autofill_label_order_cleanup.sql.

-- 1) Clear sticky_labels at the Sunday slot position(s) that correspond to a
--    6h Ability shift in the default template.
delete from public.sticky_labels sl
using public.template_slots ts,
      public.weekly_templates wt
where sl.user_id = wt.user_id
  and ts.template_id = wt.id
  and wt.is_default
  and sl.day_index = 0
  and ts.day_index = 0
  and sl.slot_index = ts.slot_index
  and ts.job_type = 'ability'
  and ts.hours_or_units = 6;

-- 2) Clear the label on the current and future week earn_slots that match
--    the same 6h Ability Sunday shift.
update public.earn_slots es
   set label = null
  from public.days d
  join public.weeks w on w.id = d.week_id
 where es.day_id = d.id
   and d.day_index = 0
   and w.start_date >= '2026-05-10'::date
   and es.job_type = 'ability'
   and es.hours_or_units = 6;
