create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  ability_regular_net_rate numeric(10, 2) not null default 15.63,
  ability_ot_net_rate numeric(10, 2) not null default 21.73,
  prestige_regular_net_rate numeric(10, 2) not null default 14.28,
  prestige_ot_net_rate numeric(10, 2) not null default 21.42,
  incentive_net_multiplier numeric(8, 4) not null default 0.7348,
  ability_withholding_rate numeric(7, 4) not null default 0.2652,
  prestige_withholding_rate numeric(7, 4) not null default 0.1800,
  incentive_withholding_rate numeric(7, 4) not null default 0.2652,
  filing_fee numeric(10, 2) not null default 160.00,
  standard_deduction numeric(10, 2) not null default 15000.00,
  default_base_sun_fri numeric(10, 2) not null default 52.00,
  default_base_sat numeric(10, 2) not null default 57.00,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_rate_bounds check (
    ability_regular_net_rate >= 0
    and ability_ot_net_rate >= 0
    and prestige_regular_net_rate >= 0
    and prestige_ot_net_rate >= 0
    and incentive_net_multiplier >= 0
    and ability_withholding_rate >= 0 and ability_withholding_rate < 1
    and prestige_withholding_rate >= 0 and prestige_withholding_rate < 1
    and incentive_withholding_rate >= 0 and incentive_withholding_rate < 1
  )
);

create table if not exists public.weeks (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  status public.week_status not null default 'active',
  closed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weeks_valid_range check (end_date = start_date + 6),
  constraint weeks_start_is_sunday check (extract(dow from start_date) = 0),
  constraint weeks_end_is_saturday check (extract(dow from end_date) = 6),
  constraint weeks_archived_must_be_closed check (archived_at is null or status = 'closed')
);

create unique index if not exists weeks_user_start_unique
  on public.weeks(user_id, start_date);

create unique index if not exists weeks_id_user_unique
  on public.weeks(id, user_id);

create unique index if not exists weeks_one_active_per_user
  on public.weeks(user_id)
  where status = 'active';

create index if not exists weeks_user_status_idx
  on public.weeks(user_id, status);

create index if not exists weeks_user_start_idx
  on public.weeks(user_id, start_date desc);

create index if not exists weeks_user_archived_idx
  on public.weeks(user_id, archived_at)
  where archived_at is not null;

create table if not exists public.days (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_id uuid not null,
  date date not null,
  day_index integer not null,
  base_amount numeric(10, 2) not null default 0,
  manual_spend_adjustment numeric(10, 2) not null default 0,
  spend_locked boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint days_valid_index check (day_index between 0 and 6),
  constraint days_week_fk foreign key (week_id, user_id)
    references public.weeks(id, user_id) on delete cascade
);

create unique index if not exists days_id_user_unique
  on public.days(id, user_id);

create unique index if not exists days_week_day_unique
  on public.days(week_id, day_index);

create unique index if not exists days_week_date_unique
  on public.days(week_id, date);

create index if not exists days_user_date_idx
  on public.days(user_id, date);

create table if not exists public.earn_slots (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_id uuid not null,
  slot_index integer not null,
  job_type public.job_type not null default 'none',
  pay_type public.pay_type not null default 'none',
  hours_or_units numeric(8, 2) not null default 0,
  label text,
  source public.earn_slot_source not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint earn_slots_day_fk foreign key (day_id, user_id)
    references public.days(id, user_id) on delete cascade,
  constraint earn_slots_valid_slot check (slot_index between 0 and 3),
  constraint earn_slots_non_negative_hours check (hours_or_units >= 0)
);

create unique index if not exists earn_slots_day_slot_unique
  on public.earn_slots(day_id, slot_index);

create index if not exists earn_slots_user_idx
  on public.earn_slots(user_id);

