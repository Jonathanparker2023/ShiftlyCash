-- EV charging is a weekly operating cost. Each Bashflow week owns its charge
-- total, so a new week starts at zero instead of inheriting prior charging.
-- Active weeks spread only through today; closed weeks reconcile across all
-- seven days. The cumulative-floor allocation keeps every weekly cent exact.

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
    sum(eca.charge_amount_cents)::numeric as numerator
  from public.ev_charge_allocations eca
  join public.transactions t
    on t.id = eca.source_transaction_id
   and t.user_id = eca.user_id
  join public.days d
    on d.id = t.day_id
   and d.user_id = t.user_id
  join public.weeks w
    on w.id = d.week_id
   and w.user_id = d.user_id
  where eca.is_active
    and t.status = 'applied'
    and w.start_date <= (now() at time zone 'America/New_York')::date
  group by eca.user_id, d.week_id, w.start_date, w.end_date
), ranged as (
  select
    user_id,
    week_id,
    start_date,
    final_date,
    numerator,
    greatest(1, (final_date - start_date) + 1) as total_days
  from weekly_charges
  where final_date >= start_date
)
select
  d.id as day_id,
  d.user_id,
  (
    floor(
      r.numerator * ((d.date - r.start_date) + 1)::numeric
      / r.total_days::numeric
    )
    - floor(
      r.numerator * (d.date - r.start_date)::numeric
      / r.total_days::numeric
    )
  )::integer as ev_charge_spend_cents
from public.days d
join ranged r
  on r.week_id = d.week_id
 and r.user_id = d.user_id
where d.date between r.start_date and r.final_date;

grant select on public.v_day_ev_charge_spend_totals to authenticated;
