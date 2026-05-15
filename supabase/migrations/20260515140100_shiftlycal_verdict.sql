alter table public.food_entries
  add column if not exists verdict text check (verdict is null or verdict in ('good','fine','bad')),
  add column if not exists verdict_reason text,
  add column if not exists verdict_source text not null default 'pending' check (verdict_source in ('pending','ai','manual_override','unscored')),
  add column if not exists verdict_context jsonb;
