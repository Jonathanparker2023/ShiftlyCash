-- A posted auto-loan debit belongs in cashflow but not consumption spending.
-- This flag gives the day/weekly rollups that missing third treatment.

alter table public.transactions
  add column if not exists cashflow_only boolean not null default false;

comment on column public.transactions.cashflow_only is
  'When true, subtract the posted debit from cashflow but exclude it from consumption spending. Used for verified auto-loan payments.';

create or replace view public.v_day_totals
with (security_invoker = true)
as
with earn_totals as (
  select
    es.day_id,
    es.user_id,
    coalesce(sum(
      coalesce(
        es.reconciled_net_cents::numeric / 100.0,
        case
          when es.job_type::text = 'ability' and es.pay_type::text = 'regular'
            then es.hours_or_units * s.ability_regular_net_rate
          when es.job_type::text = 'ability' and es.pay_type::text = 'overtime'
            then es.hours_or_units * s.ability_ot_net_rate
          when es.job_type::text = 'ability' and es.pay_type::text = 'split'
            then es.regular_hours * s.ability_regular_net_rate
              + es.overtime_hours * s.ability_ot_net_rate
          when es.job_type::text = 'prestige' and es.pay_type::text = 'regular'
            then es.hours_or_units * s.prestige_regular_net_rate
          when es.job_type::text = 'prestige' and es.pay_type::text = 'overtime'
            then es.hours_or_units * s.prestige_ot_net_rate
          when es.job_type::text = 'prestige' and es.pay_type::text = 'split'
            then es.regular_hours * s.prestige_regular_net_rate
              + es.overtime_hours * s.prestige_ot_net_rate
          when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'regular'
            then es.hours_or_units * s.prestige_ilst_net_rate
          when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'overtime'
            then es.hours_or_units * s.prestige_ilst_ot_net_rate
          when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'split'
            then es.regular_hours * s.prestige_ilst_net_rate
              + es.overtime_hours * s.prestige_ilst_ot_net_rate
          when es.job_type::text = 'incentive'
            then es.hours_or_units * (1 - s.ability_withholding_rate)
          when es.job_type::text = 'other' then es.hours_or_units
          when es.job_type::text = 'custom' and es.pay_type::text = 'regular'
            then es.hours_or_units * (cj.regular_rate_cents::numeric / 100.0)
          when es.job_type::text = 'custom' and es.pay_type::text = 'overtime'
            then es.hours_or_units * (cj.ot_rate_cents::numeric / 100.0)
          when es.job_type::text = 'custom' and es.pay_type::text = 'split'
            then es.regular_hours * (cj.regular_rate_cents::numeric / 100.0)
              + es.overtime_hours * (cj.ot_rate_cents::numeric / 100.0)
          else 0
        end
        + case
            when es.job_type::text = 'ability' and es.incentive_mode = 'rate'
              then es.hours_or_units * es.incentive_rate
                * (1 - s.ability_withholding_rate)
            when es.job_type::text = 'ability' and es.incentive_mode = 'lump_sum'
              then es.incentive_amount * (1 - s.ability_withholding_rate)
            else 0
          end
      )
    ), 0)::numeric(12, 2) as earnings_total,
    coalesce(sum(
      case
        when es.job_type::text = 'ability' and es.pay_type::text = 'regular'
          then es.hours_or_units * s.ability_regular_net_rate
        when es.job_type::text = 'ability' and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.ability_ot_net_rate
        when es.job_type::text = 'ability' and es.pay_type::text = 'split'
          then es.regular_hours * s.ability_regular_net_rate
            + es.overtime_hours * s.ability_ot_net_rate
        when es.job_type::text = 'incentive'
          then es.hours_or_units * (1 - s.ability_withholding_rate)
        else 0
      end
      + case
          when es.job_type::text = 'ability' and es.incentive_mode = 'rate'
            then es.hours_or_units * es.incentive_rate
              * (1 - s.ability_withholding_rate)
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
          then es.regular_hours * s.prestige_regular_net_rate
            + es.overtime_hours * s.prestige_ot_net_rate
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'regular'
          then es.hours_or_units * s.prestige_ilst_net_rate
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'overtime'
          then es.hours_or_units * s.prestige_ilst_ot_net_rate
        when es.job_type::text = 'prestige_ilst' and es.pay_type::text = 'split'
          then es.regular_hours * s.prestige_ilst_net_rate
            + es.overtime_hours * s.prestige_ilst_ot_net_rate
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
  left join public.custom_jobs cj
    on cj.id = es.custom_job_id and cj.user_id = es.user_id
  group by es.day_id, es.user_id
), active_transport as (
  select
    source_transaction_id,
    user_id,
    gas_amount_cents as allocated_cents
  from public.gas_allocations
  where is_active
  union all
  select
    source_transaction_id,
    user_id,
    charge_amount_cents as allocated_cents
  from public.ev_charge_allocations
  where is_active
), transaction_totals as (
  select
    t.day_id,
    t.user_id,
    coalesce(sum(
      greatest(
        round(t.amount * 100)::integer - coalesce(at.allocated_cents, 0),
        0
      )::numeric / 100.0
    ) filter (
      where t.status = 'applied' and not t.cashflow_only
    ), 0)::numeric(12, 2) as transaction_spend_total,
    coalesce(sum(
      greatest(
        round(t.amount * 100)::integer - coalesce(at.allocated_cents, 0),
        0
      )::numeric / 100.0
    ) filter (
      where t.status = 'applied'
        and t.source = 'manual'
        and not t.cashflow_only
    ), 0)::numeric(12, 2) as manual_transaction_total,
    coalesce(sum(
      greatest(
        round(t.amount * 100)::integer - coalesce(at.allocated_cents, 0),
        0
      )::numeric / 100.0
    ) filter (
      where t.status = 'applied'
        and t.source = 'plaid'
        and not t.cashflow_only
    ), 0)::numeric(12, 2) as plaid_transaction_total,
    coalesce(sum(
      greatest(
        round(t.amount * 100)::integer - coalesce(at.allocated_cents, 0),
        0
      )::numeric / 100.0
    ) filter (
      where t.status = 'applied' and t.cashflow_only
    ), 0)::numeric(12, 2) as cashflow_only_total,
    coalesce(count(*) filter (
      where t.status = 'pending_review'
    ), 0)::integer as pending_transaction_count
  from public.transactions t
  left join active_transport at
    on at.source_transaction_id = t.id and at.user_id = t.user_id
  where t.day_id is not null
  group by t.day_id, t.user_id
)
select
  d.id as day_id,
  d.user_id,
  d.week_id,
  d.date,
  d.day_index,
  (
    d.base_amount + coalesce(amt.amort_cents, 0)::numeric / 100.0
  )::numeric(10, 2) as base_amount,
  d.manual_spend_adjustment,
  d.spend_locked,
  (
    coalesce(e.earnings_total, 0)
      + coalesce(cr.credit_cents, 0)::numeric / 100.0
  )::numeric(12, 2) as earnings_total,
  coalesce(e.ability_paycheck_earnings, 0)::numeric(12, 2)
    as ability_paycheck_earnings,
  coalesce(e.prestige_paycheck_earnings, 0)::numeric(12, 2)
    as prestige_paycheck_earnings,
  coalesce(e.wage_hours_total, 0)::numeric(10, 2) as wage_hours_total,
  (
    coalesce(t.transaction_spend_total, 0)
      + coalesce(gas.gas_spend_cents, 0)::numeric / 100.0
      + coalesce(ev.ev_charge_spend_cents, 0)::numeric / 100.0
  )::numeric(12, 2) as transaction_spend_total,
  coalesce(t.manual_transaction_total, 0)::numeric(12, 2)
    as manual_transaction_total,
  coalesce(t.plaid_transaction_total, 0)::numeric(12, 2)
    as plaid_transaction_total,
  coalesce(t.pending_transaction_count, 0) as pending_transaction_count,
  (
    coalesce(t.transaction_spend_total, 0)
      + coalesce(gas.gas_spend_cents, 0)::numeric / 100.0
      + coalesce(ev.ev_charge_spend_cents, 0)::numeric / 100.0
      + d.manual_spend_adjustment
  )::numeric(12, 2) as spend_total,
  (
    coalesce(e.earnings_total, 0)
      + coalesce(cr.credit_cents, 0)::numeric / 100.0
      - (
        coalesce(t.transaction_spend_total, 0)
          + coalesce(t.cashflow_only_total, 0)
          + coalesce(gas.gas_spend_cents, 0)::numeric / 100.0
          + coalesce(ev.ev_charge_spend_cents, 0)::numeric / 100.0
          + d.manual_spend_adjustment
      )
      - (
        d.base_amount + coalesce(amt.amort_cents, 0)::numeric / 100.0
      )
  )::numeric(12, 2) as cashflow_total
from public.days d
left join earn_totals e
  on e.day_id = d.id and e.user_id = d.user_id
left join transaction_totals t
  on t.day_id = d.id and t.user_id = d.user_id
left join public.v_day_gas_spend_totals gas
  on gas.day_id = d.id and gas.user_id = d.user_id
left join public.v_day_ev_charge_spend_totals ev
  on ev.day_id = d.id and ev.user_id = d.user_id
left join public.v_day_amortized_totals amt
  on amt.day_id = d.id and amt.user_id = d.user_id
left join public.v_day_amortization_credit cr
  on cr.day_id = d.id and cr.user_id = d.user_id;
