# Firebase Import

Use this for the one-time legacy Firebase Realtime Database import. The importer is intentionally conservative:

- `--dry-run` is the default and writes nothing to Supabase.
- `--apply` is required before any database writes happen.
- The raw source JSON is copied to `./backups/migration-source-{timestamp}.json` before parsing.
- Import reports can be written to `./reports/*.json`.
- Imported rows are idempotent through stable `import_key` values and `migration_identity_map`.

## Export Firebase JSON

1. Open Firebase Console.
2. Go to Realtime Database.
3. Use the three-dot menu.
4. Choose **Export JSON**.
5. Save the file somewhere local, for example `C:\Users\jay1p\Downloads\shiftly-export.json`.

JSON file import is safer than live fetch because it is repeatable and can be inspected before apply.

## Environment

`.env.local` needs the normal Supabase URL plus a local-only service role key for apply mode:

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` in browser code, screenshots, commits, or production client env.

## Dry Run

```powershell
cd "C:\Users\jay1p\OneDrive\Documents\New project\shiftlycash"
npm run import:firebase -- --file "C:\Users\jay1p\Downloads\shiftly-export.json" --dry-run --report ".\reports\firebase-dry-run.json"
```

Dry run prints:

- number of weeks, days, earn slots, day transactions, and cached transactions found
- backup file path
- review queue preview
- verification deltas where imported totals differ from source totals by more than `$1`

## Apply

Apply requires a Supabase auth user so imported rows attach to the right `user_id`.

```powershell
npm run import:firebase -- --file "C:\Users\jay1p\Downloads\shiftly-export.json" --apply --user-email "you@example.com" --report ".\reports\firebase-apply.json"
```

You can use `--user-id <uuid>` instead of `--user-email` if needed.

## What Gets Imported

- `users/{uid}/shiftly` week-like records from `activeWeek`, `currentWeek`, `current`, `history`, `historyData`, `weeks`, `closedWeeks`, `weekHistory`, and `yearHistory[].historyData`
- days from `days`, `daysMeta`, `dailyData`, `dayData`, or `entries`
- earn slots from `earns`, `earnSlots`, `shifts`, or `slots`
- day transaction logs from `txLog`, `transactions`, or `transactionLog`
- cached Plaid-like transactions from `shiftboard/cached_transactions`

Weeks are keyed by immutable ISO `start_date`. If the export contains the current week and that week already exists in Supabase, the importer updates that week instead of creating a duplicate.

## Review Queue

Malformed, ambiguous, duplicate, or mismatched data becomes a review item. Nothing is silently thrown away.

Common categories:

- `missing_week_date`: no Sunday start date could be found
- `duplicate_week`: two source records mapped to the same ISO week
- `duplicate_day`: two source records mapped to the same day
- `malformed_slot`: an earn slot could not be parsed
- `extra_slot`: legacy day had more than the 4 supported slot rows
- `malformed_transaction`: transaction missing date, amount, or merchant
- `verification_delta`: imported totals differ from source totals by more than `$1`

## Live Firebase Fetch

Prefer JSON export. If you need live fetch:

```powershell
npm run import:firebase -- --firebase-url "https://PROJECT.firebaseio.com" --firebase-token "TOKEN" --dry-run
```

The importer appends `.json` automatically.
