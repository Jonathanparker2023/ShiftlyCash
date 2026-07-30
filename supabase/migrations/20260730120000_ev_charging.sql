-- Retire gas as a frozen historical series and begin transaction-backed EV
-- charging allocations. Gas remains visible and continues to reconcile exactly;
-- its whole-history average simply stops changing after 2026-07-30.

drop table if exists public.ev_charging_weeks;
drop table if exists public.ev_charging_settings;
drop function if exists public.touch_ev_charging_settings_updated_at();

create table if not exists public.transport_energy_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  gas_ended_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.transport_energy_settings (user_id, gas_ended_on)
select id, date '2026-07-30'
from public.profiles
on conflict (user_id) do update
set gas_ended_on = excluded.gas_ended_on,
    updated_at = now();

alter table public.transport_energy_settings enable row level security;

drop policy if exists transport_energy_settings_owner
  on public.transport_energy_settings;
create policy transport_energy_settings_owner
  on public.transport_energy_settings
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete
  on public.transport_energy_settings to authenticated;

create table if not exists public.ev_charge_allocations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_transaction_id uuid not null,
  merchant_name text not null,
  charge_date date not null,
  previous_charge_date date not null,
  start_date date generated always as (previous_charge_date + 1) stored,
  charge_amount_cents integer not null check (charge_amount_cents > 0),
  original_amount_cents integer not null check (original_amount_cents > 0),
  remainder_amount_cents integer not null check (remainder_amount_cents >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ev_charge_allocations_transaction_fk
    foreign key (source_transaction_id, user_id)
    references public.transactions(id, user_id)
    on delete cascade,
  constraint ev_charge_allocations_period_check
    check (charge_date > previous_charge_date),
  constraint ev_charge_allocations_amount_check check (
    charge_amount_cents <= original_amount_cents
    and remainder_amount_cents = original_amount_cents - charge_amount_cents
  )
);

create unique index if not exists ev_charge_allocations_source_transaction_uq
  on public.ev_charge_allocations(source_transaction_id);

create index if not exists ev_charge_allocations_user_start_idx
  on public.ev_charge_allocations(user_id, start_date);

alter table public.ev_charge_allocations enable row level security;

drop policy if exists ev_charge_allocations_owner
  on public.ev_charge_allocations;
create policy ev_charge_allocations_owner
  on public.ev_charge_allocations
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete
  on public.ev_charge_allocations to authenticated;

create or replace function public.touch_transport_energy_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists transport_energy_settings_touch
  on public.transport_energy_settings;
create trigger transport_energy_settings_touch
  before update on public.transport_energy_settings
  for each row execute function public.touch_transport_energy_updated_at();

drop trigger if exists ev_charge_allocations_touch
  on public.ev_charge_allocations;
create trigger ev_charge_allocations_touch
  before update on public.ev_charge_allocations
  for each row execute function public.touch_transport_energy_updated_at();

create or replace function public.ev_charge_replaces_gas_allocation()
returns trigger language plpgsql as $$
begin
  if new.is_active then
    update public.gas_allocations
    set is_active = false
    where source_transaction_id = new.source_transaction_id
      and user_id = new.user_id
      and is_active;
  end if;
  return new;
end;
$$;

drop trigger if exists ev_charge_replaces_gas
  on public.ev_charge_allocations;
create trigger ev_charge_replaces_gas
  before insert or update of is_active
  on public.ev_charge_allocations
  for each row execute function public.ev_charge_replaces_gas_allocation();

create or replace view public.v_day_gas_spend_totals
with (security_invoker = true)
as
with agg as (
  select
    ga.user_id,
    sum(ga.gas_amount_cents)::numeric as numerator,
    min(coalesce(ga.start_date, ga.fill_date)) as first_date,
    least(
      (now() at time zone 'America/New_York')::date,
      coalesce(
        tes.gas_ended_on,
        (now() at time zone 'America/New_York')::date
      )
    ) as final_date
  from public.gas_allocations ga
  left join public.transport_energy_settings tes
    on tes.user_id = ga.user_id
  where ga.is_active
    and ga.fill_date <= coalesce(
      tes.gas_ended_on,
      (now() at time zone 'America/New_York')::date
    )
  group by ga.user_id, tes.gas_ended_on
), ranged as (
  select
    user_id,
    numerator,
    first_date,
    final_date,
    greatest(1, (final_date - first_date) + 1) as total_days
  from agg
)
select
  d.id as day_id,
  d.user_id,
  (
    floor(
      r.numerator * ((d.date - r.first_date) + 1)::numeric
      / r.total_days::numeric
    )
    - floor(
      r.numerator * (d.date - r.first_date)::numeric
      / r.total_days::numeric
    )
  )::integer as gas_spend_cents
from public.days d
join ranged r on r.user_id = d.user_id
where d.date >= r.first_date
  and d.date <= r.final_date;

grant select on public.v_day_gas_spend_totals to authenticated;

create or replace view public.v_day_ev_charge_spend_totals
with (security_invoker = true)
as
with agg as (
  select
    eca.user_id,
    sum(eca.charge_amount_cents)::numeric as numerator,
    min(coalesce(eca.start_date, eca.charge_date)) as first_date,
    (now() at time zone 'America/New_York')::date as today
  from public.ev_charge_allocations eca
  where eca.is_active
  group by eca.user_id
), ranged as (
  select
    user_id,
    numerator,
    first_date,
    today,
    greatest(1, (today - first_date) + 1) as total_days
  from agg
)
select
  d.id as day_id,
  d.user_id,
  (
    floor(
      r.numerator * ((d.date - r.first_date) + 1)::numeric
      / r.total_days::numeric
    )
    - floor(
      r.numerator * (d.date - r.first_date)::numeric
      / r.total_days::numeric
    )
  )::integer as ev_charge_spend_cents
from public.days d
join ranged r on r.user_id = d.user_id
where d.date >= r.first_date
  and d.date <= r.today;

grant select on public.v_day_ev_charge_spend_totals to authenticated;

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
    ) filter (where t.status = 'applied'), 0)::numeric(12, 2)
      as transaction_spend_total,
    coalesce(sum(
      greatest(
        round(t.amount * 100)::integer - coalesce(at.allocated_cents, 0),
        0
      )::numeric / 100.0
    ) filter (
      where t.status = 'applied' and t.source = 'manual'
    ), 0)::numeric(12, 2) as manual_transaction_total,
    coalesce(sum(
      greatest(
        round(t.amount * 100)::integer - coalesce(at.allocated_cents, 0),
        0
      )::numeric / 100.0
    ) filter (
      where t.status = 'applied' and t.source = 'plaid'
    ), 0)::numeric(12, 2) as plaid_transaction_total,
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
