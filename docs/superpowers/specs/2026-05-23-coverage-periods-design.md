# Coverage Periods — Design Spec

**Date:** 2026-05-23
**Status:** Approved

## Summary

Introduce time-bounded coverage periods (1 day, 7 days, 30 days) for recurring-event contracts (`trigger_type: 'weather' | 'urban'`). Buyers choose a period in the purchase panel; the premium scales proportionally from the oracle-adjusted full-duration tier price. Non-recurring contracts (`event`, `manual`) are unchanged — only basic/premium tier selection, no periods.

---

## Product Rules

| Contract type | Purchase panel shows |
|---|---|
| `weather`, `urban` | Period selector + tier selector |
| `event`, `manual` | Tier selector only (existing behaviour) |

Coverage periods available for recurring contracts: **1 day**, **7 days**, **30 days**.

Capital providers (provide mode) never select a period — they earn over the full contract duration regardless.

---

## Pricing

### Period factor

```ts
periodFactor = Math.min(1.0, periodDays / contractDurationDays)
contractDurationDays = (trigger_deadline_ms - created_at_ms) / 86_400_000
```

When `periodDays ≥ contractDurationDays` the factor clamps to 1.0 — the buyer pays the full-duration price (effectively covering the remaining contract window).

### Period premium

```ts
periodPremium = tier.premium_usd * periodFactor
```

`tier.premium_usd` is the oracle-adjusted full-duration price produced by the most recent reprice run. Because the oracle multiplier is already baked into `tier.premium_usd`, period pricing automatically reflects live oracle conditions — no extra logic needed.

### Repricer is unchanged

The repricer continues to price and store the full-duration `premium_usd` on each tier. Period scaling is ephemeral — computed only at purchase time, never written back to the tier.

---

## Data Model

### Migration: `hedger_positions` — two new nullable columns

```sql
ALTER TABLE hedger_positions
  ADD COLUMN coverage_period_days  integer,
  ADD COLUMN coverage_end_at       timestamptz;
```

- `NULL` on both columns = full-duration coverage (non-recurring contracts or legacy positions)
- For period purchases: `coverage_period_days = selectedPeriodDays`; `coverage_end_at = MIN(purchased_at + interval '? days', trigger_deadline)`

### `lib/types.ts` additions

```ts
// On HedgerPosition:
coverage_period_days: number | null
coverage_end_at: string | null
```

---

## Architecture

### New: `computePeriodFactor(periodDays, contract)` — `lib/pricing/engine.ts`

Pure function exported alongside `priceTier`. No DB access, no side effects.

```ts
export function computePeriodFactor(
  periodDays: number,
  contract: Pick<Contract, 'created_at' | 'trigger_deadline'>,
): number {
  const contractDays =
    (new Date(contract.trigger_deadline).getTime() - new Date(contract.created_at).getTime()) /
    86_400_000
  if (contractDays <= 0) return 1.0
  return Math.min(1.0, periodDays / contractDays)
}
```

### Modified: `components/markets/TierSelector.tsx`

New optional prop: `periodFactor?: number` (defaults to 1.0 when absent).

In the buy-mode price line, replace `tier.premium_usd` with `tier.premium_usd * (periodFactor ?? 1.0)`. No other changes.

### Modified: `components/markets/PurchasePanel.tsx`

**New state:**
```ts
const [selectedPeriodDays, setSelectedPeriodDays] = useState<number | null>(null)
```

**New constant:**
```ts
const isRecurring = (['weather', 'urban'] as const).includes(
  contract.trigger_type as 'weather' | 'urban',
)
const PERIOD_OPTIONS = [1, 7, 30] as const
```

**Period factor for display:**
```ts
const periodFactor = selectedPeriodDays
  ? computePeriodFactor(selectedPeriodDays, contract)
  : 1.0
```

**Placement:** Period pills render between the mode toggle and `<TierSelector />`, only when `isRecurring && mode === 'buy'`. Each pill shows the period label and "from $X" price computed from the basic tier at that period factor.

