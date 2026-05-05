-- Seeds historic weeks 16 (Apr 19-25) and 17 (Apr 26-May 2) as closed weeks
-- for Jon. Wk16 ability hours from Ultipro + standard prestige template.
-- Wk17 from recovered legacy data. Existing Plaid transactions in date range
-- get linked to the new days automatically (no transaction inserts here).

do $$
declare
  v_user_id uuid;
  v_wk16_id uuid;
  v_wk17_id uuid;
  v_day_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = 'jay1park1@gmail.com' limit 1;
  if v_user_id is null then
    raise exception 'User jay1park1@gmail.com not found';
  end if;

  if exists (select 1 from public.weeks where user_id = v_user_id and start_date in ('2026-04-19','2026-04-26')) then
    raise notice 'Weeks 16 or 17 already exist; aborting to avoid duplicate inserts.';
    return;
  end if;

  -- ============= WEEK 16 (Apr 19 - Apr 25, 2026) =============
  insert into public.weeks (user_id, start_date, end_date, status, closed_at)
  values (v_user_id, '2026-04-19', '2026-04-25', 'closed', now())
  returning id into v_wk16_id;

  insert into public.days (user_id, week_id, date, day_index, base_amount, manual_spend_adjustment, spend_locked) values
    (v_user_id, v_wk16_id, '2026-04-19', 0, 52, 0, true),
    (v_user_id, v_wk16_id, '2026-04-20', 1, 52, 0, true),
    (v_user_id, v_wk16_id, '2026-04-21', 2, 52, 0, true),
    (v_user_id, v_wk16_id, '2026-04-22', 3, 52, 0, true),
    (v_user_id, v_wk16_id, '2026-04-23', 4, 52, 0, true),
    (v_user_id, v_wk16_id, '2026-04-24', 5, 52, 0, true),
    (v_user_id, v_wk16_id, '2026-04-25', 6, 57, 0, true);

  -- Sun Apr 19
  select id into v_day_id from public.days where week_id = v_wk16_id and day_index = 0;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'ability',  'regular', 2.95, 'Sunrise Cottage', 'migration'),
    (v_user_id, v_day_id, 1, 'prestige', 'regular', 3,    'Tony',            'migration');

  -- Mon Apr 20
  select id into v_day_id from public.days where week_id = v_wk16_id and day_index = 1;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'prestige', 'regular', 13,   'Tony/Joe', 'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'regular', 5.87, null,       'migration');

  -- Tue Apr 21
  select id into v_day_id from public.days where week_id = v_wk16_id and day_index = 2;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'prestige', 'regular',  8,     'Joe', 'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'regular',  1.18,  null,  'migration'),
    (v_user_id, v_day_id, 2, 'ability',  'overtime', 14.78, null,  'migration');

  -- Wed Apr 22
  select id into v_day_id from public.days where week_id = v_wk16_id and day_index = 3;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'prestige', 'regular',  2,    'Mike', 'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'overtime', 4.58, null,   'migration');

  -- Thu Apr 23
  select id into v_day_id from public.days where week_id = v_wk16_id and day_index = 4;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'prestige', 'regular', 10, 'Mike',            'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'regular', 10, 'Sunrise Cottage', 'migration');

  -- Fri Apr 24
  select id into v_day_id from public.days where week_id = v_wk16_id and day_index = 5;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'prestige', 'regular',  4,    'Nate',            'migration'),
    (v_user_id, v_day_id, 1, 'prestige', 'overtime', 8,    'Nate',            'migration'),
    (v_user_id, v_day_id, 2, 'ability',  'regular',  10,   'Sunrise Cottage', 'migration'),
    (v_user_id, v_day_id, 3, 'ability',  'overtime', 4.97, null,              'migration');

  -- Sat Apr 25
  select id into v_day_id from public.days where week_id = v_wk16_id and day_index = 6;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'ability', 'regular',  10,   'Sunrise Cottage', 'migration'),
    (v_user_id, v_day_id, 1, 'ability', 'overtime', 4.80, null,              'migration');

  -- ============= WEEK 17 (Apr 26 - May 2, 2026) =============
  insert into public.weeks (user_id, start_date, end_date, status, closed_at)
  values (v_user_id, '2026-04-26', '2026-05-02', 'closed', now())
  returning id into v_wk17_id;

  insert into public.days (user_id, week_id, date, day_index, base_amount, manual_spend_adjustment, spend_locked) values
    (v_user_id, v_wk17_id, '2026-04-26', 0, 62, 76,  true),
    (v_user_id, v_wk17_id, '2026-04-27', 1, 55, 86,  true),
    (v_user_id, v_wk17_id, '2026-04-28', 2, 59, 98,  true),
    (v_user_id, v_wk17_id, '2026-04-29', 3, 60, 132, true),
    (v_user_id, v_wk17_id, '2026-04-30', 4, 55, 134, true),
    (v_user_id, v_wk17_id, '2026-05-01', 5, 59, 89,  true),
    (v_user_id, v_wk17_id, '2026-05-02', 6, 60, 207, true);

  -- Sun Apr 26
  select id into v_day_id from public.days where week_id = v_wk17_id and day_index = 0;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'ability',  'regular', 8, 'Sunrise Cottage', 'migration'),
    (v_user_id, v_day_id, 1, 'prestige', 'regular', 3, 'Tony',            'migration');

  -- Mon Apr 27
  select id into v_day_id from public.days where week_id = v_wk17_id and day_index = 1;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'prestige', 'regular', 13, 'Tony/Joe', 'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'regular', 8,  null,       'migration');

  -- Tue Apr 28
  select id into v_day_id from public.days where week_id = v_wk17_id and day_index = 2;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'prestige', 'regular',  8,   'Joe', 'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'regular',  2,   null,  'migration'),
    (v_user_id, v_day_id, 2, 'ability',  'overtime', 5.5, null,  'migration'),
    (v_user_id, v_day_id, 3, 'ability',  'overtime', 1,   null,  'migration');

  -- Wed Apr 29
  select id into v_day_id from public.days where week_id = v_wk17_id and day_index = 3;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'prestige', 'regular',  2,   'Mike', 'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'overtime', 7.5, null,   'migration'),
    (v_user_id, v_day_id, 2, 'ability',  'overtime', 6,   null,   'migration');

  -- Thu Apr 30
  select id into v_day_id from public.days where week_id = v_wk17_id and day_index = 4;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'prestige', 'regular', 10,  'Mike',            'migration'),
    (v_user_id, v_day_id, 1, 'ability',  'regular', 2,   'Sunrise Cottage', 'migration'),
    (v_user_id, v_day_id, 2, 'other',    'unit',    335, null,              'migration');

  -- Fri May 1
  select id into v_day_id from public.days where week_id = v_wk17_id and day_index = 5;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'prestige', 'regular',  4,  'Nate',            'migration'),
    (v_user_id, v_day_id, 1, 'prestige', 'overtime', 8,  'Nate',            'migration'),
    (v_user_id, v_day_id, 2, 'ability',  'regular',  10, 'Sunrise Cottage', 'migration'),
    (v_user_id, v_day_id, 3, 'ability',  'overtime', 2,  null,              'migration');

  -- Sat May 2
  select id into v_day_id from public.days where week_id = v_wk17_id and day_index = 6;
  insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source) values
    (v_user_id, v_day_id, 0, 'ability', 'regular',  10, 'Sunrise Cottage', 'migration'),
    (v_user_id, v_day_id, 1, 'ability', 'overtime', 6,  null,              'migration'),
    (v_user_id, v_day_id, 2, 'other',   'unit',     50, null,              'migration');

  -- ============= LINK existing Plaid transactions to new days =============
  -- Any pending_review or applied transactions in the date range get linked
  -- to the new days. Transactions already linked (day_id is not null) stay.
  update public.transactions t
  set day_id = d.id, status = 'applied'
  from public.days d
  where t.user_id = v_user_id
    and t.day_id is null
    and t.status in ('pending_review','applied')
    and t.date = d.date
    and d.user_id = v_user_id
    and d.week_id in (v_wk16_id, v_wk17_id);
end $$;
