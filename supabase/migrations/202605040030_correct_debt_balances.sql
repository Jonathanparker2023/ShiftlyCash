-- Correct Jon's debt balances from the current debt ledger.

do $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = 'jay1park1@gmail.com'
  limit 1;

  if v_user_id is null then
    return;
  end if;

  delete from public.debts
  where user_id = v_user_id
    and name = 'Tax Bill';

  insert into public.debts
    (user_id, name, balance, minimum_payment, apr, status, priority_order)
  select
    v_user_id,
    source.name,
    source.balance,
    source.minimum_payment,
    source.apr,
    'active'::public.debt_status,
    source.priority_order
  from (
    values
      ('Auto Loan',    14600::numeric, 455::numeric, 0.1850::numeric, 10),
      ('Capital One',  1603::numeric,  35::numeric,  0::numeric,      30),
      ('Best Buy',     1314::numeric,  35::numeric,  0::numeric,      40),
      ('Midas Auto',   967::numeric,   0::numeric,   0::numeric,      50),
      ('Aspire',       558::numeric,   25::numeric,  0::numeric,      60),
      ('Mission Lane', 58::numeric,    25::numeric,  0::numeric,      70),
      ('Fortiva',      172::numeric,   0::numeric,   0::numeric,      80)
  ) as source(name, balance, minimum_payment, apr, priority_order)
  where not exists (
    select 1
    from public.debts existing
    where existing.user_id = v_user_id
      and existing.name = source.name
  );

  update public.debts
  set
    balance = case name
      when 'Auto Loan' then 14600
      when 'Capital One' then 1603
      when 'Best Buy' then 1314
      when 'Midas Auto' then 967
      when 'Aspire' then 558
      when 'Mission Lane' then 58
      when 'Fortiva' then 172
      else balance
    end,
    minimum_payment = case name
      when 'Auto Loan' then 455
      when 'Capital One' then 35
      when 'Best Buy' then 35
      when 'Midas Auto' then 0
      when 'Aspire' then 25
      when 'Mission Lane' then 25
      when 'Fortiva' then 0
      else minimum_payment
    end,
    apr = case name
      when 'Auto Loan' then 0.1850
      else 0
    end,
    status = 'active',
    priority_order = case name
      when 'Auto Loan' then 10
      when 'Capital One' then 30
      when 'Best Buy' then 40
      when 'Midas Auto' then 50
      when 'Aspire' then 60
      when 'Mission Lane' then 70
      when 'Fortiva' then 80
      else priority_order
    end
  where user_id = v_user_id
    and name in (
      'Auto Loan',
      'Capital One',
      'Best Buy',
      'Midas Auto',
      'Aspire',
      'Mission Lane',
      'Fortiva'
    );
end $$;
