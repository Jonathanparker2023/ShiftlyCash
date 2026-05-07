create table public.chat_usage_log (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  estimated_cost_cents integer not null default 0,
  created_at timestamptz not null default now()
);

create index chat_usage_log_user_created_idx
  on public.chat_usage_log (user_id, created_at desc);

alter table public.chat_usage_log enable row level security;

create policy chat_usage_log_own on public.chat_usage_log
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert on public.chat_usage_log to authenticated;
revoke update, delete on public.chat_usage_log from authenticated;
