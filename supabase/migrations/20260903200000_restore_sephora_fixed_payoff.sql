-- Jon reversed the September 2 accounting choice: the August 24 Sephora
-- purchase must not enter Spending as a lump sum. Model the payoff as an
-- $80/month Fixed obligation instead, while preserving the card balance as debt.

do $$
declare
  v_user_id uuid;
  v_transaction_id uuid := '14be2536-499f-4010-a3fc-1cfc4c94fa2b';
  v_expense_id uuid := '491df87d-f7ce-4d68-a2a4-206278500e7d';
  v_day_spend_before numeric(12, 2);
  v_daily_before numeric(10, 2);
  v_daily_after numeric(10, 2);
  v_daily_delta numeric(10, 2);
begin
  select id into v_user_id
  from auth.users
  where lower(email) = 'jay1park1@gmail.com'
  limit 1;

  if v_user_id is null then
    raise exception 'BashFlow owner was not found.';
  end if;

  if (
    select count(*)
    from public.transactions
    where id = v_transaction_id
      and user_id = v_user_id
      and date = date '2026-08-24'
      and amount = 219.35
      and merchant_name = 'Sephora'
      and raw_name = 'Sephora Card — first purchase'
      and source = 'manual'
      and status = 'applied'
  ) <> 1 then
    raise exception 'Expected the single applied $219.35 Sephora purchase.';
  end if;

  if (
    select count(*)
    from public.expenses
    where id = v_expense_id
      and user_id = v_user_id
      and name = 'Sephora card payoff'
      and amount = 80.00
      and starts_on = date '2026-09-01'
      and expiration_date = date '2026-11-30'
      and not is_active
  ) <> 1 then
    raise exception 'Expected the inactive $80 Sephora Fixed payoff row.';
  end if;

  select transaction_spend_total into v_day_spend_before
  from public.v_day_totals
  where user_id = v_user_id
    and date = date '2026-08-24';

  select projected_daily_base into v_daily_before
  from public.v_active_expense_totals
  where user_id = v_user_id;

  if v_day_spend_before is null or v_daily_before is null then
    raise exception 'Required BashFlow totals were not found.';
  end if;

  update public.transactions
  set status = 'excluded',
      review_reason = 'fixed_expense_payoff',
      excluded_at = now(),
      notes = 'Jon confirmed September 3, 2026: do not count this purchase as a lump-sum expense. The card payoff is modeled in Fixed at $80/month until paid; posted card-payment transfers must remain excluded.',
      updated_at = now()
  where id = v_transaction_id
    and user_id = v_user_id;

  update public.expenses
  set is_active = true,
      amount = 80.00,
      starts_on = date '2026-09-01',
      expiration_date = date '2026-11-30',
      updated_at = now()
  where id = v_expense_id
    and user_id = v_user_id;

  select projected_daily_base into v_daily_after
  from public.v_active_expense_totals
  where user_id = v_user_id;

  v_daily_delta := v_daily_after - v_daily_before;

  if v_daily_delta <> 2.64 then
    raise exception 'Unexpected Sephora daily Fixed delta: %', v_daily_delta;
  end if;

  -- apply_baseline_to_future_days begins today. Restore the same aggregate
  -- Fixed delta to September 1-2 without recomputing unrelated history.
  update public.days
  set base_amount = round(base_amount + v_daily_delta, 2)
  where user_id = v_user_id
    and date between date '2026-09-01' and current_date - 1;

  update public.credit_card_accounts
  set notes = 'First purchase was $219.35 on August 24, 2026. Jon chose to exclude that lump sum from Spending and model the payoff in Fixed at $80/month from September through November, adjusting the final month when the real remaining balance is known. The $219.35 remains card debt until payments post. The approximately $11.56 interest is a planning estimate inside the payoff allowance, not posted interest and not an additional booked charge. Permanent limit is $650; exact statement, minimum, due date, AutoPay, and card type remain unverified.',
      updated_at = now()
  where user_id = v_user_id
    and name = 'Sephora Card';

  if not found then
    raise exception 'Sephora card account was not found.';
  end if;

  perform public.apply_baseline_to_future_days(v_user_id);

  if (
    select transaction_spend_total
    from public.v_day_totals
    where user_id = v_user_id
      and date = date '2026-08-24'
  ) <> v_day_spend_before - 219.35 then
    raise exception 'August 24 Spending did not decrease by $219.35.';
  end if;

  if not exists (
    select 1
    from public.transactions
    where id = v_transaction_id
      and user_id = v_user_id
      and status = 'excluded'
      and review_reason = 'fixed_expense_payoff'
      and excluded_at is not null
  ) then
    raise exception 'The Sephora lump-sum purchase was not exempted.';
  end if;

  if not exists (
    select 1
    from public.expenses
    where id = v_expense_id
      and user_id = v_user_id
      and is_active
      and amount = 80.00
      and starts_on = date '2026-09-01'
      and expiration_date = date '2026-11-30'
  ) then
    raise exception 'The Sephora $80 Fixed payoff was not restored.';
  end if;
end $$;
