-- Historic weeks 1-13 were imported as week-level summary rows. They preserve
-- earnings_total, but they do not have shift-level Ability/Prestige slots.
-- The tax projection engine grosses up Ability and Prestige separately, so a
-- week with earnings_total > 0 and zero split values undercounts ypwiGross.
--
-- Match the legacy _wkSplit fallback for summary-only weeks:
--   Ability = earnings_total * 0.68
--   Prestige = earnings_total * 0.32
--
-- Keep this in the view layer so calcWeeklyProjection stays pure and receives
-- complete WeekRow inputs.

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
    coalesce(sum(d.pending_transaction_count), 0)::integer as pending_transaction_count
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
      when wrr.earnings_total > 0
        and wrr.ability_paycheck_earnings = 0
        and wrr.prestige_paycheck_earnings = 0
        then (wrr.earnings_total * 0.68)::numeric(12, 2)
      else wrr.ability_paycheck_earnings
    end as ability_paycheck_earnings,
    case
      when wrr.earnings_total > 0
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
