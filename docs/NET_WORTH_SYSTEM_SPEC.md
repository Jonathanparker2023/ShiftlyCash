# Net Worth System Spec

**Audience:** an AI coding agent implementing the future Net Worth page in ShiftlyCash.

This page is not the Debt page. It may reuse projection primitives, but its visual contract and data contract live here.

---

## 5.5 Net Worth -> Projection Chart

### Two-Series Stacked Area Chart

Over N years, default 12:

- **Series 1, base:** cumulative principal contributed.
  - Formula: sum of weekly cashflow surplus deposits to date.
- **Series 2, stacked on top:** compounded interest earned.
  - Formula: projected value minus cumulative principal.

Total height at any point equals projected portfolio value.

Visual:

- Principal uses a muted tone.
- Interest uses an accent color stacked above principal.
- The chart should make it obvious when compounding overtakes contributions, called the crossover year.

Inputs:

- Starting balance.
- Weekly contribution, auto-pulled from cashflow surplus.
- Assumed annual return percentage.
- Horizon years.

Tooltip per year:

- Principal dollars.
- Interest dollars.
- Total dollars.
- Percent from interest.

---

### Layout: Collision Avoidance

- Y-axis labels and chart legend are anchored to the left side.
- Series labels, `Principal` and `Interest`, are positioned as left-side inline labels at Year 1.
- Series labels must not float directly on the curve.
- Crossover-year callout is pinned to the left padding zone with a leader line to the crossover point.
- Crossover-year callout must never overlap the stacked area.
- Right side is reserved as clean runway for the curve rising into Year N.
- Chart container uses 80px left padding for labels and 20px right padding.

---

### Y-Axis Dynamic Scaling For Timeframe Toggle

- Y-axis max equals the max value within the currently selected timeframe plus 10% headroom.
- Y-axis must not be locked to the full horizon terminal value.
- Y-axis recalculates on every timeframe toggle.
- Supported timeframe toggles: `1M`, `3M`, `1Y`, `3Y`, `All`.
- Scale transition should animate smoothly over 300ms.

Examples:

- `All` view, 12 years: Y-axis 0 -> about $1.1M.
- `1Y` view: Y-axis 0 -> about $60K, using Year 1 target plus 10%.
- `3M` view: Y-axis 0 -> current quarter ceiling.

Crossover callout:

- Render only if the crossover year falls inside the visible window.
- Hide it when the crossover year is outside the current timeframe.
