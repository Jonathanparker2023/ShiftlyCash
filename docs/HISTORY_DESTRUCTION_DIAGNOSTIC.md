# History Destruction Diagnostic

Generated: 2026-05-07

Scope: read-only assessment of `reopen_week` destruction, current `weeks` state, available `week_reopen` snapshots, and recovery feasibility. No production rows, tables, RPCs, or migrations were modified.

## 1. Tooling Versions And Current Branch

| Item | Value |
|---|---|
| Node | `v24.14.0` |
| Supabase CLI | `2.98.2` |
| Starting branch | `shiftlycash-next` |
| Starting HEAD | `ee02ad8522059e5ef2d728207b7336e1ae82f7b7` |
| Diagnostic branch | `shiftlycash-diagnostic-history` |
| Linked Supabase project | `Jonathanparker2023's Project` / `jrjcajeaduofkhaquzuk` |

Working tree note: unrelated local edits were present before this diagnostic began. They were not altered for this report.

## 2. Code Paths Confirmed Present

The destructive path is present in `supabase/migrations/202605040014_week_close_history.sql`.

Relevant code path:

```sql
insert into public.state_snapshots (
  user_id,
  snapshot_type,
  week_id,
  payload
)
values (
  v_user_id,
  'week_reopen',
  v_active_week.id,
  jsonb_build_object(
    'discarded_active_week', public.week_snapshot_json(v_user_id, v_active_week.id),
    'reopened_week', public.week_snapshot_json(v_user_id, v_target_week.id)
  )
);

delete from public.weeks
where id = v_active_week.id
  and user_id = v_user_id;
```

`git grep` hits:

| Search | Hits |
|---|---|
| `delete from public.weeks` | `supabase/migrations/202605040014_week_close_history.sql:224` |
| `week_reopen` snapshot enum/type | `supabase/migrations/202605040001_foundations.sql:83`, `supabase/migrations/202605040014_week_close_history.sql:216` |
| RPC definition | `supabase/migrations/202605040014_week_close_history.sql:168` |
| RPC grant | `supabase/migrations/202605040014_week_close_history.sql:241` |
| Server Action | `src/app/(protected)/history/actions.ts:96` |
| History list caller | `src/components/history/HistoryTable.tsx:82` |
| History detail caller | `src/components/history/ReopenWeekButton.tsx:34` |

Conclusion: each reopen snapshots the current active week, then hard-deletes that active week through the `weeks` table. Related rows are then subject to FK cascade.

## 3. Currently Existing Weeks

Current aggregate:

| Active | Closed | Archived (`archived_at is not null`) | Earliest | Latest |
|---:|---:|---:|---|---|
| 1 | 15 | 0 | 2026-01-04 | 2026-05-09 |

Current `weeks` / `v_week_totals` inventory:

