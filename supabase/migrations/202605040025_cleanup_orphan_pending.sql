-- Clean up 65 transactions stranded in pending_review with reason
-- 'historic_week_unlink' from migration 0017. They were unlinked from wk16/17
-- days when those weeks switched to manual_spend_adjustment as the source of
-- truth. They're not relevant to any tracked week and just clutter the pending
-- queue. Marking them excluded preserves the audit trail without deleting.

do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = 'jay1park1@gmail.com' limit 1;
  if v_user_id is null then return; end if;

  update public.transactions
  set status = 'excluded',
      excluded_at = now(),
      review_reason = 'wk16_17_orphan_archived'
  where user_id = v_user_id
    and status = 'pending_review'
    and review_reason = 'historic_week_unlink';
end $$;
