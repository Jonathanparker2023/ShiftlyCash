-- The verified TD Onyx residual is the cost of the July 29–September 2
-- ownership window. Represent it once through Fixed using the existing exact
-- cumulative-floor allocation, and keep the source Plaid debit excluded so it
-- cannot also reduce cashflow as a lump sum.

do $$
declare
  v_user_id uuid;
  v_transaction_id constant uuid := 'dffdfb8c-885c-4181-9929-253a929c6550';
  v_debt_id constant uuid := 'd8a575d8-5780-45f9-9661-ef72bfcb7251';
  v_amortized_id uuid;
  v_allocation_count integer;
  v_allocation_total bigint;
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
      and date = date '2026-09-02'
      and amount = 311.01
      and lower(coalesce(merchant_name, '') || ' ' || coalesce(raw_name, ''))
        like '%td auto finance%'
      and status = 'excluded'
  ) <> 1 then
    raise exception 'Expected exactly one excluded $311.01 TD residual transaction.';
  end if;

  if (
    select count(*)
    from public.debts
    where id = v_debt_id
      and user_id = v_user_id
      and name = 'Auto Loan - TD Auto Finance - Onyx'
      and balance = 311.01
      and lifecycle_status = 'payoff_pending'
  ) <> 1 then
    raise exception 'TD Onyx debt is not in the expected payoff-pending state.';
  end if;

  if (
    select count(*)
    from public.days
    where user_id = v_user_id
      and date between date '2026-07-29' and date '2026-09-02'
  ) <> 36 then
    raise exception 'Expected all 36 BashFlow days in the TD ownership window.';
  end if;

  if exists (
    select 1
    from public.amortized_expenses
    where source_transaction_id = v_transaction_id
       or (
         user_id = v_user_id
         and merchant_name = 'TD Auto Finance — Onyx residual'
         and start_date = date '2026-07-29'
         and period_days = 36
       )
  ) then
    raise exception 'TD Onyx residual allocation already exists.';
  end if;

  insert into public.amortized_expenses (
    user_id,
    source_transaction_id,
    merchant_name,
    original_amount_cents,
    start_date,
    period_days,
    is_active
  ) values (
    v_user_id,
    v_transaction_id,
    'TD Auto Finance — Onyx residual',
    31101,
    date '2026-07-29',
    36,
    true
  )
  returning id into v_amortized_id;

  update public.transactions
  set status = 'excluded',
      cashflow_only = false,
      review_reason = 'amortized_expense',
      excluded_at = coalesce(excluded_at, now()),
      notes = 'TD Onyx residual allocated through Fixed from July 29 through September 2; source debit excluded to prevent double counting.',
      updated_at = now()
  where id = v_transaction_id
    and user_id = v_user_id;

  update public.debts
  set notes = 'Progressive total-loss funds were received by TD. TD calculated a $311.01 final residual on September 2, 2026, and Jon authorized it. BashFlow allocates that residual through Fixed across the 36-day Onyx ownership window, July 29 through September 2; the source debit stays excluded to prevent double counting. Posting and zero-balance proof remain pending. No $605.94 installment was paid or forecast after payoff submission. The residual principal/interest split remains unknown until TD supplies the final ledger.',
      updated_at = now()
  where id = v_debt_id
    and user_id = v_user_id;

  select count(*), coalesce(sum(applied_cents), 0)
  into v_allocation_count, v_allocation_total
  from public.v_day_base_allocations
  where user_id = v_user_id
    and item_kind = 'amortized'
    and item_id = v_amortized_id::text;

  if v_allocation_count <> 36 or v_allocation_total <> 31101 then
    raise exception 'TD allocation mismatch: % days and % cents.',
      v_allocation_count, v_allocation_total;
  end if;

  if exists (
    select 1
    from public.v_day_base_allocations
    where user_id = v_user_id
      and item_kind = 'amortized'
      and item_id = v_amortized_id::text
      and date not between date '2026-07-29' and date '2026-09-02'
  ) then
    raise exception 'TD allocation escaped its ownership window.';
  end if;

  if not exists (
    select 1
    from public.transactions
    where id = v_transaction_id
      and user_id = v_user_id
      and status = 'excluded'
      and not cashflow_only
      and review_reason = 'amortized_expense'
  ) then
    raise exception 'TD source transaction was not safely excluded.';
  end if;

  if not exists (
    select 1
    from public.debts
    where id = v_debt_id
      and user_id = v_user_id
      and balance = 311.01
      and lifecycle_status = 'payoff_pending'
  ) then
    raise exception 'TD debt lifecycle was changed before lender confirmation.';
  end if;

  if exists (
    select 1
    from public.expenses
    where user_id = v_user_id
      and is_active
      and (
        name ilike '%TD Auto Finance%'
        or (amount = 605.94 and name ilike '%Onyx%')
      )
  ) then
    raise exception 'A normal TD installment is still active in Fixed.';
  end if;
end $$;