| Display # | Date Range | Status | Closed At | Week ID |
|---:|---|---|---|---|
| 1 | 2026-01-04 to 2026-01-10 | closed | 2026-05-04 21:52:29 UTC | `2c9884a8-49ef-4447-8618-18cc2dc1ab97` |
| 2 | 2026-01-11 to 2026-01-17 | closed | 2026-05-04 21:52:29 UTC | `8e61cd4a-b450-4615-9f5b-1d40e9902a69` |
| 3 | 2026-01-18 to 2026-01-24 | closed | 2026-05-04 21:52:29 UTC | `9c25485c-9c4a-45c7-ac59-fba06b91b8bd` |
| 4 | 2026-01-25 to 2026-01-31 | closed | 2026-05-04 21:52:29 UTC | `3a4307be-3dba-4e07-b2a5-c1d12c77cc8e` |
| 5 | 2026-02-01 to 2026-02-07 | closed | 2026-05-04 21:52:29 UTC | `0710f972-12c9-4ba6-b622-117c3fc42939` |
| 6 | 2026-02-08 to 2026-02-14 | closed | 2026-05-04 21:52:29 UTC | `f097e9d5-9935-41f5-ac1d-23a7e7eea5f4` |
| 7 | 2026-02-15 to 2026-02-21 | closed | 2026-05-04 21:52:29 UTC | `69845377-e134-41fd-a2a1-87ab4ca1f0db` |
| 8 | 2026-02-22 to 2026-02-28 | closed | 2026-05-04 21:52:29 UTC | `b642b396-d3ef-496d-a832-05da782c2650` |
| 9 | 2026-03-01 to 2026-03-07 | closed | 2026-05-04 21:52:29 UTC | `e80a5d39-608f-4535-a978-995282a04514` |
| 10 | 2026-03-08 to 2026-03-14 | closed | 2026-05-04 21:52:29 UTC | `36dcddd5-3f0d-4fb9-aab9-0f8290c8290f` |
| 11 | 2026-03-15 to 2026-03-21 | closed | 2026-05-04 21:52:29 UTC | `0c64ddec-333d-4c0e-be42-3ff1f35eaf25` |
| 12 | 2026-03-22 to 2026-03-28 | closed | 2026-05-04 21:52:29 UTC | `8b3b169d-86f0-40be-83b0-71025734d668` |
| 13 | 2026-03-29 to 2026-04-04 | closed | 2026-05-04 21:52:29 UTC | `1a171dc1-964d-439e-b136-42fed9bbe769` |
| 14 | 2026-04-05 to 2026-04-11 | closed | 2026-05-04 21:50:03 UTC | `ffda73df-559d-41d0-8932-b8c09740d448` |
| 17 | 2026-04-26 to 2026-05-02 | closed | 2026-05-07 02:30:27 UTC | `323fd5ce-da1c-41be-97c7-b6d47c2c3e1a` |
| 18 | 2026-05-03 to 2026-05-09 | active | null | `b207659a-58ab-4d97-9881-3716b8a12c65` |

Confirmed gap: display weeks 15 and 16 are missing from the live `weeks` table.

## 4. Display-Number Mapping Logic

`src/lib/history/data.ts` does not compute display numbers directly. It reads `display_week_number` from `public.v_week_totals`.

`public.v_week_totals` computes it with:

```sql
public.shiftly_display_week_number(w.start_date) as display_week_number
```

`public.shiftly_display_week_number` is defined in `supabase/migrations/202605040001_foundations.sql`:

```sql
create or replace function public.shiftly_display_week_number(p_start_date date)
returns integer
language sql
immutable
as $$
  select floor((p_start_date - public.shiftly_first_sunday(p_start_date))::numeric / 7)::integer + 1;
$$;
```

So display number is not dense UI indexing. It is calendar-derived from the year's first Sunday. For 2026, display week 1 starts 2026-01-04, and each display number advances by one Sunday.

## 5. Identified Gaps And Deleted Weeks

Because display week number is calendar-derived, the missing rows map cleanly:

| Missing Display # | Expected Date Range | Evidence |
|---:|---|---|
| 15 | 2026-04-12 to 2026-04-18 | Gap between week 14 ending 2026-04-11 and week 17 starting 2026-04-26; matching `week_reopen` snapshot exists |
| 16 | 2026-04-19 to 2026-04-25 | Gap between week 14 ending 2026-04-11 and week 17 starting 2026-04-26; matching `week_reopen` snapshot exists |

Additional deleted active-week snapshots also exist for week 18 and a future week 19 test, but those date ranges currently have an active replacement or are not part of the reported week 15/16 loss.

## 6. Available `week_reopen` Snapshots

