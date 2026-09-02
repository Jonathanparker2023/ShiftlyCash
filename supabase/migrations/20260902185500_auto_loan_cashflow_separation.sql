-- Loan balances, contractual cash dates, and analytic accruals are different
-- facts. A loan installment must not live in recurring expenses: that table is
-- converted into a daily baseline and would charge cash before the debit date.

alter table public.debts
  add column if not exists debt_kind text,
  add column if not exists contract_date date,
  add column if not exists activated_on date,
  add column if not exists original_principal numeric(12, 2),
  add column if not exists contractual_payment numeric(10, 2),
  add column if not exists first_payment_date date,
  add column if not exists payment_day smallint,
  add column if not exists term_months smallint,
  add column if not exists lifecycle_status text,
  add column if not exists payoff_submitted_amount numeric(12, 2),
  add column if not exists payoff_submitted_on date,
  add column if not exists verified_at timestamptz,
  add column if not exists notes text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.debts'::regclass
      and conname = 'debts_loan_metadata_check'
  ) then
    alter table public.debts
      add constraint debts_loan_metadata_check
      check (
        (debt_kind is null or debt_kind in ('auto_loan', 'credit_card', 'other'))
        and (original_principal is null or original_principal >= 0)
        and (contractual_payment is null or contractual_payment > 0)
        and (payment_day is null or payment_day between 1 and 31)
        and (term_months is null or term_months > 0)
        and (lifecycle_status is null or lifecycle_status in ('active', 'payoff_pending', 'paid'))
        and (payoff_submitted_amount is null or payoff_submitted_amount > 0)
        and (
          payoff_submitted_amount is null
          or payoff_submitted_on is not null
        )
      );
  end if;
end $$;

comment on column public.debts.contractual_payment is
  'Full contractual cash payment. It is forecast on due dates, never spread into recurring expenses.';
comment on column public.debts.lifecycle_status is
  'Loan lifecycle detail. payoff_pending remains a liability but has no normal installment forecast.';
comment on column public.debts.payoff_submitted_amount is
  'Submitted payoff awaiting posting. Not a posted transaction and not proof of a zero balance.';

-- Remove only the loan portions that were stamped into historical baseline
-- days. The delta is calculated with the exact baseline rounding formula, so
-- unrelated historic baseline decisions remain untouched.
with owner as (
  select id as user_id
  from auth.users
  where lower(email) = 'jay1park1@gmail.com'
  limit 1
), per_day as (
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
            and e.name not in (
              'Tesla Loan (Tesla Finance 14.99%)',
              'TD Auto Finance - old Onyx loan (accrued 7/29-9/12, one $605.94 payment)'
            )
            and (e.expiration_date is null or e.expiration_date >= d.date)
            and (e.starts_on is null or e.starts_on <= d.date)
            and e.created_at::date <= d.date
        ), 0) / public.weeks_per_month()
      ) / 7
    ) / 100.0 as loan_daily_base
  from public.days d
  join owner o on o.user_id = d.user_id
  left join public.expenses e on e.user_id = d.user_id
  where d.date between date '2026-07-29'
    and least(current_date - 1, date '2026-09-02')
  group by d.id, d.date
)
update public.days d
set base_amount = greatest(0, round(d.base_amount - p.loan_daily_base, 2))
from per_day p
where d.id = p.id
  and p.loan_daily_base > 0;

update public.expenses
set is_active = false,
    updated_at = now()
where user_id = (
    select id from auth.users
    where lower(email) = 'jay1park1@gmail.com'
    limit 1
  )
  and name in (
    'Tesla Loan (Tesla Finance 14.99%)',
    'TD Auto Finance - old Onyx loan (accrued 7/29-9/12, one $605.94 payment)'
  )
  and is_active;

