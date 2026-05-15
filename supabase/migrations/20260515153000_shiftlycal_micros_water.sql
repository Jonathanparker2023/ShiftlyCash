alter table public.food_entries
  add column if not exists sodium_mg integer null check (sodium_mg is null or sodium_mg >= 0),
  add column if not exists added_sugar_g integer null check (added_sugar_g is null or added_sugar_g >= 0),
  add column if not exists saturated_fat_g integer null check (saturated_fat_g is null or saturated_fat_g >= 0);

alter table public.saved_foods
  add column if not exists sodium_mg integer null check (sodium_mg is null or sodium_mg >= 0),
  add column if not exists added_sugar_g integer null check (added_sugar_g is null or added_sugar_g >= 0),
  add column if not exists saturated_fat_g integer null check (saturated_fat_g is null or saturated_fat_g >= 0);

alter table public.settings
  add column if not exists sodium_target_mg integer null check (sodium_target_mg is null or sodium_target_mg > 0),
  add column if not exists added_sugar_target_g integer null check (added_sugar_target_g is null or added_sugar_target_g > 0),
  add column if not exists saturated_fat_target_g integer null check (saturated_fat_target_g is null or saturated_fat_target_g > 0),
  add column if not exists water_target_oz integer null check (water_target_oz is null or water_target_oz > 0);

create table if not exists public.water_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  amount_oz integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint water_logs_amount_positive check (amount_oz > 0)
);

create index if not exists water_logs_user_date_idx
  on public.water_logs (user_id, date);

alter table public.water_logs enable row level security;

drop policy if exists water_logs_own on public.water_logs;
create policy water_logs_own on public.water_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.water_logs to authenticated;
