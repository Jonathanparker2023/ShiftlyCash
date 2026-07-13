-- Tracks whether a transaction was moved to yesterday via the dashboard
-- "Move to yesterday" action, so "Move to tomorrow" can be scoped to only
-- reversing that action rather than being offered on every transaction.
alter table public.transactions
  add column if not exists moved_to_yesterday boolean not null default false;
