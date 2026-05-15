alter table public.food_entries
  add column if not exists logged_time time;

create index if not exists food_entries_user_date_time_idx
  on public.food_entries (user_id, date, logged_time);
