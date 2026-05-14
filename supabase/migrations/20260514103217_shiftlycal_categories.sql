alter table public.food_entries
  add column if not exists category text not null default 'meal';

alter table public.saved_foods
  add column if not exists category text not null default 'meal';

alter table public.food_entries
  drop constraint if exists food_entries_category_check;
alter table public.food_entries
  add constraint food_entries_category_check check (
    category in ('meal', 'healthy_snack', 'unhealthy_snack', 'drink', 'other')
  );

alter table public.saved_foods
  drop constraint if exists saved_foods_category_check;
alter table public.saved_foods
  add constraint saved_foods_category_check check (
    category in ('meal', 'healthy_snack', 'unhealthy_snack', 'drink', 'other')
  );
