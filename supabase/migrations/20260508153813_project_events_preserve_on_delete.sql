alter table public.project_events
  drop constraint if exists project_events_project_id_fkey;

alter table public.project_events
  alter column project_id drop not null;

alter table public.project_events
  add constraint project_events_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete set null;
