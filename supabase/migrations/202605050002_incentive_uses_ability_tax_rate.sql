-- Incentive pay is an arm of Ability Beyond, so it should be taxed at the
-- Ability rate. Drop the now-redundant incentive_net_multiplier and
-- incentive_withholding_rate columns and rewrite v_day_totals to derive the
-- incentive net amount from ability_withholding_rate.

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
          then es.hours_or_units * (1 - s.ability_withholding_rate)
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
          then es.hours_or_units * (1 - s.ability_withholding_rate)
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

alter table public.settings
  drop constraint if exists settings_rate_bounds;

alter table public.settings
  drop column if exists incentive_net_multiplier,
  drop column if exists incentive_withholding_rate;

alter table public.settings
  add constraint settings_rate_bounds check (
    ability_regular_net_rate >= 0
    and ability_ot_net_rate >= 0
    and prestige_regular_net_rate >= 0
    and prestige_ot_net_rate >= 0
    and ability_withholding_rate >= 0 and ability_withholding_rate < 1
    and prestige_withholding_rate >= 0 and prestige_withholding_rate < 1
  );
