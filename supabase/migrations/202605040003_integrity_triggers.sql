create or replace function public.prevent_week_date_identity_change()
returns trigger
language plpgsql
as $$
begin
  if old.start_date is distinct from new.start_date
    or old.end_date is distinct from new.end_date then
    raise exception 'Week date identity is immutable. Create a new week instead.';
  end if;

  return new;
end;
$$;

create or replace function public.validate_day_matches_week()
returns trigger
language plpgsql
as $$
declare
  week_start date;
begin
  select w.start_date
    into week_start
  from public.weeks w
  where w.id = new.week_id
    and w.user_id = new.user_id;

  if week_start is null then
    raise exception 'Day references a missing week: %', new.week_id;
  end if;

  if new.date <> week_start + new.day_index then
    raise exception 'Day date % does not match week start % plus day index %',
      new.date, week_start, new.day_index;
  end if;

  return new;
end;
$$;

create or replace function public.validate_paycheck_actual_week2()
returns trigger
language plpgsql
as $$
declare
  week_start date;
begin
  select w.start_date
    into week_start
  from public.weeks w
  where w.id = new.week_id
    and w.user_id = new.user_id;

  if week_start is null then
    raise exception 'Paycheck actual references a missing week: %', new.week_id;
  end if;

  if public.shiftly_display_week_number(week_start) % 2 <> 1 then
    raise exception 'Paycheck actuals must be keyed to week 2 of the pay period. Week starting % is display week %.',
      week_start, public.shiftly_display_week_number(week_start);
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_week_date_identity_change on public.weeks;
create trigger prevent_week_date_identity_change
  before update on public.weeks
  for each row
  execute function public.prevent_week_date_identity_change();

drop trigger if exists validate_day_matches_week on public.days;
create trigger validate_day_matches_week
  before insert or update of week_id, user_id, date, day_index on public.days
  for each row
  execute function public.validate_day_matches_week();

drop trigger if exists validate_paycheck_actual_week2 on public.paycheck_actuals;
create trigger validate_paycheck_actual_week2
  before insert or update of week_id, user_id on public.paycheck_actuals
  for each row
  execute function public.validate_paycheck_actual_week2();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_settings_updated_at on public.settings;
create trigger set_settings_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

drop trigger if exists set_weeks_updated_at on public.weeks;
create trigger set_weeks_updated_at
  before update on public.weeks
  for each row execute function public.set_updated_at();

drop trigger if exists set_days_updated_at on public.days;
create trigger set_days_updated_at
  before update on public.days
  for each row execute function public.set_updated_at();

drop trigger if exists set_earn_slots_updated_at on public.earn_slots;
create trigger set_earn_slots_updated_at
  before update on public.earn_slots
  for each row execute function public.set_updated_at();

drop trigger if exists set_weekly_templates_updated_at on public.weekly_templates;
create trigger set_weekly_templates_updated_at
  before update on public.weekly_templates
  for each row execute function public.set_updated_at();

drop trigger if exists set_template_slots_updated_at on public.template_slots;
create trigger set_template_slots_updated_at
  before update on public.template_slots
  for each row execute function public.set_updated_at();

drop trigger if exists set_sticky_labels_updated_at on public.sticky_labels;
create trigger set_sticky_labels_updated_at
  before update on public.sticky_labels
  for each row execute function public.set_updated_at();

drop trigger if exists set_expenses_updated_at on public.expenses;
create trigger set_expenses_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

drop trigger if exists set_plaid_items_updated_at on public.plaid_items;
create trigger set_plaid_items_updated_at
  before update on public.plaid_items
  for each row execute function public.set_updated_at();

drop trigger if exists set_transactions_updated_at on public.transactions;
create trigger set_transactions_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

drop trigger if exists set_transaction_exemption_rules_updated_at on public.transaction_exemption_rules;
create trigger set_transaction_exemption_rules_updated_at
  before update on public.transaction_exemption_rules
  for each row execute function public.set_updated_at();

drop trigger if exists set_week_projection_exclusions_updated_at on public.week_projection_exclusions;
create trigger set_week_projection_exclusions_updated_at
  before update on public.week_projection_exclusions
  for each row execute function public.set_updated_at();

drop trigger if exists set_paycheck_actuals_updated_at on public.paycheck_actuals;
create trigger set_paycheck_actuals_updated_at
  before update on public.paycheck_actuals
  for each row execute function public.set_updated_at();

drop trigger if exists set_debts_updated_at on public.debts;
create trigger set_debts_updated_at
  before update on public.debts
  for each row execute function public.set_updated_at();

drop trigger if exists set_assets_updated_at on public.assets;
create trigger set_assets_updated_at
  before update on public.assets
  for each row execute function public.set_updated_at();