**Reset on mode switch:** `switchMode` already resets `selectedTierId`, `step`, etc. Add `setSelectedPeriodDays(null)` there.

**Continue button disabled when:** the existing `!selectedTierId || loading` condition, plus the new clause `isRecurring && mode === 'buy' && selectedPeriodDays === null`. Both must pass — period and tier are both required for recurring buy flows.

**Pass to action:** `handleContinue` calls `createHedgerPaymentIntent(selectedTierId, selectedPeriodDays ?? undefined)`.

### Modified: `lib/actions/purchase.ts`

```ts
export async function createHedgerPaymentIntent(
  tierId: string,
  periodDays?: number,
): Promise<{ clientSecret: string } | { error: string }>
```

Inside the action:
1. Fetch tier + contract (already done for the payment intent amount)
2. Compute `periodFactor = periodDays ? computePeriodFactor(periodDays, contract) : 1.0`
3. Compute `amount = Math.round(tier.premium_usd * periodFactor * 100)` (cents for Stripe)
4. Pass `coverage_period_days` in PaymentIntent metadata so the webhook can write it to the position

### Modified: `lib/oracle/poll.ts`

Before issuing a payout to a hedger position, add expiry check:

```ts
if (
  position.coverage_end_at &&
  new Date(position.coverage_end_at) < new Date(reading.read_at)
) {
  continue // coverage window expired before trigger fired
}
```

---

## Purchase Panel Flow (recurring contract, buy mode)

```
1. Mode toggle (Buy / Provide)
2. Period selector  ← NEW (weather/urban only, buy mode only)
   [ 1 day · from $0.37 ]  [ 7 days · from $2.61 ]  [ 30 days · from $11.20 ]
3. Tier selector (prices shown at selected period)
   [ Basic — $2.61 premium → $500 payout ]
   [ Premium — $5.22 premium → $1,000 payout ]
4. Continue to payment  (disabled until period + tier both selected)
5. Stripe payment form
6. Done
```

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| `periodDays ≥ contractDurationDays` | `periodFactor` clamps to 1.0 — buyer pays full-duration price |
| Non-recurring contract | No period UI; `periodDays = undefined`; position created with null columns |
| Provide mode | No period selector; `periodFactor = 1.0` always |
| Position with `coverage_end_at = null` | Eligible for payout at any time (legacy + non-recurring) |
| `coverage_end_at` vs `trigger_deadline` | Capped at `trigger_deadline` when writing position |

---

## Testing

### `lib/pricing/engine.test.ts` — `computePeriodFactor`
- Returns correct factor for 7-day period on 90-day contract (≈ 0.0778)
- Clamps to 1.0 when period ≥ contract duration
- Returns 1.0 when `contractDurationDays ≤ 0`

### `tests/components/PurchasePanel.test.tsx`
- Period pills rendered for `weather` contract in buy mode
- Period pills absent for `event` contract
- Period pills absent in provide mode
- "from $X" price on each pill reflects `tier.premium_usd × periodFactor` of the basic tier
- Continue button disabled until both period and tier selected
- `selectedPeriodDays` resets to null when switching mode

### `tests/components/TierSelector.test.tsx`
- Without `periodFactor`: shows raw `tier.premium_usd`
- With `periodFactor = 0.233`: shows `tier.premium_usd × 0.233`

### `lib/actions/purchase.test.ts`
- `createHedgerPaymentIntent` with `periodDays = 7` creates intent for correct amount
- Metadata contains `coverage_period_days = 7`

### `lib/oracle/poll.test.ts`
- Position with expired `coverage_end_at` is skipped when trigger fires
- Position with null `coverage_end_at` is always eligible

---

## Out of Scope

- Period selection for capital providers
- Period display on the contract detail page tier cards (detail page shows full-duration price)
- Auto-renewal of coverage periods
- Partial refunds when coverage expires before trigger
- Admin UI for configuring which periods are available per contract
