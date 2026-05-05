alter table public.expenses
  add column if not exists withdrawal_day smallint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.expenses'::regclass
      and conname = 'expenses_withdrawal_day_range'
  ) then
    alter table public.expenses
      add constraint expenses_withdrawal_day_range
      check (withdrawal_day is null or withdrawal_day between 1 and 31);
  end if;
end $$;

create index if not exists expenses_user_withdrawal_day_idx
  on public.expenses(user_id, withdrawal_day);
