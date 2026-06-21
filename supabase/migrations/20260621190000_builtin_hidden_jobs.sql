-- Lets a user "delete" a built-in job (Ability / Prestige / Prestige ILST) from
-- the UI. This is a DISPLAY/picker hide only: the job type still exists, all past
-- shifts keep their earnings, and the paycheck model is untouched. Hidden keys
-- simply drop out of the shift/template job pickers and the net bar.
alter table public.settings
  add column if not exists hidden_builtin_jobs text[] not null default '{}';
