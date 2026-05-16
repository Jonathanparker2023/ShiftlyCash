create table if not exists public.chime_raw_captures (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  raw_text text not null,
  received_at timestamptz not null,
  source_meta jsonb,
  parsed_at timestamptz,
  parsed_transaction_id uuid references public.transactions(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists chime_raw_captures_user_received_idx
  on public.chime_raw_captures(user_id, received_at desc);

create index if not exists chime_raw_captures_unparsed_idx
  on public.chime_raw_captures(user_id, parsed_at)
  where parsed_at is null;

alter table public.chime_raw_captures enable row level security;

drop policy if exists chime_raw_captures_own on public.chime_raw_captures;
create policy chime_raw_captures_own on public.chime_raw_captures for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.chime_raw_captures to authenticated;
