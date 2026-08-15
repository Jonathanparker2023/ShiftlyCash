-- Replace the old Ford-only figure with the confirmed Progressive policy
-- transition. The August rate begins after Onyx ended; the combined-car rate
-- starts automatically on September 1, so only one insurance line counts at a
-- time.
do $$
declare
  v_user_id uuid;
begin
  select id
    into v_user_id
  from auth.users
  where lower(email) = 'jay1park1@gmail.com';

  if v_user_id is null then
    raise exception 'Bashflow owner was not found.';
  end if;

  update public.expenses
  set name = 'Auto Insurance (Progressive — August 2026)',
      amount = 372.25,
      starts_on = date '2026-08-13',
      expiration_date = date '2026-08-31',
      is_active = true,
      updated_at = now()
  where user_id = v_user_id
    and name in ('Ford Insurance', 'Auto Insurance (Progressive — August 2026)');

  if not found then
    raise exception 'Ford Insurance was not found; refusing to create a duplicate insurance line.';
  end if;

  insert into public.expenses (
    user_id,
    name,
    amount,
    starts_on,
    expiration_date,
    is_active,
    sort_order
  )
  values (
    v_user_id,
    'Auto Insurance (Progressive)',
    493.75,
    date '2026-09-01',
    null,
    true,
    310
  )
  on conflict (user_id, name) do update
    set amount = excluded.amount,
        starts_on = excluded.starts_on,
        expiration_date = excluded.expiration_date,
        is_active = excluded.is_active,
        sort_order = excluded.sort_order,
        updated_at = now();

  perform public.restamp_recent_baseline(v_user_id, 45);
end;
$$;
