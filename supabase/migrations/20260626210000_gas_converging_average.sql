-- Gas: per-fill-window spread  ->  converging whole-history daily average.
--
-- The prior v_day_gas_spend_totals spread each fill's gas over its own
-- [previous_fill_date+1 .. fill_date] window and mirrored the rate forward to
-- the next fill (today-clamped). Jon's intent is a single GLOBAL converging
-- average: total active gas / inclusive calendar days from the FIRST fill
-- through today, re-leveled across the whole history on every mutation, so all
-- days settle to the true daily gas cost.
--
-- Ledger semantics unchanged (WORLD A): the per-day slice still feeds
-- v_day_totals.transaction_spend_total -> spend_total -> cashflow_total, and the
-- source transaction's gas amount is still carved out of its own day's raw spend
-- (GREATEST(amount - gas_amount_cents, 0) in v_day_totals), so the gas total is
-- redistributed evenly with zero net change to any period total.
--
-- Slices use a cumulative-floor (Bresenham) split over [first_date .. today] so
-- they sum EXACTLY to the gas total (no rounding drift). Order-independent: a
-- pure function of the set of active (gas_amount_cents, fill_date) rows + today.
-- The legacy per-fill columns (previous_fill_date, generated start_date,
-- remainder_amount_cents) no longer feed the math (left in place, dead).
create or replace view public.v_day_gas_spend_totals as
with agg as (
  select ga.user_id,
         sum(ga.gas_amount_cents)::numeric as numerator,
         min(ga.fill_date) as first_date,
         (now() at time zone 'America/New_York')::date as today
  from gas_allocations ga
  where ga.is_active
  group by ga.user_id
), ranged as (
  select user_id, numerator, first_date, today,
         greatest(1, (today - first_date) + 1) as total_days
  from agg
)
select d.id as day_id,
       d.user_id,
       (floor(r.numerator * ((d.date - r.first_date) + 1)::numeric / r.total_days::numeric)
        - floor(r.numerator * (d.date - r.first_date)::numeric / r.total_days::numeric))::integer as gas_spend_cents
from days d
join ranged r on r.user_id = d.user_id
where d.date >= r.first_date and d.date <= r.today;
