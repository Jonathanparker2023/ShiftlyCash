alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.weeks enable row level security;
alter table public.days enable row level security;
alter table public.earn_slots enable row level security;
alter table public.weekly_templates enable row level security;
alter table public.template_slots enable row level security;
alter table public.sticky_labels enable row level security;
alter table public.expenses enable row level security;
alter table public.plaid_items enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_exemption_rules enable row level security;
alter table public.week_projection_exclusions enable row level security;
alter table public.paycheck_actuals enable row level security;
alter table public.debts enable row level security;
alter table public.assets enable row level security;
alter table public.ai_reviews enable row level security;
alter table public.email_backups enable row level security;
alter table public.state_snapshots enable row level security;
alter table public.migration_runs enable row level security;
alter table public.migration_identity_map enable row level security;
alter table public.migration_review_items enable row level security;
alter table public.audit_log enable row level security;

grant usage on schema public to authenticated;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.settings to authenticated;
grant select, insert, update, delete on public.weeks to authenticated;
grant select, insert, update, delete on public.days to authenticated;
grant select, insert, update, delete on public.earn_slots to authenticated;
grant select, insert, update, delete on public.weekly_templates to authenticated;
grant select, insert, update, delete on public.template_slots to authenticated;
grant select, insert, update, delete on public.sticky_labels to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.transaction_exemption_rules to authenticated;
grant select, insert, update, delete on public.week_projection_exclusions to authenticated;
grant select, insert, update, delete on public.paycheck_actuals to authenticated;
grant select, insert, update, delete on public.debts to authenticated;
grant select, insert, update, delete on public.assets to authenticated;
grant select on public.ai_reviews to authenticated;
grant select on public.email_backups to authenticated;
grant select, insert, update, delete on public.state_snapshots to authenticated;
grant select, insert, update, delete on public.migration_runs to authenticated;
grant select, insert, update, delete on public.migration_identity_map to authenticated;
grant select, insert, update, delete on public.migration_review_items to authenticated;
grant select on public.audit_log to authenticated;

grant select on public.plaid_item_metadata to authenticated;
grant select on public.v_day_totals to authenticated;
grant select on public.v_week_totals to authenticated;
grant select on public.v_projection_weeks to authenticated;
grant select on public.v_pending_transactions to authenticated;
grant select on public.v_active_expense_totals to authenticated;

revoke all on public.plaid_items from anon, authenticated;
revoke all on public.audit_log from anon;
revoke insert, update, delete on public.audit_log from authenticated;

create policy profiles_select_own
  on public.profiles for select
  using (id = auth.uid());

create policy profiles_insert_own
  on public.profiles for insert
  with check (id = auth.uid());

create policy profiles_update_own
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy settings_own
  on public.settings for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy weeks_own
  on public.weeks for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy days_own
  on public.days for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy earn_slots_own
  on public.earn_slots for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy weekly_templates_own
  on public.weekly_templates for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy template_slots_own
  on public.template_slots for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy sticky_labels_own
  on public.sticky_labels for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy expenses_own
  on public.expenses for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy transactions_own
  on public.transactions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy transaction_exemption_rules_own
  on public.transaction_exemption_rules for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy week_projection_exclusions_own
  on public.week_projection_exclusions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy paycheck_actuals_own
  on public.paycheck_actuals for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy debts_own
  on public.debts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy assets_own
  on public.assets for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy ai_reviews_select_own
  on public.ai_reviews for select
  using (user_id = auth.uid());

create policy email_backups_select_own
  on public.email_backups for select
  using (user_id = auth.uid());

create policy state_snapshots_own
  on public.state_snapshots for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy migration_runs_own
  on public.migration_runs for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy migration_identity_map_own
  on public.migration_identity_map for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy migration_review_items_own
  on public.migration_review_items for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy audit_log_select_own
  on public.audit_log for select
  using (user_id = auth.uid());
