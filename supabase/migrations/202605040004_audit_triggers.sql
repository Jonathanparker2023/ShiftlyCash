create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_row jsonb;
  new_row jsonb;
  audit_user_id uuid;
  audit_row_id uuid;
  audit_actor text;
begin
  old_row := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_row := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;

  audit_user_id := coalesce(
    (new_row ->> 'user_id')::uuid,
    (old_row ->> 'user_id')::uuid
  );

  audit_row_id := coalesce(
    (new_row ->> 'id')::uuid,
    (old_row ->> 'id')::uuid
  );

  audit_actor := coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claim.role', true), ''),
    current_user
  );

  insert into public.audit_log (
    user_id,
    table_name,
    row_id,
    action,
    old_values,
    new_values,
    actor
  )
  values (
    audit_user_id,
    tg_table_name,
    audit_row_id,
    tg_op,
    old_row,
    new_row,
    audit_actor
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists audit_weeks_changes on public.weeks;
create trigger audit_weeks_changes
  after insert or update or delete on public.weeks
  for each row
  execute function public.audit_row_change();

drop trigger if exists audit_days_changes on public.days;
create trigger audit_days_changes
  after insert or update or delete on public.days
  for each row
  execute function public.audit_row_change();

drop trigger if exists audit_earn_slots_changes on public.earn_slots;
create trigger audit_earn_slots_changes
  after insert or update or delete on public.earn_slots
  for each row
  execute function public.audit_row_change();

drop trigger if exists audit_transactions_changes on public.transactions;
create trigger audit_transactions_changes
  after insert or update or delete on public.transactions
  for each row
  execute function public.audit_row_change();
