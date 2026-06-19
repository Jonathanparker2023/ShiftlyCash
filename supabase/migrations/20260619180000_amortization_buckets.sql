-- Lump-Sum Amortizer ("Amortized Income"). A named lump sum (multiple signed line
-- items) spread EVENLY as a daily NET earnings credit across a date range. Derived
-- overlay only — no concrete credit rows are ever materialized. Mirrors the shipped
-- amortized_expenses model (20260618190000 / 20260619170000) but INVERTED to a net
-- credit pointed at earnings, with two deliberate divergences:
--   1. amount_cents is SIGNED (a return reduces the total; e.g. AirPods -56500).
--   2. a PLAIN unique arbiter on (bucket_id, item_index) (the 20260619170000 lesson:
--      a partial unique index cannot be an ON CONFLICT arbiter).

----------------------------------------------------------------------
-- 1. PARENT: amortization_bucket — window + active flag. Total = sum(items).
--    period_days is the single integer denominator for the cumulative-floor split;
--    end_date is GENERATED from it (same shape as amortized_expenses) so there is
--    one source of truth. period_days > 0 structurally BLOCKS zero/negative ranges.
----------------------------------------------------------------------
create table if not exists public.amortization_bucket (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  start_date date not null,
  period_days integer not null check (period_days > 0),
  end_date date generated always as (start_date + (period_days - 1)) stored,
  status text not null default 'active' check (status in ('active', 'archived')),
  schedule_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- composite unique target for the child's user-scoped FK
  constraint amortization_bucket_id_user_key unique (id, user_id)
);

create index if not exists amortization_bucket_user_status_idx
  on public.amortization_bucket (user_id, status);
create index if not exists amortization_bucket_user_window_idx
  on public.amortization_bucket (user_id, start_date, end_date);

alter table public.amortization_bucket enable row level security;

drop policy if exists amortization_bucket_owner on public.amortization_bucket;
create policy amortization_bucket_owner on public.amortization_bucket
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

----------------------------------------------------------------------
-- 2. CHILD: amortization_item — SIGNED net cents. NO positivity check (the
--    deliberate divergence from amortized_expenses). A negative item is a return
--    that reduces the bucket total. Bucket total = sum(amount_cents).
----------------------------------------------------------------------
create table if not exists public.amortization_item (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  bucket_id uuid not null,
  item_index integer not null,
  label text not null,
  amount_cents bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amortization_item_bucket_fk foreign key (bucket_id, user_id)
    references public.amortization_bucket (id, user_id) on delete cascade,
  -- PLAIN unique constraint = valid ON CONFLICT arbiter for idempotent item upserts
  constraint amortization_item_bucket_index_key unique (bucket_id, item_index)
);

create index if not exists amortization_item_bucket_idx
  on public.amortization_item (bucket_id, item_index);
create index if not exists amortization_item_user_idx
  on public.amortization_item (user_id);

alter table public.amortization_item enable row level security;

drop policy if exists amortization_item_owner on public.amortization_item;
create policy amortization_item_owner on public.amortization_item
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

----------------------------------------------------------------------
-- 3. updated_at touch trigger (shared by both tables; same shape as
--    touch_amortized_expenses_updated_at).
----------------------------------------------------------------------
create or replace function public.touch_amortization_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists amortization_bucket_touch on public.amortization_bucket;
create trigger amortization_bucket_touch
  before update on public.amortization_bucket
  for each row execute function public.touch_amortization_updated_at();

drop trigger if exists amortization_item_touch on public.amortization_item;
create trigger amortization_item_touch
  before update on public.amortization_item
  for each row execute function public.touch_amortization_updated_at();
