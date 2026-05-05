-- Fix wk16/17 spend totals.
-- Migration 0016 auto-linked every Plaid transaction in the date range to days,
-- which (a) double-counted with the manual_spend_adjustment for wk17 and
-- (b) included deposits stored as negative amounts, dragging spend negative.
-- Strategy: unlink all Plaid txs from wk16/17 days, return them to
-- pending_review for user to handle individually. Use manual_spend_adjustment
-- as source of truth for both weeks (per-day spend already calculated correctly
-- from filtered Chime data).

do $$
declare
  v_user_id uuid;
  v_wk16_id uuid;
  v_wk17_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = 'jay1park1@gmail.com' limit 1;
  if v_user_id is null then return; end if;

  select id into v_wk16_id from public.weeks where user_id = v_user_id and start_date = '2026-04-19';
  select id into v_wk17_id from public.weeks where user_id = v_user_id and start_date = '2026-04-26';

  -- Unlink any Plaid txs assigned to wk16/17 days
  update public.transactions t
  set day_id = null,
      status = 'pending_review',
      review_reason = 'historic_week_unlink'
  from public.days d
  where t.user_id = v_user_id
    and t.source = 'plaid'
    and t.day_id = d.id
    and d.user_id = v_user_id
    and d.week_id in (v_wk16_id, v_wk17_id);

  -- Set wk16 daily spend from manually calculated filtered totals
  update public.days d
  set manual_spend_adjustment = case d.day_index
    when 0 then 88   -- Sun Apr 19
    when 1 then 179  -- Mon Apr 20
    when 2 then 153  -- Tue Apr 21
    when 3 then 310  -- Wed Apr 22
    when 4 then 78   -- Thu Apr 23
    when 5 then 92   -- Fri Apr 24
    when 6 then 32   -- Sat Apr 25
  end
  where d.user_id = v_user_id and d.week_id = v_wk16_id;

  -- Wk17 manual_spend_adjustment is already set correctly from migration 0016
end $$;
