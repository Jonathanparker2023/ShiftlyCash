-- Give expenses a real start date.
--
-- Until now an expense could only be ENDED (expiration_date), never scheduled to
-- BEGIN. A cost that changes on a known future date -- an insurance renewal, a
-- loan payment that steps up, any dated rate change -- had only two bad options:
-- type the new figure early and overstate spend until it lands, or remember to
-- type it on the day. The second is the one that gets missed.
--
-- "This expense changes on a known future date" is a recurring pattern, not a
-- one-off, so it gets a column rather than a reminder.
--
-- starts_on is nullable and null means "already started", so every existing row
-- keeps its exact current behaviour and no backfill is needed. It is the mirror
-- of expiration_date: starts_on is the first date an expense counts, and
-- expiration_date is the last.

alter table public.expenses
  add column if not exists starts_on date;

comment on column public.expenses.starts_on is
  'First date this expense counts toward the baseline. Null means it has always been in effect. Mirror of expiration_date, which is the last date it counts.';

-- 1. The live calculator: only sum expenses in effect TODAY.
create or replace view public.v_active_expense_totals
with (security_invoker = true)
as
with counted as (
  select
    e.user_id,
    e.amount,
    (
      e.is_active
      and (e.starts_on is null or e.starts_on <= current_date)
      and (e.expiration_date is null or e.expiration_date >= current_date)
    ) as in_effect
  from public.expenses e
)
select
  c.user_id,
  coalesce(sum(c.amount) filter (where c.in_effect), 0)::numeric(12, 2) as monthly_total,
  (
    coalesce(sum(c.amount) filter (where c.in_effect), 0)
    / public.weeks_per_month()
  )::numeric(12, 2) as weekly_average,
  (
    coalesce(sum(c.amount) filter (where c.in_effect), 0)
    / public.weeks_per_month() / 7
  )::numeric(12, 2) as projected_daily_base
from counted c
group by c.user_id;

-- 2. The recent-past restamp: per-day correctness now also respects starts_on,
--    so a dated expense does not get back-applied to days before it began.
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
              and (e.starts_on is null or e.starts_on <= dd.date)
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

-- 3. Make a dated change actually land without anyone touching the app.
--
-- ensure_current_active_week runs on every dashboard load but previously only
-- stamped the baseline when it CREATED a week, so a starts_on date arriving
-- mid-week would have sat inert until the next Sunday. It now re-applies the
-- baseline to today-and-forward whenever the calculator has drifted from what
-- today is stamped with. The drift check keeps this a no-op on ordinary loads;
-- it only writes on the day a cost actually changes.
create or replace function public.ensure_current_active_week(p_start_date date)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_week_id uuid;
  v_week_start date;
  v_daily_base numeric(10, 2);
  v_created_week boolean := false;
  v_today_base numeric(10, 2);
begin
  if v_user_id is null then
    raise exception 'Authentication required to ensure an active week.';
  end if;

  if extract(dow from p_start_date) <> 0 then
    raise exception 'Active week start_date must be a Sunday. Got %.', p_start_date;
  end if;

  insert into public.settings (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select coalesce(projected_daily_base, 0)
    into v_daily_base
  from public.v_active_expense_totals
  where user_id = v_user_id;

  v_daily_base := coalesce(v_daily_base, 0);

  select w.id, w.start_date
    into v_week_id, v_week_start
  from public.weeks w
  where w.user_id = v_user_id
    and w.status = 'active'
  order by w.start_date desc
  limit 1;

  if v_week_id is null then
    begin
      insert into public.weeks (user_id, start_date, end_date, status)
      values (v_user_id, p_start_date, p_start_date + 6, 'active')
      returning id, start_date into v_week_id, v_week_start;
      v_created_week := true;
    exception
      when unique_violation then
        select w.id, w.start_date
          into v_week_id, v_week_start
        from public.weeks w
        where w.user_id = v_user_id
          and w.status = 'active'
        order by w.start_date desc
        limit 1;

        if v_week_id is null then
          raise;
        end if;
    end;
  end if;

  insert into public.days (
    user_id,
    week_id,
    date,
    day_index,
    base_amount,
    manual_spend_adjustment,
    spend_locked
  )
  select
    v_user_id,
    v_week_id,
    v_week_start + gs.day_index,
    gs.day_index,
    v_daily_base,
    0,
    false
  from generate_series(0, 6) as gs(day_index)
  on conflict (week_id, day_index) do nothing;

  -- Apply template ONLY when a fresh week was just created.
  -- Removing this guard caused user edits to be reverted on every page load.
  if v_created_week then
    perform public.apply_default_template_to_week(v_week_id);
  else
    select d.base_amount
      into v_today_base
    from public.days d
    where d.user_id = v_user_id
      and d.date = current_date;

    if v_today_base is not null and v_today_base is distinct from v_daily_base then
      perform public.apply_baseline_to_future_days(v_user_id);
    end if;
  end if;

  return v_week_id;
end;
$$;

grant execute on function public.ensure_current_active_week(date) to authenticated;
