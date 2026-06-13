create table if not exists public.plaid_deployable_balance_cache (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  as_of timestamptz not null,
  deployable_balance numeric(12, 2) not null,
  accounts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.plaid_deployable_balance_cache enable row level security;

revoke all on public.plaid_deployable_balance_cache from anon, authenticated;

drop trigger if exists set_plaid_deployable_balance_cache_updated_at
  on public.plaid_deployable_balance_cache;

create trigger set_plaid_deployable_balance_cache_updated_at
  before update on public.plaid_deployable_balance_cache
  for each row execute function public.set_updated_at();
