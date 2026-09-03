-- Jon confirmed the $184 Apple Cash transfer on August 28 was money sent to
-- Jesse that is expected to be returned. Keep it visible as an exempt ledger
-- item, but remove it from daily and weekly spending totals.

do $$
declare
  v_user_id uuid;
  v_transaction_id uuid := 'a69c2e61-cdb3-4921-b751-1f149e357d21';
  v_before_spend numeric(12, 2);
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
      and date = date '2026-08-28'
      and authorized_date = date '2026-08-28'
      and amount = 184.00
      and source = 'plaid'
      and status = 'applied'
      and category = 'TRANSFER_OUT'
      and raw_name = 'Apple Cash Sent Money'
  ) <> 1 then
    raise exception 'Expected the single applied $184 Apple Cash transfer to Jesse.';
  end if;

  select transaction_spend_total into v_before_spend
  from public.v_day_totals
  where user_id = v_user_id
    and date = date '2026-08-28';

  if v_before_spend is null then
    raise exception 'August 28 totals were not found.';
  end if;

  update public.transactions
  set merchant_name = 'Jesse — Apple Cash',
      status = 'excluded',
      review_reason = 'temporary_reimbursement',
      excluded_at = now(),
      notes = 'Jon confirmed September 3, 2026: money sent to Jesse and expected back. Visible as exempt, excluded from spending totals.',
      updated_at = now()
  where id = v_transaction_id
    and user_id = v_user_id;

  if not exists (
    select 1
    from public.transactions
    where id = v_transaction_id
      and user_id = v_user_id
      and merchant_name = 'Jesse — Apple Cash'
      and status = 'excluded'
      and review_reason = 'temporary_reimbursement'
      and excluded_at is not null
  ) then
    raise exception 'The Jesse Apple Cash transfer was not exempted.';
  end if;

  if (
    select transaction_spend_total
    from public.v_day_totals
    where user_id = v_user_id
      and date = date '2026-08-28'
  ) <> v_before_spend - 184.00 then
    raise exception 'August 28 transaction spending did not decrease by $184.00.';
  end if;
end $$;
