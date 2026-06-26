-- supabase/migrations/20260626211500_paycheck_reconciliations.sql
--
-- Paycheck reconciliation (Option A — per-shift NET override), PER PAY PERIOD
-- PER JOB. The paychecks page exposes exactly two job kinds (src/lib/paychecks
-- /data.ts): the built-in "prestige" job (which folds job_type IN
-- ('prestige','prestige_ilst')) and "custom:<uuid>" jobs (job_type = 'custom'
-- with that custom_job_id). Ability/incentive are RETIRED from this page, so
-- they are never a reconcile target. Reconciliation scopes to ONE job key's
-- slot set inside ONE pay period and never touches other jobs' shifts in the
-- same fortnight.
--
-- "Reconcile" runs a Hamilton/largest-remainder net-to-net distribution over
-- that job's period shifts' DERIVED net (the exact v_day_totals earn CASE, in
-- integer cents) and OVERWRITES each shift's reconciled_net_cents so the job's
-- period Σ == the actual net take-home exactly. Every earnings rollup reads
-- COALESCE(reconciled_net_cents/100.0, <derived net CASE>); the derived net is
-- the immutable base and is never mutated. Idempotent: every run recomputes the
-- base from the derived-net CASE and overwrites the override (never reads it
-- back). Integer cents end to end; `factor` is display-only and nullable.
--
-- week_id = the pay period's week_2 (check-week) anchor, matching how
-- paycheck_actuals keys its actuals. One record per (user_id, week_id, job_key).

----------------------------------------------------------------------
-- 1. earn_slots: nullable per-shift net override (integer cents, >= 0)
----------------------------------------------------------------------
alter table public.earn_slots
  add column if not exists reconciled_net_cents integer
    check (reconciled_net_cents is null or reconciled_net_cents >= 0);

comment on column public.earn_slots.reconciled_net_cents is
  'Per-shift reconciled NET take-home in integer cents. NULL = not reconciled '
  '(rollups use the derived net = hours x net-rate). When set, rollups read '
  'COALESCE(reconciled_net_cents/100.0, derived net). Written only by the '
  'Hamilton/largest-remainder net-to-net distribution in reconcile_paycheck; '
  'the derived net is the immutable base and is never mutated. Auto-NULLed by '
  'trigger whenever the slot''s hours/job inputs change, so a stale override '
  'can never outlive the shift it scaled.';

-- 1b. Any edit to a reconciled slot's hours/job inputs invalidates its override
-- (punch-list #8): the dashboard editor re-derives from hours and must not show
-- a frozen reconciled net. Nulling here makes the rollup fall back to derived
-- immediately, and the period's reconciliation record goes stale (its base
-- snapshot no longer matches), prompting a re-reconcile on the paychecks page.
create or replace function public.clear_reconciled_net_on_input_change()
returns trigger language plpgsql as $$
begin
  if new.reconciled_net_cents is not null
     and (
       new.hours_or_units    is distinct from old.hours_or_units
       or new.regular_hours  is distinct from old.regular_hours
       or new.overtime_hours is distinct from old.overtime_hours
       or new.job_type       is distinct from old.job_type
       or new.pay_type       is distinct from old.pay_type
       or new.custom_job_id  is distinct from old.custom_job_id
       or new.incentive_mode is distinct from old.incentive_mode
       or new.incentive_rate is distinct from old.incentive_rate
       or new.incentive_amount is distinct from old.incentive_amount
     )
     -- Skip when THIS update is the reconcile write itself (it sets the override).
     and new.reconciled_net_cents is not distinct from old.reconciled_net_cents
  then
    new.reconciled_net_cents := null;
  end if;
  return new;
end;
$$;

drop trigger if exists earn_slots_clear_reconciled on public.earn_slots;
create trigger earn_slots_clear_reconciled
  before update on public.earn_slots
  for each row execute function public.clear_reconciled_net_on_input_change();

