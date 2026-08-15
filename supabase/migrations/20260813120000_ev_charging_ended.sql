-- Stop EV charging on the date the Onyx was totalled (crash 2026-08-12, last charge 2026-08-11).
--
-- Mirrors the existing gas_ended_on switch: when Jon moved off gasoline on
-- 2026-07-30 the gas spread was capped at that date rather than deleted, so
-- history stayed intact and only forward days stopped accruing. The Tesla was
-- destroyed 2026-08-12 and last charged 2026-08-11, so EV charging gets the same treatment.
--
-- Why it matters: the active-week view spreads the week's charges across an
-- elapsed-days window bounded by TODAY. Left alone, that window keeps growing
-- past 08-12 and re-spreads Sunday-to-Tuesday charging onto days when there was
-- no car to charge.
--
-- History is preserved. Allocations on or before the end date still spread
-- exactly as before and closed weeks are untouched. Clearing ev_ended_on back
-- to null restores the previous behaviour.

alter table public.transport_energy_settings
  add column if not exists ev_ended_on date;

update public.transport_energy_settings
set ev_ended_on = date '2026-08-11',
    updated_at = now()
where ev_ended_on is distinct from date '2026-08-11';

create or replace view public.v_day_ev_charge_spend_totals
with (security_invoker = true)
as
with bounds as (
  select
    p.id as user_id,
    least(
      (now() at time zone 'America/New_York')::date,
      coalesce(tes.ev_ended_on, 'infinity'::date)
    ) as cutoff_date
  from public.profiles p
  left join public.transport_energy_settings tes
    on tes.user_id = p.id
), weekly_charges as (
  select
    eca.user_id,
    d.week_id,
    w.start_date,
    least(w.end_date, b.cutoff_date) as final_date,
    sum(eca.charge_amount_cents)::numeric as week_cents
  from public.ev_charge_allocations eca
  join public.days d
    on d.user_id = eca.user_id
   and d.date = eca.charge_date
  join public.weeks w
    on w.id = d.week_id
   and w.user_id = d.user_id
  join bounds b
    on b.user_id = eca.user_id
  where eca.is_active
    and w.start_date <= b.cutoff_date
    and eca.charge_date <= b.cutoff_date
  group by eca.user_id, d.week_id, w.start_date, w.end_date, b.cutoff_date
), ranged as (
  select
    user_id,
    week_id,
    start_date,
    final_date,
    week_cents,
    greatest(1, (final_date - start_date) + 1) as elapsed_days
  from weekly_charges
  where final_date >= start_date
)
select
  d.id as day_id,
  d.user_id,
  (
    floor(
      r.week_cents * ((d.date - r.start_date) + 1)::numeric
      / r.elapsed_days::numeric
    )
    - floor(
      r.week_cents * (d.date - r.start_date)::numeric
      / r.elapsed_days::numeric
    )
  )::integer as ev_charge_spend_cents
from public.days d
join ranged r
  on r.week_id = d.week_id
 and r.user_id = d.user_id
where d.date between r.start_date and r.final_date;

grant select on public.v_day_ev_charge_spend_totals to authenticated;
