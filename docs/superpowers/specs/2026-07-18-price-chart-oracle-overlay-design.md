# Price-history chart: oracle-metric overlay

*Design — 2026-07-18*

## Problem

The market-detail price-history chart (`components/markets/PriceChart.tsx`) plots two
lines, **Basic** and **Pro**, from `pricing_history.premium_usd_after`. Both are stored
by the daily reprice job (`lib/pricing/reprice.ts`) using `priceTenor(payout, 1, …)` —
i.e. the **1-day** price for every tier.

Two consequences make the Pro line meaningless:

1. **No 1-day Pro product.** Pro (`max_payouts = 3`) is locked on a 1-day window
   (`selectedPeriodDays <= 1`); it only sells at 3+ days. A 1-day Pro price is a price
   for something you cannot buy.
2. **Mathematically identical to Basic.** Over a 1-day window `P(≥2 triggers) = P(≥3) = 0`,
   so Pro's expected payouts equal Basic's. The only difference is the incidental
   **capacity-factor** surcharge (e.g. 1.12× vs 1.20×), an artifact of current pool
   funding — not the multi-payout feature.

So the chart shows two near-identical lines, one of which is a phantom product.

## Goal

Replace the phantom Pro line with a **historical view of the objective trigger metric**
(traffic index, and by extension AQI / rainfall / fuel price), so the chart delivers
**oracle transparency**: "here is the data that decides payouts, and here is your stable
price." We are *not* claiming price co-moves with traffic — post-PR#32 the recurring
oracle multiplier floors at 1.0 and the reprice snapshot is taken at a quiet hour, so the
daily price is deliberately stable between calibrations. A flat price beside a moving
metric is the correct parametric story.

## Design

### 1. Data layer (new)

A helper that returns one point per day for the trigger metric over the chart window:

```
dailyOracleSeries(contractId, days = 30) -> { date: string (YYYY-MM-DD), value: number }[]
```

- **Value per day = in-window max** of the trigger metric — the value that actually
  determines a trigger.
  - "In-window" = readings whose local-time `read_at` falls within the corridor's
    `[window_start, window_end]`.
  - **Non-corridor contracts** (air-quality, flood, fuel) have no commute window → fall
    back to **daily max across all readings**.
- Metric key comes from `trigger_condition.metric`; value read from `oracle_readings.value[metric]`.
- **Timezone:** windows are local (America/Mexico_City for MX, America/Guatemala for GT,
  keyed off the contract/corridor country). Readings' `read_at` is UTC and must be
  converted before the in-window comparison — reuse the `Intl.DateTimeFormat`
  timezone-extraction pattern already in `TrafficPulseBar.isCurrentlyInWindow`.
- **Implementation: JS, no new DB object.** Fetch the contract's `oracle_readings`
  (`read_at`, `value`) for the last `days` (`.gte('read_at', cutoff)`), then aggregate to
  daily in-window max in a pure, unit-testable function. The fetch is a server-side query
  in the existing loaders (service or anon client already in use there). In-window
  readings are few per day (~4–8 over a 1–2 h commute window), so even ~30 days is a small
  result set; aggregation cost is trivial.

Plumbed through the existing bundle (`lib/corridors.ts`) for corridor contracts and the
non-corridor page loader in `app/markets/[slug]/page.tsx`, then passed into `PriceChart`
alongside `pricing_history`.

### 2. Chart (`PriceChart.tsx`)

- **Remove** the Pro `<Area>`.
- **Basic price** line stays on the **left Y axis** ($), unchanged.
- Add the **metric** line on a **right Y axis** (its own scale, e.g. index 0–100).
- Add a dashed **threshold `ReferenceLine`** on the right axis at
  `trigger_condition.threshold`, so proximity to a payout is visible.
- Legend & labels are contract-agnostic, derived from `trigger_condition`
  (`Price` · `<metric label>` · `Trigger threshold`).
- Reuse the existing 30-day-or-first-data windowing and carry-forward logic for the price
  series; align the metric series onto the same date axis. Days with no readings leave a
  gap in the metric line (no carry-forward for the metric — absence of data ≠ prior value).

### 3. Copy / regulatory

Keep to allowed vocabulary ("price", not "premium/coverage"; see the regulatory language
rule). Metric label localized only as far as existing copy already is.

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `dailyOracleSeries` (fetch) + pure aggregator | daily in-window (or all-day) max of the trigger metric | `oracle_readings`, contract window + tz |
| `lib/corridors.ts` bundle + page loader | fetch the series, pass to the view | the helper |
| `PriceChart.tsx` | render price (left) + metric (right) + threshold line | series + `trigger_condition` |

## Testing

- Pure aggregator: in-window filtering picks the right readings; tz conversion correct for
  MX and GT; non-corridor fallback = daily max; empty history → empty series.
- `PriceChart`: renders a single price line (no Pro), a metric line, and a threshold line;
  handles empty metric series (price-only) and empty price history (existing "No pricing
  history yet" state); dual-axis scales independent.

## Out of scope

- Changing the pricing engine so price co-moves with traffic (explicitly rejected — the
  intent is transparency, not a pricing rework).
- Backfilling historical readings beyond what `oracle_readings` already holds; the metric
  line simply starts where reading history starts.
- The short-term `TrafficPulseBar` (current + last-6 sparkline) stays as-is; this is its
  long-horizon complement.
