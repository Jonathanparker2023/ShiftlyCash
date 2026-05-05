-- Reset wk18 (active week, May 3-9) spend to clean baseline.
-- Plaid auto-link from migration 0016 dragged all unrelated transactions into
-- wk18 days. User wants to triage manually. Unlink them, zero out manual
-- adjustments, leave Plaid transactions as pending_review for individual review.

do $$
declare
  v_user_id uuid;
  v_wk18_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = 'jay1park1@gmail.com' limit 1;
  if v_user_id is null then return; end if;

  select id into v_wk18_id from public.weeks
    where user_id = v_user_id and start_date = '2026-05-03';

  if v_wk18_id is null then return; end if;

  -- Unlink Plaid transactions from wk18 days
  update public.transactions t
  set day_id = null,
      status = 'pending_review',
      review_reason = coalesce(t.review_reason, 'wk18_baseline_reset')
  from public.days d
  where t.user_id = v_user_id
    and t.source = 'plaid'
    and t.day_id = d.id
    and d.user_id = v_user_id
    and d.week_id = v_wk18_id;

  -- Zero out manual spend adjustment for wk18
  update public.days
  set manual_spend_adjustment = 0
  where user_id = v_user_id and week_id = v_wk18_id;
end $$;
