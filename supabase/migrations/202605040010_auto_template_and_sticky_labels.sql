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
  v_sun_fri_base numeric(10, 2);
  v_sat_base numeric(10, 2);
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

  select s.default_base_sun_fri, s.default_base_sat
    into v_sun_fri_base, v_sat_base
  from public.settings s
  where s.user_id = v_user_id;

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
    case when gs.day_index = 6 then v_sat_base else v_sun_fri_base end,
    0,
    false
  from generate_series(0, 6) as gs(day_index)
  on conflict (week_id, day_index) do nothing;

  perform public.apply_default_template_to_week(v_week_id);

  return v_week_id;
end;
$$;

grant execute on function public.ensure_current_active_week(date) to authenticated;

create or replace function public.bootstrap_user_defaults(
  p_user_id uuid,
  p_email text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  default_template_id uuid;
begin
  insert into public.profiles (id, email)
  values (p_user_id, p_email)
  on conflict (id) do update
    set email = coalesce(excluded.email, public.profiles.email);

  insert into public.settings (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select id
    into default_template_id
  from public.weekly_templates
  where user_id = p_user_id
    and is_default
  limit 1;

  if default_template_id is null then
    insert into public.weekly_templates (user_id, name, is_default)
    values (p_user_id, 'Default', true)
    returning id into default_template_id;
  end if;

  insert into public.template_slots (
    user_id,
    template_id,
    day_index,
    slot_index,
    job_type,
    pay_type,
    hours_or_units
  )
  values
    (p_user_id, default_template_id, 0, 0, 'ability', 'regular', 8),
    (p_user_id, default_template_id, 0, 1, 'ability', 'regular', 6),
    (p_user_id, default_template_id, 0, 2, 'prestige', 'regular', 3),
    (p_user_id, default_template_id, 1, 0, 'prestige', 'regular', 13),
    (p_user_id, default_template_id, 1, 1, 'ability', 'regular', 4),
    (p_user_id, default_template_id, 1, 2, 'ability', 'overtime', 2),
    (p_user_id, default_template_id, 2, 0, 'prestige', 'regular', 8),
    (p_user_id, default_template_id, 2, 1, 'ability', 'overtime', 12),
    (p_user_id, default_template_id, 3, 0, 'prestige', 'regular', 2),
    (p_user_id, default_template_id, 3, 1, 'ability', 'overtime', 12),
    (p_user_id, default_template_id, 4, 0, 'prestige', 'regular', 10),
    (p_user_id, default_template_id, 4, 1, 'ability', 'regular', 2),
    (p_user_id, default_template_id, 4, 2, 'ability', 'overtime', 6),
    (p_user_id, default_template_id, 5, 0, 'prestige', 'regular', 4),
    (p_user_id, default_template_id, 5, 1, 'prestige', 'overtime', 8),
    (p_user_id, default_template_id, 5, 2, 'ability', 'regular', 10),
    (p_user_id, default_template_id, 6, 0, 'ability', 'regular', 10),
    (p_user_id, default_template_id, 6, 1, 'ability', 'overtime', 6)
  on conflict (template_id, day_index, slot_index) do nothing;

  insert into public.sticky_labels (user_id, day_index, slot_index, label)
  values
    (p_user_id, 0, 0, 'Sunrise Cottage'),
    (p_user_id, 0, 2, 'Tony'),
    (p_user_id, 1, 0, 'Tony/Joe'),
    (p_user_id, 2, 0, 'Joe'),
    (p_user_id, 3, 0, 'Mike'),
    (p_user_id, 4, 0, 'Mike'),
    (p_user_id, 4, 1, 'Sunrise Cottage'),
    (p_user_id, 5, 0, 'Nate'),
    (p_user_id, 5, 1, 'Nate'),
    (p_user_id, 5, 2, 'Sunrise Cottage'),
    (p_user_id, 6, 0, 'Sunrise Cottage')
  on conflict do nothing;

  insert into public.transaction_exemption_rules (user_id, rule_type, value, source)
  select p_user_id, 'merchant', v.value, 'seed'
  from unnest(array[
    'scl residential',
    'rent',
    'holyoke',
    'direct debit',
    'ach debit',
    'subscription',
    'netflix',
    'spotify',
    'hulu',
    'disney+',
    'apple.com/bill',
    'google play',
    'google one',
    'google storage',
    'amazon prime',
    'youtube premium',
    'xbox',
    'playstation',
    'monthly fee',
    'monthly plan',
    'monthly charge',
    'perplexity',
    'anthropic',
    'openai',
    'chatgpt',
    'claude.ai',
    'doordashdashpass',
    'dashpass',
    'platinum car wash'
  ]::text[]) as v(value)
  on conflict do nothing;

  insert into public.transaction_exemption_rules (user_id, rule_type, value, source)
  select p_user_id, 'category', v.value, 'seed'
  from unnest(array[
    'subscription',
    'recurring',
    'loan payment',
    'mortgage',
    'insurance',
    'utilities'
  ]::text[]) as v(value)
  on conflict do nothing;
end;
$$;

do $$
declare
  auth_user record;
begin
  for auth_user in
    select id, email
    from auth.users
  loop
    perform public.bootstrap_user_defaults(auth_user.id, auth_user.email);
  end loop;
end $$;