create table if not exists public.weekly_templates (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists weekly_templates_one_default_per_user
  on public.weekly_templates(user_id)
  where is_default;

create index if not exists weekly_templates_user_idx
  on public.weekly_templates(user_id);

create unique index if not exists weekly_templates_id_user_unique
  on public.weekly_templates(id, user_id);

create table if not exists public.template_slots (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  template_id uuid not null,
  day_index integer not null,
  slot_index integer not null,
  job_type public.job_type not null,
  pay_type public.pay_type not null,
  hours_or_units numeric(8, 2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint template_slots_template_same_user_fk foreign key (template_id, user_id)
    references public.weekly_templates(id, user_id) on delete cascade,
  constraint template_slots_valid_day check (day_index between 0 and 6),
  constraint template_slots_valid_slot check (slot_index between 0 and 3),
  constraint template_slots_non_negative_hours check (hours_or_units >= 0)
);

create unique index if not exists template_slots_template_day_slot_unique
  on public.template_slots(template_id, day_index, slot_index);

create index if not exists template_slots_user_idx
  on public.template_slots(user_id);

create table if not exists public.sticky_labels (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_index integer not null,
  slot_index integer not null,
  label text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, day_index, slot_index),
  constraint sticky_labels_valid_day check (day_index between 0 and 6),
  constraint sticky_labels_valid_slot check (slot_index between 0 and 3)
);

create table if not exists public.expenses (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  amount numeric(10, 2) not null default 0,
  expiration_date date,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_non_negative_amount check (amount >= 0)
);

create index if not exists expenses_user_active_idx
  on public.expenses(user_id, is_active);

create index if not exists expenses_user_expiration_idx
  on public.expenses(user_id, expiration_date);

create table if not exists public.plaid_items (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plaid_item_id text,
  access_token_encrypted text,
  cursor text,
  institution_name text,
  status public.plaid_item_status not null default 'login_required',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists plaid_items_user_item_unique
  on public.plaid_items(user_id, plaid_item_id)
  where plaid_item_id is not null;

create unique index if not exists plaid_items_id_user_unique
  on public.plaid_items(id, user_id);

create index if not exists plaid_items_user_status_idx
  on public.plaid_items(user_id, status);

create table if not exists public.transactions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day_id uuid,
  plaid_item_id uuid,
  source public.transaction_source not null,
  status public.transaction_status not null default 'applied',
  review_reason text,
  plaid_transaction_id text,
  import_key text,
  date date not null,
  authorized_date date,
  datetime timestamptz,
  legacy_time text,
  merchant_name text not null,
  raw_name text,
  amount numeric(10, 2) not null,
  category text,
  pending boolean not null default false,
  excluded_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_day_fk foreign key (day_id, user_id)
    references public.days(id, user_id) on delete cascade,
  constraint transactions_plaid_item_same_user_fk foreign key (plaid_item_id, user_id)
    references public.plaid_items(id, user_id),
  constraint transactions_applied_requires_day check (
    status <> 'applied' or day_id is not null
  ),
  constraint transactions_excluded_has_timestamp check (
    status <> 'excluded' or excluded_at is not null
  ),
  constraint transactions_pending_review_has_reason check (
    status <> 'pending_review' or review_reason is not null
  )
);

create unique index if not exists transactions_id_user_unique
  on public.transactions(id, user_id);

create unique index if not exists transactions_plaid_unique
  on public.transactions(user_id, plaid_transaction_id)
  where plaid_transaction_id is not null;

create unique index if not exists transactions_import_key_unique
  on public.transactions(user_id, source, import_key)
  where import_key is not null;

create index if not exists transactions_user_date_idx
  on public.transactions(user_id, date desc);

create index if not exists transactions_day_idx
  on public.transactions(day_id);

create index if not exists transactions_status_idx
  on public.transactions(user_id, status);

create index if not exists transactions_plaid_item_idx
  on public.transactions(plaid_item_id);

create table if not exists public.transaction_exemption_rules (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  rule_type public.transaction_rule_type not null,
  value text not null,
  source text not null default 'user',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists transaction_exemption_rules_unique_lower
  on public.transaction_exemption_rules(user_id, rule_type, lower(value));

create index if not exists transaction_exemption_rules_lookup_idx
  on public.transaction_exemption_rules(user_id, rule_type, is_active);

create table if not exists public.week_projection_exclusions (
  week_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  exclude_earnings boolean not null default false,
  exclude_spend boolean not null default false,
  exclude_cashflow boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint week_projection_exclusions_week_fk foreign key (week_id, user_id)
    references public.weeks(id, user_id) on delete cascade
);

create table if not exists public.paycheck_actuals (
  week_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  ability_actual_amount numeric(10, 2),
  prestige_actual_amount numeric(10, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paycheck_actuals_week_fk foreign key (week_id, user_id)
    references public.weeks(id, user_id) on delete cascade
);

create index if not exists paycheck_actuals_user_idx
  on public.paycheck_actuals(user_id);

create table if not exists public.debts (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  balance numeric(12, 2) not null default 0,
  minimum_payment numeric(10, 2) not null default 0,
  apr numeric(7, 4) not null default 0,
  status public.debt_status not null default 'active',
  priority_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint debts_non_negative_values check (balance >= 0 and minimum_payment >= 0 and apr >= 0)
);

create index if not exists debts_user_status_idx
  on public.debts(user_id, status);

create index if not exists debts_user_priority_idx
  on public.debts(user_id, priority_order);

create unique index if not exists debts_id_user_unique
  on public.debts(id, user_id);

create table if not exists public.assets (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  linked_debt_id uuid,
  name text not null,
  value numeric(12, 2) not null default 0,
  depreciation_rate numeric(7, 4) not null default 0,
  category public.asset_category not null default 'other',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assets_linked_debt_same_user_fk foreign key (linked_debt_id, user_id)
    references public.debts(id, user_id),
  constraint assets_non_negative_values check (value >= 0 and depreciation_rate >= 0)
);

create index if not exists assets_user_category_idx
  on public.assets(user_id, category);

create index if not exists assets_linked_debt_idx
  on public.assets(linked_debt_id);

create table if not exists public.ai_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_id uuid not null,
  review_type public.ai_review_type not null,
  text text not null,
  audio_storage_path text,
  audio_expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ai_reviews_week_fk foreign key (week_id, user_id)
    references public.weeks(id, user_id) on delete cascade
);

create unique index if not exists ai_reviews_week_type_unique
  on public.ai_reviews(week_id, review_type);

create index if not exists ai_reviews_audio_expiry_idx
  on public.ai_reviews(audio_expires_at)
  where audio_expires_at is not null;

create table if not exists public.email_backups (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_id uuid not null,
  recipient_email text not null,
  subject text not null,
  body text not null,
  provider text not null default 'resend',
  provider_message_id text,
  status public.email_backup_status not null,
  error_message text,
  created_at timestamptz not null default now(),
  constraint email_backups_week_fk foreign key (week_id, user_id)
    references public.weeks(id, user_id) on delete cascade
);

create unique index if not exists email_backups_user_week_unique
  on public.email_backups(user_id, week_id);

create table if not exists public.state_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  snapshot_type public.snapshot_type not null,
  week_id uuid references public.weeks(id) on delete set null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists state_snapshots_user_created_idx
  on public.state_snapshots(user_id, created_at desc);

create table if not exists public.migration_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null default 'firebase',
  source_path text,
  mode text not null default 'dry-run',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status public.migration_status not null default 'running',
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  constraint migration_runs_mode_check check (mode in ('dry-run', 'apply'))
);

create index if not exists migration_runs_user_started_idx
  on public.migration_runs(user_id, started_at desc);

create table if not exists public.migration_identity_map (
  id uuid primary key default extensions.gen_random_uuid(),
  migration_run_id uuid references public.migration_runs(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null,
  legacy_path text,
  legacy_id text not null,
  target_table text not null,
  target_id uuid not null,
  created_at timestamptz not null default now()
);

create unique index if not exists migration_identity_map_unique
  on public.migration_identity_map(user_id, source, target_table, legacy_id);

create index if not exists migration_identity_map_run_idx
  on public.migration_identity_map(migration_run_id);

create table if not exists public.migration_review_items (
  id uuid primary key default extensions.gen_random_uuid(),
  migration_run_id uuid references public.migration_runs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  severity public.review_severity not null default 'warning',
  category text not null,
  source_path text,
  source_payload jsonb,
  message text not null,
  resolution_status public.review_resolution_status not null default 'open',
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists migration_review_items_user_status_idx
  on public.migration_review_items(user_id, resolution_status, severity);

create index if not exists migration_review_items_run_idx
  on public.migration_review_items(migration_run_id);

create table if not exists public.audit_log (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  table_name text not null,
  row_id uuid,
  action text not null,
  old_values jsonb,
  new_values jsonb,
  actor text not null default current_user,
  created_at timestamptz not null default now(),
  constraint audit_log_action_check check (action in ('INSERT', 'UPDATE', 'DELETE'))
);

create index if not exists audit_log_user_created_idx
  on public.audit_log(user_id, created_at desc);

create index if not exists audit_log_table_row_idx
  on public.audit_log(table_name, row_id, created_at desc);
