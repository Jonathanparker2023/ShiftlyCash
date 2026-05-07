-- =============================================================================
-- Recovery transaction: restore weeks 15, 16, and the original week 18.
-- =============================================================================
--
-- Sources:
--   da7d3899-3d59-4fb0-aed5-a2594cbb6882  → week 15 (2026-04-12 to 2026-04-18)
--   39971813-1daf-4672-96e0-ec6a3265c96a  → week 16 (2026-04-19 to 2026-04-25)
--   855aa948-6ac2-41e9-8f4d-a51395400cc3  → week 18 (2026-05-03 to 2026-05-09)
--
-- Destroyed week IDs (preserved on insert):
--   a7d971a9-ab67-40b0-bb13-8ffd1232e178  → week 15
--   3d5dd53d-4be3-4d9f-be00-ddd058f7766f  → week 16
--   a2bc0659-1939-4922-a59c-ccc10be2809b  → original week 18
--
-- Replacement week 18 to be removed:
--   b207659a-58ab-4d97-9881-3716b8a12c65
--
-- User:
--   4986df07-5f79-4e01-a34e-ca7459b56e9e
--
-- Run as service_role via Supabase Studio SQL Editor or `supabase db query`.
-- File ends in ROLLBACK; — rehearse first, inspect verification output, then
-- change ROLLBACK to COMMIT and re-run for the real recovery.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- STEP 1 — Snapshot the current "fugazi" replacement week 18 as a rollback
-- point. Uses the existing week_snapshot_json helper to capture full state.
-- -----------------------------------------------------------------------------

insert into public.state_snapshots (user_id, snapshot_type, week_id, payload)
select
  user_id,
  'manual_backup',
  id,
  public.week_snapshot_json(user_id, id)
from public.weeks
where id = 'b207659a-58ab-4d97-9881-3716b8a12c65'
  and user_id = '4986df07-5f79-4e01-a34e-ca7459b56e9e';

-- -----------------------------------------------------------------------------
-- STEP 2 — Delete the replacement week 18. FK cascades clear its days,
-- earn_slots, and any auto-imported transactions linked to those days.
-- -----------------------------------------------------------------------------

delete from public.weeks
where id = 'b207659a-58ab-4d97-9881-3716b8a12c65'
  and user_id = '4986df07-5f79-4e01-a34e-ca7459b56e9e';

-- -----------------------------------------------------------------------------
-- STEP 3 — Restore original week 18 from snapshot 855aa948 as ACTIVE.
-- Order: weeks → days → earn_slots → day-attached transactions.
-- Skip unassigned_transactions (still live in public.transactions).
-- -----------------------------------------------------------------------------

-- Week row (override status='active', closed_at=null, archived_at=null)
insert into public.weeks
select (jsonb_populate_record(
  null::public.weeks,
  payload->'discarded_active_week'->'week'
    || '{"status":"active","closed_at":null,"archived_at":null}'::jsonb
)).*
from public.state_snapshots
where id = '855aa948-6ac2-41e9-8f4d-a51395400cc3';

-- Days
insert into public.days
select (jsonb_populate_record(null::public.days, d->'day')).*
from public.state_snapshots,
     jsonb_array_elements(payload->'discarded_active_week'->'days') as d
where id = '855aa948-6ac2-41e9-8f4d-a51395400cc3';

-- Earn slots
insert into public.earn_slots
select (jsonb_populate_record(null::public.earn_slots, slot)).*
from public.state_snapshots,
     jsonb_array_elements(payload->'discarded_active_week'->'days') as d,
     jsonb_array_elements(d->'earn_slots') as slot
where id = '855aa948-6ac2-41e9-8f4d-a51395400cc3';

-- Day-attached transactions (30 rows for week 18)
insert into public.transactions
select (jsonb_populate_record(null::public.transactions, tx)).*
from public.state_snapshots,
     jsonb_array_elements(payload->'discarded_active_week'->'days') as d,
     jsonb_array_elements(d->'transactions') as tx
where id = '855aa948-6ac2-41e9-8f4d-a51395400cc3';

-- -----------------------------------------------------------------------------
-- STEP 4 — Restore week 15 from snapshot da7d3899 as CLOSED.
-- closed_at is set to the snapshot's created_at for ordering parity.
-- 0 day-attached transactions in this snapshot. Unassigned skipped (live).
-- -----------------------------------------------------------------------------

insert into public.weeks
select (jsonb_populate_record(
  null::public.weeks,
  payload->'discarded_active_week'->'week'
    || jsonb_build_object(
         'status', 'closed',
         'closed_at', to_jsonb(created_at),
         'archived_at', null
       )
)).*
from public.state_snapshots
where id = 'da7d3899-3d59-4fb0-aed5-a2594cbb6882';

insert into public.days
select (jsonb_populate_record(null::public.days, d->'day')).*
from public.state_snapshots,
     jsonb_array_elements(payload->'discarded_active_week'->'days') as d
where id = 'da7d3899-3d59-4fb0-aed5-a2594cbb6882';

insert into public.earn_slots
select (jsonb_populate_record(null::public.earn_slots, slot)).*
from public.state_snapshots,
     jsonb_array_elements(payload->'discarded_active_week'->'days') as d,
     jsonb_array_elements(d->'earn_slots') as slot
