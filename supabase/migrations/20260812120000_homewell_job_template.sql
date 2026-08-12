-- Add Jonathan's confirmed HomeWell schedule to the existing custom-job model.
-- Scope is deliberately narrow: the custom job, default template, and active
-- open week only. Closed/history weeks are never selected or updated.
--
-- HomeWell withholding is a 14% ESTIMATE until the first real paystub arrives.
-- Correct regular_rate_cents, ot_rate_cents, and withholding_rate together once
-- an observed HomeWell withholding rate is available.

do $$
declare
  v_user_id uuid;
  v_template_id uuid;
  v_active_week_id uuid;
  v_tuesday_day_id uuid;
  v_wednesday_day_id uuid;
  v_homewell_id constant uuid := 'cade7852-57f9-400c-a42c-aefc977d2acf';
  v_tuesday_template_slot_id constant uuid := '97b72004-2c8c-430e-b7fb-8bdb13678808';
  v_wednesday_template_slot_id constant uuid := 'b01ae97d-5d70-4a47-9270-10befc75f8d9';
  v_tuesday_earn_slot_id constant uuid := '39643d4d-4137-40b4-a809-2e016f3a9cda';
  v_wednesday_earn_slot_id constant uuid := 'fe1de9d0-ecf0-484f-b94b-719429468ec7';
  v_homewell_color text;
  v_tuesday_slot_index integer;
  v_wednesday_slot_index integer;
  v_existing_earn_slot_id uuid;
  v_before_week_net numeric(12, 2);
  v_after_week_net numeric(12, 2);
  v_before_jobs jsonb;
  v_after_existing_jobs jsonb;
