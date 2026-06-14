-- Archive the removed Projects feature data outside the public app schema.
-- This intentionally preserves rows for recovery while removing the tables
-- from the app-facing public schema.

create schema if not exists archived_projects;

revoke all on schema archived_projects from anon;
revoke all on schema archived_projects from authenticated;
revoke all on schema archived_projects from public;

alter table if exists public.chat_usage_log set schema archived_projects;
alter table if exists public.weekly_reflections set schema archived_projects;
alter table if exists public.task_tags set schema archived_projects;
alter table if exists public.project_events set schema archived_projects;
alter table if exists public.tags set schema archived_projects;
alter table if exists public.tasks set schema archived_projects;
alter table if exists public.projects set schema archived_projects;

comment on schema archived_projects is
  'Archived ShiftlyCash Projects feature tables moved out of public schema on 2026-06-13.';
