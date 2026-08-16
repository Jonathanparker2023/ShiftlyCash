-- Teach the paycheck audit to fix the CAUSE, not just the symptom.
--
-- Today reconcile_paycheck takes the real check and overrides each shift's
-- reconciled_net_cents. That corrects one period's dollars and nothing else --
-- the job's withholding_rate is never touched by anything in the system, so an
-- estimated rate (HomeWell ships at a placeholder 14%) stays an estimate
-- forever and every future projection stays wrong. The factor needed to fix it
-- (actual / projected) is already computed and explicitly stored "display only".
--
-- WHY HOURS MUST MATCH FIRST. actual / projected absorbs EVERY discrepancy, not
-- just withholding: a shift never logged, wrong hours on one day, a bonus, a
-- garnishment, retro pay. Overriding net dollars with a polluted factor is
-- survivable -- it is one period. Writing that same factor into a tax RATE is
-- not: the error stops being a blip and becomes permanently wrong arithmetic on
-- every future shift for that job, in a form nobody will spot later.
--
-- So the gate is hard: hours from the paystub must equal hours logged, or the
-- rate is not touched at all.
--
-- SCOPE: custom jobs only. Prestige stores take-home directly as net rates in
-- settings rather than gross + a withholding rate, so there is no rate to
-- recalibrate there; asking is an error rather than a silent no-op.

-- The logged side of the comparison: hours and GROSS for one job across one pay
-- period. Deliberately mirrors paycheck_period_base_slots' anchor/period/job
-- selection so the two can never disagree about which shifts are in scope.
create or replace function public.paycheck_period_hours_gross(
  p_week_id uuid,
  p_job_key text
)
returns table (
  regular_hours numeric,
  overtime_hours numeric,
  total_hours numeric,
  gross_cents bigint,
  slot_count integer
)
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
  ),
  split_slots as (
    select
      es.id,
      case
        when es.pay_type::text = 'regular'  then coalesce(es.hours_or_units, 0)
        when es.pay_type::text = 'split'    then coalesce(es.regular_hours, 0)
        else 0
      end as reg_hours,
      case
        when es.pay_type::text = 'overtime' then coalesce(es.hours_or_units, 0)
        when es.pay_type::text = 'split'    then coalesce(es.overtime_hours, 0)
        else 0
      end as ot_hours,
      cj.regular_gross_rate_cents,
      cj.ot_gross_rate_cents
    from public.earn_slots es
    join public.days d on d.id = es.day_id and d.user_id = es.user_id
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
  )
  select
    coalesce(sum(reg_hours), 0)::numeric as regular_hours,
    coalesce(sum(ot_hours), 0)::numeric as overtime_hours,
    coalesce(sum(reg_hours + ot_hours), 0)::numeric as total_hours,
    coalesce(round(sum(
      reg_hours * coalesce(regular_gross_rate_cents, 0)
      + ot_hours * coalesce(ot_gross_rate_cents, 0)
    )), 0)::bigint as gross_cents,
    count(*)::integer as slot_count
  from split_slots;
$$;

grant execute on function public.paycheck_period_hours_gross(uuid, text) to authenticated;

-- A tax rate changing is not a thing that should happen silently. Every
-- recalibration -- and every one that was REFUSED because the hours disagreed --
-- leaves a row here, so a wrong rate can always be traced to the check that
-- caused it and rolled back to the previous value.
create table if not exists public.withholding_recalibrations (
  id                    uuid primary key default extensions.gen_random_uuid(),
  user_id               uuid not null references public.profiles(id) on delete cascade,
  week_id               uuid not null,
  job_key               text not null,
  custom_job_id         uuid,
  outcome               text not null
                          check (outcome in ('applied', 'hours_mismatch', 'rate_out_of_range')),
  logged_hours          numeric(10, 2) not null,
  actual_hours          numeric(10, 2) not null,
  gross_cents           bigint not null,
  actual_net_cents      bigint not null,
  rate_before           numeric(6, 4),
  rate_after            numeric(6, 4),
  created_at            timestamptz not null default now()
);

alter table public.withholding_recalibrations enable row level security;

drop policy if exists withholding_recalibrations_owner on public.withholding_recalibrations;
create policy withholding_recalibrations_owner
  on public.withholding_recalibrations
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert on public.withholding_recalibrations to authenticated;

create index if not exists withholding_recalibrations_user_job_idx
  on public.withholding_recalibrations (user_id, job_key, created_at desc);