| Snapshot ID | Created At | Deleted Week ID | Deleted Range | Status At Snapshot | Days | Earn Slots | Day Transactions | Unassigned Transactions |
|---|---|---|---|---|---:|---:|---:|---:|
| `da7d3899-3d59-4fb0-aed5-a2594cbb6882` | 2026-05-07 02:27:32 UTC | `a7d971a9-ab67-40b0-bb13-8ffd1232e178` | 2026-04-12 to 2026-04-18 | active | 7 | 18 | 0 | 37 |
| `39971813-1daf-4672-96e0-ec6a3265c96a` | 2026-05-07 02:26:48 UTC | `3d5dd53d-4be3-4d9f-be00-ddd058f7766f` | 2026-04-19 to 2026-04-25 | active | 7 | 17 | 0 | 38 |
| `855aa948-6ac2-41e9-8f4d-a51395400cc3` | 2026-05-07 02:25:04 UTC | `a2bc0659-1939-4922-a59c-ccc10be2809b` | 2026-05-03 to 2026-05-09 | active | 7 | 24 | 30 | 4 |
| `b17a5f7e-4641-4d83-a088-6d187a3ca2f8` | 2026-05-04 11:59:14 UTC | `dc069e43-de93-4148-953e-2a84f646cc9d` | 2026-05-10 to 2026-05-16 | active | 7 | 18 | 0 | 0 |

The two snapshots that matter for the reported loss are:

- Week 15: `da7d3899-3d59-4fb0-aed5-a2594cbb6882`
- Week 16: `39971813-1daf-4672-96e0-ec6a3265c96a`

## 7. Snapshot Integrity Checks

All four `week_reopen` snapshots passed the structural checks:

| Snapshot ID | Has Week ID | Has Start | Has End | Days Is Array | Unassigned Is Array |
|---|---|---|---|---|---|
| `39971813-1daf-4672-96e0-ec6a3265c96a` | true | true | true | true | true |
| `855aa948-6ac2-41e9-8f4d-a51395400cc3` | true | true | true | true | true |
| `b17a5f7e-4641-4d83-a088-6d187a3ca2f8` | true | true | true | true | true |
| `da7d3899-3d59-4fb0-aed5-a2594cbb6882` | true | true | true | true | true |

The deleted week IDs from those snapshots are absent from `public.weeks`, confirming they were actually deleted rather than renamed or status-changed.

## 8. Cascade / Orphan Check Results

For deleted week IDs:

| Table | Remaining Rows Referencing Deleted Weeks |
|---|---:|
| `days` | 0 |
| `earn_slots` | 0 |
| `transactions` via surviving deleted-week days | 0 |
| `week_projection_exclusions` | 0 |

FK definitions confirm cascade behavior:

| Constraint | Definition |
|---|---|
| `days_week_fk` | `FOREIGN KEY (week_id, user_id) REFERENCES weeks(id, user_id) ON DELETE CASCADE` |
| `earn_slots_day_fk` | `FOREIGN KEY (day_id, user_id) REFERENCES days(id, user_id) ON DELETE CASCADE` |
| `transactions_day_fk` | `FOREIGN KEY (day_id, user_id) REFERENCES days(id, user_id) ON DELETE CASCADE` |
| `week_projection_exclusions_week_fk` | `FOREIGN KEY (week_id, user_id) REFERENCES weeks(id, user_id) ON DELETE CASCADE` |

Conclusion: cascade deletes fired. Restore must reconstruct weeks, days, earn slots, transactions, and projection exclusions from snapshot JSON where applicable.

Important nuance: the week 15 and week 16 snapshots contain zero day-attached transactions but 37 and 38 unassigned transactions respectively. Those transactions were captured in the snapshot as unassigned, not as applied day transactions.

## 9. Retention Check

`state_snapshots` summary:

| Total | Earliest | Latest |
|---:|---|---|
| 8 | 2026-05-04 11:59:14 UTC | 2026-05-07 02:30:27 UTC |

Snapshot type counts:

| Snapshot Type | Count |
|---|---:|
| `week_reopen` | 4 |
| `post_week_close` | 2 |
| `pre_week_close` | 2 |

`pg_cron.job` does not exist in this project, so no database cron pruning job was found through `pg_cron`.

Code search found no migration or application path that deletes or prunes `state_snapshots`.

Risk note: `supabase/migrations/202605040006_rls_policies.sql` grants authenticated users `select, insert, update, delete` on `state_snapshots` and defines a broad owner policy. That is not an automatic purge job, but it means application code with the user's auth context may be able to mutate/delete owned snapshots if such code is ever added.

## 10. Recovery Feasibility Verdict

