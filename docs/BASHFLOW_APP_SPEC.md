# ShiftlyCash — Application Specification

> **Brand:** The app's display name is **Bashflow** (formerly **ShiftlyCash**). This spec uses "ShiftlyCash" throughout to refer to the application/codebase; the rename to "Bashflow" so far covers only user-facing display text. Internal identifiers — the `shiftlycash.vercel.app` URL, `SHIFTLYCASH_*` env vars, the `shiftlycash-theme` cookie, database/table/column names, and the sibling **ShiftlyCal** nutrition section — are intentionally unchanged.

ShiftlyCash is a single-tenant personal-finance web app (Next.js App Router + Supabase/Postgres) built around one identity computed for every day: **Cashflow = Earnings − Spending − Fixed costs.** It tracks shift-work income, bank/Chime spending, recurring and one-time costs, debts, assets, and forward projections (debt-free date, a path-to-$1M millionaire timeline, net-worth growth), and it embeds a full nutrition tracker (ShiftlyCal) and a read-out of an external paper-trading engine (Screener).

This document is an exhaustive, plain-English description of every feature and how it works, assembled from a full read of the codebase.

## Table of contents

1. [Dashboard — Daily Cashflow Editor](#1-dashboard--daily-cashflow-editor)
2. [The Money & Projection Engine](#2-the-money--projection-engine)
3. [Fixed Expenses, Amortization, Debt & Net Worth](#3-fixed-expenses-amortization-debt--net-worth)
4. [Paychecks, Jobs, Templates & History](#4-paychecks-jobs-templates--history)
5. [Trends & Stock Screener](#5-trends--stock-screener)
6. [Banking, Nutrition, Settings, Theme, Auth & Infrastructure](#6-banking-nutrition-settings-theme-auth--infrastructure)

---

# 1. Dashboard — Daily Cashflow Editor

The Dashboard is the main signed-in page (route `/`, file `src/app/(protected)/page.tsx`). It is the "live week" workspace: a seven-day strip of cashflow cells across the top, a focused single-day editor beneath, and a week-level summary band. Everything on this page operates on the **current active week** — the calendar week (Sunday → Saturday) that contains today. The exact same component (`DashboardEditor`) is reused read-only in the History section to render a closed week, so much of the behavior below has an "active" and a "historical" variant.

### How the page loads and what it remounts on

When the page renders on the server, `getDashboardData()` (`src/lib/dashboard/data.ts`) runs. It first calls a Postgres function `ensure_current_active_week` to guarantee an active week (and its 7 day rows) exist for the Sunday-on-or-before-today, then runs **projection maintenance**, then fans out a batch of queries: the user's pay settings, the week row, the 7 day rows, per-day totals (`v_day_totals`), week totals (`v_week_totals`), the active-expense/baseline totals, all closed-week metric rows (for medians), the projection weeks, then earn slots and transactions for those days, then gas allocations, the per-day gas spread, the per-day fixed-cost breakdown, the per-day amortized-income credits, and the custom-jobs library. All of this is assembled into a single `DashboardData` object.

The client component is keyed by the week id (`key={dashboardData.week.id}`). This is deliberate: the editor only fully remounts (losing focused-day selection, expanded drawers, etc.) when the **active week changes** — i.e. when a week is closed and the next one begins. Any other server refresh reconciles props in place and preserves your client-side UI state.

A persistent floating **"Log food" pill** (emerald, bottom-right, fixed) links to `/cal` (ShiftlyCal). The protected layout wraps the page with the left nav (`AppNav`), a swipe-navigation gesture handler for mobile, and a decorative "penthouse" background layer. Nav links are gated by edition capabilities.

### Two background tasks that fire on load

Both are throttled via `sessionStorage` and both are skipped entirely in historical (read-only) mode:

1. **Projection maintenance** — fires once per `todayIso` per browser session. It calls a server action that clears stale projected spend that has "reached today" and fills in future-day spend projections; if it changed anything it triggers a `router.refresh()`.
2. **Plaid auto-sync** — fires at most once per 5-minute window per session. It calls `syncTransactionsAction()` to pull new/modified bank transactions; if anything changed it refreshes. Silent on failure.

There is also a manual **"Sync now"** button in the header (active week only) that force-refreshes Plaid and reports a status pill like "Pulled 3 new, 1 updated."

### The header band

Top-left shows the **week number** ("Week 26"), the **date range** ("Jun 21 - Jun 27, 2026") with a small calendar icon, and two pills: the **pay-period role** ("Week 1 of Pay Period" or "Week 2 of Pay Period") plus the paycheck due date. Pay-period role and paycheck date come from `v_week_totals` via the display-week-number parity rule (even display-week = week 1, odd = week 2; the week-2 paycheck date is start + 11 days).

A 2px-tall colored bar at the top of the card is a **mode cue**: emerald means you are editing — a live week, or a closed week you've unlocked; amber means read-only history.

Top-right is the **status row**. In active mode it shows an "Active week" pill and the "Sync now" button. In historical mode it shows a "Closed week - read only" / "Closed week - editing" pill plus an "Edit week" / "Save & done" button. A save indicator ("Saving…" / "Auto-saved" / "Save failed") appears here as edits flush.

### The three top metrics (Earn / Spend / Cashflow)

Below the header sits the `MetricStrip`: three side-by-side metric tiles for the **whole week**. These read from `weekTotals`, recomputed **client-side** from the day slots (`calculateWeekTotals` over each day's `toDayInput`), with the signed amortized-income bucket credits added on top. This client recompute is what makes typing into a shift update the week metrics instantly.

- **Earn** — sum of all net shift earnings for the week.
- **Spend** — sum of applied transaction spend + manual daily spend for the week. This tile is **expandable**; clicking it toggles the Spend breakdown panel.
- **Cashflow** — Earn minus Spend minus Fixed, then **rounded to the nearest $5** for display. Shown with an explicit sign.

Each tile carries a **top accent stripe** colored by tone, a **value color** by tone (green positive / amber / red), and a **median trend arrow** comparing the week's value to the **median of all closed weeks** for that metric. The arrow's color reflects whether the move is *favorable* (Earn/Cashflow favor higher; Spend favors lower). Tones come from `legacyRules.ts`. **Earn tone** is relative to the median of closed weeks: below median = red, within +10% = amber, above +10% = green. **Spend tone** is the mirror. **Cashflow tone** (weekly) is absolute: under $500 = red, $500–$899 = amber, ≥$900 = green.

#### The expandable Spend breakdown panel

When the Spend tile is open, a panel headed "Spend formula · this week — transactions + manual" lists how the week's Spend is composed. Built client-side by `buildSpendBreakdown` and designed to **reconcile to the cent**:

- One row per **transaction category** (sorted by amount desc), labeled from the Plaid category (snake_case → Title Case; missing → "Uncategorized"). Each row shows its dollar amount and its **percent of total Spend**.
- A blue **"Incl. Gas"** row (sky-blue) when any gas spread exists — the per-day gas slice already folded *inside* the transactions total, surfaced as its own line and subtracted from "Other" so the rows still add up.
- An **"Other transactions"** remainder row that absorbs whatever categorized rows + gas don't account for.
- A muted **"Manual daily spend"** row (`day.spendCents`).
- A bold **Spend** total line (transactions + manual).

### The week strip (seven day cells)

A `grid-cols-7` row of `WeekStripCell` buttons, one per day. Clicking a cell focuses that day in the editor below. Each shows the **short weekday name** and (on wider screens) the day number, plus the day's **cashflow** as the headline number — recomputed client-side, rounded to the nearest $5, signed.

Per-cell styling encodes a lot:

- **Cashflow tone coloring** (red / amber / green) on both the number color and the cell border, using the **daily** tiers (`cashflowDailyTone`): ≥ $200 = green, $75–$199 = amber, < $75 = red.
- **Today's cell** gets a subtle lighter/grayish surface tint (`--surface-hover`) instead of a "Today" badge.
- **The focused/selected cell** gets a 3px accent border plus a focus ring and a soft green glow.
- **Locked days** (`spendLocked`) render at 75% opacity and, on wider screens, show a small "Locked" pill.
- **Future days with no spend yet** show a **projected cashflow in italics at 70% opacity** — Earn − (projected daily spend) − Fixed, where projected daily spend is the median weekly spend of the last six spending weeks, divided by 7.

### The focused day editor

Selecting a day renders `FocusedDayEditor`, a three-column grid: **Shift list** (left), **Totals panel** (middle), **Transaction drawer** (right).

#### Earn slots / the shift list

Each day has up to **four real editable shift slots** (slot indices 0–3) plus any number of synthetic read-only "bucket" rows (amortized-income credits, slot index ≥ 4). An "+ Add shift" button is disabled when the day is locked, when four real shifts already exist, or in read-only history.

Each **shift row** is a colored bar:
- **Color carries the job type, not a theme token**: Ability = deep blue (`#1d4ed8`), Prestige = yellow/amber (`#facc15`), Other = white/neutral; a custom job uses its own stored color with auto-derived border (darkened) and text color (contrast-picked).
- A colored dot, the **job name**, a **pay-type badge** ("Reg" / "OT" / "Split"), the **hours**, an optional **label**, and the slot's **net dollar earnings** (blank if zero or negative).
- Rows are **drag-and-drop reorderable** within the day (real slots only). Reordering re-stamps slot indices 0–3 and saves each affected slot.
- Clicking a row **expands** it into an inline editor (one row open at a time).

The expanded shift editor exposes: a **Job** dropdown (None, Ability, Prestige, Prestige ILST, Other, filtered to exclude hidden built-ins, plus a "Custom jobs" optgroup — selecting a custom job stamps that job's rates and color onto the slot); a **Type** dropdown (Regular, Overtime, **Split (Reg + OT)**, Unit, None); an **Hours / units** field (for split, two fields "Regular hours" + "OT hours"; a split slot with either leg ≤ 0 is not saved until both are filled); **Incentive** controls (Ability only — Rate = $/hour on wage hours, or Lump sum = flat add); a **Label** field; an auto-save note; and a **Remove** link.

**The earnings math (`pay.ts`):** each slot's net earnings via `calculateEarnSlot` — Ability = reg×abilityRegNet + OT×abilityOTNet + incentive (gross × abilityNetMultiplier), into the Ability paycheck bucket; Prestige/ILST = reg×prestigeReg + OT×prestigeOT (ILST own rates), into the Prestige bucket; Custom = reg/OT × custom rates, in neither bucket and excluded from wage hours; Incentive (standalone) = amount × abilityNetMultiplier into Ability; Other = flat dollar amount, no bucket. Rates are stored as **net cents** in `settings`.

**Per-shift reconciled NET override:** a slot can carry `reconciledNetCents`. When non-null it *replaces* the slot's derived net earnings (client + server `v_day_totals`, via `COALESCE`), while leaving hours and bucket attribution derived. This is how a real paycheck reconciles exactly without distorting hour breakdowns.

**Synthetic "bucket" rows (Amortized Income):** from `v_day_amortization_credit_items` — a daily credit slice from an amortized-income bucket. They render as a neutral "Other / Amortized" bar with a **signed** daily credit (can be negative), are read-only, never persisted, and their signed credit is added to earnings/cashflow separately (so negatives aren't clamped to zero).

#### The per-day Totals panel

A compact ledger: **Earn**, **Spend** (red), **Fixed** (exact-to-the-cent, expandable), **Cashflow** (Earn − Spend − Fixed, rounded to $5, colored by daily tone). The **Fixed value comes from the server** (`v_day_totals.base_amount`). The expandable base breakdown lists each contributing item ("$X/mo → $Y/day" or "$X over Nd → $Y/day") with a reconciliation line ("Sum matches Fixed ✓", or a warning if the per-item sum drifts > 2¢). A "Edit in Fixed →" link points to `/baseline`.

#### The transaction drawer

Two columns — **SPENDING** (applied) and **EXEMPT** (excluded) — each with a count badge. Transactions come from Plaid or manual entry, sorted chronologically. Each row shows merchant name, time, and amount. Clicking expands an action panel:
- **Rename** (inline, optimistic).
- **Include / Exempt** (toggles applied ↔ excluded).
- **Move to yesterday**.
- **Gas** (spending only) — opens the gas allocation editor.
- **Amort 1mo / Amort 3mo** (spending only) — amortizes the cost.
- **Delete** — a two-tap inline confirm ("Tap again"), because `window.confirm` is dead in the installed app.

All optimistic; no-ops in read-only history. An **"+ Add transaction"** button reveals a merchant + amount form to add a **manual spending transaction** to that day.

**Gas allocation:** a fuel transaction often covers a multi-day tank. You enter the gas portion (default the full amount; > $0, ≤ the transaction). The server records a `gas_allocations` row (gas portion, remainder, fill/previous-fill dates), and the converging daily-average machinery spreads the gas as a flat daily slice across every day since your first fill. After allocation, the transaction's displayed amount drops to the **remainder** (the chips/snacks), the row gets a glowing blue **"Gas spread"** tag, and each day shows its per-day gas slice. Gas and amortization are mutually exclusive on a transaction.

**Amortize:** spreads a one-off large cost across **fixed costs** over 1 or 3 months. It upserts an `amortized_expenses` row (keyed on the source transaction, so re-amortizing edits in place), **excludes the original transaction**, and deactivates any gas allocation. The daily slices show in each day's **Fixed** breakdown.

### Week summary band (bottom)

- **Hours readout**: "Prestige: Xh / Ability: Yh / Total: Zh".
- **`WeekNetSummary`**: per-bucket net chips — Ability net, Prestige net, and one chip per custom job that has shifts (derived from slots grouped by `customJobId`).
- **Close week** button (active mode only).

### Closing a week

Enabled only once today is on or past the week's Saturday end (else disabled, "Available after Saturday"). It uses a **two-tap inline confirm** (first tap arms for 5 seconds, button turns amber). Closing calls Postgres `close_week_and_start_next`, which finalizes the week and creates the next active week; the page refreshes and the editor remounts on the new week.

### Editing a closed week (historical mode)

The same editor renders read-only over an amber background. Pressing **"Edit week"** first saves a recovery `state_snapshot`, then unlocks the shift inputs. Shift edits flow through the same `saveEarnSlotAction` with an `allowClosedEdit` flag. Transactions stay read-only. **"Save & done"** flushes saves, refreshes, and returns to read-only. **This never calls `reopen_week`** (the corruption-prone legacy op).

### Saving model and running balance

Shift edits are **optimistic + debounced** (1.2s) with a per-key version guard; pending saves are flushed on unmount, on `pagehide`/visibility-hidden, and on "Save & done." Transaction actions save immediately. The **running balance** (`v_week_totals.running_balance`) is the cumulative cashflow carried across weeks; closing/editing recomputes it forward.

### Hiding built-in jobs

Stored in `settings.hidden_builtin_jobs`. Hidden jobs are dropped from the picker and the net-summary chips (display-only; history unaffected).

### Data-source split (the key mental model)

- **Server SQL views own the authoritative numbers**: `v_day_totals`/`v_week_totals` (earnings, spend, amortization-aware Fixed, cashflow, running balance, paycheck buckets, wage hours), `v_day_base_allocations`, `v_day_amortization_credit_items`, `v_day_gas_spend_totals`, `v_active_expense_totals`. Medians and the spend projection are computed in `data.ts`.
- **The client recomputes day/week totals from raw slots** (`pay.ts`) so editing a shift updates everything instantly. Bucket credits and reconciled-net overrides are layered on so the client matches the server to the cent. The rule of the codebase: a breakdown chip must derive from the same slots as its total, and an overlay added to one path is a bug until it's added to the other.

---

# 2. The Money & Projection Engine

This is the definitive explanation of how every number is produced. A recurring theme: **the app never stores a dollar amount for earnings.** Every earnings figure is *derived* on demand from hours × rate, in two parallel places (a Postgres view and a TypeScript function) kept byte-for-byte equivalent.

### Foundational unit: integer cents, derived not stored

The money primitive is `MoneyCents` — an integer number of cents (`money.ts`). Working in integer cents end-to-end is what lets the penny-distribution rules sum back to an exact total with zero drift. **`earn_slots` has no earnings-dollars column** — a shift stores only inputs (`job_type`, `pay_type`, `hours_or_units` / `regular_hours`+`overtime_hours`, incentive fields); the dollar value is computed every read from inputs × the current net rates in `settings`. So a rate or tax-rate correction instantly re-prices all history. (The lone exception: the reconciliation override, which overrides only the *net dollar*, never hours or bucket attribution.)

### Net rates, not gross

All `settings` pay rates are **net of tax** (take-home). Defaults: Ability reg $15.63 / OT $21.73, Prestige reg $14.62 / OT $21.93, Prestige-ILST reg $15.48 / OT $23.22, plus an Ability withholding rate (default 0.2652) whose complement is the `abilityNetMultiplier` (≈ 0.7348). Gross-up happens only later, in the year-end projection.

### Per-slot earnings: hours × rate, by job and pay type

Lives in `calculateEarnSlot`, mirrored exactly by the `CASE` in `v_day_totals`. Job types: `ability`, `ability_incentive`, `prestige`, `prestige_ilst`, `incentive`, `other`, `custom`, `none`. Pay types: `regular`, `overtime`, `split`, `unit`, `none`. `wageHourParts` resolves the split (regular → all reg; overtime → all OT; split → independent reg+OT, `wageHours = reg + ot`). Then per family:
- **Ability**: reg×abilityReg + OT×abilityOT, plus incentive (rate mode: rate × wageHours; lump_sum: flat) netted by the Ability multiplier; into the **Ability bucket**.
- **Prestige / prestige_ilst**: reg×prestigeReg + OT×prestigeOT (ILST own pair); into the **Prestige bucket**. (Prestige OT is a v0 flat-1.5× stopgap.)
- **custom**: reg/OT × the custom job's own rates; in **neither** bucket and **excluded** from `wage_hours_total`.
- **incentive** (standalone): amount × abilityNetMultiplier, into Ability, zero wage hours.
- **other**: units = raw dollars, no bucket (how legacy summary imports and synthetic "Amortized Income" rows ride in).

Each slot yields `earningsCents`, `abilityPaycheckCents`, `prestigePaycheckCents`, `wageHours`.

### A day's four numbers

`calculateDayTotals`: `cashflowCents = earningsCents − spendCents − baseCents`. The server's `v_day_totals.cashflow_total` is identical: `earnings_total − (transaction_spend_total + manual_spend_adjustment) − base_amount`. **Spend** = applied transactions + `manual_spend_adjustment` (also the vehicle for projected future-day spend). **Fixed (base)** = recurring slice + amortized-expense slice (Saturdays default higher). **Earn** = slot sum + amortized-income credit overlay.

### Running balance: cumulative cashflow

A SQL window function in `v_week_totals`: `sum(cashflow_total) over (partition by user_id order by start_date rows unbounded preceding to current row)`. It's the integral of the Earn−Spend−Fixed identity over time — not a bank balance. Because cashflow is derived, editing a closed week's shift safely re-flows the running balance for that week and every week after, with no frozen scalar to corrupt.

### The biweekly pay-period model

Weeks are Sunday→Saturday with a **display week number** from the first Sunday of the year. Parity decides role (`getPayPeriodInfo`, mirrored in `v_week_totals`): **even → `week_1`** (carry week, Ability hours carried forward); **odd → `week_2`** (completing week, paycheck due, `paycheck_due_date` = week end + 5 days). Viewing one week loads the **adjacent** pay-period week (+7 if week_1, −7 if week_2) and folds in its Ability hours/dollars, so one screen shows the full biweekly Ability paycheck though earnings are stored per work week.

### Server view vs client recompute — overlays must touch both

`v_day_totals`/`v_week_totals` (Postgres) are authoritative; the dashboard editor re-derives in-browser via `calculateDayTotals`/`calculateWeekTotals` for instant UI. The per-slot `CASE` and `calculateEarnSlot` must stay identical, **and any overlay added to the server view must also be folded into the client memo.** Example: the amortized-income credit adds `credit_cents` to the server view; on the client it arrives as synthetic "bucket" slots (slotIndex ≥ 4) which `toDayInput` excludes and `withBucketCredit` re-adds.

### Future-day spend projection

New-week future days get a *projected* spend in `manual_spend_adjustment` flagged `is_projected_spend = true`. The per-day value is the **median of the most recent six projection-included closed weeks' spend, ÷ 7** (`apply_future_day_projection`; client mirror `deriveSpendProjection`, `recent_six_median`). `cleanup_expired_projections` clears the flag as each day arrives. Weeks can be excluded from projections via `week_projection_exclusions`.

### The year-end projection engine

`calcWeeklyProjection` (`projections.ts`). Inputs are NET; it grosses up internally. **WPC (weekly projected cashflow)** = mean cashflow over the last *window* (default **2**) closed weeks (the debt page feeds `ROLLING_WINDOW_WEEKS = 2`; future-spend uses a 6-week median — two different "recent" knobs). YTD cashflow/earnings/wage-net summed over all closed weeks; `weeksRemaining = 53 − currentWeekNumber`; **yearly projected gross cashflow** `ypgc = ytdCashflow + WPC × weeksRemaining`. Gross-up: `grossUpNetWageCents(net, rate) = net / (1 − rate)` (rate clamped ≤ 0.6), Ability and Prestige each with their own withholding.

### The tax model

From grossed-up yearly wage income (all 2025 single-filer): **Federal** (`fedTax2025`, brackets 10–37% on gross − standard deduction $15,000 − a legacy $900 OT exemption); **Connecticut** (`ctTax2025`, 2%→6.99%, personal exemption phasing out $30k–$45k); **FICA** (6.2% Social Security to the $176,100 cap + 1.45% Medicare uncapped). Total = fed + CT + FICA. **Estimated tax still owed** = `max(0, total − withheldYTD) + filingFee` ($160). Net-of-tax cashflow ÷ 12 = monthly withdrawable. A separate biweekly withholding curve (`withholding.ts`) is a calibrated piecewise-linear interpolation over real Ability paystub points (flat 18% stopgap for Prestige), used for per-check withholding and the marginal tax of extra hours.

### Debt-free date, millionaire timeline, age calc

Assembled in `debt/data.ts` over `simulateDebtFree` / `simulateLegacyMillionaire`. **Investable weekly cashflow** = `max(0, WPC − weeklyTaxDue)` where `weeklyTaxDue = estTax / 52`. **Debt-free date** (shipped headline) = `ceil(totalActiveDebt / WPC)` weeks → a date (a richer avalanche sim also runs for the chart). **Millionaire timeline**: `simulateLegacyMillionaire` starts net worth at **negative total debt**, adds investable weekly cashflow, and **compounds at 10%/yr (rate/52 weekly) only once positive**; as cumulative cashflow crosses each *linked* debt's balance, that debt is "freed" and its weekly minimum is added to the contribution (snowball); runs until $1,000,000. **The "you'll be X years old" age**: the millionaire date vs a hardcoded birthdate (Jan 12, 1998) via `calculateAgeOnDate`. The net-worth page reuses the same compounding via `buildNetWorthProjection`.

### The gas converging-daily-average model

`v_day_gas_spend_totals` is a **whole-history converging daily average**, recomputed every mutation. Numerator = total active gas allocations; window from `first_date` (earliest tank *start* = `previous_fill_date + 1`, stored as `start_date`, not the earliest fill date) through *today* (America/New_York). Each day's slice is a **cumulative-floor (Bresenham) split** so slices sum to the total exactly, order-independent. The **zero-net-change** property: gas dollars are *carved out* of the originating transaction's own day (`GREATEST(amount − gas_amount, 0)`) and the same total *re-spread* across the window as `gas_spend_cents` — money is moved, not created; every period total nets identically.

### The amortization model: three distinct buckets

All share the cumulative-floor penny rule.
1. **Recurring stamped base (never retroactively rewritten).** Monthly fixed costs → daily base `sum(monthly)/4.33/7` (`v_recurring_daily_base`), **stamped** prospectively into `days.base_amount`; historical base is immutable. (Hard-won: an earlier live-derive moved the running balance ~$1,956.) Saturdays carry a higher default base.
2. **Amortized expense slices.** A one-time cost → `amortized_expenses` row; per-day slice (`v_day_amortized_totals`) added on top of the stamped base. A live view bounded to its own window — edits re-derive overlapping days from one row, never touching recurring history.
3. **Amortized income credit / prorated income.** `amortization_bucket` + **signed** `amortization_item` line items (a return can reduce the total, e.g. AirPods −$565). Per-day credit (`v_day_amortization_credit`) added **only to `earnings_total`/`cashflow_total`** — never the paycheck buckets (net cash, not wages).

All three honor **drill-down-reconciles-to-the-penny**: the displayed "Fixed" is the exact sum of its breakdown rows, because the rows *are* the slices.

### Paycheck reconciliation (Hamilton/largest-remainder)

`reconcile_paycheck` snaps a job's pay-period shifts to the actual check **exactly**, per pay period per job (only `prestige`, folding `prestige`+`prestige_ilst`, and `custom:<uuid>`; Ability is retired). (1) Build the base from `paycheck_period_base_slots` (re-derives each shift's net via the same `CASE`); the period = the week_2 anchor + the week 7 days earlier. (2) Distribute by **Hamilton/largest-remainder**: `floor(base × actual / projectedTotal)`, leftover cents to the largest fractional remainders (ties → larger base, then id); a hard invariant asserts `Σalloc == actual` or rolls back. (3) Write each shift's `reconciled_net_cents`; rollups read `COALESCE(reconciled_net_cents/100, derived CASE)` — overriding only the net dollar. It is **idempotent**, **reversible** (`revert_paycheck_reconciliation`), and **self-invalidating** (a trigger nulls the override the moment a shift's inputs change). A staleness snapshot prompts re-reconcile when shifts drift; `factor` (actual ÷ projected) is display-only.

### Tone/color thresholds

`legacyRules.ts`: **daily** cashflow green ≥ $200, amber $75–$199, red below; **weekly** cashflow red < $500, amber $500–$899, green ≥ $900. Weekly spend/earnings are toned relative to the median (spend green when ≥10% under, earnings green when ≥10% over).

---

# 3. Fixed Expenses, Amortization, Debt & Net Worth

Every dollar is integer cents end-to-end; conversion to/from `numeric(12,2)` happens only at the DB boundary. Math lives in pure functions and SQL views; loaders assemble data; components display and optimistically echo edits.

### The Fixed Expenses page (`/baseline`)

The single editable list of monthly recurring costs and the *source of truth* for the daily "fixed cost" the dashboard subtracts from every current/future day. Titled **"Fixed Expenses"** ("Monthly recurring costs converted into weekly and daily fixed cost").

**The expense row** has six fields (table on desktop, Edit/Done cards on mobile): **Name**; **Monthly** (dollars→cents, negatives clamped to 0); **Withdraws** (optional 1–31 day-of-month, informational only); **Expiration** (optional date — expired when `expirationDate < today` using lexicographic `YYYY-MM-DD` compare, so an expense expiring *today* is still active its final day; a future date shows an "Expires" badge + highlighted row); **Active** checkbox (unchecked = excluded from totals regardless of expiration); **Delete**. A **"Make permanent"** link clears the expiration date.

**Add / delete** insert a blank row (`sort_order` +10 over the max) / remove, optimistically.

**Live totals** (recompute client-side via `calculateBaselineTotals`): **Monthly total** (sum of active, non-expired); **Weekly average** = `round(monthlyTotal / 4.33)` (the 52÷12 divisor, identical in TS `WEEKS_PER_MONTH` and SQL `weeks_per_month()`); **Projected daily fixed** (hero) = `round(weeklyAverage / 7)`, sub-line "Auto-applied to today + future days · N active." Full chain: **monthly → ÷4.33 → weekly → ÷7 → daily**.

**The auto-apply mechanism.** Every create/save/delete calls the RPC `apply_baseline_to_future_days(user_id)`, which reads `projected_daily_base` from `v_active_expense_totals` and writes it into `days.base_amount` for **today and every future day** (`date >= current_date`) only — past days are immutable. Idempotent (`is distinct from` guard). A second RPC `restamp_recent_baseline(user_id, 14)` heals the last 14 days (soft-fails if absent). Both `/baseline` and `/` revalidate. The dashboard reads `days.base_amount` as-is and subtracts it — so editing one expense ripples into every future day's cashflow.

**Save indicator**: amber "Saving…" / green "Saved" (~1.2s) / red "Save failed"; edits debounced ~500ms with a per-field version guard.

### Amortized Expenses (spread a one-time cost over a window)

Created not here but on a transaction ("Spread this cost"). Canonical example: a $1,200 laptop at **Best Buy** (a normalized merchant in `legacyRules.ts`). `amortizeTransactionAction`: reads amount/merchant/date; computes a **calendar-accurate** period (1 or 3 real months, 28–31 days each); upserts one `amortized_expenses` row keyed on `source_transaction_id` (re-amortizing edits in place, fixing a double-count bug); marks the original transaction `excluded` (`amortized_expense`); deactivates any gas allocation.

**The daily slice** uses a **cumulative-floor** algorithm: for day k, `floor(original × (k+1) / periodDays) − floor(original × k / periodDays)`, 0 outside `[start, end]`, summing exactly to the original. Each row shows merchant (resolved live from the source transaction), original amount, period days, window, and `$X/day`. **Remove** (`removeAmortizationAction`) deactivates the row (`is_active=false`); because the contribution is derived at read time, removal instantly drops the cost with no orphaned writes (an optional `reInclude` restores the original to spend). Period can change via `reAmortizeTransactionAction` (bumps `schedule_version`).

**The drift warning.** The section shows "Daily fixed today" = `$recurring + $amortized` read from `v_day_totals.base_amount` (the same source the dashboard uses). If the component's own sum diverges by > 2¢, a loud amber "⚠ components sum to $X" warning appears.

### Prorated Income buckets (spread supplemental cash as daily "Other" earnings)

The income-side analogue, **renamed from "Amortized Income"** because you **prorate** income but **amortize** a cost (commit `a4c7991`); internal tables/views still say "amortization." Each **bucket** (e.g. "Lean Break") has a start/end date and signed line items (a return is negative, e.g. "Sold laptop"). "Add bucket" = a 21-day window from today. The card shows **Total** (signed sum), **Daily rate · Nd** (`round(total / periodDays)`), **Items**. Buckets can be **Archived** or hard-**Deleted** (CASCADE). The daily credit is **derived at read time** (`v_day_amortization_credit*`), added as a **NET "Other" earnings credit** to each day in the window. Save: optimistic, ~600ms debounce.

### The Debt page (`/debt`)

Titled **"Debt Obligations,"** subtitle **"Predict your future. Own your future."** Every color is a `[data-theme]` CSS token (`globals.css`/`DESIGN.md`) — derived from a **Linear** design analysis with an **Apple** cousin theme, swappable by one `data-theme` attribute.

**The debt list** (Order | Name | Balance | Min/mo | APR % | Status | Delete): Order arrows rewrite `priority_order` to `(index+1)×10`; Balance ≤ 0 auto-flips status to **"paid"**; APR is entered as % stored as **basis points** (18.50% → 1850). Edits debounced ~700ms via `updateDebtAction`. "Add debt" inserts "New Debt." Delete is gated by `window.confirm` (suppressed on mobile — a known limitation).

**The metric cards** surface the full year-end tax/cashflow engine (`calcWeeklyProjection`): Earnings/Cashflow avg over the rolling 2-week window; Yearly projected gross wage income; **Estimated due tax** (`max(0, fed+FICA+CT − withheld) + $160`); Weekly tax due (`estTax/52`); Yearly projected gross/net cashflow; **Debt-free date** (`ceil(totalActiveDebt / wpc)`); **Millionaire date** (the Path-to-$1M hit date, "on <date> — you'll be X years old — $<weekly>/wk — 10% return").

**The Path to $1M chart.** "Starts at negative debt, invests post-tax weekly cashflow, compounds at 10%." Range toggles `1Y/3Y/5Y/10Y/$1M`. Two series (principal-only at 0%, invested at 10%); orange/red fill below zero (debt phase), slate fill above (principal), teal fill between (interest); dashed zero + $1M target lines; "now" dot, crossover dot (date-labeled), target-hit dots, endpoint labels. As cumulative cashflow crosses each **linked** (collateralized) debt's balance, its weekly minimum steps up the contribution (green dashed payoff markers). A **Debt breakdown** panel renders balance bars + a "Total minus auto loan" line.

### The Net Worth page (`/net-worth`)

Titled **"Net Worth,"** subtitle "Turn weekly surplus into a clean principal versus compounding view." Starts at **current net worth = total assets − total active debt** and projects forward 12 years. **Assets** list (name, category, value, sorted desc). **Model inputs** card: Starting balance; **Weekly contribution** = `max(0, wpc − weeklyTaxDue)` (post-tax investable); **Annual return** (assumed-return input, default **10%**, compounded weekly); **Horizon** (12 years). Four metric cards (weekly contribution, assumed return %, selected-timeframe projected value with "% from interest", interest earned).

**The stacked projection chart** (`buildNetWorthProjection`): per week, **Principal** = `start + contribution × w` (slate base); **Total** compounds (`× rate/52` then + contribution); the teal **interest** band = `max(0, total − principal)` stacked on top. **Crossover marker** = first week cumulative interest ≥ cumulative principal (purple dashed leader + callout). Timeframe toggles `1M/3M/1Y/3Y/All`; Y axis rescales to the visible window (+~10% headroom); X axis in years; all colors `--chart-*` tokens.

### How it all feeds the projection math

Fixed Expenses sets `days.base_amount`; Prorated Income adds daily "Other" credits — together shaping each day's `cashflow = earnings − spend − base`. Closed-week cashflow rolls into `v_week_totals`, read by the Debt and Net Worth loaders for the rolling-window `wpc`, the year-end tax bill, and the post-tax investable surplus — which drives the debt-free date, millionaire timeline, and net-worth projection. A single bill edit ripples all the way to the "you'll be X years old" date and the crossover year.

---

# 4. Paychecks, Jobs, Templates & History

### Pay-period foundations

Weeks start Sunday; each carries a **display week number** from the first Sunday of the year and a **pay-period role**: even = **`week_1`** (carry), odd = **`week_2`** (completing; paycheck due = start + 11 days). A pay period is the 14-day span from a `week_1` Sunday. The audit, dashboard badge, and reconciliation anchor all read this one rule.

### 1. The Paychecks page ("Pay-period check")

At `/paychecks`, force-dynamic, **personal** edition only (`showPaycheckAudit`; consumer redirects home). Titled "Pay-period check" under "Paycheck audit," subtitle "Compare expected take-home against what the paycheck actually paid."

**Loads four week-starts** (previous + current pay period's two weeks each) from `v_week_totals`, their days, all `earn_slots`, pay settings, custom jobs, stored `paycheck_actuals` (week_2 only), and `paycheck_reconciliations`.

**Dynamic per-job appearance (Ability retired).** A job shows only if it has a logged slot in the four visible weeks: **Prestige** appears for any `prestige`/`prestige_ilst` slot (both folded into one "Prestige" card, each variant priced at its own gross rate; note "includes Prestige $17 and ILST $18; OT is simple 1.5x v0"); **each custom job** appears at its first shift (own gross rates + withholding). **Ability is fully retired** — job keys are only `"prestige"` or `"custom:<uuid>"`. Empty state if nothing is logged.

**The CCF / Spanish-Saturday distinction** is a *labeling* distinction, not separate math: ILST vs base Prestige fold into one Prestige total but are priced separately; shift *labels* like "Spanish Shift" tag a CCF/Saturday Prestige shift without changing its bucket.

**Job tab switcher** when more than one job qualifies. **Layout:** two `PaycheckPeriodCard`s (previous/current) for the selected job + a "Pay-period totals (all jobs)" section.

**Inside each period card:** header with date span + a **StatusPill** ("No actual yet" / "$X short" / "$X over" / "Matches estimate"); a metric grid (Reg/OT/Total hours, Pay date); a per-week breakdown (Reg/OT/Gross); money lines (Expected gross → Estimated withholding → **Expected take-home**; plus Actual + Difference when entered); and an **AuditRead** callout interpreting the gap.

**Expected take-home math:** per job, sum each week's gross (hours × variant gross rate), apply withholding (Prestige fixed 14%, deriving Prestige gross from the stored net by ÷(1−0.14); customs use their own), net = gross − tax.

**Entering the actual check:** a decimal input + Save (`savePaycheckActualAction` → `paycheck_actuals.job_actuals` JSONB keyed by job key; the Prestige key also mirrors the legacy `prestige_actual_amount` column). Optimistic; a SaveBadge shows state; disabled if no week_2.

**Pay-period totals cards:** one line per job (expected net), an Expected total, and an Actual total (only when every job has an actual).

#### Reconcile-to-actual

Below the actual form: a **required affirmation** checkbox ("This check is correct — no dispute") disabled until a valid actual is typed, and **reset to unchecked whenever the actual changes**. The **Reconcile** button (enabled with a week_2 anchor + valid actual + checked affirmation) calls `reconcilePaycheckAction` → the Postgres `reconcile_paycheck` (recomputes base from `paycheck_period_base_slots`, Hamilton-distributes the actual across the period's shifts, overwrites each `reconciled_net_cents`, asserts the sum, snapshots for staleness, upserts the record — all in one transaction). Rollups read `COALESCE(reconciled_net_cents, derived)`. Idempotent. Once reconciled, the button becomes **Re-reconcile** with an **Undo** beside it; a **Reconciled badge** shows "$X" + a signed-percentage **factor**. On every load each active reconciliation is re-checked against the live base set; if shifts drifted it's flagged **stale** ("the shifts changed since this was reconciled… Re-reconcile"). **Undo** (`revert_paycheck_reconciliation`) nulls the overrides. A red **zero-actual warning** appears if the actual is exactly $0.00.

### 2. Custom Jobs

A **tab inside Templates** (`/settings/template`, "Jobs" tab; the old `/settings/jobs` permanently redirects there), shown only when `showCustomJobs`. Lists **built-ins** (Ability, Prestige, Prestige ILST — editable Net reg/OT, a "built-in" pill, hide via Delete/Restore which toggles `settings.hidden_builtin_jobs`) then **custom jobs** (color swatch, name 1–40 chars, color picker, Gross reg, Withhold % 0–99, read-only Net display, Delete/Restore).

**Rate rules:** OT is **always** auto-derived as **1.5× the regular gross** for customs (built-ins keep real OT). Net = gross × (1 − withholding). **Create** = a "New job" default. **Delete is soft** (`active=false`) — past shifts keep their stamped earnings, and the job is cleared out of the future template (its `template_slots` reset to "none"). Inactive jobs a slot still references render as "(inactive)."

### 3. The Weekly Template system

The shifts that **autofill into every newly created week**. At `/settings/template` (`showWeeklyTemplate`). Data model: the default `weekly_templates` row owns it; `template_slots` (up to 4/weekday, day_index 0–6, slot 0–3) hold job/pay/hours/incentive/`custom_job_id`; **sticky labels live in their own `sticky_labels` table** keyed by `(user, day_index, slot_index)`, so a label survives independently of the slot.

**The editor** (`TemplateEditor`): a header with a shift count + save status + **Save** button (nothing persists until Save); a scrollable weekday strip (each day shows colored dots per filled shift); a focused-day panel with shift bars (tap to expand: Job select, Type incl. Split, hours or reg/OT, Ability incentive controls, a Label field placeholder "e.g. Spanish Shift"); **"+ Add shift"** (max 4/day); a "Remove shift" per bar. Save (`saveDefaultTemplateAction`) normalizes every slot, calls `replace_default_template_slots` (deletes + re-inserts non-empty slots), and persists labels separately to `sticky_labels`.

**Apply on week create:** `apply_default_template_to_week` copies each template slot into the matching day's earn-slot **only into empty slots** (never overwrites a real logged shift), carrying job/pay/hours/incentive/`custom_job_id`, source `'template'`.

**Sticky labels + the Sunrise/Ability rule:** non-Ability labels come from `sticky_labels`; **Ability** labels are app-managed by a slot pattern — a slot gets **"Sunrise Cottage"** if it's a 10-hour Ability slot, the Sunday 8-hour Ability slot, or the Thursday 2-hour Ability slot; other Ability filler slots are unlabeled. The bootstrap seed ships a starter Sun–Sat template + starter labels ("Sunrise Cottage," "Tony," "Joe," "Mike," "Nate," …).

### 4. The History section

**The week list (`/history`)** loads every **closed** week (newest first) + projection-exclusion flags. A horizontally-scrollable table (Week # + "Archived" pill, Date range, Earnings, Spend, Fixed, Cashflow, Running balance, Actions); each row's **"View"** → `/history/<week_id>`. Money in whole-dollar legacy format; running balance red when negative.

**Projection-exclusion toggles:** the Earnings/Spend/Cashflow cells are buttons; clicking toggles whether that value is excluded from projection averages (struck-through + "EXCL" badge). Optimistic; `toggleProjectionExclusionAction` upserts `week_projection_exclusions` (separate booleans); refuses to change flags on an active week. Exclusion **never deletes data**.

**The customizable summary panel (`HistorySummary`)** shows totals/averages/medians across closed weeks (8 tiles). A **window selector** (All / Last 4/6/8/12/26) limits to recent N. **Customize mode**: each tile is a drag-reorderable row (dnd-kit) + show/hide checkbox. Order/hidden/window persist to `localStorage` (`shiftlycash-history-summary-v1`). Math **skips excluded weeks** per field; averages/medians return "—" when none qualify.

**The read-only closed-week view (`/history/[week_id]`)**: force-dynamic; missing → 404; a *non-closed* week redirects to the dashboard. It renders the **same `DashboardEditor`** in **`mode="historical"`** — so the historical detail *is* the dashboard UI, read-only. Above it: **"← Back to Trends"** (→ `/trends`) and **"History"** (→ the list). Historical mode adds an amber inset ring + "Closed week — read only" pill, an amber top bar (→ emerald when editing), read-only transactions, and no projection/sync side-effects. Custom-job net chips appear for the closed week.

**The safe-edit story:** closed weeks are read-only until **"Edit week,"** which first calls `snapshotClosedWeekAction` (a recovery snapshot into `state_snapshots`) before unlocking. An amber banner explains the blast radius ("recompute this week plus the running balance for every later week — no earlier week changes"). Edits reuse `saveEarnSlotAction` with **`allowClosedEdit: true`**. **"Save & done"** flushes + refreshes + returns to read-only. **It never calls `reopen_week`.**

**Snapshots panel:** a "Recovery snapshots" section listing each snapshot's type/timestamp/counts with the raw payload viewable.

**Notable dead code:** `ReopenWeekButton` renders `null` (the `reopen_week` RPC is wired as `reopenWeekAction` but has no UI). `HistoryWeekView` / `getHistoryDetailData` is a fully-built alternate read-only renderer **not currently mounted** by the route (the route renders `DashboardEditor` historical instead).

---

# 5. Trends & Stock Screener

Both pages are gated by capability flags (`showTrends`, `showScreener`; disabled → redirect home) and are `force-dynamic`.

### The Trends Page (`/trends`)

A server component loads all data via `getTrendsData()` (two parallel queries: every `v_week_totals` row oldest-first, and the single most recent *active* `gas_allocations` row) and hands it to the client `TrendsView`; all interactivity is client-side from that one payload.

**Header + range selector:** a pill control — **12W** (last 12 weeks), **YTD** (weeks since Jan 1 of the latest week's year; default), **All**, **Custom** (a numeric "wks" input clamped 2–53, default 10). **Stats strip** (recompute on the filtered set): **Total**, **Median**, **Average**, **Weeks** (whole-dollar USD). Empty range → "No weeks in this range yet."

**The weekly cashflow bar chart** (SVG, 1000×280 viewBox, stretches full width). **Continuous color by cashflow**: full green ≥ $950, green→yellow $650–$950 (yellow anchors $650), yellow→red $0–$650, full red < $0; a legend swatch shows the gradient with "$0 → $650 → $950+". Vertical scale auto-fits (positive headroom = max of actual max or the $1,000 target; negative depth = worst negative week); a **zero baseline** with bars up/down; a solid **$1,000 target line** labeled "$1,000"; a **dashed median guide** (when median ≠ 0). **Confetti** (14 deterministic colored rects) on any week ≥ $1,500. The current **active** week renders at 55% opacity. X-axis date labels every Nth bar (~12 shown). **Click-through:** each column is a full-height transparent hit area (keyboard-focusable, `role="link"`, Enter/Space) navigating to `/history/{weekId}`, with a `<title>` tooltip "date · cashflow — open week."

**The Gas tracker card** surfaces the converging daily gas model. **Waiting for fill** (no active allocation) → "Waiting for today's fill." **Active** → headline "$X per gas day"; the data layer derives period start = previous fill + 1, period days = inclusive count to the fill date, gas total = rounded `gas_amount_cents`, daily = gas/days, extra = `remainder_amount_cents`. A 2×4 stat grid (Gas total, Days, Daily, Extra), a plain-English receipt, and a footnote naming the previous fill date + merchant ("Store extras stay normal spend").

### The Screener Page (`/screener`)

A **read-only dashboard for an external systematic paper-trading engine** (the "twin"). The app does no trading — an outside engine pushes a complete daily snapshot, and the page renders the latest one in plain English.

**The ingest route (`POST /api/screener/snapshot`)**, Node runtime, append-only, idempotent-by-recency: (1) `Authorization: Bearer` must equal `SHIFTLYCASH_LEDGER_TOKEN` (else 401/500). (2) `validateSnapshotPayload` requires `generated_at` (ISO), `snapshot_id`, `clock`+`hero` objects, and `positions`/`queue`/`fear` arrays. (3) **Recency gate** — only a strictly newer `generated_at` than the latest stored is inserted (else `{skipped:"not newer"}`). (4) **Append insert** of a new row (never updates). (5) GET/PUT/DELETE → 405. Uses a service-role client.

**Reading:** `getLatestScreenerSnapshot()` fetches the most recent row, normalizes it defensively (tolerates missing keys/wrong types, filters malformed items, defaults `unvalidated` to **true**), and flags **stale** when `generated_at` is > **26 hours** old.

**Empty state:** "Nothing here yet — your picks show up after the next daily run."

**The hero block** ("Your practice portfolio"): a **verdict chip** (`pass`→"validated" green, `fail`→"did not pass" red, `inconclusive`→amber, else "practice run" brand) + a stale pill; a plain-English **headline** from the verdict and vs-S&P number; the **three headline percentages** ("Your picks" = `twin_total_return_pct`/`pnl_pct`, "The market" = `sp500_total_return_pct`, "Ahead by" = `vs_sp500_pct`, sign-colored, "even" within ±0.05%); a **money line** ("Invested {cost basis} of {reference capital} ({X}% in) · {idle} waiting in cash"); a **risk line** (worst dip / how bumpy); and a **clock progress bar** ("Day N of M · trial note", with "· cohort N (clock was reset)" when cohort > 1) plus as-of/scope footnotes.

**Ingest health banner** when `health.ingest_errors_7d > 0`. **NAV chart** ("Picks vs. the market") plots twin vs S&P cumulative-return lines with a zero line when `nav_series` ≥ 2 points.

**Sections** (each gated on data): **Open positions** ("What you're holding" — ticker, optional "price stale" badge, shares/price, value, signed P&L); **On sale right now** (the in-fear list — dropped hard AND historically cheap; shadow-flagged names excluded; "down X%", "in its cheapest X%"); **The candidate queue** ("Worth keeping an eye on" — `band==="queue"`, top 8, combining queue score/criteria — "earnings growth/debt load/low capex/pricing power", "passes all 4 tests" — with research verdict chips — `compelling`→"strong", `pass`→"skip", else "worth watching" — and a thesis: short take, moat, first bull "+", first bear "–", up to two red flags "⚠"); a **near-miss** sub-list ("Just missed the cut"); **Filtered out** (excluded names blocked by rules); **Closed paper trades** ("Already sold" — exit reason translated, close date, realized P&L). One snapshot drives the entire page; the page never computes finance — it formats, translates jargon, colors by sign, and gates on data presence.

---

# 6. Banking, Nutrition, Settings, Theme, Auth & Infrastructure

A single-tenant Next.js + Supabase app. Money in cents; UI formats via `Intl.NumberFormat`. Almost everything is gated by editions/capabilities and protected by Supabase auth.

### 1. Banking — Plaid bank linking

The Banking page (`/banking`, `BankingClient`) shows **Connected items**, **Pending review**, **Chime email captures**, and a header (Connect bank, Sync now, Clean merchant names). **Plaid is "configured"** only when `PLAID_CLIENT_ID`, `PLAID_SECRET`, and `PLAID_ACCESS_TOKEN_ENCRYPTION_KEY` all exist (defaults `PLAID_ENV=sandbox`, products `transactions`, country `US`); otherwise a warning lists missing vars and disables Connect/Sync.

**Connect flow:** `createLinkTokenAction` → Plaid `linkTokenCreate` (`client_name: "ShiftlyCash"`, `transactions.days_requested: 30`, `user.client_user_id`, `webhook`) → the client opens Plaid Link → `exchangePublicTokenAction` exchanges the public token for a permanent `access_token`+`item_id`, **encrypted at rest**, stored via `upsert_plaid_item_from_server`. **Connected items** read from `plaid_item_metadata` (never exposing the token); status badges `active`/`login_required`/`error`.

### 2. Plaid transaction sync

One implementation (`syncPlaidItem`) invoked from the manual button (`syncTransactionsAction`), the webhook/cron (`syncTransactionsActionForItem`), and cron. Per item: decrypt the token; if forced, best-effort `transactionsRefresh`; loop `transactionsSync` (count 500, threading the cursor) processing added/modified (upsert) + removed (exclude); persist cursor; `ITEM_LOGIN_REQUIRED` flips the item to `login_required` and skips.

**Per-transaction upsert (`upsertPlaidTransaction`):** raw description = `original_description ?? name`; display name via the merchant-AI cleaner. **Day matching:** an unlocked existing day → auto-`applied`; else `pending_review` (`day_locked`/`no_matching_day`), or `excluded` if before the active week. **Auto-exclusion:** income (amount ≤ 0) + legacy-exempt merchants/categories. **Idempotency:** keyed by `plaid_transaction_id`; user-`applied` stays applied; user-`excluded` is left alone. **Cross-source dedup with Chime:** an existing Chime row (same date+amount, no Plaid id) is stamped with the Plaid id rather than duplicated. **Post-sync:** bulk-exclude old no-match rows; re-run the merchant cleaner over the active week.

**Pending review UI:** lists each with a day-selector; **Apply** / **Exclude**; plus bulk cleanup and a `cleanUglyMerchantNamesAction` re-run.

### 3. Plaid webhook, token encryption, deployable balance

**Webhook (`POST /api/plaid/webhook`)**: verifies the Plaid `plaid-verification` JWT (ES256, 5-min max age, timing-safe body-SHA-256 check); on `TRANSACTIONS / SYNC_UPDATES_AVAILABLE` runs the item sync + revalidates; logs errors but returns 200 to avoid retry-storms. **Registration (`POST /api/plaid/register-webhook`)**: a one-shot admin endpoint (Bearer ledger token) setting `PLAID_WEBHOOK_URL` on every item. **Token encryption (`lib/plaid/crypto.ts`)**: **AES-256-GCM**, key = SHA-256 of `PLAID_ACCESS_TOKEN_ENCRYPTION_KEY`, format `v1:<iv>:<authTag>:<ciphertext>` (random 12-byte IV). **Deployable balance (`GET /api/ledger/deployable-balance`)**: Bearer endpoint summing live Plaid `available` balances of depository checking/savings accounts, cached in `plaid_deployable_balance_cache`; on Plaid failure returns the cached value flagged `stale`.

### 4. Chime instant-notification capture

**Ingest (`POST /api/chime/ingest`)**, auth via `x-chime-ingest-key` = `CHIME_INGEST_SECRET`; the user is the **first profile** (single-tenant). Flow: parse with the AI Chime parser; for a money-movement kind with a non-zero amount, derive the **local** ISO date from `receivedAt` (so a late-night EDT email lands on the right local day), match the day, decide status like Plaid sync (credits/refunds/deposits/transfers-in auto-excluded). **Amount guardrail:** a zero-amount parse is skipped + flagged. **Dedup both directions** (existing Plaid or prior Chime row → link, not duplicate; an `import_key` for further dedup). Every notification — parsed or not — is written to `chime_raw_captures` for the audit panel. **Sources:** Tasker → ingest (primary, instant), a Gmail-IMAP cron (backfill), and `POST /api/chime/test` (synthetic). **Captures UI** groups raw captures by date with a parse-status chip.

### 5. Transaction normalization

**Merchant cleaning (`merchant-ai.ts`)**: a two-stage cleaner with a `merchant_name_cache`. Deterministic `normalizeTxName` first; if still "ugly" (`isLikelyUglyMerchantName`: digits, URLs, processor prefixes `SPO*`/`TST*`/`SQ*`/`PYP*`, > 3 words, > 22 chars), fall back to **Anthropic Haiku** (`claude-haiku-4-5`) returning a clean name or "UNKNOWN." **Legacy rules (`legacyRules.ts`)**: `normalizeTxName` collapses noisy descriptions via a `MERCHANT_MAP`; `isLegacyExempt` auto-excludes recurring/subscription/rent/insurance/utility transactions; also holds the cashflow color tiers (with a documented gotcha that `globals.css` overrides `text-amber-600`, so `text-amber-500` is used).

### 6. Chime AI parser (`chime-parser.ts`)

Server-only. A deterministic payment-request short-circuit first (no API call); otherwise **Anthropic Haiku** (`temperature: 0`, `max_tokens: 400`) classifies into `purchase`/`deposit`/`transfer_in`/`transfer_out`/`refund`/`payment_request`/`pending_charge`/`balance_alert`/`card_event`/`unknown_known_chime`, extracting amount, merchant/source, new balance, direction, confidence, and one-sentence reasoning.

### 7–8. ShiftlyCal — nutrition tracker

ShiftlyCal ("the cal tab", `/cal` and `/cal/trends`) is a **sibling/embedded nutrition app** gated behind `showCal` (personal edition only). **Data model:** `food_entries` (calories + seven nutrients, category, time, `saved_food_id`, `is_projected_plan`, verdict fields); separate `water_logs` (insert-only) and `weight_logs` (upsert/day); `saved_foods`; day/week roll-ups in **TypeScript** (not SQL), week Sunday→Saturday.

**Four ways to log food:** saved-food quick log; manual entry; **AI estimate** (free text / voice via Web Speech / nutrition-label photo, `estimate.ts`, **`claude-sonnet-4-5`**, web-search enabled, re-sums component macros); **paste-and-log** bulk import (no AI). **Targets/TDEE** live in `settings` (user-entered TDEE, macro/micro targets, water, profile incl. phase ∈ cut/maintain/bulk/recomp, `health_flags[]`, `banned_foods[]`), edited on the Trends page.

**Verdicts (two layers):** *per-entry* are **AI-driven** (`verdict.ts`, Sonnet, temp 0.1) stored binary `good`/`bad` (binge cap > 40% TDEE, phase calorie band, protein/fiber guardrails, conditional health-flag rules, strict no-numbers/no-shaming, sanitized); scored in the background, polled every 4s. *Per-day* (`dayVerdict.ts`, `day_food_verdicts`) are **pure rules** (`good` iff calories within ±10% TDEE AND protein ≥ 90% target; only the one-line reason from Haiku), re-normalized on every load. **Coach reviews** are a **kill-switched** (`ENABLE_CAL_COACH=1`), cached, snarky one-liner layer (code computes signals; Sonnet only writes the line).

**Weekly view + trends:** a 7-day verdict-colored strip, focused-day column, water/weight panels, saved-food quick log; the Trends page covers a **28-day** grid + the targets/saved-foods editors. **Projection maintenance:** on every cal load, `projectionMaintenance.ts` regenerates placeholder "Projected" meals (breakfast 28% / lunch 36% / dinner 36% of targets) for empty future days via `reset_shiftlycal_projected_entries`; logging real food deletes that day's projected rows. Weight-change projected simply as `deficit / 3500`.

### 9. Settings pages

**Account password (`/settings/account`)**: the signed-in email + a set-password form (`updatePasswordAction`, min 10 chars) → `supabase.auth.updateUser`. Not capability-gated. **Template (`/settings/template`, "Templates")**: gated by `showWeeklyTemplate`; edits the weekly autofill template + (when `showCustomJobs`) the custom jobs.

### 10. Theme, auth, setup, navigation shell

**Theme (site-wide, cookie-persisted):** **`linear`** (default — near-black, lavender `#5e6ad2`) and **`apple`** (light `#f5f5f7`, white cards, SF Pro, action-blue `#0066cc`); a retired `legacy` block remains as rollback. Pure **`[data-theme]` CSS-variable remap** in `globals.css` over one token contract. The root layout reads the `shiftlycash-theme` cookie server-side and sets `data-theme` on `<html>` before first paint (no flash, default `linear`); `ThemeToggle` (sidebar footer) flips it immediately + writes the cookie (1-year) + localStorage. Shared constants live in a non-client `theme.ts`.

**Auth (password-only, no magic links):** Login (`/login`, branded **"Bashflow"**) is a single password field; `signInWithPassword` reads `SHIFTLYCASH_LOGIN_EMAIL`. `requireUser` guards every protected route; `requireUserWithBootstrapStatus` fast-paths on a `settings` row else runs `bootstrap_user_defaults`. A legacy `/auth/confirm` handles old OTP links; `/auth/logout` signs out. Session refresh in middleware (`proxy.ts`). Clients: SSR `server.ts`, browser `client.ts`, service-role `admin.ts`.

**Setup wizard (`/setup`)**: gated by `showSetup` (consumer edition only) — an explicitly **preview/non-persisting** five-step onboarding ("nothing here is stored yet").

**Navigation shell:** the layout filters each nav link by capability. Full set: Setup (consumer), Dashboard, Fixed, History, Trends, Paychecks (full), Debt, Net Worth, Screener (full), ShiftlyCal (full), Templates (full). `AppNav` = a fixed left rail (desktop) / hamburger drawer (mobile) with logo, active highlight, theme toggle, user email, Sign Out; `SwipeNavigation` adds mobile left/right swipes.

**Editions (`lib/edition.ts`):** `APP_EDITION` selects `personal` (default, everything except Setup) or `consumer` (basic finance + Setup, disabling paycheck audit, ShiftlyCal, screener, wealth projection, tax set-aside, weekly template, custom jobs). Banking is on in both.

### 11. Cron jobs

No `vercel.json` — crons are fired by an **external scheduler (cron-job.org)** hitting Bearer (`CRON_SECRET`) GET routes (Node runtime, admin client): **`/api/cron/plaid-sync`** (300s, per-item sync, the webhook safety net); **`/api/cron/gmail-chime-sync`** (kill-switched `ENABLE_GMAIL_CHIME_SYNC=1`, self-throttled via `cron_runs` ~30-min floor, backgrounded IMAP over `imap.gmail.com`, dedup against `chime_gmail_processed`, replays each email through `/api/chime/ingest`); **`/api/cron/notion-sync`**.

### 12. Export endpoints

Two Bearer (`SHIFTLYCASH_LEDGER_TOKEN`) read-only JSON snapshots (user via `SHIFTLYCASH_LEDGER_USER_ID` or first profile): **`/api/export/ledger-fields`** (a comprehensive finance snapshot — cashflow windows, income/paycheck schedule, spending + rolling-30d top categories, baseline, closed-week history stats, debt, the full projection block + tax liabilities, plan metrics incl. projected debt-free/millionaire dates and age) and **`/api/export/nutrition-fields`** (the ShiftlyCal snapshot — targets, today, current week, rolling 7d/28d windows, saved foods, 28 trend days).

### 13. Notion sync (`lib/notion-sync/index.ts`)

`runNotionSync` (Bearer ledger token + `NOTION_API_KEY`) fetches both export snapshots and upserts one row per current week into two Notion databases (a **Foundation ledger** ~50 properties + a **Nutrition ledger**), querying by "Week start" date and PATCHing/POSTing; missing values are dropped so a partial snapshot never clears existing fields.
