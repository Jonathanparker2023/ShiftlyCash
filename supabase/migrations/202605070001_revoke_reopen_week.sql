-- Emergency safety patch: stop authenticated users from invoking the
-- destructive reopen flow while history recovery is being prepared.
--
-- The function body is intentionally left in place for forensic review and
-- possible service-role-only recovery work. The UI is hidden in the same
-- application change so users do not see a button that only errors.

revoke execute on function public.reopen_week(uuid) from authenticated;
