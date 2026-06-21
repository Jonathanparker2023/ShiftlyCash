-- Refresh active-week projected spend rows that were stamped by the temporary
-- all-closed-week average projection.

with recent as (
  select
    user_id,
    spend_for_projection,
    row_number() over (
      partition by user_id
      order by start_date desc
    ) as rn
  from public.v_projection_weeks
  where spend_for_projection is not null
),
user_projection as (
  select
    user_id,
    round(
      (
        percentile_cont(0.5) within group (order by spend_for_projection) / 7.0
      )::numeric,
      2
    ) as per_day
  from recent
  where rn <= 6
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
