# Debt System ? Behavior Spec for Codex

**Audience:** an AI coding agent (Codex) implementing or auditing the Debt page, tax pipeline, and millionaire/net-worth projections in this repo.

**Read this cold.** Everything you need is in this doc ? the legacy app is referenced for context only, you don't need to open it.

**Stack:** TypeScript + Next.js (current breaking-change version, see `AGENTS.md`) + Supabase. Money is stored in **integer cents** end-to-end (`MoneyCents` type). No floats in stored data. Floats only appear in math intermediates and are rounded back to ints before persistence.

---

## 1. Scope of this spec

The "debt system" is the full projection chain ? not just the Debt page UI. It spans:

1. **Tax pipeline** ? federal/CT/FICA bracket math, withholding gross-up, estimated April bill.
2. **Debt page** ? header, metric cards, tables, charts, server actions.
3. **Millionaire / net-worth projections** ? `simulateLegacyMillionaire`, `legacyDebtPaydownTrajectory`, `legacyInvestedTrajectory`, `simulateMillionaire`, `simulateDebtFree`.
4. **Supporting types & constants** ? `WeekRow`, `DebtRow`, `PaySettings`, withholding constants.

Everything below is grouped by file. Files that already exist are marked `(existing)`. Files Codex must create are marked `(new)`.

```
src/lib/domain/projections.ts        (existing) ? pure projection math
src/lib/domain/projections.test.ts   (existing) ? bracket / projection tests
src/lib/domain/pay.ts                (existing) ? per-shift, per-day, per-week earn calc
src/lib/debt/data.ts                 (existing) ? Supabase loader + assembly for the page
src/components/debt/DebtPage.tsx     (existing) ? page UI
src/app/(protected)/debt/page.tsx    (existing) ? route entry, calls getDebtData()
src/app/(protected)/debt/actions.ts  (existing) ? add/update/delete/reorder server actions
```

---

## 1.5 Current implementation architecture

The debt system is a five-layer pipeline. Keep it this way. Do not move math into React, do not let the UI query Supabase directly, and do not add a second state-sync path.

```
[Layer 1: pure tax functions]          src/lib/domain/projections.ts
  fedTax2025(taxableCents) -> cents
  ctTax2025(incomeCents)   -> cents
  ficaTax(incomeCents)     -> cents
  No I/O. Same input always returns the same output.

[Layer 2: pure projection pipeline]     src/lib/domain/projections.ts
  calcWeeklyProjection({ closedWeeks, currentWeekNumber, withholding })
    -> wpc, ypwiNet, ypwiGross, withheldYr, liability,
       estTax, ypgc, ypnc, recent week values, etc.
  This is the only tax-pipeline entry point.

[Layer 3: Supabase loader]              src/lib/debt/data.ts
  getDebtData()
    - reads v_week_totals, settings, debts, assets
    - calls calcWeeklyProjection(...)
    - calls simulateLegacyMillionaire(...)
    - calls legacyDebtPaydownTrajectory(...), legacyInvestedTrajectory(...),
      and simulateDebtFree(...)
    - derives weeklyTaxDue, debtFreeDate, millionaireDate,
      ageAtMillionaire, chart series, and payoff events
    - returns DebtPageData for the UI

[Layer 4: display UI]                   src/components/debt/DebtPage.tsx
  Renders header, metric cards, Path to $1M chart, debt breakdown, and debt table.
  Computes no tax, debt payoff, date, or age logic.

[Layer 5: mutations]                    src/app/(protected)/debt/actions.ts
  addDebtAction / updateDebtAction / deleteDebtAction / reorderDebtsAction
    -> Supabase write
    -> revalidatePath("/debt")
    -> route reload calls getDebtData() again
```

Current architectural rules:

1. The ability/prestige split is exposed through `v_week_totals` as computed per-week totals. The Debt page reads those totals; it does not walk `earn_slots` at render time. Summary-only legacy weeks with the `Week N summary (legacy)` migration slot use the legacy 68/32 fallback in the view so tax projections still receive a complete split.
2. `calcWeeklyProjection` is the single projection and tax pipeline. Withholding rates come from the user's `settings` row with hardcoded fallbacks in the loader. Bracket math stays in pure TypeScript, never in React and never in SQL.
3. Data flows one way: pure functions -> Supabase loader -> display UI -> server actions -> `revalidatePath("/debt")`. No Firebase-style listener, no client-side DB writes, no manual cache layer.

---

## 2. Glossary ? every metric, with formula

These names are sticky. Use them exactly in code, comments, and UI.

