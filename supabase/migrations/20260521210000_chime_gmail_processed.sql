-- Track which Gmail message IDs the chime sync cron has already
-- processed. Replaces the broken imapflow messageFlagsAdd label-write
-- which was silently hanging and causing the cron to re-process the
-- same email every minute (burning Vercel quota and creating duplicate
-- chime_raw_captures rows).
--
-- Dedup is keyed on Gmail's message ID, which is globally unique per
-- email. user_id is denormalized for RLS scoping. processed_at is for
-- observability + periodic cleanup of old rows.

create table if not exists public.chime_gmail_processed (
  gmail_message_id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  capture_id uuid references public.chime_raw_captures(id) on delete set null,
  processed_at timestamptz not null default now()
);

create index if not exists chime_gmail_processed_user_recent_idx
  on public.chime_gmail_processed (user_id, processed_at desc);

alter table public.chime_gmail_processed enable row level security;

drop policy if exists chime_gmail_processed_own on public.chime_gmail_processed;
create policy chime_gmail_processed_own on public.chime_gmail_processed for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.chime_gmail_processed to authenticated;
grant all on public.chime_gmail_processed to service_role;
