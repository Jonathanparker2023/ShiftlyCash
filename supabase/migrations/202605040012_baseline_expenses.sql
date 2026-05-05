do $$
begin
  if exists (
    select 1
    from public.expenses
    group by user_id, name
    having count(*) > 1
  ) then
    raise exception 'Cannot add expenses_user_name_unique: duplicate expense names exist for at least one user.';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.expenses'::regclass
      and conname = 'expenses_user_name_unique'
  ) then
    alter table public.expenses
      add constraint expenses_user_name_unique unique (user_id, name);
  end if;
end $$;

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

  insert into public.expenses (
    user_id,
    name,
    amount,
    expiration_date,
    is_active,
    sort_order
  )
  values
    (p_user_id, 'Car Payment', 455.00, null, true, 10),
    (p_user_id, 'Car Insurance', 279.00, null, true, 20),
    (p_user_id, 'Verizon', 0.00, null, true, 30),
    (p_user_id, 'Car Wash', 44.00, null, true, 40),
    (p_user_id, 'ChatGPT', 80.00, null, true, 50),
    (p_user_id, 'Home Insurance', 14.00, null, true, 60),
    (p_user_id, 'Apple Cloud', 3.00, null, true, 70),
    (p_user_id, 'Gmail', 3.00, null, true, 80),
    (p_user_id, 'Day One', 3.00, null, true, 90),
    (p_user_id, 'Oren', 50.00, null, true, 100),
    (p_user_id, 'YouTube', 47.00, null, true, 110),
    (p_user_id, 'Best Buy', 131.00, '2026-12-31'::date, true, 120),
    (p_user_id, 'Oil Change', 26.00, null, true, 130),
    (p_user_id, 'Google AI', 20.00, null, true, 140),
    (p_user_id, 'Midas Auto', 167.00, '2026-08-31'::date, true, 150),
    (p_user_id, 'HBO Max', 20.00, null, true, 160),
    (p_user_id, 'Perplexity', 22.00, null, true, 170)
  on conflict (user_id, name) do nothing;

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

update public.earn_slots es
set
  pay_type = 'regular',
  updated_at = now()
from public.days d
where es.day_id = d.id
  and es.user_id = d.user_id
  and d.date = '2026-05-03'::date
  and d.day_index = 0
  and es.slot_index = 0
  and es.job_type = 'ability';
