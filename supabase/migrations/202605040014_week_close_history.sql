create or replace function public.week_snapshot_json(
  p_user_id uuid,
  p_week_id uuid
)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'week', to_jsonb(w),
    'days', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'day', to_jsonb(d),
            'earn_slots', coalesce(
              (
                select jsonb_agg(to_jsonb(es) order by es.slot_index)
                from public.earn_slots es
                where es.user_id = p_user_id
                  and es.day_id = d.id
              ),
              '[]'::jsonb
            ),
            'transactions', coalesce(
              (
                select jsonb_agg(to_jsonb(t) order by t.date, t.created_at, t.id)
                from public.transactions t
                where t.user_id = p_user_id
                  and t.day_id = d.id
              ),
              '[]'::jsonb
            )
          )
          order by d.day_index
        )
        from public.days d
        where d.user_id = p_user_id
          and d.week_id = p_week_id
      ),
      '[]'::jsonb
    ),
    'unassigned_transactions', coalesce(
      (
        select jsonb_agg(to_jsonb(t) order by t.date, t.created_at, t.id)
        from public.transactions t
        where t.user_id = p_user_id
          and t.day_id is null
          and t.date between w.start_date and w.end_date
      ),
      '[]'::jsonb
    ),
    'projection_exclusions',
      (
        select to_jsonb(wpe)
        from public.week_projection_exclusions wpe
        where wpe.user_id = p_user_id
          and wpe.week_id = p_week_id
      )
  )
  from public.weeks w
  where w.user_id = p_user_id
    and w.id = p_week_id;
$$;

grant execute on function public.week_snapshot_json(uuid, uuid) to authenticated;

create or replace function public.close_week_and_start_next(p_week_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_closing_week public.weeks%rowtype;
  v_next_start date;
  v_new_week_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required to close a week.';
  end if;

  select *
    into v_closing_week
  from public.weeks w
  where w.id = p_week_id
    and w.user_id = v_user_id
  for update;

  if v_closing_week.id is null then
    raise exception 'Week not found.';
  end if;

  if v_closing_week.status <> 'active' then
    raise exception 'Only the active week can be closed.';
  end if;

  insert into public.state_snapshots (
    user_id,
    snapshot_type,
    week_id,
    payload
  )
  values (
    v_user_id,
    'pre_week_close',
    v_closing_week.id,
    public.week_snapshot_json(v_user_id, v_closing_week.id)
  );

  insert into public.sticky_labels (
    user_id,
    day_index,
    slot_index,
    label
  )
  select
    v_user_id,
    d.day_index,
    es.slot_index,
    btrim(es.label)
  from public.days d
  join public.earn_slots es
    on es.user_id = v_user_id
    and es.day_id = d.id
  where d.user_id = v_user_id
    and d.week_id = v_closing_week.id
    and nullif(btrim(coalesce(es.label, '')), '') is not null
  on conflict (user_id, day_index, slot_index) do update
    set
      label = excluded.label,
      updated_at = now();

  update public.weeks
  set
    status = 'closed',
    closed_at = now()
  where id = v_closing_week.id
    and user_id = v_user_id;

  v_next_start := v_closing_week.end_date + 1;
  v_new_week_id := public.ensure_current_active_week(v_next_start);

  insert into public.state_snapshots (
    user_id,
    snapshot_type,
    week_id,
    payload
  )
  values (
    v_user_id,
    'post_week_close',
    v_closing_week.id,
    jsonb_build_object(
      'closed_week', public.week_snapshot_json(v_user_id, v_closing_week.id),
      'active_week', public.week_snapshot_json(v_user_id, v_new_week_id)
    )
  );

  return v_new_week_id;
end;
$$;

grant execute on function public.close_week_and_start_next(uuid) to authenticated;

create or replace function public.reopen_week(p_week_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_target_week public.weeks%rowtype;
  v_active_week public.weeks%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required to reopen a week.';
  end if;

  select *
    into v_target_week
  from public.weeks w
  where w.id = p_week_id
    and w.user_id = v_user_id
  for update;

  if v_target_week.id is null then
    raise exception 'Week not found.';
  end if;

  if v_target_week.status <> 'closed' then
    raise exception 'Only a closed or archived week can be reopened.';
  end if;

  select *
    into v_active_week
  from public.weeks w
  where w.user_id = v_user_id
    and w.status = 'active'
  order by w.start_date desc
  limit 1
  for update;

  if v_active_week.id is not null then
    insert into public.state_snapshots (
      user_id,
      snapshot_type,
      week_id,
      payload
    )
    values (
      v_user_id,
      'week_reopen',
      v_active_week.id,
      jsonb_build_object(
        'discarded_active_week', public.week_snapshot_json(v_user_id, v_active_week.id),
        'reopened_week', public.week_snapshot_json(v_user_id, v_target_week.id)
      )
    );

    delete from public.weeks
    where id = v_active_week.id
      and user_id = v_user_id;
  end if;

  update public.weeks
  set
    status = 'active',
    closed_at = null,
    archived_at = null
  where id = v_target_week.id
    and user_id = v_user_id;

  return v_target_week.id;
end;
$$;

grant execute on function public.reopen_week(uuid) to authenticated;
