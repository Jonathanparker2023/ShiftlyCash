-- Gas allocations are daily spend overlays, not fixed expenses.
-- A gas fill defines a daily burn rate from the day after the previous fill
-- through the current fill, then mirrors that rate forward until the next gas
-- allocation supersedes it.

create table if not exists public.gas_allocations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_transaction_id uuid not null references public.transactions(id) on delete cascade,
  merchant_name text not null,
  fill_date date not null,
  previous_fill_date date not null,
  start_date date generated always as (previous_fill_date + 1) stored,
  gas_amount_cents integer not null check (gas_amount_cents > 0),
  original_amount_cents integer not null check (original_amount_cents > 0),
  remainder_amount_cents integer not null check (remainder_amount_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gas_allocations_period_check check (fill_date > previous_fill_date),
  constraint gas_allocations_amount_check check (
    gas_amount_cents <= original_amount_cents
    and remainder_amount_cents = original_amount_cents - gas_amount_cents
  )
);

create unique index if not exists gas_allocations_source_transaction_uq
  on public.gas_allocations(source_transaction_id);

create index if not exists gas_allocations_user_start_idx
  on public.gas_allocations(user_id, start_date);

alter table public.gas_allocations enable row level security;

drop policy if exists gas_allocations_owner on public.gas_allocations;
create policy gas_allocations_owner on public.gas_allocations
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.gas_allocations to authenticated;

create or replace function public.touch_gas_allocations_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists gas_allocations_touch on public.gas_allocations;
create trigger gas_allocations_touch
  before update on public.gas_allocations
  for each row execute function public.touch_gas_allocations_updated_at();

create or replace view public.v_day_gas_spend_totals
with (security_invoker = true)
as
with ordered as (
  select
    ga.*,
    lead(ga.start_date) over (
      partition by ga.user_id
      order by ga.start_date, ga.fill_date, ga.id
    ) as next_start_date,
    greatest(1, (ga.fill_date - ga.previous_fill_date))::integer as period_days
  from public.gas_allocations ga
  where ga.is_active
),
expanded as (
  select
    d.id as day_id,
    d.user_id,
    sum(
      case
        when d.date between o.start_date and o.fill_date then
          (
            floor((o.gas_amount_cents::numeric * ((d.date - o.start_date) + 1)) / o.period_days)
            - floor((o.gas_amount_cents::numeric * (d.date - o.start_date)) / o.period_days)
          )::integer
        else
          round(o.gas_amount_cents::numeric / o.period_days)::integer
      end
    )::integer as gas_spend_cents
  from public.days d
  join ordered o
    on o.user_id = d.user_id
   and d.date >= o.start_date
   and (o.next_start_date is null or d.date < o.next_start_date)
  group by d.id, d.user_id
)
select
  day_id,
  user_id,
  gas_spend_cents
from expanded;

grant select on public.v_day_gas_spend_totals to authenticated;

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
        when es.job_type::text = 'custom' and es.pay_type::text = 'regular'
          then es.hours_or_units * (cj.regular_rate_cents / 100.0)
        when es.job_type::text = 'custom' and es.pay_type::text = 'overtime'
          then es.hours_or_units * (cj.ot_rate_cents / 100.0)
        when es.job_type::text = 'custom' and es.pay_type::text = 'split'
          then (es.regular_hours * (cj.regular_rate_cents / 100.0))
            + (es.overtime_hours * (cj.ot_rate_cents / 100.0))
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
  left join public.custom_jobs cj
    on cj.id = es.custom_job_id and cj.user_id = es.user_id
  group by es.day_id, es.user_id
),
active_gas as (
  select
    ga.source_transaction_id,
    ga.user_id,
    ga.gas_amount_cents
  from public.gas_allocations ga
  where ga.is_active
),
transaction_totals as (
  select
    t.day_id,
    t.user_id,
    coalesce(sum(greatest(round(t.amount * 100)::integer - coalesce(ag.gas_amount_cents, 0), 0) / 100.0) filter (where t.status = 'applied'), 0)::numeric(12, 2)
      as transaction_spend_total,
    coalesce(sum(greatest(round(t.amount * 100)::integer - coalesce(ag.gas_amount_cents, 0), 0) / 100.0) filter (
      where t.status = 'applied' and t.source = 'manual'
    ), 0)::numeric(12, 2) as manual_transaction_total,
    coalesce(sum(greatest(round(t.amount * 100)::integer - coalesce(ag.gas_amount_cents, 0), 0) / 100.0) filter (
      where t.status = 'applied' and t.source = 'plaid'
    ), 0)::numeric(12, 2) as plaid_transaction_total,
    coalesce(count(*) filter (where t.status = 'pending_review'), 0)::integer
      as pending_transaction_count
  from public.transactions t
  left join active_gas ag
    on ag.source_transaction_id = t.id and ag.user_id = t.user_id
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
  (coalesce(t.transaction_spend_total, 0) + coalesce(gas.gas_spend_cents, 0) / 100.0)::numeric(12, 2) as transaction_spend_total,
  coalesce(t.manual_transaction_total, 0)::numeric(12, 2) as manual_transaction_total,
  coalesce(t.plaid_transaction_total, 0)::numeric(12, 2) as plaid_transaction_total,
  coalesce(t.pending_transaction_count, 0)::integer as pending_transaction_count,
  (
    coalesce(t.transaction_spend_total, 0)
    + coalesce(gas.gas_spend_cents, 0) / 100.0
    + d.manual_spend_adjustment
  )::numeric(12, 2) as spend_total,
  (
    (coalesce(e.earnings_total, 0) + coalesce(cr.credit_cents, 0) / 100.0)
    - (coalesce(t.transaction_spend_total, 0) + coalesce(gas.gas_spend_cents, 0) / 100.0 + d.manual_spend_adjustment)
    - (d.base_amount + coalesce(amt.amort_cents, 0) / 100.0)
  )::numeric(12, 2) as cashflow_total
from public.days d
left join earn_totals e on e.day_id = d.id and e.user_id = d.user_id
left join transaction_totals t on t.day_id = d.id and t.user_id = d.user_id
left join public.v_day_gas_spend_totals gas
  on gas.day_id = d.id and gas.user_id = d.user_id
left join public.v_day_amortized_totals amt
  on amt.day_id = d.id and amt.user_id = d.user_id
left join public.v_day_amortization_credit cr
  on cr.day_id = d.id and cr.user_id = d.user_id;
