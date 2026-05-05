# Baseline System — Behavior Spec for Codex

**Audience:** an AI coding agent (Codex) implementing the baseline calculator → dashboard auto-apply path in this repo.

**Read this cold.** Everything you need is in this doc — the legacy app is referenced for context only, you don't need to open it.

**Stack:** TypeScript + Next.js (current breaking-change version, see `AGENTS.md`) + Supabase. Money is integer cents end-to-end (`MoneyCents` type). No floats in stored data. Floats only in math intermediates, rounded back to ints before persistence.

---

## 1. Scope

The "baseline system" is the chain that turns a list of monthly fixed expenses into a per-day base subtraction on the active week's dashboard. It spans:

1. **Expenses table** — the editable list of monthly fixed costs.
2. **Baseline calculator** — sums active expenses, derives monthly/weekly/daily figures.
3. **Auto-apply mechanism** — pushes the calculator's daily output into `days.base_amount` for today and every future day in the active week.
4. **Dashboard consumption** — the dashboard reads `days.base_amount` per day to compute cashflow.

```
src/lib/domain/baseline.ts                  (existing) — pure formula
src/lib/domain/baseline.test.ts             (existing) — formula tests
src/lib/baseline/data.ts                    (existing) — Supabase loader for the page
src/lib/baseline/types.ts                   (existing) — types
src/components/baseline/BaselineEditor.tsx  (existing) — page UI
src/app/(protected)/baseline/page.tsx       (existing) — route
src/app/(protected)/baseline/actions.ts     (existing — MUST be modified, see §10)
supabase/migrations/2026….sql               (new — see §7)
```

### 1.3 Direction

**Restore the legacy auto-apply.** The Baseline page's "Projected daily base" must be the single source of truth for `days.base_amount` on today and every future day in the active week. Past days are never touched.

This is a **deliberate reversal** of the current behavior where the calculator is informational only and `days.base_amount` is seeded from `settings.default_base_sun_fri` / `settings.default_base_sat` and never updated by user action. After this change:

- Editing an expense, adding an expense, or deleting an expense recomputes the daily base and applies it to today + future days.
- The Sun-Fri vs Sat split is **dropped** (legacy was uniform; the split has no UI and creates conceptual debt). The settings columns stay in place for now — see §10.
- The calculator output is the active baseline. No more disconnect.

---

## 2. Architecture

Five layers, same shape as the debt system:

```
[Layer 1: pure formula]                       src/lib/domain/baseline.ts
  calculateBaselineTotals(expenses, todayIso)
    -> { monthlyTotalCents, weeklyAverageCents, projectedDailyBaseCents }
  isExpenseExpired(expirationDate, todayIso) -> boolean
  No I/O. Same input always returns the same output.

[Layer 2: SQL view + RPC]                     supabase/migrations/...
  v_active_expense_totals (existing)
    exposes monthly_total, weekly_average, projected_daily_base
    derived from public.weeks_per_month() = 4.33

  apply_baseline_to_future_days(p_user_id) (NEW — see §7)
    UPDATE days SET base_amount = <projected_daily_base>
      WHERE user_id = p_user_id AND date >= current_date

[Layer 3: data loader]                        src/lib/baseline/data.ts
  getBaselineData()
    reads expenses + v_active_expense_totals
    returns { todayIso, expenses, totals }

[Layer 4: display UI]                         src/components/baseline/BaselineEditor.tsx
  Renders header, totals panel, expense table.
  Computes totals client-side via calculateBaselineTotals for instant feedback.
  Server view is the canonical source on reload.

[Layer 5: mutations]                          src/app/(protected)/baseline/actions.ts
  createExpenseAction / saveExpenseAction / deleteExpenseAction
    -> Supabase write
    -> CALL apply_baseline_to_future_days(user_id)   (NEW)
    -> revalidatePath("/baseline")
    -> revalidatePath("/dashboard")                  (NEW — dashboard cf depends on base)
```

**Architectural rules (load-bearing — do not violate):**

