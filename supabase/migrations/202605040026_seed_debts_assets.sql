-- Seed Jon's current debts + asset (Ford Explorer) from legacy app values.

do $$
declare
  v_user_id uuid;
  v_auto_loan_id uuid;
begin
  select id into v_user_id from auth.users where lower(email) = 'jay1park1@gmail.com' limit 1;
  if v_user_id is null then return; end if;

  if exists (select 1 from public.debts where user_id = v_user_id) then
    raise notice 'Debts already seeded for user.';
    return;
  end if;

  insert into public.debts (user_id, name, balance, minimum_payment, apr, status, priority_order) values
    (v_user_id, 'Auto Loan',     14600, 455, 0.1850, 'active', 10),
    (v_user_id, 'Capital One',   1603,  35,  0,      'active', 30),
    (v_user_id, 'Best Buy',      1314,  35,  0,      'active', 40),
    (v_user_id, 'Midas Auto',    967,   0,   0,      'active', 50),
    (v_user_id, 'Aspire',        558,   25,  0,      'active', 60),
    (v_user_id, 'Mission Lane',  58,    25,  0,      'active', 70),
    (v_user_id, 'Fortiva',       172,   0,   0,      'active', 80);

  select id into v_auto_loan_id from public.debts where user_id = v_user_id and name = 'Auto Loan';

  if not exists (select 1 from public.assets where user_id = v_user_id) then
    insert into public.assets (user_id, name, value, depreciation_rate, category, linked_debt_id)
    values (v_user_id, '2017 Ford Explorer', 11500, 0.15, 'vehicle', v_auto_loan_id);
  end if;
end $$;
