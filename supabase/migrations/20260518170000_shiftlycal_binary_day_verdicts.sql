update public.food_entries
set verdict = 'bad'
where verdict = 'fine';

alter table public.food_entries
  drop constraint if exists food_entries_verdict_check;

alter table public.food_entries
  add constraint food_entries_verdict_check
  check (verdict is null or verdict in ('good','bad'));

create table if not exists public.day_food_verdicts (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  verdict text not null,
  reason text not null,
  calorie_total integer not null,
  protein_total integer not null,
  within_calorie_tolerance boolean not null,
  within_protein_target boolean not null,
  generated_at timestamptz not null default now(),
  constraint day_food_verdicts_verdict_check check (verdict in ('good','bad')),
  constraint day_food_verdicts_calorie_total_nonneg check (calorie_total >= 0),
  constraint day_food_verdicts_protein_total_nonneg check (protein_total >= 0),
  unique (user_id, date)
);

alter table public.day_food_verdicts enable row level security;

drop policy if exists day_food_verdicts_own on public.day_food_verdicts;
create policy day_food_verdicts_own on public.day_food_verdicts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.day_food_verdicts to authenticated;
