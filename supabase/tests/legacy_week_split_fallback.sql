begin;

select plan(2);

select lives_ok(
  $$
    with test_ids as (
      select
        '00000000-0000-4000-8000-000000000031'::uuid as user_id,
        '00000000-0000-4000-8000-000000000032'::uuid as week_id,
        '00000000-0000-4000-8000-000000000033'::uuid as day_id
    )
    insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
    select user_id, 'authenticated', 'authenticated', 'legacy-summary-test@example.com', now(), now(), now()
    from test_ids
    on conflict (id) do nothing;

    with test_ids as (
      select '00000000-0000-4000-8000-000000000031'::uuid as user_id
    )
    insert into public.profiles (id, email)
    select user_id, 'legacy-summary-test@example.com'
    from test_ids
    on conflict (id) do nothing;

    with test_ids as (
      select '00000000-0000-4000-8000-000000000031'::uuid as user_id
    )
    insert into public.settings (user_id)
    select user_id
    from test_ids
    on conflict (user_id) do nothing;

    with test_ids as (
      select
        '00000000-0000-4000-8000-000000000031'::uuid as user_id,
        '00000000-0000-4000-8000-000000000032'::uuid as week_id
    )
    insert into public.weeks (id, user_id, start_date, end_date, status, closed_at)
    select week_id, user_id, '2026-01-04'::date, '2026-01-10'::date, 'closed', now()
    from test_ids;

    with test_ids as (
      select
        '00000000-0000-4000-8000-000000000031'::uuid as user_id,
        '00000000-0000-4000-8000-000000000032'::uuid as week_id,
        '00000000-0000-4000-8000-000000000033'::uuid as day_id
    )
    insert into public.days (id, user_id, week_id, date, day_index, base_amount, manual_spend_adjustment, spend_locked)
    select day_id, user_id, week_id, '2026-01-04'::date, 0, 0, 0, true
    from test_ids;

    with test_ids as (
      select
        '00000000-0000-4000-8000-000000000031'::uuid as user_id,
        '00000000-0000-4000-8000-000000000033'::uuid as day_id
    )
    insert into public.earn_slots (user_id, day_id, slot_index, job_type, pay_type, hours_or_units, label, source)
    select user_id, day_id, 0, 'other', 'unit', 1000, 'Week 1 summary (legacy)', 'migration'
    from test_ids;
  $$,
  'can seed a synthetic summary-only legacy week'
);

select results_eq(
  $$
    select
      earnings_total,
      ability_paycheck_earnings,
      prestige_paycheck_earnings
    from public.v_week_totals
    where user_id = '00000000-0000-4000-8000-000000000031'::uuid
      and start_date = '2026-01-04'::date
  $$,
  $$
    values (1000.00::numeric(12, 2), 680.00::numeric(12, 2), 320.00::numeric(12, 2))
  $$,
  'v_week_totals applies the legacy 68/32 fallback only from summary input'
);

select * from finish();

rollback;
