alter table public.settings
  add column if not exists banned_foods text[] not null default '{}'::text[];

update public.settings
  set banned_foods = array['edamame']
  where user_id = (
    select id from public.profiles order by created_at asc limit 1
  )
  and cardinality(banned_foods) = 0;
