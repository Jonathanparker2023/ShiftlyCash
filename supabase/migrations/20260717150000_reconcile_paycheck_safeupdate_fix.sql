-- Fix: reconcile_paycheck failed in production with "UPDATE requires a WHERE
-- clause" -- the four Hamilton-distribution UPDATEs on the _recon_base temp
-- table had no WHERE, and the database enforces safe-update. Add a no-op
-- "where true" to each; distribution math is unchanged.
create or replace function public.reconcile_paycheck(
  p_week_id uuid,
  p_job_key text,
  p_actual_cents bigint,
  p_confirmed_correct boolean
)
returns table (
  status                 text,
  projected_amount_cents bigint,
  actual_amount_cents    bigint,
  factor                 numeric,
  slot_count             integer
)
language plpgsql
security invoker
as $$
declare
  v_uid       uuid := auth.uid();
  v_projected bigint;
  v_n         integer;
  v_floor_sum bigint;
  v_remainder bigint;
  v_alloc_sum bigint;
  v_factor    numeric;
  v_ids       jsonb;
  v_amts      jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;
  if p_confirmed_correct is not true then
    raise exception 'Reconciliation requires explicit confirmation that the check is correct.';
  end if;
  if p_actual_cents is null or p_actual_cents < 0 then
    raise exception 'Actual amount must be a non-negative integer cents value.';
  end if;

  -- Snapshot the base set into a temp table (id::text order = Hamilton order,
  -- matches the TS localeCompare order and the staleness snapshot order).
  drop table if exists _recon_base;
  create temp table _recon_base (
    rn      bigint,
    slot_id uuid,
    base    bigint,
    num     numeric,
    floor_v bigint,
    rem     numeric,
    alloc   bigint
  ) on commit drop;

  insert into _recon_base (rn, slot_id, base)
  select row_number() over (order by b.slot_id::text asc),
         b.slot_id,
         b.base_net_cents
  from public.paycheck_period_base_slots(p_week_id, p_job_key) b;

  select count(*), coalesce(sum(base), 0) into v_n, v_projected from _recon_base;

  if v_n = 0 then
    raise exception 'No shifts in this pay period for this job; nothing to reconcile.';
  end if;

  if v_projected = 0 then
    -- Equal split: floor = A / n, leftover A mod n to the first cells in order.
    update _recon_base
      set alloc = (p_actual_cents / v_n)
                + case when rn <= (p_actual_cents - (p_actual_cents / v_n) * v_n)
                       then 1 else 0 end
      where true;
  else
    -- Hamilton / largest-remainder over base.
    update _recon_base
      set num     = base::numeric * p_actual_cents,
          floor_v = floor(base::numeric * p_actual_cents / v_projected)::bigint
      where true;
    update _recon_base
      set rem = num - (floor_v::numeric * v_projected)
      where true;
    select coalesce(sum(floor_v), 0) into v_floor_sum from _recon_base;
    v_remainder := p_actual_cents - v_floor_sum;  -- 0 <= v_remainder < n

    -- +1 cent to the top v_remainder rows: rem desc, then larger base, then id asc.
    update _recon_base t
      set alloc = floor_v + case
        when t.rn in (
          select rn from _recon_base
          order by rem desc, base desc, slot_id::text asc
          limit greatest(v_remainder, 0)
        ) then 1 else 0 end
      where true;
  end if;

  -- Hard invariant: Î£ alloc == A, else abort + rollback.
  select coalesce(sum(alloc), 0) into v_alloc_sum from _recon_base;
  if v_alloc_sum <> p_actual_cents then
    raise exception 'Reconciliation distribution failed: allocated % cents != actual % cents.',
      v_alloc_sum, p_actual_cents;
  end if;

  -- Overwrite each slot's override FROM BASE allocation (idempotent; never reads
  -- back reconciled_net_cents). The input-change trigger skips this because the
  -- override column itself is what changes here.
  update public.earn_slots es
    set reconciled_net_cents = rb.alloc
  from _recon_base rb
  where es.id = rb.slot_id
    and es.user_id = v_uid;

  -- Staleness snapshot (ordered id::text asc, same as TS comparator).
  select jsonb_agg(slot_id order by slot_id::text asc),
         jsonb_agg(base    order by slot_id::text asc)
    into v_ids, v_amts
  from _recon_base;

  v_factor := case when v_projected = 0 then null
                   else p_actual_cents::numeric / v_projected::numeric end;

  insert into public.paycheck_reconciliations as pr (
    user_id, week_id, job_key,
    projected_amount_cents, actual_amount_cents, factor, basis,
    confirmed_correct, status, base_shift_ids, base_amounts_cents
  )
  values (
    v_uid, p_week_id, p_job_key,
    v_projected, p_actual_cents, v_factor, 'net',
    true, 'reconciled', v_ids, v_amts
  )
  on conflict (user_id, week_id, job_key) do update set
    projected_amount_cents = excluded.projected_amount_cents,
    actual_amount_cents    = excluded.actual_amount_cents,
    factor                 = excluded.factor,
    basis                  = 'net',
    confirmed_correct      = true,
    status                 = 'reconciled',
    base_shift_ids         = excluded.base_shift_ids,
    base_amounts_cents     = excluded.base_amounts_cents;

  return query
    select 'reconciled'::text, v_projected, p_actual_cents, v_factor, v_n;
end;
$$;

----------------------------------------------------------------------
-- 6. revert_paycheck_reconciliation(week_id, job_key)
--    Null the override for this job's period slots and mark the record
--    reverted; rollups fall back to derived net immediately.