| Deleted Week | Date Range | Snapshot | Verdict | Notes |
|---:|---|---|---|---|
| 15 | 2026-04-12 to 2026-04-18 | `da7d3899-3d59-4fb0-aed5-a2594cbb6882` | ✅ recoverable | Full week object, 7 days, 18 earn slots, and 37 unassigned transactions are present in the snapshot. No surviving DB rows conflict with the deleted week ID. |
| 16 | 2026-04-19 to 2026-04-25 | `39971813-1daf-4672-96e0-ec6a3265c96a` | ✅ recoverable | Full week object, 7 days, 17 earn slots, and 38 unassigned transactions are present in the snapshot. No surviving DB rows conflict with the deleted week ID. |
| 18 duplicate/deleted active | 2026-05-03 to 2026-05-09 | `855aa948-6ac2-41e9-8f4d-a51395400cc3` | ⚠️ partial/needs care | A replacement active week for the same range currently exists with a different ID. Snapshot contains 24 earn slots and 30 day transactions; restore should not blindly insert a duplicate week. |
| 19 future/test | 2026-05-10 to 2026-05-16 | `b17a5f7e-4641-4d83-a088-6d187a3ca2f8` | ⚠️ optional | This appears to be a future/test active week discarded during reopen testing. Snapshot is structurally intact, but restoring it now would conflict with the one-active-week model unless handled deliberately. |

Bottom line: Jon's believed-lost weeks 15 and 16 are recoverable from `week_reopen` snapshots.

## 11. Open Questions Or Risks

1. Week 15 and week 16 snapshot transactions are unassigned, not day-attached. A restore script should preserve them as unassigned/pending review unless there is a reliable rule to attach them to days.
2. The restore must avoid violating `weeks_one_active_per_user`. Recovered week 15 and 16 rows should probably be inserted as `closed`, not `active`.
3. The restore must preserve IDs from the snapshot where possible so any snapshot references remain coherent.
4. The current `reopen_week` RPC remains destructive. Do not click Reopen again until it is patched or guarded.
5. `state_snapshots` is the only source of truth for cascaded child rows for the missing weeks. Protect this table before attempting UI recovery work.
6. Snapshot write happened before delete, which saved the data. The dangerous part is the hard delete of the active week; the snapshot system itself worked.

## 12. Claude Review Notes

Second-pass forensic review of Codex's diagnostic. No DB writes, no migrations, no recovery code — code reading and verification only.

### 12.1 Agreement With Recoverability Verdict

I agree with §10. Weeks 15 and 16 are recoverable from `week_reopen` snapshots. The core chain holds:

- Snapshot write precedes the destructive delete inside the same transaction (`reopen_week` body, `202605040014_week_close_history.sql:208-227`).
- `week_snapshot_json` captures week + days + earn slots + day-attached transactions + unassigned transactions in the date range + projection exclusion row.
- Both target snapshots (`da7d3899-...` for week 15, `39971813-...` for week 16) pass structural checks and have no surviving FK descendants.

### 12.2 Things Codex Did Not Surface

**A. Snapshot payload is two-rooted, not one.**

Each `week_reopen` payload is `jsonb_build_object('discarded_active_week', ..., 'reopened_week', ...)`. Recovery must read `payload->'discarded_active_week'`, not the payload root. `reopened_week` is the previously-closed week being promoted at the time — restoring from that key would restore the wrong week. The report's day/slot/transaction counts in §6 are clearly sourced from the right key, but the recovery script needs this called out explicitly.

**B. `state_snapshots.week_id` column for these rows is currently NULL.**

`state_snapshots.week_id` is `references public.weeks(id) on delete set null` (`202605040002_tables.sql:412`). The RPC inserts the snapshot with `week_id = v_active_week.id`, then deletes that same week in the same transaction. The cascade fires `set null` on the row just inserted. Net effect at commit: snapshot exists, but its `week_id` column is NULL.

Recovery queries cannot use `where week_id = X`. The deleted week ID must come from `payload->'discarded_active_week'->'week'->>'id'`. The "Deleted Week ID" column in §6 is parsed from JSON, not from the table column — that distinction matters for the recovery query.

