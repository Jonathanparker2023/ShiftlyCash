-- Refresh existing active-week projected spend rows so the newly averaged
-- projection takes effect immediately instead of waiting for a future cleanup.

with user_projection as (
  select
    user_id,
    round(avg(spend_for_projection) / 7.0, 2) as per_day
  from public.v_projection_weeks
  where spend_for_projection is not null
    and spend_for_projection > 0
  group by user_id
)
update public.days d
set
  manual_spend_adjustment = up.per_day,
  is_projected_spend = true
from public.weeks w
join user_projection up on up.user_id = w.user_id
where d.week_id = w.id
  and d.user_id = w.user_id
  and w.status = 'active'
  and d.date > (now() at time zone 'America/New_York')::date
  and d.is_projected_spend
  and up.per_day > 0;