----------------------------------------------------------------------
-- 2. paycheck_reconciliations: one record per (user, week_2 anchor, job_key)
----------------------------------------------------------------------
create table if not exists public.paycheck_reconciliations (
  id                     uuid primary key default extensions.gen_random_uuid(),
  user_id                uuid not null references public.profiles(id) on delete cascade,
  -- week_id = the period's week_2 (check-week) anchor, matching paycheck_actuals.
  week_id                uuid not null,
  -- job_key = 'prestige' or 'custom:<uuid>' (same grain as paycheck_actuals.job_actuals).
  job_key                text not null,
  projected_amount_cents bigint not null,             -- snapshot Σ base (derived net), cents
  actual_amount_cents    bigint not null check (actual_amount_cents >= 0),
  factor                 numeric,                      -- display only (actual/projected); NULL when projected = 0
  basis                  text not null default 'net',
  confirmed_correct      boolean not null default false,
  status                 text not null default 'reconciled'
                           check (status in ('reconciled', 'reverted', 'disputed')),
  base_shift_ids         jsonb,                        -- staleness snapshot: shift ids, ordered id::text asc
  base_amounts_cents     jsonb,                        -- staleness snapshot: per-shift base net cents, same order
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Composite FK mirrors paycheck_actuals (weeks has unique index on (id, user_id)).
  constraint paycheck_reconciliations_week_fk foreign key (week_id, user_id)
    references public.weeks(id, user_id) on delete cascade,
  constraint paycheck_reconciliations_user_week_job_unique unique (user_id, week_id, job_key)
);

create index if not exists paycheck_reconciliations_user_idx
  on public.paycheck_reconciliations (user_id);

create or replace function public.touch_paycheck_reconciliations_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists paycheck_reconciliations_touch on public.paycheck_reconciliations;
create trigger paycheck_reconciliations_touch
  before update on public.paycheck_reconciliations
  for each row execute function public.touch_paycheck_reconciliations_updated_at();

----------------------------------------------------------------------
-- 3. RLS owner policy + grants
----------------------------------------------------------------------
alter table public.paycheck_reconciliations enable row level security;

drop policy if exists paycheck_reconciliations_own on public.paycheck_reconciliations;
create policy paycheck_reconciliations_own on public.paycheck_reconciliations for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.paycheck_reconciliations to authenticated;
grant all on public.paycheck_reconciliations to service_role;