1. The pure formula in `baseline.ts` and the SQL view in `v_active_expense_totals` must produce identical numbers for the same inputs. Both use `4.33` weeks/month. Both filter on `is_active AND (expiration_date IS NULL OR expiration_date >= today)`.
2. The auto-apply happens in **mutations only**, not in the data loader. Reading `getBaselineData` or `getDashboardData` must never write to `days`.
3. The dashboard component does not compute the baseline — it reads `days.base_amount` as-is. No change to `DashboardEditor.tsx` needed.
4. Past days are **immutable** with respect to baseline. Only `date >= current_date` rows get touched.

---

## 3. Glossary

| Name | Stands for | Currency | Formula | Lives where |
|---|---|---|---|---|
| `monthlyTotal` | Sum of active, non-expired monthly amounts | $/month | `Σ amount where is_active AND not expired` | `BaselineTotals.monthlyTotalCents`, `v_active_expense_totals.monthly_total` |
| `weeklyAverage` | Monthly amortized to weekly | $/week | `monthlyTotal / 4.33` | `BaselineTotals.weeklyAverageCents` |
| `projectedDailyBase` | The daily applied baseline | $/day | `monthlyTotal / 4.33 / 7` | `BaselineTotals.projectedDailyBaseCents`, `v_active_expense_totals.projected_daily_base` |
| `base_amount` | Per-day applied baseline | $/day (cents in TS) | set by `apply_baseline_to_future_days` | `days.base_amount` |
| `cashflow_total` | Per-day cashflow | $ | `earnings_total − spend_total − base_amount` | `v_day_totals.cashflow_total` (existing) |

**Currency convention:** `amount` in the `expenses` table is stored as `numeric(12,2)` dollars. All TypeScript layer values are integer cents. Conversion happens at the DB boundary (`dollarsToCents`/`centsToDollars`).

---

## 4. Constants

```ts
// src/lib/domain/baseline.ts
export const WEEKS_PER_MONTH = 4.33;
```

```sql
-- supabase/migrations/202605040001_foundations.sql:127
create function public.weeks_per_month() returns numeric immutable as $$
  select 4.33::numeric;
$$;
```

These two **must** stay in sync. The legacy app used `30.44` (days/month from 365.25/12). We're using `4.33 × 7 = 30.31`. This produces a ~0.4% lower daily base than legacy. Acceptable — `4.33` is the standard weeks-per-month convention used everywhere else in this codebase.

`days.base_amount` precision: `numeric(10,2)` — two decimals, supports up to $99,999,999.99.

---

## 5. The pure formula — `calculateBaselineTotals`

Already implemented in `src/lib/domain/baseline.ts`. Spec is here for audit.

```ts
calculateBaselineTotals(expenses: BaselineExpenseInput[], todayIso: string): {
  monthlyTotalCents:        sum of amountCents where isActive AND !isExpenseExpired(expirationDate, todayIso)
  weeklyAverageCents:       round(monthlyTotalCents / 4.33)
  projectedDailyBaseCents:  round(weeklyAverageCents / 7)
}

isExpenseExpired(expirationDate: string | null, todayIso: string): boolean
  return Boolean(expirationDate && expirationDate < todayIso)
  // string comparison on YYYY-MM-DD lexicographic order is safe
```

Edge cases:
- `expenses = []` → all totals are `0`.
- `monthlyTotalCents = 0` → daily base = 0. Apply still runs but writes 0 to `days.base_amount` for today + future. That's correct — no expenses means no base.
- Expired today (expirationDate == todayIso) → **NOT expired** (`<`, not `<=`). Today is the last active day.
- `isActive = false` → excluded regardless of expiration.

**Do not change this function.** It is consumed both by the page (for instant client-side feedback) and as the canonical TS-side reference for the SQL view.

---

## 6. The SQL view — `v_active_expense_totals`

Already exists in `supabase/migrations/202605040005_views.sql:262`.

