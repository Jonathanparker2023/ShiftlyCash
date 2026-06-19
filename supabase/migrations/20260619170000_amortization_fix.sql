-- Amortization fix-forward: recurring baseline is NEVER retroactively rewritten.
-- Only an amortized item's own cumulative-floor slices touch its own
-- [start_date, end_date] window (retroactive to the purchase date, bounded).
--
-- Supersedes the live-full-derive in 20260618190000, which re-derived recurring
-- costs at today's rate across a 62-day window and silently moved the running
-- balance (~$1,956 on the live ledger). days.base_amount stays the stamped
-- recurring source of truth; amortized slices are added live on top. This is
-- behavior-preserving while amortized_expenses is empty: base == d.base_amount.

----------------------------------------------------------------------
-- 1. Fix the upsert arbiter. ON CONFLICT (source_transaction_id) needs a
--    NON-partial unique index; the partial index in 20260618190000 did not
--    match, so every amortize upsert / backfill insert threw. A plain unique
--    constraint works (Postgres treats NULLs as distinct, so rows with no txn
--    link are still allowed to coexist).
----------------------------------------------------------------------
drop index if exists public.amortized_expenses_source_txn_uq;
alter table public.amortized_expenses
  drop constraint if exists amortized_expenses_source_txn_key;
alter table public.amortized_expenses
  add constraint amortized_expenses_source_txn_key unique (source_transaction_id);

----------------------------------------------------------------------
-- 2. Per-day amortized slice total (cents), active rows only, cumulative floor
--    so the slices of each item sum to its original amount exactly.
----------------------------------------------------------------------
create or replace view public.v_day_amortized_totals
with (security_invoker = true)
as
select
  d.user_id,
  d.id as day_id,
  coalesce(sum(
    floor(a.original_amount_cents::numeric * ((d.date - a.start_date) + 1) / a.period_days)
    - floor(a.original_amount_cents::numeric * (d.date - a.start_date) / a.period_days)
  ), 0)::bigint as amort_cents
from public.days d
join public.amortized_expenses a
  on a.user_id = d.user_id
  and a.is_active
  and d.date between a.start_date and a.end_date
group by d.user_id, d.id;

