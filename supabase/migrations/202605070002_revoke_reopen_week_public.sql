-- Postgres grants EXECUTE on functions to PUBLIC by default. The prior
-- emergency migration revoked the explicit authenticated grant, but
-- authenticated sessions can still inherit EXECUTE through PUBLIC unless this
-- is revoked too.

revoke execute on function public.reopen_week(uuid) from public;
revoke execute on function public.reopen_week(uuid) from authenticated;