```sql
create or replace view public.v_active_expense_totals
with (security_invoker = true)
as
select
  e.user_id,
  coalesce(sum(e.amount) filter (
    where e.is_active and (e.expiration_date is null or e.expiration_date >= current_date)
  ), 0)::numeric(12,2) as monthly_total,
  ( ... / public.weeks_per_month() )::numeric(12,2) as weekly_average,
  ( ... / public.weeks_per_month() / 7 )::numeric(12,2) as projected_daily_base
from public.expenses e
group by e.user_id;
```

**Do not modify this view.** It already matches the TS formula.

---

## 7. The new SQL function — `apply_baseline_to_future_days` (NEW)

Add a new migration (next available timestamp):

```sql
-- supabase/migrations/<timestamp>_apply_baseline_to_future_days.sql

create or replace function public.apply_baseline_to_future_days(p_user_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_daily_base numeric(10, 2);
  v_count integer;
begin
  if p_user_id is null then return 0; end if;

  select coalesce(projected_daily_base, 0)
    into v_daily_base
  from public.v_active_expense_totals
  where user_id = p_user_id;

  -- Round to nearest cent (view returns 2-dp numeric already)
  v_daily_base := coalesce(v_daily_base, 0);

  update public.days
  set base_amount = v_daily_base
  where user_id = p_user_id
    and date >= current_date
    and base_amount is distinct from v_daily_base;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.apply_baseline_to_future_days(uuid) to authenticated;

-- One-time backfill: apply for every existing user so today + future days
-- catch up from the seeded 52/57 defaults to the calculator value.
do $$
declare
  u record;
begin
  for u in select distinct user_id from public.expenses loop
    perform public.apply_baseline_to_future_days(u.user_id);
  end loop;
end $$;
```

Behavior contract:
- Idempotent: running twice with no expense changes touches zero rows (the `is distinct from` guard).
- Touches **only** `date >= current_date`. Past days are never modified.
- Returns the number of rows updated (useful for telemetry / debugging).
- Computes the daily value from `v_active_expense_totals`, not from a recomputation in plpgsql, so the SQL view stays the single source.

---

## 8. Per-day base lifecycle

After this change:

| Lifecycle event | Source of `base_amount` |
|---|---|
| Week-creation in `ensure_current_active_week` | Still `default_base_sun_fri` (Sun-Fri) / `default_base_sat` (Sat) — see §10 for why we don't strip this |
| First baseline mutation after week-creation | Auto-applied: `projected_daily_base` overwrites all 7 days with the uniform value |
| Every subsequent baseline mutation | Same uniform overwrite for today + future days |
| Past days (date < current_date) | **Never modified** — preserves historical accuracy |

