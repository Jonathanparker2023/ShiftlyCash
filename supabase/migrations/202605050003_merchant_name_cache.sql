create table if not exists public.merchant_name_cache (
  raw_key text primary key,
  display_name text not null,
  source text not null check (source in ('rule', 'ai', 'user')),
  ai_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists merchant_name_cache_raw_key_idx
  on public.merchant_name_cache (raw_key);

alter table public.merchant_name_cache enable row level security;

drop policy if exists "anyone reads merchant cache" on public.merchant_name_cache;
create policy "anyone reads merchant cache"
  on public.merchant_name_cache
  for select
  to authenticated
  using (true);