where id = 'da7d3899-3d59-4fb0-aed5-a2594cbb6882';

-- -----------------------------------------------------------------------------
-- STEP 5 — Restore week 16 from snapshot 39971813 as CLOSED.
-- -----------------------------------------------------------------------------

insert into public.weeks
select (jsonb_populate_record(
  null::public.weeks,
  payload->'discarded_active_week'->'week'
    || jsonb_build_object(
         'status', 'closed',
         'closed_at', to_jsonb(created_at),
         'archived_at', null
       )
)).*
from public.state_snapshots
where id = '39971813-1daf-4672-96e0-ec6a3265c96a';

insert into public.days
select (jsonb_populate_record(null::public.days, d->'day')).*
from public.state_snapshots,
     jsonb_array_elements(payload->'discarded_active_week'->'days') as d
where id = '39971813-1daf-4672-96e0-ec6a3265c96a';

insert into public.earn_slots
select (jsonb_populate_record(null::public.earn_slots, slot)).*
from public.state_snapshots,
     jsonb_array_elements(payload->'discarded_active_week'->'days') as d,
     jsonb_array_elements(d->'earn_slots') as slot
where id = '39971813-1daf-4672-96e0-ec6a3265c96a';

-- =============================================================================
-- VERIFICATION — combined into a single SELECT so every check is returned in
-- one result set (Supabase CLI / Studio surfaces only the last statement).
-- Expected result keys are commented inline below; compare row-by-row.
-- =============================================================================

select ord, check_name, item, result from (
  -- 1. Three weeks restored with correct status / dates.
  --    Expected three rows:
  --      a7d971a9 / 2026-04-12 / closed / has_closed_at=true
  --      3d5dd53d / 2026-04-19 / closed / has_closed_at=true
  --      a2bc0659 / 2026-05-03 / active / has_closed_at=false
  select
    1 as ord,
    'weeks_check' as check_name,
    w.id::text as item,
    (w.start_date::text || ' / ' || w.status::text || ' / has_closed_at=' || (w.closed_at is not null)::text) as result
  from public.weeks w
  where w.id in (
    'a7d971a9-ab67-40b0-bb13-8ffd1232e178',
    '3d5dd53d-4be3-4d9f-be00-ddd058f7766f',
    'a2bc0659-1939-4922-a59c-ccc10be2809b'
  )

  union all

  -- 2. Replacement week 18 is gone (count should be 0).
  select 2, 'replacement_gone', 'b207659a row count',
         count(*)::text
  from public.weeks
  where id = 'b207659a-58ab-4d97-9881-3716b8a12c65'

  union all

  -- 3. Exactly one active week, and it's the restored original 18.
  --    Expected: '1 / a2bc0659-1939-4922-a59c-ccc10be2809b'
  select 3, 'one_active_week', 'count / id',
         count(*)::text || ' / ' || coalesce(max(id::text), 'none')
  from public.weeks
  where user_id = '4986df07-5f79-4e01-a34e-ca7459b56e9e'
    and status = 'active'

  union all

  -- 4. Day counts per restored week. Expected 7 / 7 / 7.
  select 4, 'day_counts', d.week_id::text, count(*)::text
  from public.days d
  where d.week_id in (
    'a7d971a9-ab67-40b0-bb13-8ffd1232e178',
    '3d5dd53d-4be3-4d9f-be00-ddd058f7766f',
    'a2bc0659-1939-4922-a59c-ccc10be2809b'
  )
  group by d.week_id

  union all

  -- 5. Earn slot counts per restored week.
  --    Expected: a7d971a9 / 18, 3d5dd53d / 17, a2bc0659 / 24.
  select 5, 'earn_slot_counts', d.week_id::text, count(*)::text
  from public.earn_slots e
  join public.days d on d.id = e.day_id
  where d.week_id in (
    'a7d971a9-ab67-40b0-bb13-8ffd1232e178',
    '3d5dd53d-4be3-4d9f-be00-ddd058f7766f',
    'a2bc0659-1939-4922-a59c-ccc10be2809b'
  )
  group by d.week_id

  union all

  -- 6. Day-attached transactions per restored week.
  --    Expected: a2bc0659 / 30 (only). Weeks 15 and 16 had 0 day-attached.
  select 6, 'day_tx_counts', d.week_id::text, count(*)::text
  from public.transactions t
  join public.days d on d.id = t.day_id
  where d.week_id in (
    'a7d971a9-ab67-40b0-bb13-8ffd1232e178',
    '3d5dd53d-4be3-4d9f-be00-ddd058f7766f',
    'a2bc0659-1939-4922-a59c-ccc10be2809b'
  )
  group by d.week_id

  union all

  -- 7. Manual backup of the replacement was written. Expected count=1.
  select 7, 'manual_backup_written', 'recent count', count(*)::text
  from public.state_snapshots
  where snapshot_type = 'manual_backup'
    and user_id = '4986df07-5f79-4e01-a34e-ca7459b56e9e'
    and created_at >= now() - interval '2 minutes'
) checks
order by ord, item;

-- =============================================================================
-- If every verification result matches expected, change ROLLBACK to COMMIT
-- and re-run the entire file. Until then, the rehearsal leaves no DB changes.
-- =============================================================================

-- rollback;
commit;
