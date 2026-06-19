-- Systemic fix for stale fixed-cost days. apply_baseline_to_future_days only
-- stamps date >= current_date, so a day stamped while it was "future" keeps that
-- rate forever — when a subscription later expires, the now-past day still carries
-- the old (higher) rate (the "Monday $85 phantom"). This companion re-stamps a
-- BOUNDED recent past window to the per-day-correct recurring base, so a recent
-- expiration self-heals within the window instead of lingering.
--
-- Per-day correct base = the recurring cost of expenses ACTIVE on that day:
--   is_active AND not-yet-expired-as-of-that-day AND already-created-by-that-day.
-- The created_at guard prevents back-dating a recently-added expense onto older
-- days. Deliberately bounded (14 days): only the recent window is reliably
-- reconstructable; deeper history is left frozen (and may hold intentional manual
-- values that a reconstruction must not overwrite).

create or replace function public.restamp_recent_baseline(
  p_user_id uuid,
  p_days_back integer default 14
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_user_id is null then
    return 0;
  end if;

  update public.days d
  set base_amount = sub.correct_base
  from (
    select
      dd.id,
      round(
        round(
          coalesce(sum(round(e.amount * 100)) filter (
            where e.is_active
              and (e.expiration_date is null or e.expiration_date >= dd.date)
              and e.created_at::date <= dd.date
          ), 0) / public.weeks_per_month()
        ) / 7
      ) / 100.0 as correct_base
    from public.days dd
    left join public.expenses e on e.user_id = dd.user_id
    where dd.user_id = p_user_id
      and dd.date >= current_date - p_days_back
      and dd.date < current_date
    group by dd.id
  ) sub
  where d.id = sub.id
    and d.user_id = p_user_id
    and d.base_amount is distinct from sub.correct_base;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.restamp_recent_baseline(uuid, integer) to authenticated;
