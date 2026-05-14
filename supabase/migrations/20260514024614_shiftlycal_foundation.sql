create table if not exists public.saved_foods (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  calories integer not null,
  protein_g integer,
  carbs_g integer,
  fat_g integer,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_foods_calories_nonneg check (calories >= 0),
  constraint saved_foods_protein_nonneg check (protein_g is null or protein_g >= 0),
  constraint saved_foods_carbs_nonneg check (carbs_g is null or carbs_g >= 0),
  constraint saved_foods_fat_nonneg check (fat_g is null or fat_g >= 0),
  constraint saved_foods_name_nonempty check (length(btrim(name)) > 0)
);

create unique index if not exists saved_foods_id_user_unique
  on public.saved_foods (id, user_id);

create index if not exists saved_foods_user_sort_idx
  on public.saved_foods (user_id, sort_order)
  where archived_at is null;

create table if not exists public.food_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  meal_name text not null default '',
  calories integer not null,
  protein_g integer,
  carbs_g integer,
  fat_g integer,
  saved_food_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint food_entries_calories_nonneg check (calories >= 0),
  constraint food_entries_protein_nonneg check (protein_g is null or protein_g >= 0),
  constraint food_entries_carbs_nonneg check (carbs_g is null or carbs_g >= 0),
  constraint food_entries_fat_nonneg check (fat_g is null or fat_g >= 0),
  constraint food_entries_saved_food_same_user_fk
    foreign key (saved_food_id, user_id)
    references public.saved_foods(id, user_id)
    on delete set null (saved_food_id)
);

create index if not exists food_entries_user_date_idx
  on public.food_entries (user_id, date);

create table if not exists public.weight_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  weight_lbs numeric(5, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weight_logs_weight_positive check (weight_lbs > 0),
  unique (user_id, date)
);

alter table public.settings
  add column if not exists tdee_calories integer,
  add column if not exists protein_target_g integer,
  add column if not exists carbs_target_g integer,
  add column if not exists fat_target_g integer;

alter table public.settings
  drop constraint if exists settings_shiftlycal_targets_nonneg;

alter table public.settings
  add constraint settings_shiftlycal_targets_nonneg check (
    (tdee_calories is null or tdee_calories > 0)
    and (protein_target_g is null or protein_target_g >= 0)
    and (carbs_target_g is null or carbs_target_g >= 0)
    and (fat_target_g is null or fat_target_g >= 0)
  );

alter table public.food_entries enable row level security;
alter table public.saved_foods enable row level security;
alter table public.weight_logs enable row level security;

drop policy if exists food_entries_own on public.food_entries;
create policy food_entries_own on public.food_entries for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists saved_foods_own on public.saved_foods;
create policy saved_foods_own on public.saved_foods for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists weight_logs_own on public.weight_logs;
create policy weight_logs_own on public.weight_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.food_entries to authenticated;
grant select, insert, update, delete on public.saved_foods to authenticated;
grant select, insert, update, delete on public.weight_logs to authenticated;
