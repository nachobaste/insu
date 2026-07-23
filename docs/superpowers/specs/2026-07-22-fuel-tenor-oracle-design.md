# Fuel oracle + tenor pricing — Guatemala regular gas & CDMX Magna

**Date:** 2026-07-22
**Status:** Approved for planning
**Contracts touched:** `gas-price-guatemala-q45` (GT, new oracle), `gas-price-magna-cdmx` (MX, existing oracle)

## Problem

Guatemala fuel prices spiked after the MEM subsidy ended (2026-07-02): regular gas
went from a subsidized ~Q31 to **Q40.09/gal (week of Jul 20)** and is drifting up
~Q0.49/week. The `gas-price-guatemala-q45` contract meant to cover this is a dead
placeholder:

- `trigger_type = 'manual'` → the poller ignores it (not in `POLLABLE_TRIGGER_TYPES`).
- **Zero `oracle_readings`, ever** — nothing tracks the price.
- The only fuel fetcher (`lib/oracle/gasFetcher.ts`) is CDMX-only (Mexican CRE feed).
- `base_probability = 0.25` was set under the subsidy and no longer reflects reality.

Separately, both fuel contracts are currently one-shot bets against a fixed
`trigger_deadline` (2026-12-31) with no way for a buyer to pick a shorter horizon.
We want short, selectable **7 / 14 / 30-day** protection windows instead — this is a
concept test for friends & family, so the priority is a working, tryable product
over precise pricing.

## Goals

1. Build a real Guatemala regular-gasoline oracle (weekly MEM reference price via AGN).
2. Convert **both** fuel contracts to selectable 7/14/30-day tenor products.
3. Recalibrate probabilities for the new tenor model and current price regime.
4. Launch both **live** immediately.

## Non-goals

- No superior/diesel fuels (regular only).
- No paid fallback data source (AGN only; skip the write on any parse failure).
- No new cron (the existing oracle-poll cron picks up `trigger_type='fuel'`).
- No change to the shared `{1,3,7,30}` menu for non-fuel recurring contracts.
- Not reintroducing sub-threshold oracle-multiplier proximity (that was the
  0.3-floor double-count bug — see `project_oracle_multiplier_floor`).

## Background: the two pricing paths

- **Non-recurring** (`priceTier`, `lib/pricing/engine.ts`): one premium tied to
  `trigger_deadline`; **no tenor menu**. What both fuel contracts use today.
- **Recurring** (`priceTenor` + `dailyHazard` + `tenorAvailable`,
  `lib/pricing/derivative.ts`): the tenor-menu path. `base_probability` is a
  **daily hazard**; window premium = `payout × Σ_{k=1..maxPayouts} P(N≥k) × loading ×
  capacity`, with `P(N≥k)` a Binomial(T, p) tail (`probAtLeastK`), the 0.70
  `MAX_PREMIUM_FRACTION` cap, and the `$5 MIN_PREMIUM_USD` floor.

Selectable 7/14/30-day windows **are** the recurring path. So both fuel contracts
become `is_recurring = true`.

## Design

### 1. Guatemala fuel fetcher — `lib/oracle/guatemalaFuelFetcher.ts` (new)

Mirrors `gasFetcher.ts`. Exports:

```ts
export async function fetchGuatemalaFuelPrice(
  fuelType: 'regular' | 'superior' | 'diesel',
): Promise<FetchedReading>
```

- **Source:** AGN WordPress REST API,
  `https://agn.gt/wp-json/wp/v2/posts?search=precios%20combustibles&per_page=5&orderby=date`.
- **Select** the most recent post in the weekly-price series ("Así quedaron los
  precios de los combustibles…") whose publish date is **within ~14 days**
  (freshness guard — never parse a stale post).
- **Parse** the regular-gasoline figure from the prose with several regex variants
  (`Q40.09`, `40.09 quetzales … regular`, `regular … Q40.09`); take the first
  plausible hit.
- **Plausibility guard:** accept only `20 ≤ price ≤ 80` (GTQ/gallon). Any failure —
  no fresh post, no parse, out of bounds — **throws**. The poller's existing
  `try/catch` then skips the write, so no bad price ever lands. **No fallback source.**
- **Returns:**
  ```ts
  { source: 'agn_mem', reading_type: 'fuel',
    value: { gas_price_quetzales: number, fuel_type: 'regular', reference_week: string } }
  ```

CDMX needs **no** new fetcher — `fetchGasPrice` already works and is unchanged.

### 2. Poll dispatch — `lib/oracle/poll.ts`

In the existing `trigger_type === 'fuel'` branch, dispatch by region:

- `condition.region === 'guatemala'` → `fetchGuatemalaFuelPrice(condition.fuel_type)`
- else (`'cdmx'`) → `fetchGasPrice(condition.fuel_type)` (unchanged)

`gte` operator and the `gas_price_quetzales` metric already work in
`evaluateTrigger`. No trigger-engine change.

### 3. Per-contract tenor menu — `lib/pricing/tenors.ts`

`PERIOD_OPTIONS` stays the global `{1,3,7,30}`. Add:

- `FUEL_PERIOD_OPTIONS = [{7},{14},{30}]`.
- `periodMenuForContract(contract)` → returns `FUEL_PERIOD_OPTIONS` when
  `contract.trigger_type === 'fuel'`, else `PERIOD_OPTIONS`.
- `availablePeriods(p, menu = PERIOD_OPTIONS)` — add the optional menu arg.

1-day/3-day are intentionally excluded from fuel: the GT price is a weekly step, so
a sub-week fuel bet is degenerate; keeping both fuel contracts on the same menu is
consistent.

### 4. Component wiring (2 call-sites)

`components/markets/PurchasePanel.tsx` and `components/markets/ContractDetailClient.tsx`:

- `availablePeriods(hazard)` → `availablePeriods(hazard, periodMenuForContract(contract))`.
- Default-selected period: use `periodOptions[0].days` instead of the hardcoded `1`
  (fuel has no 1-day option). In `PurchasePanel`, the `isRecurring ? 1` default and
  the `initialPeriodDays` sync must fall back to the first available period.

The existing "Pro needs 3+ days" lock (`periodDays <= 1`) never triggers for fuel
(min tenor 7d) — no change needed there.

### 5. Recurring sticker premium — `lib/pricing/reprice.ts`

The recurring branch hardcodes `priceTenor(payout, 1, …)`, so the stored
`premium_usd` sticker is the 1-day premium. Fuel has no 1-day tenor, so price the
sticker at the contract's **min offered tenor** (`periodMenuForContract(contract)[0].days`,
= 7 for fuel) so the market-card "from" price is a real, buyable number. Non-fuel
recurring contracts keep tenor 1 (unchanged).

