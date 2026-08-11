-- Keep EV charging inside its own week without projecting it into future days.
--
-- Active week: total charges so far / elapsed days from week start through today.
-- Closed week: total charges / all days in the completed week.
--
-- The cumulative-floor slices preserve the exact weekly cents while the
-- final_date bound guarantees tomorrow and later receive no EV allocation.
create or replace view public.v_day_ev_charge_spend_totals
with (security_invoker = true)
as
with weekly_charges as (
  select
    eca.user_id,
    d.week_id,
    w.start_date,
    least(
      w.end_date,
      (now() at time zone 'America/New_York')::date
    ) as final_date,
    sum(eca.charge_amount_cents)::numeric as week_cents
  from public.ev_charge_allocations eca
  join public.days d
    on d.user_id = eca.user_id
   and d.date = eca.charge_date
  join public.weeks w
    on w.id = d.week_id
   and w.user_id = d.user_id
  where eca.is_active
    and w.start_date <= (now() at time zone 'America/New_York')::date
    and eca.charge_date <= (now() at time zone 'America/New_York')::date
  group by eca.user_id, d.week_id, w.start_date, w.end_date
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
