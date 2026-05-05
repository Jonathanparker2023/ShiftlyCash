-- Back-apply legacy exemption rules to ALL pending_review Plaid transactions
-- (across all weeks, not just wk18). Migration 0019 only ran on wk18 dates.
-- Also auto-excludes income (amount <= 0).

do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = 'jay1park1@gmail.com' limit 1;
  if v_user_id is null then return; end if;

  -- Income (deposits, refunds) → excluded
  update public.transactions t
  set status = 'excluded',
      excluded_at = now(),
      review_reason = 'income_deposit'
  where t.user_id = v_user_id
    and t.source = 'plaid'
    and t.amount <= 0
    and t.status = 'pending_review';

  -- Merchant-rule matches → excluded
  update public.transactions t
  set status = 'excluded',
      excluded_at = now(),
      review_reason = 'auto_exempt_merchant_rule'
  from public.transaction_exemption_rules r
  where t.user_id = v_user_id
    and t.source = 'plaid'
    and t.status = 'pending_review'
    and r.user_id = v_user_id
    and r.rule_type = 'merchant'
    and r.is_active = true
    and (
      lower(t.merchant_name) like '%' || lower(r.value) || '%'
      or lower(coalesce(t.raw_name, '')) like '%' || lower(r.value) || '%'
    );

  -- Category-rule matches → excluded
  update public.transactions t
  set status = 'excluded',
      excluded_at = now(),
      review_reason = 'auto_exempt_category_rule'
  from public.transaction_exemption_rules r
  where t.user_id = v_user_id
    and t.source = 'plaid'
    and t.status = 'pending_review'
    and r.user_id = v_user_id
    and r.rule_type = 'category'
    and r.is_active = true
    and lower(coalesce(t.category, '')) = lower(r.value);
end $$;