**C. The 37/38 unassigned transactions are almost certainly still in `public.transactions`.**

The cascade is `weeks → days → transactions(day_id)`. Transactions with `day_id IS NULL` do not cascade. Snapshot's `unassigned_transactions` captured rows with `day_id IS NULL` whose `date` fell inside the deleted week's range. They were never subject to the cascade. They almost certainly still exist live with the same IDs.

This isn't theoretical — the `transactions_applied_requires_day` check (`202605040002_tables.sql:249-251`) means only `applied` transactions ever had a `day_id`. Pending/excluded ones with `day_id IS NULL` are exactly the population captured in `unassigned_transactions`. They're still there.

A naive `INSERT` of those rows from the snapshot would either create PK conflicts or duplicate semantically-identical rows depending on conflict handling.

**D. RPC is `security invoker`; underlying grants still allow `delete on public.weeks`.**

`reopen_week` runs as the calling user. The reason it can issue `delete from public.weeks` is the explicit `grant ... delete on public.weeks to authenticated` (`202605040006_rls_policies.sql:29`) plus the permissive `weeks_own` policy. Even after we patch the RPC, raw client SQL with the user's session token can still issue `DELETE` against `weeks`. Defense-in-depth: route all `weeks` deletes through `SECURITY DEFINER` functions and revoke the direct grant. Wider scope than this incident — flagging.

**E. UI confirm copy understates the action.**

`HistoryTable.tsx:67-72` and `ReopenWeekButton.tsx:22-24` use `window.confirm` with text saying "discard your current active week and any unsaved data." The "unsaved" framing reads as draft-state semantics. Reality is hard delete with cascade. Until the RPC is patched, this button should be disabled or the copy should explicitly say "permanently delete" with a typed confirmation.

### 12.3 Top 3 Risks Before Recovery

1. **Duplicate-row risk for unassigned transactions** (per §12.2.C). The snapshot's `unassigned_transactions` likely correspond to rows still living in `public.transactions`. Recovery must skip them (or `ON CONFLICT (id) DO NOTHING`) and not blindly insert.

2. **`weeks_one_active_per_user` violation.** Both snapshots captured `status = 'active'` — the destroyed weeks were the active week at deletion. Restoring with the snapshot's status as-is conflicts with the currently-active week 18 (`b207659a-...`). Recovery must override status to `'closed'` and set `closed_at` to a sensible non-null value (e.g. snapshot `created_at`) for ordering parity with sibling closed weeks.

3. **`reopen_week` is still loaded.** Until it is patched or the UI is gated, one more click extends the destruction by another week. The recovery work itself should not be done while the destructive path remains live, because partial recovery state is exactly the kind of state someone might "fix" with another Reopen.

### 12.4 Unassigned Transactions: Restore As-Is, Don't Re-Insert

Recommended posture: **do not re-insert** the snapshot's `unassigned_transactions`. Treat the surviving live rows as authoritative. Their `day_id` is already NULL, which is the correct state for "landed in the date range but never attached to a day." After weeks/days are recovered, those transactions will appear in the recovered detail view as the same orphans they have been, available for normal review/apply workflows.

If a side-by-side comparison turns up snapshot-only IDs (rows the snapshot has but live does not), those are the only candidates for restore — and even then, restore them with `day_id = NULL` and the original `status` from the snapshot. Do not synthesize a `day_id` mapping from date alone — that crosses the line from recovery into reconciliation, and date-based remap is not what the user did originally (the original `applied` transactions had explicit `day_id` set by user action; the unassigned ones did not).

Day-attached transactions in the target snapshots are zero for both weeks, so this branch is not hot for the immediate recovery. It would matter for the week-18 alternate (`855aa948-...`, 30 day-attached transactions), but that recovery is contraindicated for other reasons (replacement week exists).

### 12.5 Patch `reopen_week` Before Recovery, Not After

Order:

