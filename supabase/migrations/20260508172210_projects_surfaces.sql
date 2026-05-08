create table if not exists public.weekly_reflections (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  shipped text,
  stuck text,
  next_week text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists weekly_reflections_user_week_idx
  on public.weekly_reflections (user_id, week_start);

alter table public.weekly_reflections enable row level security;

drop policy if exists weekly_reflections_own on public.weekly_reflections;
create policy weekly_reflections_own on public.weekly_reflections for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.weekly_reflections to authenticated;

alter table public.projects
  add column if not exists is_inbox boolean not null default false;

create unique index if not exists projects_single_inbox_user_idx
  on public.projects (user_id)
  where is_inbox = true;
