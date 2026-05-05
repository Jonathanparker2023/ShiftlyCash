-- Seeds wk14 (Apr 5-11) and wk15 (Apr 12-18) as closed weeks for Jon.
-- Source: legacy restore-week15.js + WEEK15_DATA constants in index.html.
-- Wk15 Tue had 5 slots in legacy (over the 4-slot limit) — $2 'other' dropped.

do $$
declare
  v_user_id uuid;
  v_wk14_id uuid;
  v_wk15_id uuid;
  v_day_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = 'jay1park1@gmail.com' limit 1;
  if v_user_id is null then
    raise exception 'User not found';
  end if;

  if exists (select 1 from public.weeks where user_id = v_user_id and start_date in ('2026-04-05','2026-04-12')) then
    raise notice 'Wk14 or wk15 already exist; aborting.';
    return;
  end if;

  -- ============= WEEK 14 (Apr 5-11, 2026) =============
  insert into public.weeks (user_id, start_date, end_date, status, closed_at)
  values (v_user_id, '2026-04-05', '2026-04-11', 'closed', now())
  returning id into v_wk14_id;

  insert into public.days (user_id, week_id, date, day_index, base_amount, manual_spend_adjustment, spend_locked) values
    (v_user_id, v_wk14_id, '2026-04-05', 0, 52, 60,  true),
    (v_user_id, v_wk14_id, '2026-04-06', 1, 52, 54,  true),
    (v_user_id, v_wk14_id, '2026-04-07', 2, 52, 133, true),
    (v_user_id, v_wk14_id, '2026-04-08', 3, 52, 29,  true),
    (v_user_id, v_wk14_id, '2026-04-09', 4, 52, 75,  true),
    (v_user_id, v_wk14_id, '2026-04-10', 5, 52, 53,  true),
    (v_user_id, v_wk14_id, '2026-04-11', 6, 57, 33,  true);

  -- Sun Apr 5: $41 incentive + 7.5h prestige reg + 8h ability reg (Sunrise Cottage) + $80 other
  select id into v_day_id from public.days where week_id = v_wk14_id and day_index = 0;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'incentive','unit',    41,  null,              'migration'),
    (v_user_id, v_day_id, 1, 'prestige', 'regular', 7.5, null,              'migration'),
    (v_user_id, v_day_id, 2, 'ability',  'regular', 8,   'Sunrise Cottage', 'migration'),
    (v_user_id, v_day_id, 3, 'other',    'unit',    80,  null,              'migration');

  -- Mon Apr 6: 13h prestige reg + 6.5h ability ot + 2.5h ability reg
  select id into v_day_id from public.days where week_id = v_wk14_id and day_index = 1;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'prestige', 'regular',  13,  'Tony/Joe', 'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'overtime', 6.5, null,       'migration'),
    (v_user_id, v_day_id, 2, 'ability',  'regular',  2.5, null,       'migration');

  -- Tue Apr 7: 8h prestige reg + 14h ability ot + 1h ability ot
  select id into v_day_id from public.days where week_id = v_wk14_id and day_index = 2;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'prestige', 'regular',  8,  'Joe', 'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'overtime', 14, null,  'migration'),
    (v_user_id, v_day_id, 2, 'ability',  'overtime', 1,  null,  'migration');

  -- Wed Apr 8: 8h ability ot + 4h ability ot + 2h prestige reg
  select id into v_day_id from public.days where week_id = v_wk14_id and day_index = 3;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'ability',  'overtime', 8, null,   'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'overtime', 4, null,   'migration'),
    (v_user_id, v_day_id, 2, 'prestige', 'regular',  2, 'Mike', 'migration');

  -- Thu Apr 9: 10h prestige reg + 6h ability ot + 2h ability reg (Sunrise Cottage) + $20 other
  select id into v_day_id from public.days where week_id = v_wk14_id and day_index = 4;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'prestige', 'regular',  10, 'Mike',            'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'overtime', 6,  null,              'migration'),
    (v_user_id, v_day_id, 2, 'ability',  'regular',  2,  'Sunrise Cottage', 'migration'),
    (v_user_id, v_day_id, 3, 'other',    'unit',     20, null,              'migration');

  -- Fri Apr 10: 6h ability ot + 10h ability reg (Sunrise Cottage) + $13 incentive
  select id into v_day_id from public.days where week_id = v_wk14_id and day_index = 5;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'ability',  'overtime', 6,  null,              'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'regular',  10, 'Sunrise Cottage', 'migration'),
    (v_user_id, v_day_id, 2, 'incentive','unit',     13, null,              'migration');

  -- Sat Apr 11: 10h ability reg (Sunrise Cottage) + 6h ability ot + $10 other
  select id into v_day_id from public.days where week_id = v_wk14_id and day_index = 6;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'ability', 'regular',  10, 'Sunrise Cottage', 'migration'),
    (v_user_id, v_day_id, 1, 'ability', 'overtime', 6,  null,              'migration'),
    (v_user_id, v_day_id, 2, 'other',   'unit',     10, null,              'migration');


  -- ============= WEEK 15 (Apr 12-18, 2026) =============
  insert into public.weeks (user_id, start_date, end_date, status, closed_at)
  values (v_user_id, '2026-04-12', '2026-04-18', 'closed', now())
  returning id into v_wk15_id;

  insert into public.days (user_id, week_id, date, day_index, base_amount, manual_spend_adjustment, spend_locked) values
    (v_user_id, v_wk15_id, '2026-04-12', 0, 56, 146, true),
    (v_user_id, v_wk15_id, '2026-04-13', 1, 58, 58,  true),
    (v_user_id, v_wk15_id, '2026-04-14', 2, 59, 123, true),
    (v_user_id, v_wk15_id, '2026-04-15', 3, 54, 31,  true),
    (v_user_id, v_wk15_id, '2026-04-16', 4, 56, 74,  true),
    (v_user_id, v_wk15_id, '2026-04-17', 5, 56, 219, true),
    (v_user_id, v_wk15_id, '2026-04-18', 6, 56, 27,  true);

  -- Sun Apr 12: 6h ability reg (Chevron) + 8h ability reg (Nicholas) + $20 incentive (Nicholas) + 2h prestige reg
  select id into v_day_id from public.days where week_id = v_wk15_id and day_index = 0;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'ability',  'regular', 6,  'Chevron',  'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'regular', 8,  'Nicholas', 'migration'),
    (v_user_id, v_day_id, 2, 'incentive','unit',    20, 'Nicholas', 'migration'),
    (v_user_id, v_day_id, 3, 'prestige', 'regular', 2,  'Tony',     'migration');

  -- Mon Apr 13: 10h prestige reg + 4h ability reg
  select id into v_day_id from public.days where week_id = v_wk15_id and day_index = 1;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'prestige', 'regular', 10, 'Tony/Joe', 'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'regular', 4,  null,       'migration');

  -- Tue Apr 14: 8h prestige reg + 3h ability reg + 5.5h ability ot (Reilly) + $5 incentive (Reilly) [$2 other dropped — over slot limit]
  select id into v_day_id from public.days where week_id = v_wk15_id and day_index = 2;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'prestige', 'regular',  8,    'Joe',    'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'regular',  3,    null,     'migration'),
    (v_user_id, v_day_id, 2, 'ability',  'overtime', 5.5,  'Reilly', 'migration'),
    (v_user_id, v_day_id, 3, 'incentive','unit',     5,    'Reilly', 'migration');

  -- Wed Apr 15: 6h ability ot (West St Bowtown) + 2h prestige reg
  select id into v_day_id from public.days where week_id = v_wk15_id and day_index = 3;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'ability',  'overtime', 6, 'West St Bowtown', 'migration'),
    (v_user_id, v_day_id, 1, 'prestige', 'regular',  2, 'Mike',            'migration');

  -- Thu Apr 16: 6h prestige reg + 2h ability ot (Sunrise Cottage)
  select id into v_day_id from public.days where week_id = v_wk15_id and day_index = 4;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'prestige', 'regular',  6, 'Mike',            'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'overtime', 2, 'Sunrise Cottage', 'migration');

  -- Fri Apr 17: 10h ability reg (Sunrise Cottage) + 4h ability ot
  select id into v_day_id from public.days where week_id = v_wk15_id and day_index = 5;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'ability', 'regular',  10, 'Sunrise Cottage', 'migration'),
    (v_user_id, v_day_id, 1, 'ability', 'overtime', 4,  null,              'migration');

  -- Sat Apr 18: 10h ability reg (Sunrise Cottage) + 4h ability ot
  select id into v_day_id from public.days where week_id = v_wk15_id and day_index = 6;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'ability', 'regular',  10, 'Sunrise Cottage', 'migration'),
    (v_user_id, v_day_id, 1, 'ability', 'overtime', 4,  null,              'migration');
end $$;
