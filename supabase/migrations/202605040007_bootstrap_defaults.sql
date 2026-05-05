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

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.bootstrap_user_defaults(new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();