begin
  select u.id
    into strict v_user_id
  from auth.users u
  where lower(u.email) = 'jay1park1@gmail.com';

  if exists (
    select 1
    from public.custom_jobs cj
    where cj.user_id = v_user_id
      and lower(btrim(cj.name)) = 'homewell'
  ) then
    raise exception 'HomeWell already exists; refusing to create a duplicate.';
  end if;

  select candidate.color
    into v_homewell_color
  from unnest(array['#7c3aed', '#db2777', '#0891b2', '#ea580c']::text[])
    with ordinality as candidate(color, preference)
  where not exists (
    select 1
    from public.custom_jobs cj
    where cj.user_id = v_user_id
      and lower(cj.color) = candidate.color
  )
  order by candidate.preference
  limit 1;

  if v_homewell_color is null then
    raise exception 'No unused HomeWell color remains in the approved palette.';
  end if;

  select wt.id
    into strict v_template_id
  from public.weekly_templates wt
  where wt.user_id = v_user_id
    and wt.is_default;

  select w.id
    into strict v_active_week_id
  from public.weeks w
  where w.user_id = v_user_id
    and w.status = 'active';

  select d.id
    into strict v_tuesday_day_id
  from public.days d
  where d.user_id = v_user_id
    and d.week_id = v_active_week_id
    and d.day_index = 2;

  select d.id
    into strict v_wednesday_day_id
  from public.days d
  where d.user_id = v_user_id
    and d.week_id = v_active_week_id
    and d.day_index = 3;

  select candidate.slot_index
    into v_tuesday_slot_index
  from generate_series(0, 3) as candidate(slot_index)
  where not exists (
    select 1
    from public.template_slots ts
    where ts.template_id = v_template_id
      and ts.day_index = 2
      and ts.slot_index = candidate.slot_index
  )
    and not exists (
      select 1
      from public.earn_slots es
      where es.user_id = v_user_id
        and es.day_id = v_tuesday_day_id
        and es.slot_index = candidate.slot_index
        and (es.job_type <> 'none' or es.hours_or_units <> 0)
    )
  order by candidate.slot_index
  limit 1;

  select candidate.slot_index
    into v_wednesday_slot_index
  from generate_series(0, 3) as candidate(slot_index)
  where not exists (
    select 1
    from public.template_slots ts
    where ts.template_id = v_template_id
      and ts.day_index = 3
      and ts.slot_index = candidate.slot_index
  )
    and not exists (
      select 1
      from public.earn_slots es
      where es.user_id = v_user_id
        and es.day_id = v_wednesday_day_id
        and es.slot_index = candidate.slot_index
        and (es.job_type <> 'none' or es.hours_or_units <> 0)
    )
  order by candidate.slot_index
  limit 1;

  if v_tuesday_slot_index is null or v_wednesday_slot_index is null then
    raise exception 'Tuesday or Wednesday has no free default-template slot.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(cj) order by cj.id), '[]'::jsonb)
    into v_before_jobs
  from public.custom_jobs cj
  where cj.user_id = v_user_id;

  select wt.earnings_total
    into strict v_before_week_net
  from public.v_week_totals wt
  where wt.user_id = v_user_id
    and wt.week_id = v_active_week_id;

  insert into public.custom_jobs (
    id,
    user_id,
    name,
    color,
    regular_rate_cents,
    ot_rate_cents,
    regular_gross_rate_cents,
    ot_gross_rate_cents,
    withholding_rate,
    active
  ) values (
    v_homewell_id,
    v_user_id,
    'HomeWell',
    v_homewell_color,
    1978,
    2967,
    2300,
    3450,
    0.1400,
    true
  );

  insert into public.template_slots (
    id,
    user_id,
    template_id,
    day_index,
    slot_index,
    job_type,
    pay_type,
    hours_or_units,
    regular_hours,
    overtime_hours,
    incentive_mode,
    incentive_rate,
    incentive_amount,
    custom_job_id,
    label
  ) values
    (
      v_tuesday_template_slot_id,
      v_user_id,
      v_template_id,
      2,
      v_tuesday_slot_index,
      'custom',
      'regular',
      4,
      4,
      0,
      'none',
      0,
      0,
      v_homewell_id,
      'HomeWell'
    ),
    (
      v_wednesday_template_slot_id,
      v_user_id,
      v_template_id,
      3,
      v_wednesday_slot_index,
      'custom',
      'regular',
      4,
      4,
      0,
      'none',
      0,
      0,
      v_homewell_id,
      'HomeWell'
    );

  select es.id
    into v_existing_earn_slot_id
  from public.earn_slots es
  where es.user_id = v_user_id
    and es.day_id = v_tuesday_day_id
    and es.slot_index = v_tuesday_slot_index;

  if v_existing_earn_slot_id is not null then
    if not exists (
      select 1
      from public.earn_slots es
      where es.id = v_existing_earn_slot_id
        and es.job_type = 'none'
        and es.hours_or_units = 0
    ) then
      raise exception 'Active Tuesday slot % is occupied; refusing to overwrite it.', v_tuesday_slot_index;
    end if;

    update public.earn_slots
    set job_type = 'custom',
        pay_type = 'regular',
        hours_or_units = 4,
        regular_hours = 4,
        overtime_hours = 0,
        incentive_mode = 'none',
        incentive_rate = 0,
        incentive_amount = 0,
        custom_job_id = v_homewell_id,
        label = 'HomeWell',
        source = 'template',
        updated_at = now()
    where id = v_existing_earn_slot_id;
  else
    insert into public.earn_slots (
      id,
      user_id,
      day_id,
      slot_index,
      job_type,
      pay_type,
      hours_or_units,
      regular_hours,
      overtime_hours,
      incentive_mode,
      incentive_rate,
      incentive_amount,
      custom_job_id,
      label,
      source
    ) values (
      v_tuesday_earn_slot_id,
      v_user_id,
      v_tuesday_day_id,
      v_tuesday_slot_index,
      'custom',
      'regular',
      4,
      4,
      0,
      'none',
      0,
      0,
      v_homewell_id,
      'HomeWell',
      'template'
    );
  end if;

  v_existing_earn_slot_id := null;
  select es.id
    into v_existing_earn_slot_id
  from public.earn_slots es
  where es.user_id = v_user_id
    and es.day_id = v_wednesday_day_id
    and es.slot_index = v_wednesday_slot_index;

  if v_existing_earn_slot_id is not null then
    if not exists (
      select 1
      from public.earn_slots es
      where es.id = v_existing_earn_slot_id
        and es.job_type = 'none'
        and es.hours_or_units = 0
    ) then
      raise exception 'Active Wednesday slot % is occupied; refusing to overwrite it.', v_wednesday_slot_index;
    end if;

    update public.earn_slots
    set job_type = 'custom',
        pay_type = 'regular',
        hours_or_units = 4,
        regular_hours = 4,
        overtime_hours = 0,
        incentive_mode = 'none',
        incentive_rate = 0,
        incentive_amount = 0,
        custom_job_id = v_homewell_id,
        label = 'HomeWell',
        source = 'template',
        updated_at = now()
    where id = v_existing_earn_slot_id;
  else
    insert into public.earn_slots (
      id,
      user_id,
      day_id,
      slot_index,
      job_type,
      pay_type,
      hours_or_units,
      regular_hours,
      overtime_hours,
      incentive_mode,
      incentive_rate,
      incentive_amount,
      custom_job_id,
      label,
      source
    ) values (
      v_wednesday_earn_slot_id,
      v_user_id,
      v_wednesday_day_id,
      v_wednesday_slot_index,
      'custom',
      'regular',
      4,
      4,
      0,
      'none',
      0,
      0,
      v_homewell_id,
      'HomeWell',
      'template'
    );
  end if;

  select coalesce(jsonb_agg(to_jsonb(cj) order by cj.id), '[]'::jsonb)
    into v_after_existing_jobs
  from public.custom_jobs cj
  where cj.user_id = v_user_id
    and cj.id <> v_homewell_id;

  if v_after_existing_jobs <> v_before_jobs then
    raise exception 'An existing custom job changed unexpectedly.';
  end if;

  select wt.earnings_total
    into strict v_after_week_net
  from public.v_week_totals wt
  where wt.user_id = v_user_id
    and wt.week_id = v_active_week_id;

  if round(v_after_week_net - v_before_week_net, 2) <> 158.24 then
    raise exception 'Active-week net delta was %, expected 158.24.',
      round(v_after_week_net - v_before_week_net, 2);
  end if;

  raise notice 'HOMEWELL_RESULT job_id=%, color=%, tuesday_template_slot_id=%, wednesday_template_slot_id=%, before_week_net=%, after_week_net=%, delta=%, tuesday_slot_index=%, wednesday_slot_index=%',
    v_homewell_id,
    v_homewell_color,
    v_tuesday_template_slot_id,
    v_wednesday_template_slot_id,
    v_before_week_net,
    v_after_week_net,
    round(v_after_week_net - v_before_week_net, 2),
    v_tuesday_slot_index,
    v_wednesday_slot_index;
end;
$$;
