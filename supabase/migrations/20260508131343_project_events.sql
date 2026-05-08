create table public.project_events (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index project_events_project_idx
  on public.project_events (user_id, project_id, created_at desc);
create index project_events_kind_idx
  on public.project_events (user_id, kind, created_at desc);

alter table public.project_events enable row level security;

create policy project_events_own on public.project_events for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert on public.project_events to authenticated;
revoke update, delete on public.project_events from authenticated;
