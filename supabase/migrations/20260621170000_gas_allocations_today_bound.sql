-- Gas mirroring should not pre-fill future days. Future spending projection
-- already handles the rest of the week; gas adds one daily slice only as each
-- day becomes current/past.

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
   and d.date <= (now() at time zone 'America/New_York')::date
   and (o.next_start_date is null or d.date < o.next_start_date)
  group by d.id, d.user_id
)
select
  day_id,
  user_id,
  gas_spend_cents
from expanded;

grant select on public.v_day_gas_spend_totals to authenticated;