| Name | Stands for | Currency | Formula | Lives where |
|---|---|---|---|---|
| `wpc` | Weekly Projected Cashflow | net | `mean(last_window.cashflowCents)` | `ProjectionOutput.wpcCents` |
| `mwe` (legacy) | Mean Weekly Earn | net | `mean(last_window.earningsCents)` | `ProjectionOutput.avgEarningsCents` ? **renamed** |
| `ytdEarn` | Year-to-date earnings | net | `sum(closedWeeks.earningsCents)` | `ProjectionOutput.ytdEarningsCents` |
| `ytdCf` | Year-to-date cashflow | net | `sum(closedWeeks.cashflowCents)` | `ProjectionOutput.ytdCfCents` |
| `weeksRemaining` | Wks left in year incl. current | ? | `max(0, 53 ? currentWeekNumber)` | `ProjectionOutput.weeksRemaining` |
| `YPWI` (net) | Yearly Projected Wage Income | net | `ytdEarn + avgEarningsCents ? weeksRemaining` | `ProjectionOutput.ypwiNetCents` |
| `YPWI_gross` | YPWI grossed up | gross | per-job sum, see ?4 | `ProjectionOutput.ypwiGrossCents` |
| `YPGC` | Yearly Projected Gross Cashflow | net of withholding, pre-April-bill | `ytdCf + wpc ? weeksRemaining` | `ProjectionOutput.ypgcCents` |
| `withheldYr` | Total withholding for the year | gross dollars | YTD + forecast, per-job rates | `ProjectionOutput.withheldYrCents` |
| `fedLiab` | 2025 federal liability | gross | `fedTax2025(YPWI_gross ? stdDed ? otExempt)` | `ProjectionOutput.fedLiabilityCents` |
| `ficaLiab` | FICA (SS + Medicare) | gross | `ficaTax(YPWI_gross)` | `ProjectionOutput.ficaLiabilityCents` |
| `ctLiab` | 2025 Connecticut liability | gross | `ctTax2025(YPWI_gross)` | `ProjectionOutput.ctLiabilityCents` |
| `liability` | Total statutory liability | gross | `fedLiab + ficaLiab + ctLiab` | `ProjectionOutput.totalLiabilityCents` |
| `estTax` | Estimated April bill | dollars owed | `max(0, liability ? withheldYr) + filingFee` | `ProjectionOutput.estTaxCents` |
| `wklyTax` | Weekly tax set-aside | dollars | `round(estTax / 52)` | `DebtPageData.weeklyTaxDueCents` |
| `YPNC` | Yearly Projected Net Cashflow | net of all tax | `YPGC ? estTax` | `ProjectionOutput.ypncCents` |
| `wnc` | Weekly Net Cashflow (post-tax) | net | `YPNC / 52` | derived in `data.ts` as `investableWeeklyCashflowCents` |
| `mweCents` (compat field) | Misnamed monthly net cashflow | net | `YPNC / 12` | `ProjectionOutput.mweCents`; preserved only for compatibility per ?11 |

**Currency convention:**
- "net" = post-withholding (what hits the bank).
- "gross" = pre-withholding (what the IRS sees).
- "post-tax" = both withholding *and* the April bill paid.

`wpc` is **net** but **pre-April-bill** ? withholding is already out, but the April lump isn't. This is the entire reason `estTax` and `wnc` exist as separate values.

---

## 3. Constants

### 3.1 Tax brackets (must match exactly ? these are statutory)

```ts
// 2025 federal single-filer
const FED_BRACKETS_CENTS: Array<[capCents, rate]> = [
  [1_192_500, 0.10],   // up to $11,925
  [4_847_500, 0.12],   // up to $48,475
  [10_335_000, 0.22],  // up to $103,350
  [19_730_000, 0.24],  // up to $197,300
  [25_052_500, 0.32],  // up to $250,525
  [62_635_000, 0.35],  // up to $626,350
  [Infinity,    0.37],
];

// 2025 Connecticut single-filer
const CT_BRACKETS_CENTS: Array<[capCents, rate]> = [
  [1_000_000, 0.020],
  [5_000_000, 0.045],
  [10_000_000, 0.055],
  [20_000_000, 0.060],
  [25_000_000, 0.065],
  [50_000_000, 0.069],
  [Infinity,    0.0699],
];

// FICA 2025
const FICA_SS_CAP_CENTS = 17_610_000;  // $176,100
const FICA_SS_RATE = 0.062;
const FICA_MEDICARE_RATE = 0.0145;
```

### 3.2 Withholding (per-user, stored in Supabase `settings` table)

| Field (DB column) | Default | Meaning |
|---|---|---|
| `ability_withholding_rate` | `0.2652` | Ability Beyond blended fed+FICA+CT all-in |
| `prestige_withholding_rate` | `0.18` | Prestige blended |
| `incentive_withholding_rate` | `0.2652` | Incentive bonuses (same employer as Ability) |
| `filing_fee` | `160` (dollars) | Annual tax-prep filing fee |
| `standard_deduction` | `15000` (dollars) | 2025 federal std deduction, single |

These are read from the `settings` row for the current user; if no row exists, fall back to the defaults above.

`overtimeExemptionCents` is intentionally hardcoded as `dollarsToCents(900)` in `src/lib/debt/data.ts` for v1. Do not add a database column unless the out-of-scope list changes.

### 3.3 Other constants

| Name | Value | Meaning |
|---|---|---|
| `ROLLING_WINDOW_WEEKS` | `2` | Fixed rolling-average window for `wpc` / `mwe` in v1. |
| `MAX_WEEKS_IN_YEAR` | `53` | `weeksRemaining = max(0, 53 ? currentWeekNumber)`. |
| `MILLIONAIRE_TARGET_CENTS` | `100_000_000` | $1M. |
| `MILLIONAIRE_ANNUAL_RETURN` | `0.10` | 10% compounded weekly when balance > 0. |
| `OWNER_BIRTH_*` | `1998-01-12` | Used by Age-at-Millionaire card. Stays hardcoded in v1; see ?11. |
| `4.33` | ? | Months-to-weeks divisor (`52 / 12`). Use the literal in formulas; don't extract a named constant. |

