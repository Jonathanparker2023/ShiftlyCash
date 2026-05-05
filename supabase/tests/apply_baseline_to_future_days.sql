begin;

select plan(5);

select lives_ok(
  $$
    with ids as (
      select '00000000-0000-4000-8000-000000000501'::uuid as user_id
    )
    insert into auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
    select user_id, 'authenticated', 'authenticated', 'baseline-apply-test@example.com', now(), now(), now()
    from ids
    on conflict (id) do nothing;

    with ids as (
      select '00000000-0000-4000-8000-000000000501'::uuid as user_id
    )
    insert into public.profiles (id, email)
    select user_id, 'baseline-apply-test@example.com'
    from ids
    on conflict (id) do nothing;

    with ids as (
      select '00000000-0000-4000-8000-000000000501'::uuid as user_id
    )
    insert into public.settings (user_id)
    select user_id
    from ids
    on conflict (user_id) do nothing;

    with ids as (
      select
        '00000000-0000-4000-8000-000000000501'::uuid as user_id,
        '00000000-0000-4000-8000-000000000502'::uuid as week_id,
        (current_date - extract(dow from current_date)::integer)::date as week_start
    )
    insert into public.weeks (id, user_id, start_date, end_date, status)
    select week_id, user_id, week_start, week_start + 6, 'active'
    from ids;

    with ids as (
      select
        '00000000-0000-4000-8000-000000000501'::uuid as user_id,
        '00000000-0000-4000-8000-000000000502'::uuid as week_id,
        (current_date - extract(dow from current_date)::integer)::date as week_start
    )
    insert into public.days (user_id, week_id, date, day_index, base_amount)
    select
      user_id,
      week_id,
      week_start + gs.day_index,
      gs.day_index,
      case when gs.day_index = 6 then 57.00 else 52.00 end
    from ids
    cross join generate_series(0, 6) as gs(day_index);

    with ids as (
      select
        '00000000-0000-4000-8000-000000000501'::uuid as user_id,
        '00000000-0000-4000-8000-000000000503'::uuid as week_id,
        (current_date - extract(dow from current_date)::integer - 7)::date as week_start
    )
    insert into public.weeks (id, user_id, start_date, end_date, status, closed_at)
    select week_id, user_id, week_start, week_start + 6, 'closed', now()
    from ids;

    with ids as (
      select
        '00000000-0000-4000-8000-000000000501'::uuid as user_id,
        '00000000-0000-4000-8000-000000000503'::uuid as week_id,
        (current_date - extract(dow from current_date)::integer - 7)::date as week_start
    )
    insert into public.days (user_id, week_id, date, day_index, base_amount)
    select user_id, week_id, week_start + 6, 6, 99.00
    from ids;

    with ids as (
      select '00000000-0000-4000-8000-000000000501'::uuid as user_id
    )
    insert into public.expenses (user_id, name, amount, expiration_date, is_active, sort_order)
    select user_id, 'Car Payment', 455.00, null, true, 10 from ids
    union all
    select user_id, 'Car Insurance', 279.00, null, true, 20 from ids;
  $$,
  'can seed baseline apply fixture'
);

select ok(
  public.apply_baseline_to_future_days('00000000-0000-4000-8000-000000000501'::uuid) > 0,
  'first apply updates today and future day rows'
);

select results_eq(
  $$
    select count(*)
    from public.days d
    join public.v_active_expense_totals t on t.user_id = d.user_id
    where d.user_id = '00000000-0000-4000-8000-000000000501'::uuid
      and d.date >= current_date
      and d.base_amount is distinct from t.projected_daily_base
  $$,
  $$ values (0::bigint) $$,
  'today and future days match projected_daily_base'
);

select results_eq(
  $$
    select base_amount
    from public.days
    where user_id = '00000000-0000-4000-8000-000000000501'::uuid
      and date < current_date
    order by date
    limit 1
  $$,
  $$ values (99.00::numeric(10, 2)) $$,
  'past days are not modified'
);

select results_eq(
  $$
    select public.apply_baseline_to_future_days('00000000-0000-4000-8000-000000000501'::uuid)
  $$,
  $$ values (0) $$,
  'second apply is idempotent'
);

select * from finish();

rollback;
