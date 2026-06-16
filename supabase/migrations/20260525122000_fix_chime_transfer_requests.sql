-- Chime email sync cleanup:
-- - Payment requests are not transactions and should not appear in ShiftlyCash.
-- - Incoming Chime credits belong in exemptions, not spending.

with request_captures as (
  select c.id, c.parsed_transaction_id
  from public.chime_raw_captures c
  where c.parsed_transaction_id is not null
    and c.raw_text ~* '\m(requested|requesting|requests|money request|request for money)\M'
)
delete from public.transactions t
using request_captures r
where t.id = r.parsed_transaction_id
  and t.source = 'chime';

update public.chime_raw_captures c
set parsed_transaction_id = null,
    parsed_at = coalesce(c.parsed_at, now()),
    source_meta = coalesce(c.source_meta, '{}'::jsonb)
      || jsonb_build_object(
        'parse_failure_reason',
        'No transaction created for payment_request: Payment request only; no money moved.'
      )
where c.raw_text ~* '\m(requested|requesting|requests|money request|request for money)\M';

update public.transactions t
set status = 'excluded',
    excluded_at = coalesce(t.excluded_at, now()),
    review_reason = case
      when t.category = 'deposit' then 'income_deposit'
      when t.category = 'refund' then 'refund_credit'
      else 'transfer_credit'
    end,
    category = case
      when t.category = 'transfer_credit' then 'transfer'
      else t.category
    end,
    merchant_name = case
      when t.category in ('transfer', 'transfer_credit') and t.merchant_name ilike 'From %'
        then 'Transfer credit: ' || substring(t.merchant_name from 6)
      when t.category in ('transfer', 'transfer_credit') and t.merchant_name not ilike 'Transfer credit:%'
        then 'Transfer credit: ' || t.merchant_name
      when t.category = 'deposit' and t.merchant_name ilike 'Deposit:%'
        then 'Deposit credit:' || substring(t.merchant_name from 9)
      when t.category = 'deposit' and t.merchant_name not ilike 'Deposit credit:%'
        then 'Deposit credit: ' || t.merchant_name
      when t.category = 'refund' and t.merchant_name ilike 'Refund:%'
        then 'Refund credit:' || substring(t.merchant_name from 8)
      when t.category = 'refund' and t.merchant_name not ilike 'Refund credit:%'
        then 'Refund credit: ' || t.merchant_name
      else t.merchant_name
    end
where t.source = 'chime'
  and t.amount < 0
  and t.status <> 'excluded'
  and (
    t.category in ('transfer', 'transfer_credit', 'deposit', 'refund')
    or t.merchant_name ilike 'From %'
    or t.merchant_name ilike 'Transfer credit:%'
    or t.merchant_name ilike 'Deposit:%'
    or t.merchant_name ilike 'Refund:%'
  );
