create table if not exists public.tags (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  color text not null default '#94a3b8',
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tags_user_lower_name_idx
  on public.tags (user_id, lower(name));

alter table public.tags enable row level security;

drop policy if exists tags_own on public.tags;
create policy tags_own on public.tags for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.tags to authenticated;

create table if not exists public.task_tags (
  task_id uuid not null references public.tasks(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, tag_id)
);

create index if not exists task_tags_user_tag_idx
  on public.task_tags (user_id, tag_id);

alter table public.task_tags enable row level security;

drop policy if exists task_tags_own on public.task_tags;
create policy task_tags_own on public.task_tags for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, delete on public.task_tags to authenticated;

alter table public.tasks
  add column if not exists recur_unit text,
  add column if not exists recur_interval integer,
  add column if not exists recur_anchor_date date;

alter table public.tasks
  drop constraint if exists tasks_recur_unit_check,
  drop constraint if exists tasks_recur_interval_check;

alter table public.tasks
  add constraint tasks_recur_unit_check check (
    recur_unit is null or recur_unit in ('day', 'week', 'month', 'year')
  ),
  add constraint tasks_recur_interval_check check (
    recur_interval is null or recur_interval > 0
  );
