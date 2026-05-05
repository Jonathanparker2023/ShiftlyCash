-- Seed wk1-wk13 (Jan 4 - Apr 4, 2026) as closed weeks for Jon.
-- Source: legacy History page screenshot. Only week-level totals are known
-- (no per-day shift breakdown), so each week gets:
--   - 7 days locked, all metrics rolled into day 0
--   - One 'other'/unit earn_slot on day 0 carrying the full week earnings
--   - manual_spend_adjustment + base_amount on day 0
-- Future: editing a historic week's day-by-day in the UI replaces this summary.

do $$
declare
  v_user_id uuid;
  v_week_id uuid;
  v_day0_id uuid;
  w record;
begin
  select id into v_user_id from auth.users where lower(email) = 'jay1park1@gmail.com' limit 1;
  if v_user_id is null then return; end if;

  for w in
    select * from (values
      ('2026-01-04'::date,  1, 1100,  1750,  240),
      ('2026-01-11'::date,  2, 1649,  216,   255),
      ('2026-01-18'::date,  3, 1381,  482,   301),
      ('2026-01-25'::date,  4, 2030,  2640,  308),
      ('2026-02-01'::date,  5, 1806,  823,   308),
      ('2026-02-08'::date,  6, 1386,  722,   308),
      ('2026-02-15'::date,  7, 1375,  1130,  308),
      ('2026-02-22'::date,  8, 3950,  1011,  286),
      ('2026-03-01'::date,  9, 1351,  402,   315),
      ('2026-03-08'::date, 10, 1946,  520,   315),
      ('2026-03-15'::date, 11, 1010,  896,   315),
      ('2026-03-22'::date, 12, 1149,  676,   315),
      ('2026-03-29'::date, 13, 1935,  831,   364)
    ) as t(start_date, wk_num, earn, spend, base_total)
  loop
    -- Skip if week already exists
    if exists (select 1 from public.weeks where user_id = v_user_id and start_date = w.start_date) then
      continue;
    end if;

    insert into public.weeks (user_id, start_date, end_date, status, closed_at)
    values (v_user_id, w.start_date, w.start_date + 6, 'closed', now())
    returning id into v_week_id;

    -- Day 0: Sun, holds the week's earn/spend/base
    insert into public.days (user_id, week_id, date, day_index, base_amount, manual_spend_adjustment, spend_locked)
    values (v_user_id, v_week_id, w.start_date, 0, w.base_total, w.spend, true)
    returning id into v_day0_id;

    -- Days 1-6: empty placeholders
    insert into public.days (user_id, week_id, date, day_index, base_amount, manual_spend_adjustment, spend_locked)
    select v_user_id, v_week_id, w.start_date + gs, gs, 0, 0, true
    from generate_series(1, 6) as gs;

    -- Single summary earn_slot on day 0
    insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source)
    values (v_user_id, v_day0_id, 0, 'other', 'unit', w.earn, 'Week ' || w.wk_num || ' summary (legacy)', 'migration');
  end loop;
end $$;
