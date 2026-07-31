-- Auto-allocate Tesla charging transactions as EV charges.
--
-- Gas could never be automated: Jon filled up at whatever station was closest,
-- so merchant names were unbounded. Tesla charging is the opposite -- one
-- merchant, and Supercharger sessions land in a tight dollar range. That makes
-- a deterministic rule safe.
--
-- Rule: a newly inserted APPLIED transaction whose merchant name contains
-- "tesla" and whose absolute amount is under $50 gets its FULL amount
-- allocated as an EV charge.
--
-- Deliberately INSERT-only. Undoing an allocation must stay undone -- firing on
-- UPDATE would silently re-apply it the next time the row was touched. The
-- ON CONFLICT DO NOTHING is the second guard: if an allocation row already
-- exists for the transaction (active or deactivated), the rule never overwrites
-- a decision the user already made by hand.
--
-- Known false positive: Tesla Premium Connectivity bills $9.99/month from the
-- same merchant and would be captured as charging. Jon's trial runs through
-- 2026-08-29; revisit before then if it matters.
--
-- The $50 ceiling excludes the FSD subscription ($99) and vehicle-level charges
-- such as the 2026-07-19 $1,000 deposit.

create or replace function public.auto_allocate_tesla_ev_charge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cents integer;
  v_prev  date;
begin
  if new.merchant_name is null or new.merchant_name !~* 'tesla' then
    return new;
  end if;
  if new.status <> 'applied' or new.day_id is null then
    return new;
  end if;

  v_cents := round(abs(new.amount) * 100)::integer;

  -- Under $50, and a real positive amount.
  if v_cents <= 0 or v_cents >= 5000 then
    return new;
  end if;

  -- Mirrors findPreviousEvChargeDate() in the server action: the most recent
  -- active charge before this one, else the day before.
  select max(charge_date) into v_prev
  from public.ev_charge_allocations
  where user_id = new.user_id
    and is_active
    and charge_date < new.date;

  insert into public.ev_charge_allocations (
    user_id,
    source_transaction_id,
    merchant_name,
    charge_date,
    previous_charge_date,
    charge_amount_cents,
    original_amount_cents,
    remainder_amount_cents,
    is_active
  )
  values (
    new.user_id,
    new.id,
    coalesce(nullif(btrim(new.merchant_name), ''), 'EV Charge'),
    new.date,
    coalesce(v_prev, new.date - 1),
    v_cents,
    v_cents,
    0,
    true
  )
  on conflict (source_transaction_id) do nothing;

  return new;
end;
$$;

drop trigger if exists auto_ev_charge_tesla on public.transactions;

create trigger auto_ev_charge_tesla
after insert on public.transactions
for each row
execute function public.auto_allocate_tesla_ev_charge();
