-- Forbid cross-user custom_job_id references at the database level. The original
-- FK was column-only (custom_job_id -> custom_jobs.id); FK enforcement runs as
-- table owner (bypassing RLS), so a slot could point at ANOTHER user's custom
-- job. It priced as $0 (every read re-scopes the join by user_id), but it still
-- stored a cross-user reference with no error. Swap to a composite FK
-- (custom_job_id, user_id) -> custom_jobs(id, user_id) so the database itself
-- rejects foreign references.
--
-- MATCH SIMPLE (Postgres default): a NULL custom_job_id skips the check, so
-- non-custom slots (custom_job_id IS NULL) are completely unaffected. There are
-- currently no custom rows in earn_slots/template_slots, so there is nothing to
-- revalidate and no past earning can move.

create unique index if not exists custom_jobs_id_user_idx
  on public.custom_jobs (id, user_id);

alter table public.earn_slots
  drop constraint if exists earn_slots_custom_job_id_fkey;
alter table public.earn_slots
  add constraint earn_slots_custom_job_id_fkey
  foreign key (custom_job_id, user_id)
  references public.custom_jobs (id, user_id)
  on delete restrict;

alter table public.template_slots
  drop constraint if exists template_slots_custom_job_id_fkey;
alter table public.template_slots
  add constraint template_slots_custom_job_id_fkey
  foreign key (custom_job_id, user_id)
  references public.custom_jobs (id, user_id)
  on delete restrict;
