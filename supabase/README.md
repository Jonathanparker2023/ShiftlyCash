# Bashflow Database Layer

This folder contains the Supabase/Postgres schema for the Bashflow rebuild. It is intentionally database-only: no Next.js app code, no Firebase writes, and no live state mutation.

## Migration Files

| File | Purpose |
| --- | --- |
| `202605040001_foundations.sql` | Extensions, enums, helper functions, display week-number derivation |
| `202605040002_tables.sql` | All relational tables, constraints, indexes |
| `202605040003_integrity_triggers.sql` | Immutable week identity, day/date validation, paycheck wk2 validation, `updated_at` triggers |
| `202605040004_audit_triggers.sql` | Automatic `audit_log` triggers for `weeks`, `days`, `earn_slots`, `transactions` |
| `202605040005_views.sql` | Token-safe Plaid metadata view, day/week totals, projections, pending transactions, baseline totals |
| `202605040006_rls_policies.sql` | Row Level Security policies and grants |
| `202605040007_bootstrap_defaults.sql` | Magic-link user bootstrap defaults: profile, settings, default weekly template, exemption rules |
| `202605040008_dashboard_week_rpc.sql` | Authenticated RPC to create or reuse the current active week and its 7 day rows |
| `202605040009_template_application.sql` | Template application RPCs, sticky-label overlay, and default-template replacement |
| `202605040010_auto_template_and_sticky_labels.sql` | Auto-applies template on dashboard load and backfills seeded sticky labels for existing users |
| `202605040011_baseline_expenses.sql` | Seeds baseline expenses, adds unique expense names, and backfills existing users |
| `20260902184000_finance_audit_delta.sql` | Separates issuer minimums from scheduled payments, adds Prosper, and applies the verified September finance-audit delta |
| `20260902185500_auto_loan_cashflow_separation.sql` | Removes loan accruals from fixed cashflow, records TD payoff-pending state, and schedules the replacement Tesla on contractual due dates |
| `20260902191000_auto_loan_cashflow_transactions.sql` | Counts posted auto-loan debits in cashflow while excluding principal transfers from consumption spending |

## Local Setup

Install the Supabase CLI, then from the repository root:

```powershell
supabase init
supabase start
supabase db reset
```

`supabase db reset` rebuilds the local database from the migration files in `supabase/migrations`.

## Apply To A Fresh Live Supabase Project

Create the Supabase project first, then link and push:

```powershell
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

Review the SQL diff that Supabase prints before confirming. Do not run this against a project that already contains production Bashflow data.

## Magic-Link Bootstrap

When a user signs in through Supabase Auth, the `on_auth_user_created` trigger calls:

```sql
select public.bootstrap_user_defaults('<user-id>', '<email>');
```

That creates:

- one `profiles` row
- one `settings` row with spec defaults
- one default `weekly_templates` row
- default `template_slots` from the TMPL schedule
- default transaction exemption rules from the legacy hardcoded constants

If you create the auth user before applying these migrations, run `bootstrap_user_defaults` manually for that user.

## Safety Model

- Week identity is `(user_id, start_date)`.
- `weeks.start_date` and `weeks.end_date` are immutable after insert.
- Only one active week can exist per user.
- `days.date` must equal `weeks.start_date + day_index`.
- Running balance is not stored. It is computed in `v_week_totals` with a window function.
- Plaid access tokens are stored only in `plaid_items.access_token_encrypted`, and authenticated clients are not granted table access.
- Clients read token-free Plaid metadata through `plaid_item_metadata`.
- `audit_log` is populated automatically for all inserts, updates, and deletes on `weeks`, `days`, `earn_slots`, and `transactions`.
- Settings rates are joined into earnings views at query time. Changing pay or withholding settings will retroactively recalculate historical earnings in views. This is intentional for v1; frozen historical rates can be added later with rate snapshots or rate history.
- `public.weeks_per_month()` returns `4.33` for baseline monthly-to-weekly conversion so the value is centralized.

## Future Unit Test Notes

When the TypeScript test runner exists, add coverage for:

- `shiftly_display_week_number` for dates before the first Sunday of a year.
- Cross-year weeks such as a Sunday start on December 28 with an end date on January 3.
- Projection views excluding rows where `weeks.archived_at is not null`.

## Required Snapshot Behavior For Future App Code

Any server-side operation that touches multiple weeks must run in one transaction and insert a `state_snapshots` row first. This includes:

- week close
- history edit
- week reopen
- year close
- migration import

The database provides the table; the server action or migration script is responsible for creating the snapshot before changing rows.

## Template And Sticky Label Rules

The default `weekly_templates` data stores only job type, pay type, and hours. It does not store labels.

When app code builds a new week:

1. Copy the user's default `template_slots` into `earn_slots`.
2. Pad missing day slots as `job_type='none'`.
3. Overlay `sticky_labels` by `(day_index, slot_index)`.

During Firebase migration, if `lastLabels` is missing, derive sticky labels from the current week's earn-slot labels.

## Migration Import Rules

The future Firebase import script should default to a JSON file exported from Firebase Console:

1. Open Firebase Console.
2. Go to Realtime Database.
3. Select the database root or target path.
4. Use the three-dot menu.
5. Choose **Export JSON**.

Live Firebase fetch can exist as a convenience mode, but JSON file mode should be the default because it is repeatable and reviewable.

Before any apply-mode import, the script must write the raw source to:

```text
./backups/migration-source-{ISO_TIMESTAMP}.json
```

The import should default to `--dry-run`; actual writes should require `--apply`.

Apply-mode import requirements:

- Abort if the disk backup write fails.
- Require a valid Supabase authenticated user session before importing.
- Use `auth.uid()` as the `user_id` for all imported rows.
- Import legacy Plaid tokens only as encrypted records with `status='login_required'`.
- Wrap each table phase in a Postgres `SAVEPOINT` so one malformed table does not discard already-imported earlier phases.
- After import, compare imported week earnings, spend, base, cashflow, and transaction totals against Firebase source totals.
- Add verification deltas greater than one dollar to `migration_review_items` with `severity='warning'`.

## Sanity Queries

After applying migrations locally, sign in or create a test auth user, then run:

```sql
select * from public.settings;
select * from public.weekly_templates;
select day_index, slot_index, job_type, pay_type, hours_or_units
from public.template_slots
order by day_index, slot_index;
select * from public.v_week_totals;
select * from public.audit_log order by created_at desc limit 20;
```

For a real migration verification pass, compare legacy Firebase week totals to:

```sql
select
  display_week_number,
  start_date,
  end_date,
  earnings_total,
  spend_total,
  base_total,
  cashflow_total,
  running_balance
from public.v_week_totals
order by start_date;
```