---

## 4. The three pure tax functions

Already implemented in `src/lib/domain/projections.ts`. Codex may need to verify or extend.

```ts
fedTax2025(taxableCents): number
ctTax2025(incomeCents): number
ficaTax(incomeCents): number
```

### 4.1 `fedTax2025` ? bracket walk
```
if taxableCents ? 0: return 0
walk FED_BRACKETS_CENTS:
  for each [cap, rate]:
    if taxableCents ? cap:
      tax += (taxableCents ? lastCap) ? rate
      return round(tax)
    tax += (cap ? lastCap) ? rate
    lastCap = cap
return round(tax)
```

### 4.2 `ctTax2025` ? phasing exemption + bracket walk
```
if incomeCents ? 0: return 0

baseExemption_cents = 1_500_000   // $15,000
phaseoutStart       = 3_000_000   // $30,000 income ? exemption begins to phase
phaseoutEnd         = 4_500_000   // $45,000 income ? exemption fully gone

exemption =
  if incomeCents ? phaseoutStart:  baseExemption
  if incomeCents ? phaseoutEnd:    0
  else:                            max(0, baseExemption ? (incomeCents ? phaseoutStart))
                                   // ? for every $1 of income over $30k, $1 of exemption is lost

taxable = max(0, incomeCents ? exemption)
walk CT_BRACKETS_CENTS over taxable, same as fed
return round(tax)
```

### 4.3 `ficaTax`
```
if incomeCents ? 0: return 0
ssBase = min(incomeCents, FICA_SS_CAP_CENTS)
return round(ssBase ? FICA_SS_RATE + incomeCents ? FICA_MEDICARE_RATE)
```
**Note on Additional Medicare Tax (0.9% over $200k single):** not currently modeled. Only matters at very high income; can be added later.

These three are **pure functions** ? no globals, no DOM, no I/O. Keep them that way.

---

## 5. The projection pipeline ? `calcWeeklyProjection`

`src/lib/domain/projections.ts` already implements this. Spec is here for audit / regression testing.

### 5.1 Inputs
```ts
type ProjectionInput = {
  closedWeeks: WeekRow[];        // sorted ascending by startDate inside the function
  currentWeekNumber: number;     // 1..53
  settings: PaySettings;         // not used by tax math, but threaded for future extension
  withholding: {
    ability: number;             // e.g., 0.2652
    prestige: number;            // e.g., 0.18
    incentive: number;
    filingFeeCents: number;
    standardDeductionCents: number;
    overtimeExemptionCents?: number;  // default 90_000 ($900)
  };
  rollingWindowWeeks?: number;   // default 2
};

type WeekRow = {
  startDate: string;             // YYYY-MM-DD
  earningsCents: number;         // NET
  cashflowCents: number;         // NET, pre-April-bill
  abilityPaycheckCents: number;  // NET, ability slice
  prestigePaycheckCents: number; // NET, prestige slice
};
```

`closedWeeks` should already exclude the in-progress week (the loader filters by `status='closed'`).

`abilityPaycheckCents` and `prestigePaycheckCents` are the per-week net split of earnings between the two jobs. They come from the Supabase view `v_week_totals` which aggregates per-shift earn slots stored at week-close time. They are the **modern equivalent** of the legacy `_wkSplit(w)` helper that walked `w.days[i].earns[]` at render time. **Splitting at write-time is intentional and cleaner ? do not move it back to read-time.**

### 5.2 The pipeline

```
window = closedWeeks.slice(-rollingWindowWeeks)

# Layer 1: window averages
wpc           = mean(window.cashflowCents)
avgEarnings   = mean(window.earningsCents)        # legacy "mwe"
avgAeNet      = mean(window.abilityPaycheckCents)
avgPeNet      = mean(window.prestigePaycheckCents)

# Layer 2: YTD totals
ytdCf         = sum(closedWeeks.cashflowCents)
ytdEarnings   = sum(closedWeeks.earningsCents)
ytdAeNet      = sum(closedWeeks.abilityPaycheckCents)
ytdPeNet      = sum(closedWeeks.prestigePaycheckCents)

# Layer 3: gross-up via withholding rates (NOT the same as paystub net rates)
abilityNetMul  = 1 ? withholding.ability        # e.g., 0.7348
prestigeNetMul = 1 ? withholding.prestige       # e.g., 0.82
ytdAeGross     = ytdAeNet  / abilityNetMul
ytdPeGross     = ytdPeNet  / prestigeNetMul
avgAeGross     = avgAeNet  / abilityNetMul
avgPeGross     = avgPeNet  / prestigeNetMul

# Layer 4: annual projections
weeksRemaining = max(0, 53 ? currentWeekNumber)
ypwiNet        = round(ytdEarnings + avgEarnings ? weeksRemaining)
ypwiGross      = round(ytdAeGross + ytdPeGross
                       + (avgAeGross + avgPeGross) ? weeksRemaining)
ypgc           = ytdCf + wpc ? weeksRemaining

# Layer 5: total withholding (already-pulled + forecast)
withheldYr = round(
    ytdAeGross ? withholding.ability + ytdPeGross ? withholding.prestige
  + (avgAeGross ? withholding.ability + avgPeGross ? withholding.prestige) ? weeksRemaining
)

# Layer 6: statutory liability ? federal uses BOTH deductions
fedLiab  = fedTax2025(ypwiGross ? standardDeductionCents ? overtimeExemptionCents)
ficaLiab = ficaTax(ypwiGross)
ctLiab   = ctTax2025(ypwiGross)
liability = fedLiab + ctLiab + ficaLiab

# Layer 7: bridge metric ? the April bill
estTax = max(0, liability ? withheldYr) + filingFeeCents
# CRITICAL: floor at the filing fee. Even when over-withheld, the $160 fee is still owed.

# Layer 8: net cashflow
ypnc = ypgc ? estTax
wnc  = ypnc / 52    # not part of ProjectionOutput; computed in data.ts
```

