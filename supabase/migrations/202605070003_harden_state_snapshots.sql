-- Recovery safety: state snapshots are the only durable copy of weeks that
-- were hard-deleted by the old reopen flow. Authenticated sessions may still
-- read their own snapshots and RPCs may still insert snapshots, but app/client
-- code must not be able to alter or delete recovery payloads.

revoke update, delete on table public.state_snapshots from authenticated;
