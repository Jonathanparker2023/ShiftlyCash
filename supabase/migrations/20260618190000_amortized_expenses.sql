-- Hypervariable expense amortization — real data model + read-time derived baseline.
--
-- BEFORE: an "amortized" cost was a fake public.expenses row named
-- "<merchant> (amort <date>)" with an expiration_date; the day baseline was one
-- flat blended scalar (sum/4.33/7) copied onto every future day. Refund/remove/
-- re-amortize could not clear historical allocations because none existed.
--
-- AFTER: amortized costs live in public.amortized_expenses (original amount +
-- start_date + period_days + source txn link + is_active). Each day's baseline
-- is DERIVED at read time from a view chain, so any lifecycle edit (single row)
-- re-derives every overlapping day automatically. Penny distribution uses a
-- cumulative-floor (Bresenham) rule so daily slices sum to the original exactly.
--
-- FREEZE HORIZON: days older than AMORT_FREEZE_HORIZON_DAYS (62, ~2 months) keep
-- their stamped days.base_amount (frozen), so refunds never silently rewrite old
-- running-balance / debt-payoff history. Recent + current + future days derive
-- live. public.force_recompute_baseline(from, to) is the manual lever to
-- re-stamp an older window on demand.

----------------------------------------------------------------------
-- 1. amortized_expenses table
----------------------------------------------------------------------
create table if not exists public.amortized_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_transaction_id uuid null references public.transactions(id) on delete cascade,
  merchant_name text not null,
  original_amount_cents bigint not null check (original_amount_cents > 0),
  start_date date not null,
  period_days integer not null check (period_days > 0),
  is_active boolean not null default true,
  schedule_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  end_date date generated always as (start_date + (period_days - 1)) stored
);

create index if not exists amortized_expenses_user_active_idx
  on public.amortized_expenses (user_id, is_active);
create index if not exists amortized_expenses_user_window_idx
  on public.amortized_expenses (user_id, start_date, end_date);
create unique index if not exists amortized_expenses_source_txn_uq
  on public.amortized_expenses (source_transaction_id)
  where source_transaction_id is not null;

alter table public.amortized_expenses enable row level security;

drop policy if exists amortized_expenses_owner on public.amortized_expenses;
create policy amortized_expenses_owner on public.amortized_expenses
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- keep updated_at fresh (no append-only block trigger: this table must mutate)
create or replace function public.touch_amortized_expenses_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists amortized_expenses_touch on public.amortized_expenses;
create trigger amortized_expenses_touch
  before update on public.amortized_expenses
  for each row execute function public.touch_amortized_expenses_updated_at();

----------------------------------------------------------------------
-- 2. derivation views
----------------------------------------------------------------------

-- Recurring-only daily base scalar (cents). Identical math to the legacy
-- v_active_expense_totals path (sum monthly / 4.33 / 7), so recurring baselines
-- do NOT drift for users with no amortized costs.
create or replace view public.v_recurring_daily_base
with (security_invoker = true)
as
select
  e.user_id,
  round(
    round(coalesce(sum(round(e.amount * 100)), 0) / public.weeks_per_month()) / 7
  )::bigint as recurring_daily_cents
from public.expenses e
where e.is_active
  and (e.expiration_date is null or e.expiration_date >= current_date)
group by e.user_id;

-- One row per (day, contributing item). Amortized rows carry the exact
-- cumulative-floor slice; recurring rows are per-expense for the drill-down
-- display (their authoritative subtotal is v_recurring_daily_base).
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
  a.merchant_name as item_name,
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

-- Authoritative per-day baseline (cents) = the EXACT sum of the drill-down
-- allocation rows, so the displayed "Fixed" total always equals the sum of its
-- breakdown to the penny (the verify-nothing's-off requirement). This means the
-- recurring contribution is the sum of per-expense daily slices rather than a
-- single aggregate round — a one-time sub-cent shift from the legacy number,
-- intentional so the breakdown reconciles.
create or replace view public.v_day_base_totals
with (security_invoker = true)
as
select
  d.user_id,
  d.id as day_id,
  d.date,
  coalesce(sum(al.applied_cents), 0)::bigint as base_cents
from public.days d
left join public.v_day_base_allocations al
  on al.day_id = d.id and al.user_id = d.user_id
group by d.user_id, d.id, d.date;

----------------------------------------------------------------------
-- 3. force_recompute_baseline — manual lever to re-stamp a frozen window
----------------------------------------------------------------------
-- Re-derives v_day_base_totals and writes it into days.base_amount for an
-- explicit date range, overriding the freeze horizon. Use for the rare deep
-- historical edit. SECURITY INVOKER so RLS scopes to the caller.
create or replace function public.force_recompute_baseline(p_from date, p_to date)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required.';
  end if;
  update public.days d
  set base_amount = round(b.base_cents::numeric / 100.0, 2)
  from public.v_day_base_totals b
  where b.day_id = d.id
    and d.user_id = v_user_id
    and d.date between p_from and p_to;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.force_recompute_baseline(date, date) to authenticated;

----------------------------------------------------------------------
-- 4. rewire v_day_totals: base term becomes horizon-aware derived value
----------------------------------------------------------------------
-- Days within 62d of today (and future): live-derived base.
-- Days older than 62d: frozen days.base_amount (stable history).
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
  -- effective base: derived live within freeze horizon, else frozen cache
  (
    case
      when d.date >= current_date - 62
        then round(coalesce(b.base_cents, 0)::numeric / 100.0, 2)
      else d.base_amount
    end
  )::numeric(12, 2) as base_amount,
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
    - case
        when d.date >= current_date - 62
          then round(coalesce(b.base_cents, 0)::numeric / 100.0, 2)
        else d.base_amount
      end
  )::numeric(12, 2) as cashflow_total
from public.days d
left join earn_totals e on e.day_id = d.id and e.user_id = d.user_id
left join transaction_totals t on t.day_id = d.id and t.user_id = d.user_id
left join public.v_day_base_totals b on b.day_id = d.id and b.user_id = d.user_id;
