-- Tighten the legacy 68/32 split fallback added in 0031 so it only applies to
-- the known summary rows from the week 1-13 import. A future real week with
-- only "other" or incentive income should not be automatically grossed up as
-- Ability/Prestige unless it is explicitly one of those legacy summaries.

create or replace view public.v_week_totals
with (security_invoker = true)
as
with week_rollup_raw as (
  select
    w.id as week_id,
    w.user_id,
    w.start_date,
    w.end_date,
    public.shiftly_display_week_number(w.start_date) as display_week_number,
    case
      when public.shiftly_display_week_number(w.start_date) % 2 = 0 then 'week_1'
      else 'week_2'
    end as pay_period_role,
    case
      when public.shiftly_display_week_number(w.start_date) % 2 = 1 then w.end_date + 5
      else null::date
    end as paycheck_due_date,
    w.status,
    w.closed_at,
    w.archived_at,
    coalesce(sum(d.earnings_total), 0)::numeric(12, 2) as earnings_total,
    coalesce(sum(d.ability_paycheck_earnings), 0)::numeric(12, 2) as ability_paycheck_earnings,
    coalesce(sum(d.prestige_paycheck_earnings), 0)::numeric(12, 2) as prestige_paycheck_earnings,
    coalesce(sum(d.wage_hours_total), 0)::numeric(10, 2) as wage_hours_total,
    coalesce(sum(d.transaction_spend_total), 0)::numeric(12, 2) as transaction_spend_total,
    coalesce(sum(d.manual_transaction_total), 0)::numeric(12, 2) as manual_transaction_total,
    coalesce(sum(d.plaid_transaction_total), 0)::numeric(12, 2) as plaid_transaction_total,
    coalesce(sum(d.manual_spend_adjustment), 0)::numeric(12, 2) as manual_spend_adjustment_total,
    coalesce(sum(d.spend_total), 0)::numeric(12, 2) as spend_total,
    coalesce(sum(d.base_amount), 0)::numeric(12, 2) as base_total,
    coalesce(sum(d.cashflow_total), 0)::numeric(12, 2) as cashflow_total,
    coalesce(sum(d.pending_transaction_count), 0)::integer as pending_transaction_count,
    exists (
      select 1
      from public.days summary_day
      join public.earn_slots summary_slot
        on summary_slot.day_id = summary_day.id
        and summary_slot.user_id = summary_day.user_id
      where summary_day.week_id = w.id
        and summary_day.user_id = w.user_id
        and summary_slot.source = 'migration'
        and summary_slot.job_type = 'other'
        and summary_slot.pay_type = 'unit'
        and summary_slot.label like 'Week % summary (legacy)'
    ) as has_legacy_summary_slot
  from public.weeks w
  left join public.v_day_totals d on d.week_id = w.id and d.user_id = w.user_id
  group by w.id, w.user_id, w.start_date, w.end_date, w.status, w.closed_at, w.archived_at
),
week_rollup as (
  select
    wrr.week_id,
    wrr.user_id,
    wrr.start_date,
    wrr.end_date,
    wrr.display_week_number,
    wrr.pay_period_role,
    wrr.paycheck_due_date,
    wrr.status,
    wrr.closed_at,
    wrr.archived_at,
    wrr.earnings_total,
    case
      when wrr.has_legacy_summary_slot
        and wrr.earnings_total > 0
        and wrr.ability_paycheck_earnings = 0
        and wrr.prestige_paycheck_earnings = 0
        then (wrr.earnings_total * 0.68)::numeric(12, 2)
      else wrr.ability_paycheck_earnings
    end as ability_paycheck_earnings,
    case
      when wrr.has_legacy_summary_slot
        and wrr.earnings_total > 0
        and wrr.ability_paycheck_earnings = 0
        and wrr.prestige_paycheck_earnings = 0
        then (wrr.earnings_total * 0.32)::numeric(12, 2)
      else wrr.prestige_paycheck_earnings
    end as prestige_paycheck_earnings,
    wrr.wage_hours_total,
    wrr.transaction_spend_total,
    wrr.manual_transaction_total,
    wrr.plaid_transaction_total,
    wrr.manual_spend_adjustment_total,
    wrr.spend_total,
    wrr.base_total,
    wrr.cashflow_total,
    wrr.pending_transaction_count
  from week_rollup_raw wrr
)
select
  wr.*,
  (sum(wr.cashflow_total) over (
    partition by wr.user_id
    order by wr.start_date
    rows between unbounded preceding and current row
  ))::numeric(12, 2) as running_balance
from week_rollup wr;
