alter table public.food_entries
  add column if not exists fiber_g integer null check (fiber_g is null or fiber_g >= 0);

alter table public.saved_foods
  add column if not exists fiber_g integer null check (fiber_g is null or fiber_g >= 0);

alter table public.settings
  add column if not exists fiber_target_g integer null check (fiber_target_g is null or fiber_target_g > 0);