### 6. Data changes (one-off script, mirrors past DB-only changes)

Both fuel contracts:

| Field | GT `gas-price-guatemala-q45` | MX `gas-price-magna-cdmx` |
|---|---|---|
| `trigger_type` | `manual` → `fuel` | `fuel` (unchanged) |
| `is_recurring` | `false` → `true` | `false` → `true` |
| `trigger_condition` | add `region:'guatemala'`, `fuel_type:'regular'` (keep `metric:gas_price_quetzales`, `operator:gte`, `threshold:45`) | unchanged (`region:cdmx`, `fuel_type:magna`, `operator:gt`, `threshold:25`) |
| `launch_stage` | `coming_soon` → `live` | `live` (unchanged) |
| tiers `base_probability` (daily hazard) | `0.25` → **0.0043** | `0.2` → **0.0020** |

Then run a reprice so the stickers reflect the new model. Both contracts have 0
positions (`total_volume_usd = 0`), so the conversion is risk-free — no live
positions were priced under the old one-shot model.

## Probability calibration (daily hazard)

`base_probability` is now a **daily** hazard `p`; window prob = `1 − (1−p)^T`.

**GT regular, p = 0.0043** (spot Q40.09, +Q0.49/wk, needs +Q4.91 → crossing is
shock-driven within a month):

| Window | P(touch) | Basic $100 | Pro $200×3 |
|---|---|---|---|
| 7d | 3.0% | $5 (floor) | ~$7 |
| 14d | 5.9% | ~$6.76 | ~$14 |
| 30d | 12.1% | ~$13.90 | ~$29 |

**CDMX Magna, p = 0.0020** (spot 23.99 MXN/L pinned for weeks, threshold 25):

| Window | P(touch) | Basic $100 | Pro $200×3 |
|---|---|---|---|
| 7d | 1.4% | $5 (floor) | $5 (floor) |
| 14d | 2.8% | $5 (floor) | ~$6.40 |
| 30d | 5.8% | ~$6.70 | ~$13.50 |

Both are easily tunable via the single `base_probability` value.

### Known limitation

`recurringOracleMultiplier` keeps only the `>1×` (at/above threshold) side, so as
spot climbs toward but stays below the strike (e.g. Q40→Q44), premiums **do not
auto-escalate** — they're carried by `base_probability` and bumped via manual
recalibration if the regime shifts. Acceptable for an F&F concept test; noted so
it's a deliberate choice, not a surprise. Fixing it properly (sub-threshold
proximity without reintroducing the double-count) is a future enhancement.

## Launch posture

Launch both **live** immediately. Safe because the tenor menu prices off
`base_probability` even before the first reading (`recurringOracleMultiplier`
returns 1.0 with no reading), so nothing is blank on day one. Sequence:

1. Ship code (fetcher, dispatch, menu, component wiring, reprice sticker).
2. Dry-run the AGN fetch once to confirm today's parse ≈ Q40.09.
3. Apply the data script (both contracts) + reprice.
4. Trigger one poll so the first GT reading lands; verify via `.oracle-check.mjs`.

## Testing

- **TDD** `guatemalaFuelFetcher` parser against captured AGN fixtures: correct
  extraction, wording variants, freshness rejection, out-of-bounds rejection,
  garbage → throw.
- Unit-test `periodMenuForContract` / `availablePeriods(p, menu)`.
- Unit-test the reprice sticker-tenor selection for fuel vs non-fuel.
- One live dry-run of `fetchGuatemalaFuelPrice('regular')` before the DB flip.
- Post-deploy `.oracle-check.mjs` to confirm the first GT reading and both
  contracts' repriced stickers.

## Files

- `lib/oracle/guatemalaFuelFetcher.ts` — new.
- `lib/oracle/poll.ts` — region dispatch in the fuel branch.
- `lib/pricing/tenors.ts` — `FUEL_PERIOD_OPTIONS`, `periodMenuForContract`, menu arg.
- `lib/pricing/reprice.ts` — min-offered-tenor sticker for fuel.
- `components/markets/PurchasePanel.tsx`, `components/markets/ContractDetailClient.tsx`
  — pass per-contract menu, default to first available period.
- One-off data script (both contracts) + reprice.
- Tests alongside the above.
</content>
</invoke>