do $$
declare
  v_user_id uuid;
  v_tesla_id uuid;
  v_existing_tesla integer;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = 'jay1park1@gmail.com'
  limit 1;

  if v_user_id is null then
    raise exception 'BashFlow owner was not found.';
  end if;

  if (
    select count(*) from public.expenses
    where user_id = v_user_id
      and name in (
        'Tesla Loan (Tesla Finance 14.99%)',
        'TD Auto Finance - old Onyx loan (accrued 7/29-9/12, one $605.94 payment)'
      )
  ) <> 2 then
    raise exception 'Expected exactly two legacy loan expense rows.';
  end if;

  if (
    select count(*) from public.debts
    where user_id = v_user_id
      and name in (
        'Auto Loan - TD Auto Finance',
        'Auto Loan - TD Auto Finance - Onyx'
      )
  ) <> 1 then
    raise exception 'Expected exactly one old TD Auto Finance debt.';
  end if;

  update public.debts
  set name = 'Auto Loan - TD Auto Finance - Onyx',
      balance = 311.01,
      minimum_payment = 0,
      apr = 0.1094,
      status = 'active',
      priority_order = 25,
      debt_kind = 'auto_loan',
      contract_date = date '2026-07-28',
      activated_on = date '2026-07-29',
      original_principal = 31743.10,
      contractual_payment = 605.94,
      first_payment_date = date '2026-09-12',
      payment_day = 12,
      term_months = 72,
      lifecycle_status = 'payoff_pending',
      payoff_submitted_amount = 311.01,
      payoff_submitted_on = date '2026-09-02',
      verified_at = timestamptz '2026-09-02 00:00:00-04',
      notes = 'Progressive total-loss funds were received by TD. TD calculated a $311.01 final residual on September 2, 2026, and Jon authorized it. Posting and zero-balance proof remain pending. No $605.94 installment was paid or forecast after payoff submission. The residual principal/interest split remains unknown until TD supplies the final ledger.',
      updated_at = now()
  where user_id = v_user_id
    and name in (
      'Auto Loan - TD Auto Finance',
      'Auto Loan - TD Auto Finance - Onyx'
    );

  if not found then
    raise exception 'Old TD Auto Finance debt was not found.';
  end if;

  select count(*) into v_existing_tesla
  from public.debts
  where user_id = v_user_id
    and name = 'Auto Loan - Tesla Finance - Replacement Model 3';

  if v_existing_tesla > 1 then
    raise exception 'Duplicate replacement Tesla debts already exist.';
  elsif v_existing_tesla = 0 then
    insert into public.debts (
      user_id,
      name,
      balance,
      minimum_payment,
      apr,
      status,
      priority_order,
      debt_kind,
      activated_on,
      original_principal,
      contractual_payment,
      first_payment_date,
      payment_day,
      term_months,
      lifecycle_status,
      verified_at,
      notes
    ) values (
      v_user_id,
      'Auto Loan - Tesla Finance - Replacement Model 3',
      33800,
      714.52,
      0.1499,
      'active',
      20,
      'auto_loan',
      date '2026-08-22',
      33800,
      714.52,
      date '2026-09-22',
      22,
      72,
      'active',
      timestamptz '2026-09-02 00:00:00-04',
      'Loan and vehicle activated August 22, 2026. The first full $714.52 AutoPay is scheduled for September 22, 2026, then monthly on the 22nd. Daily accrual is analytic only and never enters cashflow or spending totals. Refinance and accelerated-payoff savings remain scenarios until signed and posted.'
    ) returning id into v_tesla_id;
  else
    update public.debts
    set balance = 33800,
        minimum_payment = 714.52,
        apr = 0.1499,
        status = 'active',
        priority_order = 20,
        debt_kind = 'auto_loan',
        contract_date = null,
        activated_on = date '2026-08-22',
        original_principal = 33800,
        contractual_payment = 714.52,
        first_payment_date = date '2026-09-22',
        payment_day = 22,
        term_months = 72,
        lifecycle_status = 'active',
        payoff_submitted_amount = null,
        payoff_submitted_on = null,
        verified_at = timestamptz '2026-09-02 00:00:00-04',
        notes = 'Loan and vehicle activated August 22, 2026. The first full $714.52 AutoPay is scheduled for September 22, 2026, then monthly on the 22nd. Daily accrual is analytic only and never enters cashflow or spending totals. Refinance and accelerated-payoff savings remain scenarios until signed and posted.',
        updated_at = now()
    where user_id = v_user_id
      and name = 'Auto Loan - Tesla Finance - Replacement Model 3'
    returning id into v_tesla_id;
  end if;

  update public.goal_rungs
  set debt_match = '^Auto Loan - Tesla Finance - Replacement Model 3$',
      description = 'Contractual baseline: $33,800 principal, 14.99% APR, 72 months, and $714.52 due monthly on the 22nd. Refinancing and accelerated payoff are separate goal scenarios until they sign and post.',
      deadline_on = date '2032-08-22',
      deadline_label = 'Contractual final Tesla payment',
      updated_at = now()
  where user_id = v_user_id
    and title = 'Kill the Tesla note';

  if not found then
    raise exception 'Tesla payoff goal rung was not found.';
  end if;

  perform public.apply_baseline_to_future_days(v_user_id);
end $$;
