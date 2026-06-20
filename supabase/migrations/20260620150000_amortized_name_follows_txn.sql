-- Amortized expense display name follows the source transaction. The amortize
-- action snapshots the merchant_name into amortized_expenses, so renaming the
-- transaction in the dashboard left the amortized name stale in the Fixed
-- breakdown + Fixed page. Derive it live instead: coalesce(transaction name,
-- stored name) — single source of truth, so a rename propagates everywhere and
-- can never drift. (Linked rows always have their transaction: the FK is
-- ON DELETE CASCADE.) Recurring branch is byte-identical to 20260618190000.

create or replace view public.v_day_base_allocations
with (security_invoker = true)
as
-- amortized: exact per-day slice via cumulative floor
select
  d.user_id,
  d.id as day_id,
  d.date,
  'amortized'::text as item_kind,
  a.id::text as item_id,
  coalesce(t.merchant_name, a.merchant_name) as item_name,
  a.original_amount_cents,
  a.period_days,
  round(a.original_amount_cents::numeric / a.period_days)::bigint as daily_alloc_cents,
  (
    floor(a.original_amount_cents::numeric * ((d.date - a.start_date) + 1) / a.period_days)
    - floor(a.original_amount_cents::numeric * (d.date - a.start_date) / a.period_days)
  )::bigint as applied_cents,
  a.schedule_version
from public.days d
join public.amortized_expenses a
  on a.user_id = d.user_id
  and a.is_active
  and d.date between a.start_date and a.end_date
left join public.transactions t
  on t.id = a.source_transaction_id
  and t.user_id = a.user_id
union all
-- recurring: per-expense display allocation
select
  d.user_id,
  d.id as day_id,
  d.date,
  'recurring'::text as item_kind,
  e.id::text as item_id,
  e.name as item_name,
  round(e.amount * 100)::bigint as original_amount_cents,
  null::integer as period_days,
  round(round(round(e.amount * 100) / public.weeks_per_month()) / 7)::bigint as daily_alloc_cents,
  round(round(round(e.amount * 100) / public.weeks_per_month()) / 7)::bigint as applied_cents,
  1 as schedule_version
from public.days d
join public.expenses e
  on e.user_id = d.user_id
  and e.is_active
  and (e.expiration_date is null or e.expiration_date >= current_date);
