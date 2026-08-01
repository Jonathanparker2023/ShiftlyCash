-- User-owned goal ladder.
--
-- The rungs were hardcoded in application config, which meant Jon could not
-- rename one, restate why it matters, change what it costs, or reorder the
-- climb without a deploy. A goal ladder whose owner cannot edit it is a
-- slideshow, not a plan.
--
-- target_kind decides where the number comes from:
--   'debt'       -> live balance of the debt whose name matches debt_match
--   'house_hack' -> computed from the FHA assumptions on the page
--   'fixed'      -> target_cents, typed by Jon
create table if not exists public.goal_rungs (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_index integer not null default 0,
  title text not null,
  kicker text not null default '',
  description text not null default '',
  image_src text,
  target_kind text not null default 'fixed',
  target_cents bigint not null default 0,
  debt_match text,
  deadline_on date,
  deadline_label text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goal_rungs_target_kind_check
    check (target_kind in ('fixed', 'debt', 'house_hack')),
  constraint goal_rungs_non_negative check (target_cents >= 0)
);

create index if not exists goal_rungs_user_order_idx
  on public.goal_rungs (user_id, order_index);

alter table public.goal_rungs enable row level security;

drop policy if exists goal_rungs_own on public.goal_rungs;
create policy goal_rungs_own on public.goal_rungs
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.goal_rungs to authenticated;

create or replace function public.touch_goal_rungs()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists goal_rungs_touch on public.goal_rungs;
create trigger goal_rungs_touch
before update on public.goal_rungs
for each row execute function public.touch_goal_rungs();