----------------------------------------------------------------------
-- 3. v_day_totals: base = stamped recurring (untouched) + live amortized slices.
--    No freeze horizon: recurring is never derived, amortization is user-bounded
--    to its own window. (CTE bodies are byte-identical to the prior good view.)
----------------------------------------------------------------------
create or replace view public.v_day_totals
with (security_invoker = true)
as
with earn_totals as (
  select
    es.day_id,
    es.user_id,
    coalesce(sum(
      case
        when es.job_type::text in ('ability') and es.pay_type::text = 'regular'
          then es.hours_or_units * s.ability_regular_net_rate
        when es.job_type::text in ('ability') and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.ability_ot_net_rate
        when es.job_type::text in ('ability') and es.pay_type::text = 'split'
          then (es.regular_hours * s.ability_regular_net_rate)
            + (es.overtime_hours * s.ability_ot_net_rate)
        when es.job_type::text = 'prestige' and es.pay_type::text = 'regular'
          then es.hours_or_units * s.prestige_regular_net_rate
        when es.job_type::text = 'prestige' and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.prestige_ot_net_rate
        when es.job_type::text = 'prestige' and es.pay_type::text = 'split'
          then (es.regular_hours * s.prestige_regular_net_rate)
            + (es.overtime_hours * s.prestige_ot_net_rate)
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'regular'
          then es.hours_or_units * s.prestige_ilst_net_rate
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.prestige_ilst_ot_net_rate
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'split'
          then (es.regular_hours * s.prestige_ilst_net_rate)
            + (es.overtime_hours * s.prestige_ilst_ot_net_rate)
        when es.job_type::text = 'incentive'
          then es.hours_or_units * (1 - s.ability_withholding_rate)
        when es.job_type::text = 'other'
          then es.hours_or_units
        else 0
      end
      + case
          when es.job_type::text = 'ability' and es.incentive_mode = 'rate'
            then (es.hours_or_units * es.incentive_rate) * (1 - s.ability_withholding_rate)
          when es.job_type::text = 'ability' and es.incentive_mode = 'lump_sum'
            then es.incentive_amount * (1 - s.ability_withholding_rate)
          else 0
        end
    ), 0)::numeric(12, 2) as earnings_total,
    coalesce(sum(
      case
        when es.job_type::text in ('ability') and es.pay_type::text = 'regular'
          then es.hours_or_units * s.ability_regular_net_rate
        when es.job_type::text in ('ability') and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.ability_ot_net_rate
        when es.job_type::text in ('ability') and es.pay_type::text = 'split'
          then (es.regular_hours * s.ability_regular_net_rate)
            + (es.overtime_hours * s.ability_ot_net_rate)
        when es.job_type::text = 'incentive'
          then es.hours_or_units * (1 - s.ability_withholding_rate)
        else 0
      end
      + case
          when es.job_type::text = 'ability' and es.incentive_mode = 'rate'
            then (es.hours_or_units * es.incentive_rate) * (1 - s.ability_withholding_rate)
          when es.job_type::text = 'ability' and es.incentive_mode = 'lump_sum'
            then es.incentive_amount * (1 - s.ability_withholding_rate)
          else 0
        end
    ), 0)::numeric(12, 2) as ability_paycheck_earnings,
    coalesce(sum(
      case
        when es.job_type::text = 'prestige' and es.pay_type::text = 'regular'
          then es.hours_or_units * s.prestige_regular_net_rate
        when es.job_type::text = 'prestige' and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.prestige_ot_net_rate
        when es.job_type::text = 'prestige' and es.pay_type::text = 'split'
          then (es.regular_hours * s.prestige_regular_net_rate)
            + (es.overtime_hours * s.prestige_ot_net_rate)
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'regular'
          then es.hours_or_units * s.prestige_ilst_net_rate
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.prestige_ilst_ot_net_rate
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'split'
          then (es.regular_hours * s.prestige_ilst_net_rate)
            + (es.overtime_hours * s.prestige_ilst_ot_net_rate)
        else 0
      end
    ), 0)::numeric(12, 2) as prestige_paycheck_earnings,
    coalesce(sum(
      case
        when es.job_type::text in ('ability', 'prestige', 'prestige_ilst')
          then case
            when es.pay_type::text = 'split'
              then es.regular_hours + es.overtime_hours
            else es.hours_or_units
          end
        else 0
      end
    ), 0)::numeric(10, 2) as wage_hours_total
  from public.earn_slots es
  join public.settings s on s.user_id = es.user_id
  group by es.day_id, es.user_id
),
transaction_totals as (
  select
    t.day_id,
    t.user_id,
    coalesce(sum(t.amount) filter (where t.status = 'applied'), 0)::numeric(12, 2)
      as transaction_spend_total,
    coalesce(sum(t.amount) filter (
      where t.status = 'applied' and t.source = 'manual'
    ), 0)::numeric(12, 2) as manual_transaction_total,
    coalesce(sum(t.amount) filter (
      where t.status = 'applied' and t.source = 'plaid'
    ), 0)::numeric(12, 2) as plaid_transaction_total,
    coalesce(count(*) filter (where t.status = 'pending_review'), 0)::integer
      as pending_transaction_count
  from public.transactions t
  where t.day_id is not null
  group by t.day_id, t.user_id
)
select
  d.id as day_id,
  d.user_id,
  d.week_id,
  d.date,
  d.day_index,
  (d.base_amount + coalesce(amt.amort_cents, 0) / 100.0)::numeric(10, 2) as base_amount,
  d.manual_spend_adjustment,
  d.spend_locked,
  coalesce(e.earnings_total, 0)::numeric(12, 2) as earnings_total,
  coalesce(e.ability_paycheck_earnings, 0)::numeric(12, 2) as ability_paycheck_earnings,
  coalesce(e.prestige_paycheck_earnings, 0)::numeric(12, 2) as prestige_paycheck_earnings,
  coalesce(e.wage_hours_total, 0)::numeric(10, 2) as wage_hours_total,
  coalesce(t.transaction_spend_total, 0)::numeric(12, 2) as transaction_spend_total,
  coalesce(t.manual_transaction_total, 0)::numeric(12, 2) as manual_transaction_total,
  coalesce(t.plaid_transaction_total, 0)::numeric(12, 2) as plaid_transaction_total,
  coalesce(t.pending_transaction_count, 0)::integer as pending_transaction_count,
  (
    coalesce(t.transaction_spend_total, 0)
    + d.manual_spend_adjustment
  )::numeric(12, 2) as spend_total,
  (
    coalesce(e.earnings_total, 0)
    - (coalesce(t.transaction_spend_total, 0) + d.manual_spend_adjustment)
    - (d.base_amount + coalesce(amt.amort_cents, 0) / 100.0)
  )::numeric(12, 2) as cashflow_total
from public.days d
left join earn_totals e on e.day_id = d.id and e.user_id = d.user_id
left join transaction_totals t on t.day_id = d.id and t.user_id = d.user_id
left join public.v_day_amortized_totals amt
  on amt.day_id = d.id and amt.user_id = d.user_id;

----------------------------------------------------------------------
-- 4. Drop the frozen-derive lever: it stamped days.base_amount from the current
--    recurring rate, i.e. the exact retroactive-recurring footgun this fix
--    removes. Amortization is always live-correct now, so no lever is needed.
----------------------------------------------------------------------
drop function if exists public.force_recompute_baseline(date, date);

----------------------------------------------------------------------
-- 5. Abandon the backfill: legacy "<merchant> (amort <date>)" expenses keep
--    behaving as recurring until they expire; new amortizations use this model.
----------------------------------------------------------------------
drop table if exists public.amortization_backfill_review;