-- The gate itself.
--
-- Returns a row in every case rather than raising on a mismatch: "your hours
-- disagree" is a normal answer the UI has to render, not an exception. It only
-- raises when the request itself is invalid (unknown job, prestige, no gross).
create or replace function public.recalibrate_job_withholding(
  p_week_id uuid,
  p_job_key text,
  p_actual_cents bigint,
  p_actual_hours numeric
)
returns table (
  outcome text,
  logged_hours numeric,
  actual_hours numeric,
  hours_delta numeric,
  gross_cents bigint,
  rate_before numeric,
  rate_after numeric
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_custom_job_id uuid;
  v_logged record;
  v_rate_before numeric(6, 4);
  v_rate_after numeric(6, 4);
  v_outcome text;
  v_gross_reg bigint;
  v_gross_ot bigint;
  -- Hours are entered to two decimals; anything under half a cent of an hour is
  -- float noise, not a real disagreement.
  v_tolerance constant numeric := 0.005;
begin
  if v_user_id is null then
    raise exception 'Authentication required to recalibrate withholding.';
  end if;

  if p_job_key = 'prestige' then
    raise exception 'Prestige stores net rates directly and has no withholding rate to recalibrate.';
  end if;

  if p_job_key not like 'custom:%' then
    raise exception 'Unknown paycheck job %.', p_job_key;
  end if;

  v_custom_job_id := nullif(substring(p_job_key from 8), '')::uuid;

  if p_actual_hours is null or p_actual_hours < 0 then
    raise exception 'Actual hours must be zero or greater.';
  end if;

  if p_actual_cents is null or p_actual_cents < 0 then
    raise exception 'Actual amount must be zero or greater.';
  end if;

  select * into v_logged
  from public.paycheck_period_hours_gross(p_week_id, p_job_key);

  if v_logged.slot_count = 0 then
    raise exception 'No shifts logged for this job in this pay period.';
  end if;

  select cj.withholding_rate, cj.regular_gross_rate_cents, cj.ot_gross_rate_cents
    into v_rate_before, v_gross_reg, v_gross_ot
  from public.custom_jobs cj
  where cj.id = v_custom_job_id
    and cj.user_id = v_user_id;

  if v_rate_before is null then
    raise exception 'Custom job not found.';
  end if;

  -- THE GATE. Hours disagree -> record the refusal and change nothing.
  if abs(v_logged.total_hours - p_actual_hours) > v_tolerance then
    insert into public.withholding_recalibrations (
      user_id, week_id, job_key, custom_job_id, outcome,
      logged_hours, actual_hours, gross_cents, actual_net_cents,
      rate_before, rate_after
    ) values (
      v_user_id, p_week_id, p_job_key, v_custom_job_id, 'hours_mismatch',
      v_logged.total_hours, p_actual_hours, v_logged.gross_cents, p_actual_cents,
      v_rate_before, null
    );

    return query select
      'hours_mismatch'::text,
      v_logged.total_hours,
      p_actual_hours,
      round(p_actual_hours - v_logged.total_hours, 2),
      v_logged.gross_cents,
      v_rate_before::numeric,
      null::numeric;
    return;
  end if;

  if v_logged.gross_cents <= 0 then
    raise exception 'Gross pay for this period is zero; cannot derive a withholding rate.';
  end if;

  v_rate_after := round(1 - (p_actual_cents::numeric / v_logged.gross_cents::numeric), 4);

  -- A rate outside this band is not a withholding rate -- it is a bonus, a
  -- garnishment, or a data error wearing one. Refuse rather than persist it.
  if v_rate_after < 0 or v_rate_after > 0.6 then
    insert into public.withholding_recalibrations (
      user_id, week_id, job_key, custom_job_id, outcome,
      logged_hours, actual_hours, gross_cents, actual_net_cents,
      rate_before, rate_after
    ) values (
      v_user_id, p_week_id, p_job_key, v_custom_job_id, 'rate_out_of_range',
      v_logged.total_hours, p_actual_hours, v_logged.gross_cents, p_actual_cents,
      v_rate_before, v_rate_after
    );

    return query select
      'rate_out_of_range'::text,
      v_logged.total_hours,
      p_actual_hours,
      0::numeric,
      v_logged.gross_cents,
      v_rate_before::numeric,
      v_rate_after::numeric;
    return;
  end if;

  -- withholding_rate and the two derived NET rates must move together or the
  -- job's own numbers contradict each other.
  update public.custom_jobs
  set withholding_rate = v_rate_after,
      regular_rate_cents = round(regular_gross_rate_cents * (1 - v_rate_after)),
      ot_rate_cents = round(ot_gross_rate_cents * (1 - v_rate_after)),
      updated_at = now()
  where id = v_custom_job_id
    and user_id = v_user_id;

  insert into public.withholding_recalibrations (
    user_id, week_id, job_key, custom_job_id, outcome,
    logged_hours, actual_hours, gross_cents, actual_net_cents,
    rate_before, rate_after
  ) values (
    v_user_id, p_week_id, p_job_key, v_custom_job_id, 'applied',
    v_logged.total_hours, p_actual_hours, v_logged.gross_cents, p_actual_cents,
    v_rate_before, v_rate_after
  );

  return query select
    'applied'::text,
    v_logged.total_hours,
    p_actual_hours,
    0::numeric,
    v_logged.gross_cents,
    v_rate_before::numeric,
    v_rate_after::numeric;
end;
$$;

grant execute on function public.recalibrate_job_withholding(uuid, text, bigint, numeric) to authenticated;