### 5.3 Outputs
```ts
type ProjectionOutput = {
  wpcCents, avgEarningsCents, recentEarningsCents, recentCashflowCents,
  weeksRemaining, ytdCfCents, ytdEarningsCents,
  ypgcCents, ypwiNetCents, ypwiGrossCents,
  withheldYrCents,
  fedLiabilityCents, ctLiabilityCents, ficaLiabilityCents, totalLiabilityCents,
  estTaxCents, ypncCents,
  mweCents,  // Compat field: currently `ypnc/12`; leave stable per §11.
};
```

### 5.4 Edge cases
- **No closed weeks:** all averages are `0`. `wpc = 0`, `avgEarnings = 0`, etc. Don't divide by zero.
- **Withholding rate of 0 or 1:** `(1 ? rate)` would be 1 or 0. Guard: if `netMul ? 0`, set the corresponding gross to `0` (don't throw, don't divide by zero).
- **Empty incentive in window:** incentive earnings are bundled into `abilityPaycheckCents` upstream (in `pay.ts`). No special handling here.
- **Negative cashflow window:** allowed. `wpc` can be negative. Downstream consumers (`Debt-Free Date`, `Millionaire Date`) check for positive before computing.
- **`ypwiGross ? stdDed ? otExemption` can be negative:** `fedTax2025` returns `0` for non-positive inputs. Don't pre-clamp.

---

## 6. Per-shift earnings ? `pay.ts`

Already implemented. Quick reference for context:

```
ability  reg  ? hours ? abilityRegularNetRateCents          (NET)
ability  ot   ? hours ? abilityOvertimeNetRateCents         (NET)
prestige reg  ? hours ? prestigeRegularNetRateCents         (NET)
prestige ot   ? hours ? prestigeOvertimeNetRateCents        (NET)
incentive *   ? dollarsToCents(amount) ? incentiveNetMultiplier
                # incentive is entered as gross dollars, multiplied to NET
other         ? dollarsToCents(amount)                      # untaxed flat
none / 0      ? 0
```

`incentiveNetMultiplier = 1 ? WITHHOLDING.incentive ? 0.7348`. Keep this in sync with `withholding.incentive`.

`incentive` gets bucketed into `abilityPaycheckCents` (same employer pays it, same withholding rate). `other` does not contribute to either paycheck slice ? it's untaxed flat and counts only toward total earnings.

`wageHours` (sum of `ability` + `prestige` hours) is tracked separately for paycheck verification. `incentive` and `other` contribute `0` wage hours.

---

## 7. Debt page data assembly ? `src/lib/debt/data.ts`

This is the server-side loader called from the route. It's the single seam between Supabase and the projection engine. The full output (`DebtPageData`) is passed to `<DebtPage initialData={...}/>` as a serialized prop.

### 7.1 Supabase reads (parallel)
```ts
Promise.all([
  supabase.from("debts").select("id, name, balance, minimum_payment, apr, status, priority_order")
    .eq("user_id", user.id).order("priority_order"),
  supabase.from("v_week_totals").select(
    "start_date, display_week_number, earnings_total, cashflow_total, ability_paycheck_earnings, prestige_paycheck_earnings, status"
  ).eq("user_id", user.id).order("start_date"),
  supabase.from("settings").select(
    "ability_withholding_rate, prestige_withholding_rate, incentive_withholding_rate, filing_fee, standard_deduction"
  ).eq("user_id", user.id).maybeSingle(),
  supabase.from("assets").select("linked_debt_id").eq("user_id", user.id).not("linked_debt_id", "is", null),
]);
```

### 7.2 Required schema

`v_week_totals` view (read-only, derived from raw shift/spend data):
```
user_id              uuid
start_date           date
display_week_number  int      -- 1..53, monotonic per user-year
earnings_total       numeric  -- NET dollars
cashflow_total       numeric  -- NET dollars, pre-April-bill
ability_paycheck_earnings   numeric  -- NET ability slice, computed by the view
prestige_paycheck_earnings  numeric  -- NET prestige slice, computed by the view
status               text     -- 'active' | 'closed'
```

For summary-only legacy weeks, `v_week_totals` applies the legacy `_wkSplit`
fallback only when the week contains the migration slot labeled
`Week N summary (legacy)`, `earnings_total > 0`, and both split columns are
zero: `ability_paycheck_earnings = earnings_total * 0.68` and
`prestige_paycheck_earnings = earnings_total * 0.32`. This belongs in the view,
not in `calcWeeklyProjection`, because the projection engine expects complete
`WeekRow` inputs.

