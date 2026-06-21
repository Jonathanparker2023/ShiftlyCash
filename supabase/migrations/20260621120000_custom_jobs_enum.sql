-- Custom jobs: step 1 of 2 — add the 'custom' job_type enum value.
-- ALTER TYPE ... ADD VALUE is non-transactional in Postgres and cannot be used
-- in the same migration/transaction that later REFERENCES the new value, so this
-- file contains ONLY the enum add. The table/FK/view changes are in the next
-- migration (20260621120100). idempotent.
alter type public.job_type add value if not exists 'custom';
