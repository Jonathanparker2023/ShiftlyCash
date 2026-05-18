alter table public.food_entries
  add column if not exists is_projected_plan boolean not null default false;

create index if not exists food_entries_projected_plan_idx
  on public.food_entries (user_id, date)
  where is_projected_plan = true;