`debts`:
```
id               uuid pk
user_id          uuid
name             text
balance          numeric (dollars)
minimum_payment  numeric (dollars, monthly)
apr              numeric (decimal ? 0.185 = 18.5%)
status           text ('active' | 'paid')
priority_order   int (multiples of 10, e.g., 10/20/30?)
```

`settings`:
```
user_id                       uuid pk
ability_withholding_rate      numeric (e.g., 0.2652)
prestige_withholding_rate     numeric
incentive_withholding_rate    numeric
filing_fee                    numeric (dollars)
standard_deduction            numeric (dollars)
```

`assets`:
```
id              uuid pk
user_id         uuid
linked_debt_id  uuid nullable references debts(id)
... (other columns not used by debt page)
```

### 7.3 Derived values

```ts
totalActiveDebtCents  = sum(debts where status='active', balanceCents)
activeDebtCount       = count(debts where status='active')
totalMinPayCents      = sum(debts where status='active', minimumPaymentCents)
weeklyTaxDueCents     = round(projection.estTaxCents / 52)
investableWeeklyCashflowCents = max(0, round(projection.ypncCents / 52))   // this is wnc
```

### 7.4 Debt-Free Date

```ts
legacyDebtFreeWeeks =
  (projection.wpcCents > 0)
    ? Math.ceil(totalActiveDebtCents / projection.wpcCents)
    : null;

debtFreeDateIso =
  (legacyDebtFreeWeeks !== null)
    ? today + legacyDebtFreeWeeks ? 7 days, formatted as YYYY-MM-DD
    : null;
```

**Uses `wpc` (gross-side cashflow), not `wnc`.** Reasoning: dollars thrown at debt principal already paid withholding upstream; the April bill is its own separate problem and shouldn't double-penalize debt payoff.

### 7.5 Linked-debt filter for millionaire step-ups

```ts
linkedDebtIds = new Set(assets.where(linked_debt_id != null).map(linked_debt_id))

millionaireDebts = debts.filter(d =>
    d.status === 'active'
    && d.balanceCents > 0
    && d.minimumPaymentCents > 0
    && linkedDebtIds.has(d.id)
).map(d => ({
  name: d.name,
  balanceCents: d.balanceCents,
  minimumPaymentWeeklyCents: round(d.minimumPaymentCents / 4.33),
}))
```

**Only collateralized debts step up the millionaire chart.** Reasoning: when an auto-loan clears, the monthly minimum genuinely becomes new available cashflow because the budget had room for it. Credit cards typically don't free cashflow on payoff because the slot was discretionary. User can opt a debt in by linking it to an asset.

### 7.6 Millionaire simulation invocations

```ts
// With 10% return ? used for "Path to $1M" chart
millionaireSim = simulateLegacyMillionaire({
  startingBalanceCents: -totalActiveDebtCents,
  weeklyCashflowCents: investableWeeklyCashflowCents,   // = wnc
  debtsList: millionaireDebts,
  targetCents: 100_000_000,
  annualGrowthRate: 0.10,
});

// 0% return, capped at the same horizon ? for "principal only" comparison line
principalMillionaireSim = simulateLegacyMillionaire({
  startingBalanceCents: -totalActiveDebtCents,
  weeklyCashflowCents: investableWeeklyCashflowCents,
  debtsList: millionaireDebts,
  targetCents: 100_000_000,
  annualGrowthRate: 0,
  maxWeeks: millionaireSim.weeklyBalances.length,
});

// legacy net-worth helper series ? uses wpc (gross), not wnc
netWorthTrajectory          = legacyDebtPaydownTrajectory(wpc, totalActiveDebt, 520)
investedNetWorthTrajectory  = legacyInvestedTrajectory(wpc, totalActiveDebt, 520, 0.10)
```

`netWorthTrajectory` and `investedNetWorthTrajectory` are assembled for data
symmetry with the legacy model, but the current Debt page does not render those
series. See ?9.3 before adding chart panels back.

**Why `wpc` for `netWorthTrajectory` and `wnc` for `millionaireSim`?**
- `netWorthTrajectory` is "what does my debt-paydown curve look like if I just keep doing what I'm doing." Gross-side WPC is correct because the series is below zero (paying down debt) for most of it. The current UI does not render this series.
- `millionaireSim` runs for decades with compounding. Using `wpc` would silently overshoot $1M by `estTax/52` every week for the entire horizon. `wnc` lands honestly.

### 7.7 Date / age formatting

```ts
millionaireDateIso =
  (millionaireSim.weeksToTarget !== null)
    ? today + weeksToTarget ? 7 days as YYYY-MM-DD
    : null

ageAtMillionaire = calculateAgeOnDate(millionaireDateIso)   // see ?3.3 for birth constants
millionaireDurationLabel = formatWeekDuration(weeksToTarget)
   // "X yrs Y wks" if X > 0, else "Y wks", else "-" if null
```

---

## 8. Simulation algorithms

### 8.1 `simulateLegacyMillionaire` ? the millionaire chart

