-- The Onyx/Tesla loan never produced a billed payment. Remove its projected
-- recurring cost and any amortization rows explicitly tied to that loan.
-- The real $1,000 down-payment transaction is intentionally untouched; it is
-- a confirmed event and remains a single charge on 2026-07-19.

update public.expenses
set is_active = false,
    updated_at = now()
where lower(btrim(name)) = 'tesla loan'
  and is_active;

update public.amortized_expenses
set is_active = false,
    updated_at = now()
where is_active
  and lower(btrim(merchant_name)) in ('tesla loan', 'tesla auto loan');

-- Remove the loan's recurring baseline from recent stamped days. This does not
-- touch manual adjustments or the confirmed down-payment transaction.
do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = 'jay1park1@gmail.com';

  if v_user_id is not null
     and to_regprocedure('public.restamp_recent_baseline(uuid,integer)') is not null then
    perform public.restamp_recent_baseline(v_user_id, 45);
  end if;
end;
$$;
