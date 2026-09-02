-- Preserve issuer minimums separately from payments that are actually scheduled.
-- A minimum due is a contractual floor; it is not evidence that AutoPay will use
-- that amount. Keeping both values prevents cashflow agents from silently
-- replacing a verified full-statement draft with the smaller minimum.

alter table public.credit_card_accounts
  add column if not exists scheduled_payment_amount numeric(12, 2),
  add column if not exists scheduled_payment_date date;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.credit_card_accounts'::regclass
      and conname = 'credit_card_accounts_scheduled_payment_check'
  ) then
    alter table public.credit_card_accounts
      add constraint credit_card_accounts_scheduled_payment_check
      check (
        (scheduled_payment_amount is null and scheduled_payment_date is null)
        or (
          scheduled_payment_amount > 0
          and scheduled_payment_date is not null
        )
      );
  end if;
end $$;

comment on column public.credit_card_accounts.scheduled_payment_amount is
  'Verified upcoming issuer payment amount. Separate from minimum_due.';
comment on column public.credit_card_accounts.scheduled_payment_date is
  'Verified date of the upcoming issuer payment. Null when no payment is scheduled.';

do $$
declare
  v_user_id uuid;
begin
  select id
    into v_user_id
  from auth.users
  where lower(email) = 'jay1park1@gmail.com'
  limit 1;

  if v_user_id is null then
    raise exception 'BashFlow owner was not found.';
  end if;

  update public.credit_card_accounts
  set account_status = 'replacement_pending',
      scheduled_payment_amount = 500.12,
      scheduled_payment_date = date '2026-09-09',
      notes = 'All recent activity is legitimate. Sixteen posted purchases since the August 15 statement total $371.42 and remain an aggregate pending itemization. As of August 29, 2026, full-statement AutoPay is scheduled to draft $500.12 on September 9, 2026; the $25 minimum is not the planned payment.',
      updated_at = now()
  where user_id = v_user_id
    and name = 'Capital One';

  if not found then
    raise exception 'Capital One account was not found.';
  end if;

  update public.credit_card_accounts
  set account_status = 'replacement_pending',
      scheduled_payment_amount = 195.24,
      scheduled_payment_date = date '2026-09-24',
      notes = 'Balance consists of the legitimate $177.57 Apple bundle, a $15 monthly maintenance fee, and $2.67 Credit Protection. As of August 29, 2026, full-statement AutoPay is scheduled to draft $195.24 on September 24, 2026.',
      updated_at = now()
  where user_id = v_user_id
    and name = 'Aspire';

  if not found then
    raise exception 'Aspire account was not found.';
  end if;

  update public.credit_card_accounts
  set account_status = 'replacement_pending',
      scheduled_payment_amount = null,
      scheduled_payment_date = null,
      notes = 'Verified August 29, 2026: $0 balance, $0 due, and no recurring merchant expenses. Minimum-due AutoPay remains on; the replacement card was ordered.',
      updated_at = now()
  where user_id = v_user_id
    and name = 'Mission Lane';

  if not found then
    raise exception 'Mission Lane account was not found.';
  end if;

  update public.credit_card_accounts
  set scheduled_payment_amount = null,
      scheduled_payment_date = null,
      notes = 'Unauthorized history is $494.10 across 22 charges. The $380.64 planning balance preserves the current posted-plus-pending exposure observed August 29, 2026; the remaining $103.46 was absorbed in an earlier cycle. Appeal is planned, but no provisional credit or refund exists. Do not book expected recovery as cash or allow disputed charges to be swept before case treatment is confirmed.',
      updated_at = now()
  where user_id = v_user_id
    and name = 'Fortiva';

  if not found then
    raise exception 'Fortiva account was not found.';
  end if;

  insert into public.credit_card_accounts (
    user_id,
    debt_id,
    name,
    issuer,
    last_four,
    account_kind,
    account_status,
    raw_current_balance,
    planning_balance,
    statement_balance,
    statement_date,
    pending_total,
    credit_limit,
    available_credit,
    minimum_due,
    due_date,
    scheduled_payment_amount,
    scheduled_payment_date,
    autopay_status,
    autopay_mode,
    autopay_day,
    autopay_source_label,
    apr,
    monthly_fee,
    annual_fee,
    credit_protection_amount,
    verification_status,
    verified_at,
    disputed_total,
    risk_status,
    notes
  )
  values (
    v_user_id,
    null,
    'Prosper Mastercard',
    'Coastal Community Bank / Prosper',
    null,
    'credit_card',
    'active',
    0,
    0,
    null,
    null,
    0,
    1600,
    800,
    0,
    null,
    null,
    null,
    'on',
    'minimum payment',
    null,
    'existing checking account',
    0.3299,
    null,
    59,
    null,
    'verified',
    timestamptz '2026-09-02 00:00:00-04',
    0,
    'clear',
    'Verified September 2, 2026: authorized account, $1,600 limit, $0 balance, and $800 temporary available credit while the card ships. No statement, due date, or payment exists. AutoPay is on for the minimum due. The $59 annual fee is contractual; the anticipated first-year waiver is not booked until confirmed.'
  )
  on conflict (user_id, (lower(name))) do update
    set issuer = excluded.issuer,
        account_kind = excluded.account_kind,
        account_status = excluded.account_status,
        raw_current_balance = excluded.raw_current_balance,
        planning_balance = excluded.planning_balance,
        statement_balance = excluded.statement_balance,
        statement_date = excluded.statement_date,
        pending_total = excluded.pending_total,
        credit_limit = excluded.credit_limit,
        available_credit = excluded.available_credit,
        minimum_due = excluded.minimum_due,
        due_date = excluded.due_date,
        scheduled_payment_amount = excluded.scheduled_payment_amount,
        scheduled_payment_date = excluded.scheduled_payment_date,
        autopay_status = excluded.autopay_status,
        autopay_mode = excluded.autopay_mode,
        autopay_day = excluded.autopay_day,
        autopay_source_label = excluded.autopay_source_label,
        apr = excluded.apr,
        monthly_fee = excluded.monthly_fee,
        annual_fee = excluded.annual_fee,
        credit_protection_amount = excluded.credit_protection_amount,
        verification_status = excluded.verification_status,
        verified_at = excluded.verified_at,
        disputed_total = excluded.disputed_total,
        risk_status = excluded.risk_status,
        notes = excluded.notes,
        updated_at = now();

  update public.expenses
  set amount = 100,
      starts_on = date '2026-09-02',
      expiration_date = date '2027-10-31',
      is_active = true,
      updated_at = now()
  where user_id = v_user_id
    and name = 'Best Buy payment (terms unverified)';

  if not found then
    raise exception 'Best Buy long-promo payment row was not found.';
  end if;

  perform public.apply_baseline_to_future_days(v_user_id);
end $$;