Net effect: a freshly-created week briefly shows 52/52/52/52/52/52/57 until the first save on the baseline page (or the backfill in §7's migration runs). After that, all 7 days carry the same `projected_daily_base` value.

If you create a week and immediately go to the dashboard without touching baseline, you'll see the seeded defaults. That's expected. The backfill in the migration handles the existing-data case.

---

## 9. Data loader — `src/lib/baseline/data.ts`

**No changes.** Already correct. Reads `expenses` + `v_active_expense_totals` and returns `BaselineData`.

---

## 10. Server actions — `src/app/(protected)/baseline/actions.ts` (MUST modify)

All three mutating actions (`createExpenseAction`, `saveExpenseAction`, `deleteExpenseAction`) need three changes:

1. After the Supabase write succeeds, call the new RPC:
   ```ts
   const { error: applyError } = await supabase.rpc("apply_baseline_to_future_days", {
     p_user_id: user.id,
   });
   if (applyError) {
     throw new Error(`Unable to apply baseline: ${applyError.message}`);
   }
   ```
2. Add `revalidatePath("/dashboard")` after `revalidatePath("/baseline")`. The dashboard's per-day cashflow now depends on this.
3. (saveExpenseAction only) `requireUser` already returns `{supabase, user}`. The current implementation discards `user`. Pull it out so step 1 can use `user.id`.

**Apply order matters:**
```
1. supabase.from("expenses").insert/update/delete (...)
2. supabase.rpc("apply_baseline_to_future_days", { p_user_id: user.id })
3. revalidatePath("/baseline")
4. revalidatePath("/dashboard")
5. return ok
```

If step 2 fails after step 1 succeeded, the database is in a consistent state (the expense write landed, the future-days update didn't). Returning the error to the user is fine — the next mutation will catch up. Do not wrap in a transaction; the RPC is idempotent and self-correcting.

---

## 11. UI — `src/components/baseline/BaselineEditor.tsx`

Minimal change. The "Projected daily base" totals card label should be unambiguous:

- **Current:** `Projected daily base`
- **Required:** `Projected daily base` with an additional sub-line `auto-applied to today + future days` (small, muted text below the value).

This is a one-line addition to `TotalsPanel`. No structural refactor needed.

The instant client-side recompute via `useMemo(calculateBaselineTotals(expenses, todayIso))` stays — gives the user immediate feedback before the round-trip completes. Server revalidation reconciles to the canonical view value.

---

## 12. Persistence pathway

```
user edits expense in BaselineEditor.tsx
  → patchExpenseLocal() (optimistic)
  → scheduleExpenseSave() (debounce ~700ms)
    → saveExpenseAction(input)
      → supabase.from("expenses").update(...)
      → supabase.rpc("apply_baseline_to_future_days", { p_user_id })
      → revalidatePath("/baseline")
      → revalidatePath("/dashboard")
        → next /baseline load re-pulls getBaselineData()
        → next /dashboard load re-pulls getDashboardData() (sees new days.base_amount)
```

No client-side Supabase writes. No Firebase-style listener. `revalidatePath` on both routes is the only sync mechanism.

---

## 13. Out of scope — DO NOT implement

The following are explicitly out of scope. Codex must not "fix" them, port them from legacy, or build them. If the user later asks for any of these, treat as a new request — don't anticipate.

- **Removing `default_base_sun_fri` / `default_base_sat` from `settings`** — these stay as-is. They still get used by `ensure_current_active_week` as the seed values for new weeks before the first auto-apply. Stripping them would require also patching `ensure_current_active_week` and risks breaking the week-creation flow. Leave them.
- **Settings UI for `default_base_sun_fri` / `default_base_sat`** — no UI for editing these. The calculator is the canonical control surface for the daily base.
- **Per-day baseline edit UI on the dashboard** — `days.base_amount` is read-only from the dashboard's perspective. Users adjust it indirectly by editing expenses.
- **The "expiring" 60-day status from legacy** — not modeled. Active vs expired only.
- **Switching `4.33` to `30.44`** — the new app uses `4.33 × 7` as the days-per-month divisor. Do not change to legacy's `30.44`. The 0.4% difference is acceptable and `4.33` is consistent with the rest of the codebase.
- **Database trigger on `expenses` to auto-apply** — apply happens in server actions only. Triggers would fire on direct SQL writes too, which is not desired during migrations or admin work.
- **Wrapping the expense write + auto-apply in a transaction** — the RPC is idempotent, the next mutation self-corrects.
- **Touching `state.days` past entries** — past days' `base_amount` is historical truth. Never overwrite.

---

## 14. Acceptance criteria

### 14.1 Pure formula (existing tests still pass + new edge cases)

Existing `src/lib/domain/baseline.test.ts` tests must continue to pass. Add:

- `calculateBaselineTotals([], "2026-05-04")` → `{ monthlyTotalCents: 0, weeklyAverageCents: 0, projectedDailyBaseCents: 0 }`
- An expense with `expirationDate === todayIso` → counted as active (boundary check).
- An expense with `isActive: false` and `expirationDate: null` → not counted.

### 14.2 SQL function — `apply_baseline_to_future_days`

Add a pgTAP test at `supabase/tests/apply_baseline_to_future_days.sql`:

- Setup: insert a user, two expenses ($455 + $279), and an active week with 7 days at the seeded defaults.
- Call `apply_baseline_to_future_days(user_id)`.
- Assert:
  - `days.base_amount` for `date >= current_date` equals the view's `projected_daily_base` (rounded to 2dp).
  - `days.base_amount` for `date < current_date` is unchanged.
  - Calling twice in a row updates 0 rows the second time.
- Cannot be run without Docker; that's acceptable per the legacy-split-fallback precedent.

### 14.3 Server actions

Add a vitest spec at `src/app/(protected)/baseline/actions.test.ts` (or extend existing) that mocks supabase and asserts:

- `createExpenseAction()` calls `rpc("apply_baseline_to_future_days", ...)` exactly once with the current user_id.
- Same for `saveExpenseAction(input)`.
- Same for `deleteExpenseAction({id})`.
- All three call `revalidatePath("/baseline")` AND `revalidatePath("/dashboard")`.
- If the RPC errors, the action throws with a message containing "Unable to apply baseline".

### 14.4 Round-trip integration (manual)

After deploying:

1. Hard-refresh `/baseline`. The "Projected daily base" card shows a value (call it `$X`).
2. Hard-refresh `/dashboard`. Each future day card subtracts `$X` from its cashflow (not $52 or $57).
3. Edit an expense by $100/month. The card jumps to a new value `$Y`.
4. Hard-refresh `/dashboard`. Future day cards now subtract `$Y`.
5. Past days on the dashboard still subtract whatever they subtracted before — unchanged.

---

## 15. Source-of-truth references

### Legacy app (read-only context)

- `Cashflow App/index.html`
- `BASELINE` global: line 1686
- `EXPENSES` array: lines 3140–3158
- `expStatus()`: lines 4238–4247
- `calcExpenses()`: lines 4249–4255
- `renderBaseline()` with auto-apply loop: lines 4257–4298 (auto-apply at lines 4283–4289)
- `parseExpDate()`: lines 4230–4237
- Per-day base consumption (8 sites): see lines 1898, 1909, 1941, 1957, 2215, 2282, 2521, 5876, 6105

### New app

**Read-only references:**
- `src/lib/domain/baseline.ts` — pure formula
- `src/lib/domain/baseline.test.ts` — formula tests
- `src/lib/baseline/data.ts` — Supabase loader
- `src/lib/baseline/types.ts` — types
- `src/components/dashboard/DashboardEditor.tsx:1325` — `baseCents` consumption (no change needed)
- `supabase/migrations/202605040001_foundations.sql:127` — `weeks_per_month()` constant
- `supabase/migrations/202605040002_tables.sql:21–22` — settings default columns
- `supabase/migrations/202605040005_views.sql:262` — `v_active_expense_totals` view
- `supabase/migrations/202605040027_future_day_projections.sql` — pattern reference for the new migration

**Files to modify:**
- `src/app/(projected)/baseline/actions.ts` — add RPC call + dashboard revalidate to all three mutations
- `src/components/baseline/BaselineEditor.tsx` — add "auto-applied to today + future days" sub-line on the Projected daily base card

**New file:**
- `supabase/migrations/<timestamp>_apply_baseline_to_future_days.sql` — RPC + backfill (see §7)
- `supabase/tests/apply_baseline_to_future_days.sql` — pgTAP regression (see §14.2)

---

## 16. Style conventions

Same as `DEBT_SYSTEM_SPEC.md`:

- Cents-as-int in TypeScript; numeric(10,2) dollars in Postgres; convert at the boundary.
- Pure functions for math. Server actions for mutations. `revalidatePath` for sync.
- No client-side Supabase writes. No Firebase-style listeners.
- Don't add error handling for impossible inputs.
- Comments only when the *why* is non-obvious.
- Tests live next to the code (`baseline.ts` ↔ `baseline.test.ts`). Vitest.
- pgTAP tests live in `supabase/tests/`.

---

**End of spec.** When in doubt, the legacy `index.html` behavior is the source of truth for *outputs*; the new TypeScript + Supabase architecture takes precedence for *implementation*. Match legacy's user-visible behavior — calculator drives the dashboard — without copying legacy's structure.
