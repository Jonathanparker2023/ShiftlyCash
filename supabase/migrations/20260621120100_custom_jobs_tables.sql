-- Custom jobs: step 2 of 2 — table, FK links, and earnings.
-- ADDITIVE layer: every existing earn_slot keeps job_type unchanged and
-- custom_job_id NULL, so every existing CASE arm evaluates identically. Custom
-- income is a self-contained third source (like 'other'): it feeds earnings_total
-- + cashflow_total ONLY, never the ability/prestige paycheck buckets or
-- wage_hours_total. Rates are NET take-home, integer cents (/100.0 in SQL).

----------------------------------------------------------------------
-- 1. custom_jobs library (per user)
----------------------------------------------------------------------
create table if not exists public.custom_jobs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  name               text not null check (length(trim(name)) between 1 and 40),
  color              text not null default '#475569'
                       check (color ~ '^#[0-9a-fA-F]{6}$'),
  regular_rate_cents integer not null default 0 check (regular_rate_cents >= 0),
  ot_rate_cents      integer not null default 0 check (ot_rate_cents >= 0),
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists custom_jobs_user_active_idx
  on public.custom_jobs (user_id) where active;

alter table public.custom_jobs enable row level security;
drop policy if exists custom_jobs_owner on public.custom_jobs;
create policy custom_jobs_owner on public.custom_jobs
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.touch_custom_jobs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists custom_jobs_touch on public.custom_jobs;
create trigger custom_jobs_touch before update on public.custom_jobs
  for each row execute function public.touch_custom_jobs_updated_at();

----------------------------------------------------------------------
-- 2. nullable FK on both slot tables (NULL for every existing/non-custom row).
--    ON DELETE RESTRICT: a referenced job can't be hard-deleted; the UI
--    deactivates (active=false) instead so closed weeks still price correctly.
----------------------------------------------------------------------
alter table public.earn_slots
  add column if not exists custom_job_id uuid
  references public.custom_jobs(id) on delete restrict;
alter table public.template_slots
  add column if not exists custom_job_id uuid
  references public.custom_jobs(id) on delete restrict;

-- custom_job_id present IFF job_type='custom'. True for every legacy row
-- (both sides false) so no backfill and no validation failure.
alter table public.earn_slots drop constraint if exists earn_slots_custom_job_link;
alter table public.earn_slots add constraint earn_slots_custom_job_link
  check ((job_type = 'custom') = (custom_job_id is not null));
alter table public.template_slots drop constraint if exists template_slots_custom_job_link;
alter table public.template_slots add constraint template_slots_custom_job_link
  check ((job_type = 'custom') = (custom_job_id is not null));

----------------------------------------------------------------------
-- 3. v_day_totals: + custom_jobs LEFT JOIN and 3 custom earnings arms.
--    Byte-identical for every existing row (custom_job_id NULL, job_type<>custom).
--    Paycheck buckets + wage_hours_total unchanged (custom excluded by design).
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
