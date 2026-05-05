create or replace view public.plaid_item_metadata
with (security_barrier = true)
as
select
  id,
  user_id,
  plaid_item_id,
  institution_name,
  status,
  last_synced_at,
  created_at,
  updated_at
from public.plaid_items
where user_id = auth.uid();

create or replace view public.v_day_totals
with (security_invoker = true)
as
with earn_totals as (
  select
    es.day_id,
    es.user_id,
    coalesce(sum(
      case
        when es.job_type = 'ability' and es.pay_type = 'regular'
          then es.hours_or_units * s.ability_regular_net_rate
        when es.job_type = 'ability' and es.pay_type = 'overtime'
          then es.hours_or_units * s.ability_ot_net_rate
        when es.job_type = 'prestige' and es.pay_type = 'regular'
          then es.hours_or_units * s.prestige_regular_net_rate
        when es.job_type = 'prestige' and es.pay_type = 'overtime'
          then es.hours_or_units * s.prestige_ot_net_rate
        when es.job_type = 'incentive'
          then es.hours_or_units * s.incentive_net_multiplier
        when es.job_type = 'other'
          then es.hours_or_units
        else 0
      end
    ), 0)::numeric(12, 2) as earnings_total,
    coalesce(sum(
      case
        when es.job_type = 'ability' and es.pay_type = 'regular'
          then es.hours_or_units * s.ability_regular_net_rate
        when es.job_type = 'ability' and es.pay_type = 'overtime'
          then es.hours_or_units * s.ability_ot_net_rate
        when es.job_type = 'incentive'
          then es.hours_or_units * s.incentive_net_multiplier
        else 0
      end
    ), 0)::numeric(12, 2) as ability_paycheck_earnings,
    coalesce(sum(
      case
        when es.job_type = 'prestige' and es.pay_type = 'regular'
          then es.hours_or_units * s.prestige_regular_net_rate
        when es.job_type = 'prestige' and es.pay_type = 'overtime'
          then es.hours_or_units * s.prestige_ot_net_rate
        else 0
      end
    ), 0)::numeric(12, 2) as prestige_paycheck_earnings,
    coalesce(sum(es.hours_or_units) filter (
      where es.job_type in ('ability', 'prestige')
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
  d.base_amount,
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
    - d.base_amount
  )::numeric(12, 2) as cashflow_total
from public.days d
left join earn_totals e on e.day_id = d.id and e.user_id = d.user_id
left join transaction_totals t on t.day_id = d.id and t.user_id = d.user_id;

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
      -- Historic summary weeks imported without shift-level Ability/Prestige
      -- detail still need a gross-up split for tax projections. Match the
      -- legacy _wkSplit fallback: 68% Ability, 32% Prestige.
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

create or replace view public.v_projection_weeks
with (security_invoker = true)
as
select
  wt.week_id,
  wt.user_id,
  wt.start_date,
  wt.end_date,
  wt.display_week_number,
  wt.status,
  wt.archived_at,
  coalesce(wpe.exclude_earnings, false) as exclude_earnings,
  coalesce(wpe.exclude_spend, false) as exclude_spend,
  coalesce(wpe.exclude_cashflow, false) as exclude_cashflow,
  case when coalesce(wpe.exclude_earnings, false) then null else wt.earnings_total end
    as earnings_for_projection,
  case when coalesce(wpe.exclude_spend, false) then null else wt.spend_total end
    as spend_for_projection,
  case when coalesce(wpe.exclude_cashflow, false) then null else wt.cashflow_total end
    as cashflow_for_projection
from public.v_week_totals wt
left join public.week_projection_exclusions wpe
  on wpe.week_id = wt.week_id
  and wpe.user_id = wt.user_id
where wt.status = 'closed'
  and wt.archived_at is null;

create or replace view public.v_pending_transactions
with (security_invoker = true)
as
select
  t.id as transaction_id,
  t.user_id,
  t.day_id,
  t.date,
  t.merchant_name,
  t.raw_name,
  t.amount,
  t.category,
  t.source,
  t.review_reason,
  t.created_at
from public.transactions t
where t.status = 'pending_review';

create or replace view public.v_active_expense_totals
with (security_invoker = true)
as
select
  e.user_id,
  coalesce(sum(e.amount) filter (
    where e.is_active
      and (e.expiration_date is null or e.expiration_date >= current_date)
  ), 0)::numeric(12, 2) as monthly_total,
  (
    coalesce(sum(e.amount) filter (
      where e.is_active
        and (e.expiration_date is null or e.expiration_date >= current_date)
    ), 0) / public.weeks_per_month()
  )::numeric(12, 2) as weekly_average,
  (
    coalesce(sum(e.amount) filter (
      where e.is_active
        and (e.expiration_date is null or e.expiration_date >= current_date)
    ), 0) / public.weeks_per_month() / 7
  )::numeric(12, 2) as projected_daily_base
from public.expenses e
group by e.user_id;