```
inputs: startingBalanceCents, weeklyCashflowCents, debtsList, target, rate, maxWeeks
weeklyGrowthRate = rate / 52

balance = startingBalanceCents
weeklyCashflow = weeklyCashflowCents
cumulativeCashflow = 0
debts = debtsList.map({...d, paid: false})
balances = []
payoffEvents = []

for week in 0..maxWeeks:
  balances.push(round(balance))
  if balance ? target:
    return { weeksToTarget: week, weeklyBalances: balances, payoffEvents }

  if balance > 0:
    balance += round(balance ? weeklyGrowthRate)   # compound only when positive
  balance += weeklyCashflow
  cumulativeCashflow += weeklyCashflow

  for debt in debts where !paid:
    if cumulativeCashflow ? debt.balanceCents:
      debt.paid = true
      weeklyCashflow += debt.minimumPaymentWeeklyCents   # step-up
      payoffEvents.push({ week: week+1, name, freedCents })

return { weeksToTarget: null, ... }
```

**Critical semantics:**
- A debt is "paid off" the week your **cumulative cashflow** could have lump-summed it. From that week forward its minimum payment is added to `weeklyCashflow`.
- `weeklyCashflow` mutates over time. Step-ups create the visible green dashed verticals on the chart.
- Compound only when `balance > 0` ? you don't earn interest on a negative net worth.
- `weeksToTarget` records the **first** week at or above target. After that, the loop exits; balances array is shorter than `maxWeeks`.

### 8.2 `legacyDebtPaydownTrajectory` ? legacy save line

```
balances = []
netWorth = -totalDebtCents
for w in 0..maxWeeks:
  balances.push(netWorth)
  netWorth += weeklyCashflowCents
return balances
```

Pure linear. No interest, no avalanche, no per-debt accounting. The crossover point (where the line hits zero) is when `accumulatedCashflow > totalDebt`.

### 8.3 `legacyInvestedTrajectory` ? legacy invest line

Same as 8.2 but compounds at `annualGrowthRate / 52` once balance is positive. Mirror of `simulateLegacyMillionaire` without the step-up logic.

### 8.4 `simulateDebtFree` ? avalanche (highest APR first)

```
active = debts.filter(active && balance > 0).sort(desc by aprBps)
balances = []
for week in 0..maxWeeks:
  for d in active where balance > 0 && aprBps > 0:
    weeklyRate = aprBps / 10000 / 52
    d.balance += round(d.balance ? weeklyRate)        # accrue interest

  totalMinWeekly = sum(round(d.minimumPaymentCents / 4.33) for d in active where balance > 0)
  extra = max(0, weeklyCashflowCents ? totalMinWeekly)

  for d in active:
    minWeekly = round(d.minimumPaymentCents / 4.33)
    d.balance = max(0, d.balance ? minWeekly)
  for d in active where balance > 0 && extra > 0:
    pay = min(d.balance, extra)
    d.balance -= pay
    extra -= pay

  total = sum(d.balance)
  balances.push(total)
  if total === 0:
    return { weeklyBalances, weeksToPayoff: week+1 }
return { weeklyBalances, weeksToPayoff: null }
```

Used for the "weeklyBalances" series passed to the page. Different from ?7.4's `legacyDebtFreeWeeks` ? that's a simpler `ceil(totalDebt / wpc)` heuristic. Both exist; both are surfaced.

### 8.5 `simulateMillionaire` (the non-legacy variant)

A simpler version without debt step-ups. Currently exported but not consumed by the Debt page. Keep it ? it's used elsewhere or planned. Don't delete.

---

## 9. UI surface ? `DebtPage.tsx`

Already substantially implemented. Auditing checklist:

### 9.1 Header
- Title `"Debt Obligations"`, subtitle `"Predict your future. Own your future."`
- "Pulling N closed weeks. Rolling window: wk X, Y." status line (uses `projectionSource`)
- Right-side `Total debt` metric card showing `totalActiveDebtCents` + `activeDebtCount`

### 9.2 Metric cards (10 total, in this order by default)
1. `Earnings avg` ? `avgEarningsCents`, sub: recent week list + count
2. `Cashflow avg` ? `wpcCents`, sub: recent week list + count
3. `Yearly projected wage income` ? `ypwiNetCents`, sub: `YTD $X + avg $Y ? Z wks`
4. `Estimated due tax` ? `estTaxCents`, sub: `fed $X + FICA $Y + CT $Z ? withheld $W + $160`
5. `Weekly tax due` ? `weeklyTaxDueCents`, sub: `set aside per week`
6. `Yearly projected gross cashflow` ? `ypgcCents`, sub: `YTD $X + avg $Y ? Z wks`
7. `Yearly projected net cashflow` ? `ypncCents`, sub: `YPGC $X ? bill due $Y`
8. `Debt-free date` ? `debtFreeDateIso`, sub: `<weeks> wks at $<wpc>/wk gross`
9. `Millionaire date` ? `millionaireDurationLabel`, sub: `on <date> ? $<wnc>/wk ? 10% return`
10. `Age at millionaire` ? `ageAtMillionaire`, sub: `on <date>`

