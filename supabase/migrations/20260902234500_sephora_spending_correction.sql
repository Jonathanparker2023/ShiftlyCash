-- Jon confirmed that the August 24 Sephora purchase was recognized as
-- spending when charged. The later fixed-payoff model therefore counted the
-- same purchase a second time. Restore the purchase to Spending, retire the
-- fixed payoff, and preserve the card balance until an actual payment posts.

do $$
declare
  v_user_id uuid;
  v_day_id uuid;
  v_transaction_id uuid;
  v_expense_id uuid;
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
    where user_id = v_user_id
      and date = date '2026-08-24'
      and amount = 219.35
      and lower(coalesce(merchant_name, '')) = 'sephora'
  ) <> 1 then
    raise exception 'Expected exactly one August 24 Sephora purchase.';
  end if;

  select id into v_transaction_id
  from public.transactions
  where user_id = v_user_id
    and date = date '2026-08-24'
    and amount = 219.35
    and lower(coalesce(merchant_name, '')) = 'sephora';

  select id into v_day_id
  from public.days
  where user_id = v_user_id
    and date = date '2026-08-24';

  if v_day_id is null then
    raise exception 'August 24 BashFlow day was not found.';
  end if;

  if (
    select count(*)
    from public.expenses
    where user_id = v_user_id
      and name = 'Sephora card payoff'
  ) <> 1 then
    raise exception 'Expected exactly one Sephora fixed-payoff row.';
  end if;

  select id into v_expense_id
  from public.expenses
  where user_id = v_user_id
    and name = 'Sephora card payoff';

  -- Remove only the Sephora component from already-stamped historical days.
  -- Computing the difference between the two rounded baselines avoids
  -- disturbing unrelated historical expense decisions.
  with per_day as (
    select
      d.id,
      round(
        round(
          coalesce(sum(round(e.amount * 100)) filter (
            where e.is_active
              and (e.expiration_date is null or e.expiration_date >= d.date)
              and (e.starts_on is null or e.starts_on <= d.date)
              and e.created_at::date <= d.date
          ), 0) / public.weeks_per_month()
        ) / 7
      ) / 100.0
      - round(
        round(
          coalesce(sum(round(e.amount * 100)) filter (
            where e.is_active
              and e.id <> v_expense_id
              and (e.expiration_date is null or e.expiration_date >= d.date)
              and (e.starts_on is null or e.starts_on <= d.date)
              and e.created_at::date <= d.date
          ), 0) / public.weeks_per_month()
        ) / 7
      ) / 100.0 as sephora_daily_base
    from public.days d
    left join public.expenses e on e.user_id = d.user_id
    where d.user_id = v_user_id
      and d.date between date '2026-09-01'
        and least(current_date - 1, date '2026-11-30')
    group by d.id, d.date
  )
  update public.days d
  set base_amount = greatest(
    0,
    round(d.base_amount - p.sephora_daily_base, 2)
  )
  from per_day p
  where d.id = p.id
    and p.sephora_daily_base > 0;

  update public.transactions
  set day_id = v_day_id,
      status = 'applied',
      review_reason = null,
      excluded_at = null,
      cashflow_only = false,
      notes = 'Correction confirmed September 2, 2026: this purchase was recognized in Spending when charged on August 24. Card repayment is a balance transfer, not a second expense.',
      updated_at = now()
  where id = v_transaction_id
    and user_id = v_user_id;

  update public.expenses
  set is_active = false,
      updated_at = now()
  where id = v_expense_id
    and user_id = v_user_id;

  update public.credit_card_accounts
  set notes = 'First purchase was $219.35 on August 24, 2026 and is recognized in Spending on that charge date. The card balance remains a debt until paid. Repayments reduce the card balance but are not Fixed Expenses and must not be counted as spending again. Permanent limit is $650; exact statement, minimum, due date, AutoPay, and card type remain unverified.',
      updated_at = now()
  where user_id = v_user_id
    and name = 'Sephora Card';

  if not found then
    raise exception 'Sephora card account was not found.';
  end if;

  perform public.apply_baseline_to_future_days(v_user_id);

  if not exists (
    select 1
    from public.transactions t
    join public.days d on d.id = t.day_id and d.user_id = t.user_id
    where t.id = v_transaction_id
      and t.user_id = v_user_id
      and t.status = 'applied'
      and not t.cashflow_only
      and d.date = date '2026-08-24'
  ) then
    raise exception 'Sephora purchase was not restored to August 24 Spending.';
  end if;

  if exists (
    select 1
    from public.expenses
    where id = v_expense_id
      and user_id = v_user_id
      and is_active
  ) then
    raise exception 'Sephora fixed-payoff row is still active.';
  end if;
end $$;
