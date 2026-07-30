-- EV charging is a computed weekly operating metric. It does not create
-- transactions or alter the gas allocation ledger.

create table if not exists public.ev_charging_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  efficiency_wh_per_mi numeric not null default 250,
  free_hours_per_week numeric not null default 69,
  free_mi_per_hour numeric not null default 4,
  home_rate_cents_per_kwh numeric not null default 30,
  public_rate_cents_per_kwh numeric not null default 45,
  charging_loss_pct numeric not null default 13,
  typical_miles_per_week numeric not null default 125,
  explorer_mpg numeric not null default 19,
  gas_price_per_gal_cents numeric not null default 335,
  gas_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ev_charging_settings enable row level security;

drop policy if exists ev_charging_settings_owner on public.ev_charging_settings;
create policy ev_charging_settings_owner on public.ev_charging_settings
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.ev_charging_settings to authenticated;

create table if not exists public.ev_charging_weeks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_id uuid not null,
  miles_driven numeric not null default 0,
  primary key (user_id, week_id),
  constraint ev_charging_weeks_owned_week_fk
    foreign key (week_id, user_id)
    references public.weeks(id, user_id)
    on delete cascade
);

alter table public.ev_charging_weeks enable row level security;

drop policy if exists ev_charging_weeks_owner on public.ev_charging_weeks;
create policy ev_charging_weeks_owner on public.ev_charging_weeks
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.ev_charging_weeks to authenticated;

create or replace function public.touch_ev_charging_settings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ev_charging_settings_touch on public.ev_charging_settings;
create trigger ev_charging_settings_touch
  before update on public.ev_charging_settings
  for each row execute function public.touch_ev_charging_settings_updated_at();