### 9.3 Charts (2 panels)
- **Path to $1M** ? full-width. Renders `millionaireBalances` (10% return) + `principalMillionaireBalances` (0% return) for visual delta. Range buttons `1y / 3y / 5y / 10y / TO $1M`. Step-up markers come from `millionairePayoffEvents`. The y-axis must frame the real starting debt and the $1M target; it must not waste space below the actual negative debt floor.
- **Debt breakdown** ? horizontal bars sorted by balance, largest first.

`netWorthTrajectory` and `investedNetWorthTrajectory` are still assembled by `getDebtData()` for now, but they are not rendered by the current Debt page. Do not re-add the Year Trajectory or standalone 5-Year Projection panels unless the user explicitly asks for them.

Path to $1M visual contract:

- Inputs are precomputed in `data.ts`: invested series, principal-only series, and payoff events. The SVG performs rendering only.
- The `TO $1M` range uses the full invested simulation length and should end at the target when reachable. Short ranges can end before $1M.
- The principal-only series uses the same cashflow and payoff step-ups with `annualGrowthRate = 0`, capped to the invested series length.
- The orange fill below zero is the debt phase. The slate fill above zero is principal-only accumulation. The teal fill between principal and invested is interest earned.
- The invested line, Millionaire Date card, Age card, right-side projection label, and target marker must all derive from the same `weeksToTarget` / series length semantics.
- Week-duration labels come from `src/lib/domain/projection-format.ts`; do not add another local duration formatter.
- Crossover date labels use UTC calendar math via `formatWeekOffsetDateLabel` to avoid local midnight drift.

### 9.4 Debts table
- Columns: Order (up/down arrows) | Name | Balance | Min/mo | APR % | Status | Delete
- Inputs are debounced (700ms) ? call `updateDebtAction`.
- `+ Add debt` calls `addDebtAction`, optimistically appends row.
- Delete shows `window.confirm`. Reorder via up/down arrows ? `reorderDebtsAction` (priorityOrder = (index+1)*10).

### 9.5 Server actions (already done ? `actions.ts`)
- `addDebtAction()` ? inserts default row, returns `{ debtId, priorityOrder }`.
- `updateDebtAction(input)` ? partial update; if `balanceCents ? 0` and `status` not provided, auto-flips `status='paid'`.
- `deleteDebtAction({ debtId })` ? hard delete.
- `reorderDebtsAction({ orderedIds })` ? rewrites `priority_order` to (index+1)*10 for every debt.

All actions: `revalidatePath("/debt")` after success.

---

## 10. Persistence pathway

```
user mutates field on DebtPage.tsx
  ? patchDebtLocal()                             # optimistic local state
  ? scheduleDebtSave() (700ms debounce)
    ? updateDebtAction()                         # server action
      ? supabase.from("debts").update()
      ? revalidatePath("/debt")
        ? router.refresh()                       # client re-pulls getDebtData()
```

**Do not introduce a cloud-sync layer like the legacy Firebase listener.** Supabase + server actions + `revalidatePath` is the entire sync model. No `cloudSave()` equivalent. No `fbIgnoreNext` flag.

---

## 11. Out of scope ? DO NOT implement

The following are **explicitly out of scope.** Codex must not "fix" them, port them from legacy, or build them. They are listed only so a future reader knows they were considered and deliberately excluded. If the user later asks for any of these, treat that as a new request ? don't anticipate.

- **Net Worth page** ? not building one. `simulateLegacyMillionaire` / `wnc` stay Debt-page-only.
- **Paycheck audit / verification flow** ? no expected-vs-actual paycheck comparison. Don't port `LAST_CHECK_*` / `ACTUAL_CHECK_*` / `generatePaycheckReview` from legacy.
- **`overtime_exemption` column** ? keep the hardcoded `dollarsToCents(900)` literal in `data.ts`. Don't add a settings column.
- **User-adjustable rolling window** ? `ROLLING_WINDOW_WEEKS = 2` stays a constant. No UI control, no settings column.
- **Owner birthdate config** ? `OWNER_BIRTH_YEAR/MONTH/DAY` stays hardcoded.
- **Drag-to-reorder metric cards** ? debt-table rows reorder via up/down arrows; metric cards do not reorder.
- **`simulateMillionaire` (non-legacy variant)** ? leave exported as-is. No consumer needed, don't delete.
- **Additional Medicare Tax (0.9% over $200k)** ? not modeled.
- **Withholding-rate change history / mid-year reconciliation** ? using the current rate against full YTD is acceptable.
- **`mweCents` rename or removal** ? leave the field alone. Mis-named but stable; consumers tolerate it.
- **`calcDTI` wiring** ? function stays exported but unused. Not surfacing DTI.
- **Plaid / banking writes into the cashflow path** ? `v_week_totals` is read-only from the Debt page's perspective. Any change to how cashflow is computed happens upstream of this engine.

---

## 12. Acceptance criteria ? tests Codex must pass

Add these to `src/lib/domain/projections.test.ts` (or similar). Existing test file already covers some of these.

