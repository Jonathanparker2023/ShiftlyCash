-- An inactive amortization means its source cost belongs back in day-level
-- spending as one full charge on the date it happened. Some older records had
-- the spread turned off without restoring their excluded source transaction,
-- leaving the money in neither Fixed nor Spending.
--
-- Restore only source transactions that are still explicitly excluded for an
-- inactive amortization. Active amortizations, non-amortized exclusions, and
-- transactions already restored as standalone charges are intentionally left
-- alone.
update public.transactions t
set status = 'applied',
    review_reason = null,
    excluded_at = null
from public.amortized_expenses a
join auth.users u on u.id = a.user_id
where t.id = a.source_transaction_id
  and t.user_id = a.user_id
  and lower(u.email) = 'jay1park1@gmail.com'
  and not a.is_active
  and t.status = 'excluded'
  and t.review_reason = 'amortized_expense'
  and t.day_id is not null;
