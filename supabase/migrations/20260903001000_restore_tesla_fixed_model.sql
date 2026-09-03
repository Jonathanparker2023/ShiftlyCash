-- BashFlow Fixed is a daily smoothing model for recurring obligations. Restore
-- the replacement Tesla payment to that baseline and keep its posted bank debit
-- excluded, exactly like other bills already represented in Fixed. TD's
-- one-time payoff residual and the already-expensed Sephora purchase stay out.

comment on column public.debts.contractual_payment is
  'Full contractual payment. BashFlow may smooth it through Fixed for daily cash planning; any posted debit must then stay excluded to prevent double counting.';

do $$
declare
  v_user_id uuid;
  v_tesla_expense_id uuid;
  v_daily_before numeric(10, 2);
  v_daily_after numeric(10, 2);
  v_tesla_daily_delta numeric(10, 2);
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
    from public.expenses
    where user_id = v_user_id
      and name = 'Tesla Loan (Tesla Finance 14.99%)'
  ) <> 1 then
    raise exception 'Expected exactly one replacement Tesla Fixed row.';
  end if;

  select id into v_tesla_expense_id
  from public.expenses
  where user_id = v_user_id
    and name = 'Tesla Loan (Tesla Finance 14.99%)';

  if exists (
    select 1
    from public.expenses
    where id = v_tesla_expense_id
      and is_active
  ) then
    raise exception 'Replacement Tesla Fixed row is already active.';
  end if;

  select projected_daily_base into v_daily_before
  from public.v_active_expense_totals
  where user_id = v_user_id;

  update public.expenses
  set is_active = true,
      amount = 714.52,
      starts_on = date '2026-08-22',
      expiration_date = null,
      withdrawal_day = 22,
      updated_at = now()
  where id = v_tesla_expense_id
    and user_id = v_user_id;

  select projected_daily_base into v_daily_after
  from public.v_active_expense_totals
  where user_id = v_user_id;

  v_tesla_daily_delta := v_daily_after - v_daily_before;

  if v_tesla_daily_delta not between 23.57 and 23.58 then
    raise exception 'Unexpected Tesla daily Fixed delta: %', v_tesla_daily_delta;
  end if;

  -- The prior correction removed Tesla from already-stamped days. Add back only
  -- the aggregate calculator delta; do not recompute unrelated historical Fixed.
  update public.days
  set base_amount = round(base_amount + v_tesla_daily_delta, 2)
  where user_id = v_user_id
    and date between date '2026-08-22' and current_date - 1;

  update public.debts
  set notes = 'Loan and vehicle activated August 22, 2026. The $714.52 monthly obligation is smoothed through BashFlow Fixed from August 22; its posted bank debit is excluded so cashflow is not charged twice. The separate due-cycle analytic is $714.52 across August 22 through September 21, with the first full AutoPay scheduled September 22. Refinance and accelerated-payoff savings remain scenarios until signed and posted.',
      updated_at = now()
  where user_id = v_user_id
    and name = 'Auto Loan - Tesla Finance - Replacement Model 3';

  if not found then
    raise exception 'Replacement Tesla debt was not found.';
  end if;

  perform public.apply_baseline_to_future_days(v_user_id);

  if not exists (
    select 1
    from public.expenses
    where id = v_tesla_expense_id
      and is_active
      and amount = 714.52
      and starts_on = date '2026-08-22'
      and withdrawal_day = 22
  ) then
    raise exception 'Replacement Tesla Fixed row was not restored.';
  end if;

  if exists (
    select 1
    from public.expenses
    where user_id = v_user_id
      and name in (
        'TD Auto Finance - old Onyx loan (accrued 7/29-9/12, one $605.94 payment)',
        'Sephora card payoff'
      )
      and is_active
  ) then
    raise exception 'TD or Sephora was incorrectly restored to Fixed.';
  end if;
end $$;