### 12.1 Bracket math
- `fedTax2025(0)` ? `0`
- `fedTax2025(-100)` ? `0`
- `fedTax2025(1_192_500)` ? `119_250` (top of 10% bracket)
- `fedTax2025(2_000_000)` ? 10% ? $11,925 + 12% ? $8,075 ? `1,_192_50 + 96_900 = $2,161.50` ? assert exact cents
- `ctTax2025(3_000_000)` ? exemption $15k ? taxable $15k ? `42_500` (10k ? 2% + 5k ? 4.5%)
- `ctTax2025(4_500_000)` ? exemption fully phased out ? assert exact value (`177_500` per current test)
- `ctTax2025(0)` ? `0`
- `ficaTax(10_000_000)` ? `10_000_000 ? 0.062 + 10_000_000 ? 0.0145` = `620_000 + 145_000 = 765_000`
- `ficaTax(20_000_000)` ? SS capped at `17_610_000` ? 0.062 + `20_000_000 ? 0.0145` = `1_091_820 + 290_000 = 1_381_820`

### 12.2 Pipeline
- Rolling window of 2 ? `avgEarnings = mean`, `wpc = mean`, `recentEarningsCents.length = 2`.
- `currentWeekNumber=10` ? `weeksRemaining = 43`.
- `withholding.ability = 1` ? `abilityNetMul = 0` ? no division-by-zero, gross terms set to `0`.
- `closedWeeks = []` ? all averages `0`, no NaN, no throw.
- `liability < withheldYr` ? `estTax === filingFeeCents` (floor at filing fee).
- `closedWeeks` order is robust to input order (function sorts internally by `startDate`).

### 12.3 Simulation
- `simulateLegacyMillionaire` step-up: a debt with `balance=20_000`, `minWeekly=5_000`, weeklyCf=10_000, target=50_000, growth=0 ? `payoffEvents[0] = { week: 2, name, freedCents: 5_000 }`, `weeksToTarget = 4`.
- `simulateLegacyMillionaire` with `target=Infinity` runs to `maxWeeks` and returns `weeksToTarget: null`.
- `simulateDebtFree` with empty list ? `weeklyBalances=[0]`, `weeksToPayoff=0`.
- `simulateDebtFree` allocates extra cashflow to highest APR first ? verify with two debts of equal balance, different APR.
- `legacyDebtPaydownTrajectory(wpc=1_000, totalDebt=10_000, weeks=20)`: crossover at week 10, end at +10_000.

### 12.4 Date / formatting
- `formatWeekDuration(null)` ? `"-"`
- `formatWeekDuration(0)` ? `"0 wks"`
- `formatWeekDuration(52)` ? `"1 yrs 0 wks"`
- `formatWeekDuration(104)` ? `"2 yrs 0 wks"`
- `calculateAgeOnDate("2026-01-12")` (birthday) ? 28
- `calculateAgeOnDate("2026-01-11")` (day before birthday) ? 27

### 12.5 Round-trip integration
- A debt with `balanceCents = 0` and `status='active'` ? after update, status auto-flips to `'paid'` (verify via action).
- Reorder calls write `priority_order = (index+1) ? 10` for every row in the supplied order.

---

## 13. Source-of-truth references

### Legacy app (read-only context)
- `Cashflow App/index.html` is the legacy single-file vanilla-JS app. **Don't modify it.**
- Tax functions: lines 1659?1683.
- `WITHHOLDING` constant: line 1647?1657.
- Per-shift `eEarn`: lines 1930?1936.
- `_wkSplit` (inline in legacy): lines 3393?3410 (debt page) and 3250?3264 (calcWnc).
- Annual pipeline: lines 3393?3445 (debt) and 3244?3285 (calcWnc ? duplicate kept in sync).
- `simulateMillionaire` (legacy, with step-ups): lines 3814?3844.
- `buildDebtsForSim` (linked-asset filter): lines 3851?3859.
- `renderDebtTimeline` / `renderMultiYearChart` / `renderDebtBar`: lines 3543?3804.

### New app (modify)
- `src/lib/domain/projections.ts` ? pure math (already implemented).
- `src/lib/domain/pay.ts` ? per-shift earn calc (already implemented).
- `src/lib/debt/data.ts` ? Supabase loader.
- `src/components/debt/DebtPage.tsx` ? UI.
- `src/app/(protected)/debt/page.tsx` ? route entry.
- `src/app/(protected)/debt/actions.ts` ? server actions.

### Schema
- Migration files live in `supabase/migrations/` (verify path). Do not add `settings.overtime_exemption` or `settings.rolling_window_weeks` in v1; both are explicitly out of scope.

---

## 14. Style conventions

- **Cents-as-int everywhere.** No floats in DB columns, no floats in API surface. Floats only in math intermediates.
- **Named constants for magic numbers** *except* `4.33` (months-to-weeks) ? keep as literal in formulas, it's universally recognized.
- **Pure functions** for math. No DOM access, no I/O, no globals.
- **Server actions** for mutations. No client-side Supabase writes.
- **`revalidatePath("/debt")`** after every write. No manual cache busting.
- **Don't add error handling for impossible inputs.** `fedTax2025(-1)` returns 0; that's the contract. No throw.
- **Comments only when the *why* is non-obvious.** All formulas in this spec have a why; preserve them at the call site if a reader would otherwise misread the intent.
- **Tests live next to the code** ? `projections.test.ts` next to `projections.ts`. Vitest.

**End of spec.** When in doubt, the legacy `index.html` behavior is the source of truth; the new TypeScript implementation is the target. Match the legacy's *outputs*, not its *implementation* ? idiomatic TS + the Supabase architecture take precedence wherever they diverge from the single-file structure.