----------------------------------------------------------------------
-- 4. paycheck_period_base_slots(week_id, job_key)
--    THE SINGLE SOURCE OF TRUTH for the reconcile base (punch-list #6/#12):
--    one row per matching slot, base_net_cents = round(<live v_day_totals earn
--    CASE> * 100). reconcile, revert, the staleness snapshot, AND the TS
--    preview all read from this function — the CASE is never re-derived in TS.
--
--    Period set (punch-list #7): the week_2 anchor week + the week whose
--    start_date = anchor.start_date - 7, resolved by start_date window over the
--    SAME (id, user_id) the caller owns — byte-identical to buildPeriod's
--    [periodStart, periodStart+13] with periodStart = week_2.start - 7.
--
--    Job filter (punch-list #2/#3/#13): 'prestige' -> job_type IN
--    ('prestige','prestige_ilst'); 'custom:<uuid>' -> job_type='custom' AND
--    custom_job_id = <uuid>. No other job key is reconcilable on this page.
----------------------------------------------------------------------
create or replace function public.paycheck_period_base_slots(
  p_week_id uuid,
  p_job_key text
)
returns table (slot_id uuid, base_net_cents bigint)
language sql
security invoker
stable
as $$
  with anchor as (
    select w.user_id, w.start_date
    from public.weeks w
    where w.id = p_week_id
      and w.user_id = auth.uid()
  ),
  period_weeks as (
    select w.id
    from public.weeks w, anchor a
    where w.user_id = a.user_id
      and w.start_date between (a.start_date - 7) and (a.start_date + 6)
  ),
  custom_target as (
    select case
             when p_job_key like 'custom:%'
               then nullif(substring(p_job_key from 8), '')::uuid
             else null
           end as custom_job_id
  )
  select
    es.id as slot_id,
    round(
      (
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
          when es.job_type::text = 'custom' and es.pay_type::text = 'regular'
            then es.hours_or_units * (cj.regular_rate_cents / 100.0)
          when es.job_type::text = 'custom' and es.pay_type::text = 'overtime'
            then es.hours_or_units * (cj.ot_rate_cents / 100.0)
          when es.job_type::text = 'custom' and es.pay_type::text = 'split'
            then (es.regular_hours * (cj.regular_rate_cents / 100.0))
              + (es.overtime_hours * (cj.ot_rate_cents / 100.0))
          else 0
        end
      ) * 100
    )::bigint as base_net_cents
  from public.earn_slots es
  join public.days d on d.id = es.day_id and d.user_id = es.user_id
  join public.settings s on s.user_id = es.user_id
  left join public.custom_jobs cj
    on cj.id = es.custom_job_id and cj.user_id = es.user_id
  cross join custom_target ct
  where es.user_id = auth.uid()
    and d.week_id in (select id from period_weeks)
    and (
      (p_job_key = 'prestige'
        and es.job_type::text in ('prestige', 'prestige_ilst'))
      or
      (p_job_key like 'custom:%'
        and es.job_type::text = 'custom'
        and es.custom_job_id = ct.custom_job_id)
    )
  order by es.id::text asc;
$$;

----------------------------------------------------------------------
-- 5. reconcile_paycheck(week_id, job_key, actual_cents, confirmed_correct)
--    Atomic: build base -> Hamilton split -> Σ==A assert -> override write ->
--    record upsert, all in one implicit transaction. Any RAISE rolls it back.
--    Returns the reconciliation record fields the UI threads into state.
----------------------------------------------------------------------
create or replace function public.reconcile_paycheck(
  p_week_id uuid,
  p_job_key text,
  p_actual_cents bigint,
  p_confirmed_correct boolean
)
returns table (
  status                 text,
  projected_amount_cents bigint,
  actual_amount_cents    bigint,
  factor                 numeric,
  slot_count             integer
)
language plpgsql
security invoker
as $$
declare
  v_uid       uuid := auth.uid();
  v_projected bigint;
  v_n         integer;
  v_floor_sum bigint;
  v_remainder bigint;
  v_alloc_sum bigint;
  v_factor    numeric;
  v_ids       jsonb;
  v_amts      jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;
  if p_confirmed_correct is not true then
    raise exception 'Reconciliation requires explicit confirmation that the check is correct.';
  end if;
  if p_actual_cents is null or p_actual_cents < 0 then
    raise exception 'Actual amount must be a non-negative integer cents value.';
  end if;

  -- Snapshot the base set into a temp table (id::text order = Hamilton order,
  -- matches the TS localeCompare order and the staleness snapshot order).
  drop table if exists _recon_base;
  create temp table _recon_base (
    rn      bigint,
    slot_id uuid,
    base    bigint,
    num     numeric,
    floor_v bigint,
    rem     numeric,
    alloc   bigint
  ) on commit drop;

  insert into _recon_base (rn, slot_id, base)
  select row_number() over (order by b.slot_id::text asc),
         b.slot_id,
         b.base_net_cents
  from public.paycheck_period_base_slots(p_week_id, p_job_key) b;

  select count(*), coalesce(sum(base), 0) into v_n, v_projected from _recon_base;

  if v_n = 0 then
    raise exception 'No shifts in this pay period for this job; nothing to reconcile.';
  end if;

  if v_projected = 0 then
    -- Equal split: floor = A / n, leftover A mod n to the first cells in order.
    update _recon_base
      set alloc = (p_actual_cents / v_n)
                + case when rn <= (p_actual_cents - (p_actual_cents / v_n) * v_n)
                       then 1 else 0 end;
  else
    -- Hamilton / largest-remainder over base.
    update _recon_base
      set num     = base::numeric * p_actual_cents,
          floor_v = floor(base::numeric * p_actual_cents / v_projected)::bigint;
    update _recon_base
      set rem = num - (floor_v::numeric * v_projected);
    select coalesce(sum(floor_v), 0) into v_floor_sum from _recon_base;
    v_remainder := p_actual_cents - v_floor_sum;  -- 0 <= v_remainder < n

    -- +1 cent to the top v_remainder rows: rem desc, then larger base, then id asc.
    update _recon_base t
      set alloc = floor_v + case
        when t.rn in (
          select rn from _recon_base
          order by rem desc, base desc, slot_id::text asc
          limit greatest(v_remainder, 0)
        ) then 1 else 0 end;
  end if;

  -- Hard invariant: Σ alloc == A, else abort + rollback.
  select coalesce(sum(alloc), 0) into v_alloc_sum from _recon_base;
  if v_alloc_sum <> p_actual_cents then
    raise exception 'Reconciliation distribution failed: allocated % cents != actual % cents.',
      v_alloc_sum, p_actual_cents;
  end if;

  -- Overwrite each slot's override FROM BASE allocation (idempotent; never reads
  -- back reconciled_net_cents). The input-change trigger skips this because the
  -- override column itself is what changes here.
  update public.earn_slots es
    set reconciled_net_cents = rb.alloc
  from _recon_base rb
  where es.id = rb.slot_id
    and es.user_id = v_uid;

  -- Staleness snapshot (ordered id::text asc, same as TS comparator).
  select jsonb_agg(slot_id order by slot_id::text asc),
         jsonb_agg(base    order by slot_id::text asc)
    into v_ids, v_amts
  from _recon_base;

  v_factor := case when v_projected = 0 then null
                   else p_actual_cents::numeric / v_projected::numeric end;

  insert into public.paycheck_reconciliations as pr (
    user_id, week_id, job_key,
    projected_amount_cents, actual_amount_cents, factor, basis,
    confirmed_correct, status, base_shift_ids, base_amounts_cents
  )
  values (
    v_uid, p_week_id, p_job_key,
    v_projected, p_actual_cents, v_factor, 'net',
    true, 'reconciled', v_ids, v_amts
  )
  on conflict (user_id, week_id, job_key) do update set
    projected_amount_cents = excluded.projected_amount_cents,
    actual_amount_cents    = excluded.actual_amount_cents,
    factor                 = excluded.factor,
    basis                  = 'net',
    confirmed_correct      = true,
    status                 = 'reconciled',
    base_shift_ids         = excluded.base_shift_ids,
    base_amounts_cents     = excluded.base_amounts_cents;

  return query
    select 'reconciled'::text, v_projected, p_actual_cents, v_factor, v_n;
end;
$$;

----------------------------------------------------------------------
-- 6. revert_paycheck_reconciliation(week_id, job_key)
--    Null the override for this job's period slots and mark the record
--    reverted; rollups fall back to derived net immediately.
----------------------------------------------------------------------
create or replace function public.revert_paycheck_reconciliation(
  p_week_id uuid,
  p_job_key text
)
returns table (cleared_slots integer)
language plpgsql
security invoker
as $$
declare
  v_uid     uuid := auth.uid();
  v_cleared integer := 0;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  update public.earn_slots es
    set reconciled_net_cents = null
  where es.user_id = v_uid
    and es.reconciled_net_cents is not null
    and es.id in (
      select slot_id from public.paycheck_period_base_slots(p_week_id, p_job_key)
    );
  get diagnostics v_cleared = row_count;

  update public.paycheck_reconciliations pr
    set status = 'reverted', confirmed_correct = false
  where pr.user_id = v_uid
    and pr.week_id = p_week_id
    and pr.job_key = p_job_key;

  return query select v_cleared;
end;
$$;

grant execute on function
  public.paycheck_period_base_slots(uuid, text),
  public.reconcile_paycheck(uuid, text, bigint, boolean),
  public.revert_paycheck_reconciliation(uuid, text)
  to authenticated, service_role;


-- v_day_totals override
create or replace view public.v_day_totals
with (security_invoker = true)
as
 WITH earn_totals AS (
         SELECT es.day_id,
            es.user_id,
            COALESCE(sum(
                COALESCE(es.reconciled_net_cents::numeric / 100.0,
                CASE
                    WHEN es.job_type::text = 'ability'::text AND es.pay_type::text = 'regular'::text THEN es.hours_or_units * s.ability_regular_net_rate
                    WHEN es.job_type::text = 'ability'::text AND es.pay_type::text = 'overtime'::text THEN es.hours_or_units * s.ability_ot_net_rate
                    WHEN es.job_type::text = 'ability'::text AND es.pay_type::text = 'split'::text THEN es.regular_hours * s.ability_regular_net_rate + es.overtime_hours * s.ability_ot_net_rate
                    WHEN es.job_type::text = 'prestige'::text AND es.pay_type::text = 'regular'::text THEN es.hours_or_units * s.prestige_regular_net_rate
                    WHEN es.job_type::text = 'prestige'::text AND es.pay_type::text = 'overtime'::text THEN es.hours_or_units * s.prestige_ot_net_rate
                    WHEN es.job_type::text = 'prestige'::text AND es.pay_type::text = 'split'::text THEN es.regular_hours * s.prestige_regular_net_rate + es.overtime_hours * s.prestige_ot_net_rate
                    WHEN es.job_type::text = 'prestige_ilst'::text AND es.pay_type::text = 'regular'::text THEN es.hours_or_units * s.prestige_ilst_net_rate
                    WHEN es.job_type::text = 'prestige_ilst'::text AND es.pay_type::text = 'overtime'::text THEN es.hours_or_units * s.prestige_ilst_ot_net_rate
                    WHEN es.job_type::text = 'prestige_ilst'::text AND es.pay_type::text = 'split'::text THEN es.regular_hours * s.prestige_ilst_net_rate + es.overtime_hours * s.prestige_ilst_ot_net_rate
                    WHEN es.job_type::text = 'incentive'::text THEN es.hours_or_units * (1::numeric - s.ability_withholding_rate)
                    WHEN es.job_type::text = 'other'::text THEN es.hours_or_units
                    WHEN es.job_type::text = 'custom'::text AND es.pay_type::text = 'regular'::text THEN es.hours_or_units * (cj.regular_rate_cents::numeric / 100.0)
                    WHEN es.job_type::text = 'custom'::text AND es.pay_type::text = 'overtime'::text THEN es.hours_or_units * (cj.ot_rate_cents::numeric / 100.0)
                    WHEN es.job_type::text = 'custom'::text AND es.pay_type::text = 'split'::text THEN es.regular_hours * (cj.regular_rate_cents::numeric / 100.0) + es.overtime_hours * (cj.ot_rate_cents::numeric / 100.0)
                    ELSE 0::numeric
                END +
                CASE
                    WHEN es.job_type::text = 'ability'::text AND es.incentive_mode = 'rate'::text THEN es.hours_or_units * es.incentive_rate * (1::numeric - s.ability_withholding_rate)
                    WHEN es.job_type::text = 'ability'::text AND es.incentive_mode = 'lump_sum'::text THEN es.incentive_amount * (1::numeric - s.ability_withholding_rate)
                    ELSE 0::numeric
                END)), 0::numeric)::numeric(12,2) AS earnings_total,
            COALESCE(sum(
                CASE
                    WHEN es.job_type::text = 'ability'::text AND es.pay_type::text = 'regular'::text THEN es.hours_or_units * s.ability_regular_net_rate
                    WHEN es.job_type::text = 'ability'::text AND es.pay_type::text = 'overtime'::text THEN es.hours_or_units * s.ability_ot_net_rate
                    WHEN es.job_type::text = 'ability'::text AND es.pay_type::text = 'split'::text THEN es.regular_hours * s.ability_regular_net_rate + es.overtime_hours * s.ability_ot_net_rate
                    WHEN es.job_type::text = 'incentive'::text THEN es.hours_or_units * (1::numeric - s.ability_withholding_rate)
                    ELSE 0::numeric
                END +
                CASE
                    WHEN es.job_type::text = 'ability'::text AND es.incentive_mode = 'rate'::text THEN es.hours_or_units * es.incentive_rate * (1::numeric - s.ability_withholding_rate)
                    WHEN es.job_type::text = 'ability'::text AND es.incentive_mode = 'lump_sum'::text THEN es.incentive_amount * (1::numeric - s.ability_withholding_rate)
                    ELSE 0::numeric
                END), 0::numeric)::numeric(12,2) AS ability_paycheck_earnings,
            COALESCE(sum(
                CASE
                    WHEN es.job_type::text = 'prestige'::text AND es.pay_type::text = 'regular'::text THEN es.hours_or_units * s.prestige_regular_net_rate
                    WHEN es.job_type::text = 'prestige'::text AND es.pay_type::text = 'overtime'::text THEN es.hours_or_units * s.prestige_ot_net_rate
                    WHEN es.job_type::text = 'prestige'::text AND es.pay_type::text = 'split'::text THEN es.regular_hours * s.prestige_regular_net_rate + es.overtime_hours * s.prestige_ot_net_rate
                    WHEN es.job_type::text = 'prestige_ilst'::text AND es.pay_type::text = 'regular'::text THEN es.hours_or_units * s.prestige_ilst_net_rate
                    WHEN es.job_type::text = 'prestige_ilst'::text AND es.pay_type::text = 'overtime'::text THEN es.hours_or_units * s.prestige_ilst_ot_net_rate
                    WHEN es.job_type::text = 'prestige_ilst'::text AND es.pay_type::text = 'split'::text THEN es.regular_hours * s.prestige_ilst_net_rate + es.overtime_hours * s.prestige_ilst_ot_net_rate
                    ELSE 0::numeric
                END), 0::numeric)::numeric(12,2) AS prestige_paycheck_earnings,
            COALESCE(sum(
                CASE
                    WHEN es.job_type::text = ANY (ARRAY['ability'::text, 'prestige'::text, 'prestige_ilst'::text]) THEN
                    CASE
                        WHEN es.pay_type::text = 'split'::text THEN es.regular_hours + es.overtime_hours
                        ELSE es.hours_or_units
                    END
                    ELSE 0::numeric
                END), 0::numeric)::numeric(10,2) AS wage_hours_total
           FROM earn_slots es
             JOIN settings s ON s.user_id = es.user_id
             LEFT JOIN custom_jobs cj ON cj.id = es.custom_job_id AND cj.user_id = es.user_id
          GROUP BY es.day_id, es.user_id
        ), active_gas AS (
         SELECT ga.source_transaction_id,
            ga.user_id,
            ga.gas_amount_cents
           FROM gas_allocations ga
          WHERE ga.is_active
        ), transaction_totals AS (
         SELECT t_1.day_id,
            t_1.user_id,
            COALESCE(sum(GREATEST(round(t_1.amount * 100::numeric)::integer - COALESCE(ag.gas_amount_cents, 0), 0)::numeric / 100.0) FILTER (WHERE t_1.status = 'applied'::transaction_status), 0::numeric)::numeric(12,2) AS transaction_spend_total,
            COALESCE(sum(GREATEST(round(t_1.amount * 100::numeric)::integer - COALESCE(ag.gas_amount_cents, 0), 0)::numeric / 100.0) FILTER (WHERE t_1.status = 'applied'::transaction_status AND t_1.source = 'manual'::transaction_source), 0::numeric)::numeric(12,2) AS manual_transaction_total,
            COALESCE(sum(GREATEST(round(t_1.amount * 100::numeric)::integer - COALESCE(ag.gas_amount_cents, 0), 0)::numeric / 100.0) FILTER (WHERE t_1.status = 'applied'::transaction_status AND t_1.source = 'plaid'::transaction_source), 0::numeric)::numeric(12,2) AS plaid_transaction_total,
            COALESCE(count(*) FILTER (WHERE t_1.status = 'pending_review'::transaction_status), 0::bigint)::integer AS pending_transaction_count
           FROM transactions t_1
             LEFT JOIN active_gas ag ON ag.source_transaction_id = t_1.id AND ag.user_id = t_1.user_id
          WHERE t_1.day_id IS NOT NULL
          GROUP BY t_1.day_id, t_1.user_id
        )
 SELECT d.id AS day_id,
    d.user_id,
    d.week_id,
    d.date,
    d.day_index,
    (d.base_amount + COALESCE(amt.amort_cents, 0::bigint)::numeric / 100.0)::numeric(10,2) AS base_amount,
    d.manual_spend_adjustment,
    d.spend_locked,
    (COALESCE(e.earnings_total, 0::numeric) + COALESCE(cr.credit_cents, 0::bigint)::numeric / 100.0)::numeric(12,2) AS earnings_total,
    COALESCE(e.ability_paycheck_earnings, 0::numeric)::numeric(12,2) AS ability_paycheck_earnings,
    COALESCE(e.prestige_paycheck_earnings, 0::numeric)::numeric(12,2) AS prestige_paycheck_earnings,
    COALESCE(e.wage_hours_total, 0::numeric)::numeric(10,2) AS wage_hours_total,
    (COALESCE(t.transaction_spend_total, 0::numeric) + COALESCE(gas.gas_spend_cents, 0)::numeric / 100.0)::numeric(12,2) AS transaction_spend_total,
    COALESCE(t.manual_transaction_total, 0::numeric)::numeric(12,2) AS manual_transaction_total,
    COALESCE(t.plaid_transaction_total, 0::numeric)::numeric(12,2) AS plaid_transaction_total,
    COALESCE(t.pending_transaction_count, 0) AS pending_transaction_count,
    (COALESCE(t.transaction_spend_total, 0::numeric) + COALESCE(gas.gas_spend_cents, 0)::numeric / 100.0 + d.manual_spend_adjustment)::numeric(12,2) AS spend_total,
    (COALESCE(e.earnings_total, 0::numeric) + COALESCE(cr.credit_cents, 0::bigint)::numeric / 100.0 - (COALESCE(t.transaction_spend_total, 0::numeric) + COALESCE(gas.gas_spend_cents, 0)::numeric / 100.0 + d.manual_spend_adjustment) - (d.base_amount + COALESCE(amt.amort_cents, 0::bigint)::numeric / 100.0))::numeric(12,2) AS cashflow_total
   FROM days d
     LEFT JOIN earn_totals e ON e.day_id = d.id AND e.user_id = d.user_id
     LEFT JOIN transaction_totals t ON t.day_id = d.id AND t.user_id = d.user_id
     LEFT JOIN v_day_gas_spend_totals gas ON gas.day_id = d.id AND gas.user_id = d.user_id
     LEFT JOIN v_day_amortized_totals amt ON amt.day_id = d.id AND amt.user_id = d.user_id
     LEFT JOIN v_day_amortization_credit cr ON cr.day_id = d.id AND cr.user_id = d.user_id;
