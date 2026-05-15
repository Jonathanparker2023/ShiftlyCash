alter table public.settings
  add column if not exists age integer check (age is null or (age >= 13 and age <= 100)),
  add column if not exists sex text check (sex is null or sex in ('male','female')),
  add column if not exists height_cm numeric check (height_cm is null or (height_cm > 100 and height_cm < 260)),
  add column if not exists activity_level text check (activity_level is null or activity_level in ('sedentary','light','moderate','very','athlete')) default 'sedentary',
  add column if not exists current_phase text check (current_phase is null or current_phase in ('cut','maintain','bulk','recomp')),
  add column if not exists goals_text text,
  add column if not exists health_flags text[] not null default '{}'::text[];
