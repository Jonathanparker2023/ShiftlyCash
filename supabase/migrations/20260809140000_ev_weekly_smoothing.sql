-- EV charging: smooth WITHIN each week, not across all of history.
--
-- The old view spread every charge ever made evenly from the first charge
-- through today. Three consequences, all wrong for what this number is for:
--
--   1. It never reset. Sunday of a fresh week with no charging still read
--      $23.92, because the day was collecting a slice of the previous fortnight.
--   2. The window ended at "today", so it grew by one every night and quietly
--      changed the EV figure on every past day. Yesterday's slice was $26.09,
--      tomorrow's would have been $22.08 — for charges that never changed.
--   3. A week could never be compared to another week, which is the entire
--      point: Jon is trying to see whether charging at the houses instead of
--      Superchargers is working, week over week.
--
-- Now each week is self-contained: the charges made in a week are spread evenly
-- across that week's days. The week total always equals what was actually
-- spent charging that week, a week with no charging reads zero, and closed
-- weeks stop moving.
--
-- The cumulative-floor spread (floor(T*i/n) - floor(T*(i-1)/n)) telescopes to
-- the exact weekly total in integer cents, so no pennies are created or lost.
--
-- v_day_totals subtracts each charge from its own transaction's day and adds
-- this spread back. Because both now happen inside the same week, the netting
-- is exact per week — which the old cross-week spread could not guarantee.
create or replace view public.v_day_ev_charge_spend_totals
with (security_invoker = true)
as
with charge_weeks as (
  -- Attribute each charge to the week containing the day it happened.
  select
    d.user_id,
    d.week_id,
    sum(eca.charge_amount_cents)::numeric as week_cents
  from public.ev_charge_allocations eca
  join public.days d
    on d.user_id = eca.user_id
   and d.date = eca.charge_date
  where eca.is_active
  group by d.user_id, d.week_id
),
day_slots as (
  select
    d.id,
    d.user_id,
    d.week_id,
    row_number() over (partition by d.week_id order by d.day_index, d.date) as i,
    count(*) over (partition by d.week_id) as n
  from public.days d
)
select
  ds.id as day_id,
  ds.user_id,
  (
    floor(cw.week_cents * ds.i::numeric / ds.n::numeric)
    - floor(cw.week_cents * (ds.i - 1)::numeric / ds.n::numeric)
  )::integer as ev_charge_spend_cents
from day_slots ds
join charge_weeks cw
  on cw.week_id = ds.week_id
 and cw.user_id = ds.user_id;

grant select on public.v_day_ev_charge_spend_totals to authenticated;
