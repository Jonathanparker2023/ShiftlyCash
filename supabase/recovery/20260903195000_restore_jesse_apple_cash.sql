-- Recovery for 20260903195000_exempt_jesse_apple_cash.sql.
-- Run only if the confirmed reimbursement treatment must be reversed.

update public.transactions
set merchant_name = 'Apple',
    status = 'applied',
    review_reason = null,
    excluded_at = null,
    notes = null,
    updated_at = now()
where id = 'a69c2e61-cdb3-4921-b751-1f149e357d21'
  and date = date '2026-08-28'
  and amount = 184.00
  and raw_name = 'Apple Cash Sent Money'
  and status = 'excluded'
  and review_reason = 'temporary_reimbursement';
