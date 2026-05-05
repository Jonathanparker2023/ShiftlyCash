-- Apply Plaid transactions to wk18 days (May 3-9), with auto-exemption.
-- 1. Deposits (amount <= 0) → excluded with reason='income_deposit'
-- 2. Matches a user exemption rule (merchant or category) → excluded with reason='auto_exempt_rule'
-- 3. Everything else → applied to the day matching its date

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

  -- Step 1: Mark deposits as excluded (income, not spend)
  update public.transactions t
  set status = 'excluded',
      excluded_at = now(),
      review_reason = 'income_deposit'
  where t.user_id = v_user_id
    and t.source = 'plaid'
    and t.amount <= 0
    and t.date between '2026-05-03' and '2026-05-09'
    and t.status = 'pending_review';

  -- Step 2: Mark merchant-rule matches as excluded
  update public.transactions t
  set status = 'excluded',
      excluded_at = now(),
      review_reason = 'auto_exempt_merchant_rule'
  from public.transaction_exemption_rules r
  where t.user_id = v_user_id
    and t.source = 'plaid'
    and t.date between '2026-05-03' and '2026-05-09'
    and t.status = 'pending_review'
    and r.user_id = v_user_id
    and r.rule_type = 'merchant'
    and r.is_active = true
    and (
      lower(t.merchant_name) like '%' || lower(r.value) || '%'
      or lower(coalesce(t.raw_name, '')) like '%' || lower(r.value) || '%'
    );

  -- Step 3: Mark category-rule matches as excluded
  update public.transactions t
  set status = 'excluded',
      excluded_at = now(),
      review_reason = 'auto_exempt_category_rule'
  from public.transaction_exemption_rules r
  where t.user_id = v_user_id
    and t.source = 'plaid'
    and t.date between '2026-05-03' and '2026-05-09'
    and t.status = 'pending_review'
    and r.user_id = v_user_id
    and r.rule_type = 'category'
    and r.is_active = true
    and lower(coalesce(t.category, '')) = lower(r.value);

  -- Step 4: Apply remaining pending txs to their date-matching wk18 days
  update public.transactions t
  set day_id = d.id,
      status = 'applied',
      review_reason = null
  from public.days d
  where t.user_id = v_user_id
    and t.source = 'plaid'
    and t.status = 'pending_review'
    and t.day_id is null
    and d.user_id = v_user_id
    and d.week_id = v_wk18_id
    and d.date = t.date;
end $$;
