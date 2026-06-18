-- Backfill: migrate legacy "<merchant> (amort <date>)" expense rows into the new
-- public.amortized_expenses model, then remove them from public.expenses so they
-- are no longer counted as recurring.
--
-- SAFE BY CONSTRUCTION: a legacy row is migrated ONLY when it can be confidently
-- reconstructed (parseable start date, a present expiration_date for the window,
-- and — preferred — a linked excluded source transaction for the authoritative
-- original amount). Anything ambiguous (no expiration, no/duplicate txn match)
-- is left UNTOUCHED in public.expenses (so it keeps behaving exactly as today,
-- contributing its monthly amount to the recurring base) and logged to
-- public.amortization_backfill_review for manual handling. Idempotent: rows
-- already migrated (their expense deleted) are simply absent on re-run.

create table if not exists public.amortization_backfill_review (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  expense_id uuid,
  expense_name text,
  reason text,
  created_at timestamptz not null default now()
);

do $$
declare
  r record;
  v_start date;
  v_merchant text;
  v_txn_id uuid;
  v_txn_amount numeric;
  v_match_count integer;
  v_original_cents bigint;
  v_period_days integer;
  v_active boolean;
begin
  for r in
    select e.*
    from public.expenses e
    where e.name ~ '\(amort \d{4}-\d{2}-\d{2}\)'
  loop
    begin
      -- parse start date + merchant from the legacy name convention
      v_start := (substring(r.name from '\(amort (\d{4}-\d{2}-\d{2})\)'))::date;
      v_merchant := btrim(split_part(r.name, ' (amort ', 1));

      if v_start is null then
        insert into public.amortization_backfill_review (user_id, expense_id, expense_name, reason)
        values (r.user_id, r.id, r.name, 'unparseable start date');
        continue;
      end if;

      -- a present expiration is required to know the window length
      if r.expiration_date is null then
        insert into public.amortization_backfill_review (user_id, expense_id, expense_name, reason)
        values (r.user_id, r.id, r.name, 'no expiration_date; cannot derive window');
        continue;
      end if;

      v_period_days := (r.expiration_date - v_start);
      if v_period_days < 1 then
        insert into public.amortization_backfill_review (user_id, expense_id, expense_name, reason)
        values (r.user_id, r.id, r.name, 'non-positive window');
        continue;
      end if;

      -- resolve the source transaction (authoritative original amount), only if
      -- exactly one unlinked excluded match exists
      select count(*) into v_match_count
      from public.transactions t
      where t.user_id = r.user_id
        and t.review_reason = 'amortized_expense'
        and t.status = 'excluded'
        and btrim(t.merchant_name) = v_merchant
        and t.date = v_start
        and not exists (
          select 1 from public.amortized_expenses a
          where a.source_transaction_id = t.id
        );

      if v_match_count = 1 then
        select t.id, abs(t.amount) into v_txn_id, v_txn_amount
        from public.transactions t
        where t.user_id = r.user_id
          and t.review_reason = 'amortized_expense'
          and t.status = 'excluded'
          and btrim(t.merchant_name) = v_merchant
          and t.date = v_start
          and not exists (
            select 1 from public.amortized_expenses a
            where a.source_transaction_id = t.id
          )
        limit 1;
        v_original_cents := round(v_txn_amount * 100);
      else
        -- 0 matches or ambiguous: fall back to expenses.amount * month-count guess
        -- (monthly figure * round(window/30)); link stays null.
        v_txn_id := null;
        v_original_cents := round(r.amount * 100) * greatest(1, round(v_period_days::numeric / 30));
      end if;

      v_active := r.is_active and (r.expiration_date >= current_date);

      insert into public.amortized_expenses (
        user_id, source_transaction_id, merchant_name,
        original_amount_cents, start_date, period_days, is_active, schedule_version
      )
      values (
        r.user_id, v_txn_id, v_merchant,
        v_original_cents, v_start, v_period_days, v_active, 1
      )
      on conflict (source_transaction_id) do nothing;

      -- remove the legacy expense so it is no longer counted as recurring
      delete from public.expenses where id = r.id;

    exception when others then
      insert into public.amortization_backfill_review (user_id, expense_id, expense_name, reason)
      values (r.user_id, r.id, r.name, 'exception: ' || sqlerrm);
    end;
  end loop;
end;
$$;
