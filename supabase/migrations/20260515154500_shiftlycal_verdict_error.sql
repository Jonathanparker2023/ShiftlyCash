alter table public.food_entries
  add column if not exists verdict_error text null;

update public.food_entries
  set verdict_source = 'unscored',
      verdict_error = 'auto-cleared: stuck pending pre-batch-14'
  where verdict_source = 'pending'
    and created_at < now() - interval '5 minutes';
