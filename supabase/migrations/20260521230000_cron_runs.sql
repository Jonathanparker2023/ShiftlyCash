-- Per-cron run-tracking table for code-side self-throttling and
-- last-run observability. Prevents a cron from running too frequently
-- even if the external scheduler (cron-job.org, Vercel cron) is
-- misconfigured to ping too often. Belt-and-suspenders against the
-- Vercel quota-burn we hit when the Gmail chime-sync route was
-- re-processing emails every minute.

create table if not exists public.cron_runs (
  cron_name text primary key,
  last_started_at timestamptz not null default now(),
  last_completed_at timestamptz,
  last_summary text
);

alter table public.cron_runs enable row level security;

-- Service-role only. No user-facing access.
grant all on public.cron_runs to service_role;
