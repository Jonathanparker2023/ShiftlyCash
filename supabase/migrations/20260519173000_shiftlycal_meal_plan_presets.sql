create table if not exists public.meal_plan_presets (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  axioms jsonb not null,
  pool jsonb not null,
  plan jsonb not null,
  validation jsonb not null,
  validation_ok boolean not null default true,
  main_name text not null,
  calories integer not null,
  protein_g integer not null,
  carbs_g integer not null,
  fiber_g integer not null,
  fat_g integer not null,
  sodium_mg integer not null,
  added_sugar_g integer not null,
  saturated_fat_g integer not null,
  use_count integer not null default 0,
  last_used_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meal_plan_presets_name_nonempty check (length(btrim(name)) > 0),
  constraint meal_plan_presets_calories_nonneg check (calories >= 0),
  constraint meal_plan_presets_protein_nonneg check (protein_g >= 0),
  constraint meal_plan_presets_carbs_nonneg check (carbs_g >= 0),
  constraint meal_plan_presets_fiber_nonneg check (fiber_g >= 0),
  constraint meal_plan_presets_fat_nonneg check (fat_g >= 0),
  constraint meal_plan_presets_sodium_nonneg check (sodium_mg >= 0),
  constraint meal_plan_presets_added_sugar_nonneg check (added_sugar_g >= 0),
  constraint meal_plan_presets_saturated_fat_nonneg check (saturated_fat_g >= 0),
  constraint meal_plan_presets_use_count_nonneg check (use_count >= 0)
);

create index if not exists meal_plan_presets_user_recent_idx
  on public.meal_plan_presets (user_id, created_at desc)
  where archived_at is null;

create index if not exists meal_plan_presets_user_used_idx
  on public.meal_plan_presets (user_id, last_used_at desc nulls last)
  where archived_at is null;

alter table public.meal_plan_presets enable row level security;

drop policy if exists meal_plan_presets_own on public.meal_plan_presets;
create policy meal_plan_presets_own on public.meal_plan_presets for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.meal_plan_presets to authenticated;
