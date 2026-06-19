-- Lump-Sum Amortizer derivation views + v_day_totals rewire (credit overlay).
-- The credit is added ONLY to earnings_total and cashflow_total. It is NOT added to
-- ability_paycheck_earnings / prestige_paycheck_earnings, so it never enters the
-- withholding / paycheck path (the credit is NET cash, not wages). Behavior-preserving
-- while no active bucket overlaps a day: cr.credit_cents NULL -> coalesce 0 -> totals
-- byte-identical to 20260619170000. Penny rule (cumulative floor on the SIGNED total):
--   slice(i) = floor(T*(i+1)/P) - floor(T*i/P);  sum_i slice(i) = T exactly (any sign).

-- (0) Per-bucket SIGNED total (cents): net of positive + negative items.
create or replace view public.v_amortization_bucket_total
with (security_invoker = true)
as
select
  b.id as bucket_id,
  b.user_id,
  b.name,
  b.start_date,
  b.end_date,
  b.period_days,
  b.status,
  b.schedule_version,
  coalesce(sum(i.amount_cents), 0)::bigint as total_cents
from public.amortization_bucket b
left join public.amortization_item i
  on i.bucket_id = b.id and i.user_id = b.user_id
group by b.id, b.user_id;

-- (1) Per-day AGGREGATE credit (cents): sum of cumulative-floor slices over all active
--     buckets overlapping the day. Single-day bucket (period 1) => slice = total.
create or replace view public.v_day_amortization_credit
with (security_invoker = true)
as
select
  d.user_id,
  d.id as day_id,
  coalesce(sum(
    floor(t.total_cents::numeric * ((d.date - t.start_date) + 1) / t.period_days)
    - floor(t.total_cents::numeric * (d.date - t.start_date) / t.period_days)
  ), 0)::bigint as credit_cents
from public.days d
join public.v_amortization_bucket_total t
  on t.user_id = d.user_id
  and t.status = 'active'
  and d.date between t.start_date and t.end_date
group by d.user_id, d.id;

-- (2) Per-(day,bucket) breakdown for the shift-bar synthetic "Other" row + drill-down.
--     daily_rate_cents is the ROUNDED even-split display figure (e.g. $225.48), distinct
--     from a given day's exact slice (which may differ by <=1c and is only ever summed).
create or replace view public.v_day_amortization_credit_items
with (security_invoker = true)
as
select
  d.user_id,
  d.id as day_id,
  d.date,
  t.bucket_id,
  t.name as bucket_name,
  t.total_cents,
  t.period_days,
  t.schedule_version,
  round(t.total_cents::numeric / t.period_days)::bigint as daily_rate_cents,
  (
    floor(t.total_cents::numeric * ((d.date - t.start_date) + 1) / t.period_days)
    - floor(t.total_cents::numeric * (d.date - t.start_date) / t.period_days)
  )::bigint as credit_cents
from public.days d
join public.v_amortization_bucket_total t
  on t.user_id = d.user_id
  and t.status = 'active'
  and d.date between t.start_date and t.end_date;

-- (3) Rewire v_day_totals: add the credit to earnings_total + cashflow_total ONLY.
--     CTEs + all other columns are byte-identical to 20260619170000.
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
  (coalesce(e.earnings_total, 0) + coalesce(cr.credit_cents, 0) / 100.0)::numeric(12, 2) as earnings_total,
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
    (coalesce(e.earnings_total, 0) + coalesce(cr.credit_cents, 0) / 100.0)
    - (coalesce(t.transaction_spend_total, 0) + d.manual_spend_adjustment)
    - (d.base_amount + coalesce(amt.amort_cents, 0) / 100.0)
  )::numeric(12, 2) as cashflow_total
from public.days d
left join earn_totals e on e.day_id = d.id and e.user_id = d.user_id
left join transaction_totals t on t.day_id = d.id and t.user_id = d.user_id
left join public.v_day_amortized_totals amt
  on amt.day_id = d.id and amt.user_id = d.user_id
left join public.v_day_amortization_credit cr
  on cr.day_id = d.id and cr.user_id = d.user_id;
