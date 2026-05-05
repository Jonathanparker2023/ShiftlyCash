create or replace function public.apply_baseline_to_future_days(p_user_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_daily_base numeric(10, 2);
  v_count integer;
begin
  if p_user_id is null then
    return 0;
  end if;

  select coalesce(projected_daily_base, 0)
    into v_daily_base
  from public.v_active_expense_totals
  where user_id = p_user_id;

  v_daily_base := coalesce(v_daily_base, 0);

  update public.days
  set base_amount = v_daily_base
  where user_id = p_user_id
    and date >= current_date
    and base_amount is distinct from v_daily_base;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.apply_baseline_to_future_days(uuid) to authenticated;

-- Backfill existing users so already-created active weeks stop showing the
-- older seeded 52/57 defaults and start using the calculator value.
do $$
declare
  u record;
begin
  for u in select distinct user_id from public.expenses loop
    perform public.apply_baseline_to_future_days(u.user_id);
  end loop;
end $$;
