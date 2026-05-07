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