1. Patch the RPC and ship the migration.
2. Patch or hide the Reopen UI.
3. Tighten `state_snapshots` grants (§12.6).
4. Run the recovery.

Patch shape (sketch — do not implement yet):

- Replace `delete from public.weeks where id = v_active_week.id` with `update public.weeks set status = 'discarded', archived_at = now() where id = v_active_week.id`.
- Add `'discarded'` to the `week_status` enum.
- `weeks_one_active_per_user` already filters `where status = 'active'`, so `discarded` rows do not collide with it.
- Adjust `weeks_archived_must_be_closed` to allow `archived_at` for both `closed` and `discarded`.
- Update read paths that filter `status in ('closed','archived')` to optionally include `'discarded'` based on UI need (likely: hide from `History` by default, expose in a "Recoverable" admin view).

Rationale: keep the snapshot for redundancy, but make the primary record non-destructive. Recovery becomes "flip status back from `discarded`" — no JSON marshalling needed for future incidents.

### 12.6 `state_snapshots` Grants Are Too Permissive

`202605040006_rls_policies.sql:44` grants `select, insert, update, delete on public.state_snapshots to authenticated`. Combined with `state_snapshots_own ... for all` (lines 152-155), this means:

- The user's auth-token session can `DELETE FROM state_snapshots WHERE id = ...` and erase the recovery payload.
- The user's session can also `UPDATE` the payload, corrupting JSON in place.

No application code currently does either, but the recovery payload is exposed to anything wielding the user's anon-key plus session token.

Recommended hardening (do not implement now):

- `revoke update, delete on public.state_snapshots from authenticated;`
- Keep `select` (the History detail page reads snapshots).
- Keep `insert` (the close/reopen RPCs run `security invoker` and need it). Or flip those RPCs to `security definer` and revoke `insert` too. Either is fine; the second is cleaner.
- Pruning, if ever introduced, runs through a `security definer` RPC enforcing retention.

For the immediate term (before recovery), at minimum revoke `update` and `delete` on this table.

### 12.7 Recommended Next Step

Single one-shot SQL recovery transaction, authored on a fresh branch, reviewed before execution, run inside a transaction with row-count verification before commit. Sketch only:

1. For snapshot `da7d3899-3d59-4fb0-aed5-a2594cbb6882`:
   - Read `payload->'discarded_active_week'`.
   - `INSERT INTO public.weeks` with the original `id`, `user_id`, `start_date`, `end_date`; override `status = 'closed'`; set `closed_at` to the snapshot's `created_at`; `archived_at = NULL`.
   - `INSERT INTO public.days` for each day in the payload, preserving original IDs.
   - `INSERT INTO public.earn_slots` for each slot per day, preserving IDs.
   - `INSERT INTO public.transactions` for any day-attached transactions (zero for this snapshot).
   - `INSERT INTO public.week_projection_exclusions` if `payload->'discarded_active_week'->'projection_exclusions'` is non-null.
   - **Skip** `unassigned_transactions` per §12.4.
2. Repeat for snapshot `39971813-1daf-4672-96e0-ec6a3265c96a` (week 16).
3. Verify row deltas before commit:
   - `weeks` +2
   - `days` +14
   - `earn_slots` +35 (18 + 17)
   - `transactions` +0
   - `week_projection_exclusions` +0..+2 depending on snapshot content
4. If counts match expectation, `COMMIT`. Else `ROLLBACK` and reinvestigate.

Pre-flight:

- Take an out-of-band backup of `state_snapshots` filtered to this user. The snapshots are the only copy of the destroyed data; do not begin recovery without a copy outside the database.
- Confirm `reopen_week` patch is shipped, or the UI is gated, before running.
- Rehearse with a dry-run inside a transaction that ends in `ROLLBACK`. Inspect the inserted row shapes before the real run.

Explicitly out of scope for this incident's recovery: the week-18 alternate (`855aa948-...`) and the week-19 future/test (`b17a5f7e-...`). Both have complications (replacement week exists; future-dated). Neither was what the user reported losing. Leave both in `state_snapshots`; do not restore.
