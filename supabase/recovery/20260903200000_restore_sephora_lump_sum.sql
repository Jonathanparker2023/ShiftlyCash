-- Recovery for 20260903200000_restore_sephora_fixed_payoff.sql.
-- Run only if Jon explicitly returns to charge-date accounting for Sephora.

do $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id
  from public.transactions
  where id = '14be2536-499f-4010-a3fc-1cfc4c94fa2b'
    and status = 'excluded'
    and review_reason = 'fixed_expense_payoff';

  if v_user_id is null then
    raise exception 'The corrected Sephora transaction was not found.';
  end if;

  update public.days
  set base_amount = greatest(0, round(base_amount - 2.64, 2))
  where user_id = v_user_id
    and date between date '2026-09-01'
      and least(current_date - 1, date '2026-11-30');

  update public.transactions
  set status = 'applied',
      review_reason = null,
      excluded_at = null,
      notes = 'Restored to charge-date Spending after reversing the $80/month Fixed payoff model.',
      updated_at = now()
  where id = '14be2536-499f-4010-a3fc-1cfc4c94fa2b'
    and user_id = v_user_id
    and date = date '2026-08-24'
    and amount = 219.35
    and raw_name = 'Sephora Card — first purchase';

  update public.expenses
  set is_active = false,
      updated_at = now()
  where id = '491df87d-f7ce-4d68-a2a4-206278500e7d'
    and user_id = v_user_id
    and name = 'Sephora card payoff';

  perform public.apply_baseline_to_future_days(v_user_id);
end $$;
