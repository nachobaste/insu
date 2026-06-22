# Recurring Derivative-Style Protection Pricing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reprice recurring (`urban`/`nature`) protections as perpetual binary/digital options priced purely on per-position tenor, fixing the landing-vs-buy price discrepancy.

**Architecture:** A new focused pricing module (`lib/pricing/derivative.ts`) computes premiums and live position values from one daily hazard rate `p`. Recurring contracts lose their deadline and settle per-position (never per-contract); Basic is one-touch, Pro pays up to 3 times then knocks out. One-time `events`/`experiences` keep the existing `priceTier`/deadline path untouched. The UI computes live engine prices instead of multiplying a stored `premium_usd` by a period factor.

**Tech Stack:** Next.js (App Router), TypeScript, Supabase (Postgres + RLS), Stripe, Vitest + Testing Library.

**Branch:** `feat/recurring-derivative-pricing` (already created off `main`).

**Spec:** `docs/superpowers/specs/2026-06-21-recurring-protection-pricing-design.md`

---

## File Structure

**Create:**
- `lib/pricing/derivative.ts` — hazard rate, binomial tail, tenor premium, position fair-value. Pure functions, no I/O.
- `tests/lib/pricing/derivative.test.ts` — unit tests for the above.
- `supabase/migrations/20260621000001_recurring_derivative_pricing.sql` — schema + data migration.

**Modify:**
- `lib/types.ts` — add `max_payouts` to `CoverageTier`; add new fields to `HedgerPosition`.
- `lib/supabase/database.types.ts` — mirror the new columns.
- `lib/actions/purchase.ts` — recurring branch: live `priceTenor`, reservation, tenor expiry; drop `computePeriodFactor`.
- `lib/payout/processor.ts` — recurring branch: per-position, per-day, cap-3, knockout, reserve release.
- `lib/pricing/reprice.ts` — recurring branch: refresh `premium_usd` sticker = 1-day Basic.
- `lib/pricing/engine.ts` — remove `computePeriodFactor` (keep `priceTier` for one-time).
- `components/markets/ContractDetailClient.tsx`, `components/markets/PurchasePanel.tsx`, `components/markets/TierSelector.tsx` — live prices, default 1-day, drop `periodFactor`.
- `components/dashboard/*` (position list) — show live mark.
- `tests/lib/pricing/engine.test.ts` — remove `computePeriodFactor` describe block.

---

## Phase 1 — Pricing core (`lib/pricing/derivative.ts`)

### Task 1: Binomial tail probability `probAtLeastK`

**Files:**
- Create: `lib/pricing/derivative.ts`
- Test: `tests/lib/pricing/derivative.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/pricing/derivative.test.ts
import { describe, it, expect } from 'vitest'
import { probAtLeastK } from '@/lib/pricing/derivative'

describe('probAtLeastK', () => {
  it('P(N>=1) on 1 day = p', () => {
    expect(probAtLeastK(1, 0.1, 1)).toBeCloseTo(0.1, 6)
  })
  it('P(N>=1) on 2 days, p=0.5 = 0.75', () => {
    expect(probAtLeastK(2, 0.5, 1)).toBeCloseTo(0.75, 6)
  })
  it('P(N>=2) on 2 days, p=0.5 = 0.25', () => {
    expect(probAtLeastK(2, 0.5, 2)).toBeCloseTo(0.25, 6)
  })
  it('P(N>=2) on 3 days, p=0.5 = 0.5', () => {
    expect(probAtLeastK(3, 0.5, 2)).toBeCloseTo(0.5, 6)
  })
  it('k=0 is always 1', () => {
    expect(probAtLeastK(30, 0.2, 0)).toBe(1)
  })
  it('cannot get 2 events in a 1-day window', () => {
    expect(probAtLeastK(1, 0.4, 2)).toBe(0)
  })
  it('degenerate inputs', () => {
    expect(probAtLeastK(0, 0.5, 1)).toBe(0)
    expect(probAtLeastK(10, 0, 1)).toBe(0)
    expect(probAtLeastK(10, 1, 1)).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/pricing/derivative.test.ts`
Expected: FAIL — `probAtLeastK is not a function` / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/pricing/derivative.ts

/**
 * P(N >= k) where N ~ Binomial(T, p) — probability of at least k trigger-days
 * in a T-day window. Computed via the cumulative lower tail using the stable
 * term recurrence term_j = term_{j-1} * (T-j+1)/j * p/(1-p).
 */
export function probAtLeastK(T: number, p: number, k: number): number {
  if (k <= 0) return 1
  if (T <= 0 || p <= 0) return 0
  if (p >= 1) return 1
  if (k > T) return 0
  let term = Math.pow(1 - p, T) // j = 0
  let cdf = term
  for (let j = 1; j < k; j++) {
    term = (term * (T - j + 1) / j) * (p / (1 - p))
    cdf += term
  }
  return Math.max(0, Math.min(1, 1 - cdf))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/pricing/derivative.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/derivative.ts tests/lib/pricing/derivative.test.ts
git commit -m "feat(pricing): binomial tail probAtLeastK for tenor pricing"
```

---

### Task 2: Daily hazard rate `dailyHazard`

**Files:**
- Modify: `lib/pricing/derivative.ts`
- Test: `tests/lib/pricing/derivative.test.ts`

- [ ] **Step 1: Write the failing test** (append to the test file)

```ts
import { dailyHazard, P_MIN, P_MAX } from '@/lib/pricing/derivative'

describe('dailyHazard', () => {
  const condition = { metric: 'delay_pct', operator: 'gte', threshold: 50 } as never

  it('multiplies base by oracle multiplier (normal conditions ~1x)', () => {
    const reading = { value: { delay_pct: 50 } } // actual/threshold = 1
    expect(dailyHazard(0.05, reading, condition)).toBeCloseTo(0.05, 4)
  })
  it('clamps up to P_MAX in extreme conditions', () => {
    const reading = { value: { delay_pct: 500 } } // multiplier clamps at 3.0
    expect(dailyHazard(0.4, reading, condition)).toBe(P_MAX) // 0.4*3=1.2 -> 0.95
  })
  it('clamps down to P_MIN when tiny', () => {
    const reading = { value: { delay_pct: 5 } } // multiplier -> 0.3 (min)
    expect(dailyHazard(0.001, reading, condition)).toBe(P_MIN) // 0.0003 -> 0.0005
  })
  it('null reading -> multiplier 1.0', () => {
    expect(dailyHazard(0.05, null, condition)).toBeCloseTo(0.05, 4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/pricing/derivative.test.ts`
Expected: FAIL — `dailyHazard is not a function`.

- [ ] **Step 3: Write minimal implementation** (append to `lib/pricing/derivative.ts`)

```ts
import { computeOracleMultiplier } from '@/lib/oracle/multiplier'
import type { TriggerCondition } from '@/lib/oracle/trigger'

export const P_MIN = 0.0005
export const P_MAX = 0.95

/** Daily probability the trigger fires: clamp(base x oracleMultiplier). */
export function dailyHazard(
  baseProbability: number,
  reading: { value: Record<string, unknown> } | null,
  condition: TriggerCondition,
): number {
  const multiplier = reading ? computeOracleMultiplier(reading, condition) : 1.0
  const raw = baseProbability * multiplier
  return Math.min(P_MAX, Math.max(P_MIN, raw))
}
```

> Note: keep the `import` lines at the top of the file with any existing imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/pricing/derivative.test.ts`
Expected: PASS (all derivative tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/derivative.ts tests/lib/pricing/derivative.test.ts
git commit -m "feat(pricing): dailyHazard with P_MIN/P_MAX clamp"
```

---

### Task 3: Tenor premium `priceTenor` + `capacityFactor`

**Files:**
- Modify: `lib/pricing/derivative.ts`
- Test: `tests/lib/pricing/derivative.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { priceTenor, capacityFactor, LOADING_FACTOR } from '@/lib/pricing/derivative'

describe('capacityFactor', () => {
  it('1.0 at empty pool, 1.5 at full pool', () => {
    expect(capacityFactor(0, 100000)).toBeCloseTo(1.0, 6)
    expect(capacityFactor(100000, 100000)).toBeCloseTo(1.5, 6)
  })
})

describe('priceTenor', () => {
  it('Basic 1-day: payout x p x loading', () => {
    const { premiumUsd } = priceTenor(500, 1, 0.1, 1, { capacityFactor: 1.0 })
    expect(premiumUsd).toBeCloseTo(500 * 0.1 * LOADING_FACTOR, 2) // 57.5
  })
  it('Pro == Basic at T=1 (only one event possible in a day)', () => {
    const basic = priceTenor(500, 1, 0.1, 1, { capacityFactor: 1.0 }).premiumUsd
    const pro = priceTenor(500, 1, 0.1, 3, { capacityFactor: 1.0 }).premiumUsd
    expect(pro).toBeCloseTo(basic, 6)
  })
  it('Pro > Basic at T=30', () => {
    const basic = priceTenor(2000, 30, 0.1, 1, { capacityFactor: 1.0 }).premiumUsd
    const pro = priceTenor(2000, 30, 0.1, 3, { capacityFactor: 1.0 }).premiumUsd
    expect(pro).toBeGreaterThan(basic)
  })
  it('premium strictly increasing in tenor', () => {
    const d1 = priceTenor(500, 1, 0.05, 1, { capacityFactor: 1.0 }).premiumUsd
    const d7 = priceTenor(500, 7, 0.05, 1, { capacityFactor: 1.0 }).premiumUsd
    const d30 = priceTenor(500, 30, 0.05, 1, { capacityFactor: 1.0 }).premiumUsd
    expect(d7).toBeGreaterThan(d1)
    expect(d30).toBeGreaterThan(d7)
  })
  it('capacity factor scales the premium', () => {
    const lo = priceTenor(500, 7, 0.05, 1, { capacityFactor: 1.0 }).premiumUsd
    const hi = priceTenor(500, 7, 0.05, 1, { capacityFactor: 1.5 }).premiumUsd
    expect(hi).toBeCloseTo(lo * 1.5, 1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/pricing/derivative.test.ts`
Expected: FAIL — `priceTenor is not a function`.

- [ ] **Step 3: Write minimal implementation** (append)

```ts
export const LOADING_FACTOR = 1.15

export interface TenorPriceInputs {
  p: number
  tenorDays: number
  maxPayouts: number
  loading: number
  capacityFactor: number
  expectedPayouts: number
}
export interface TenorPriceResult {
  premiumUsd: number
  inputs: TenorPriceInputs
}

/** Bounded supply/demand surcharge: 1.0x (empty) -> 1.5x (full). */
export function capacityFactor(currentCapacityUsd: number, maxCapacityUsd: number): number {
  const utilization = maxCapacityUsd > 0 ? currentCapacityUsd / maxCapacityUsd : 0
  return Math.min(1.5, 1 + 0.5 * Math.max(0, utilization))
}

/**
 * Premium for a fresh position of `tenorDays`, paying up to `maxPayouts` times.
 * Basic = maxPayouts 1 (one-touch); Pro = maxPayouts 3 (capped strip).
 * premium = payout x (sum_{k=1..maxPayouts} P(N>=k)) x loading x capacityFactor.
 */
export function priceTenor(
  payoutUsd: number,
  tenorDays: number,
  p: number,
  maxPayouts: number,
  opts: { loading?: number; capacityFactor?: number } = {},
): TenorPriceResult {
  const loading = opts.loading ?? LOADING_FACTOR
  const cap = opts.capacityFactor ?? 1.0
  let expectedPayouts = 0
  for (let k = 1; k <= maxPayouts; k++) {
    expectedPayouts += probAtLeastK(tenorDays, p, k)
  }
  const premiumUsd = Math.round(payoutUsd * expectedPayouts * loading * cap * 100) / 100
  return { premiumUsd, inputs: { p, tenorDays, maxPayouts, loading, capacityFactor: cap, expectedPayouts } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/pricing/derivative.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/derivative.ts tests/lib/pricing/derivative.test.ts
git commit -m "feat(pricing): priceTenor (Basic one-touch, Pro capped-3) + capacityFactor"
```

---

### Task 4: Live position value `valuePosition`

**Files:**
- Modify: `lib/pricing/derivative.ts`
- Test: `tests/lib/pricing/derivative.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { valuePosition } from '@/lib/pricing/derivative'

describe('valuePosition (fair value, no loading)', () => {
  it('zero once the window has closed', () => {
    expect(valuePosition(500, 0, 0.2, 1)).toBe(0)
  })
  it('zero when no payouts remain', () => {
    expect(valuePosition(500, 10, 0.2, 0)).toBe(0)
  })
  it('decays toward 0 as remaining days shrink when out-of-the-money', () => {
    const far = valuePosition(500, 20, 0.01, 1)
    const near = valuePosition(500, 2, 0.01, 1)
    expect(near).toBeLessThan(far)
  })
  it('approaches payout as hazard approaches certainty (in-the-money)', () => {
    const v = valuePosition(500, 5, 0.9, 1)
    expect(v).toBeGreaterThan(450) // close to full payout
  })
  it('Pro with payouts remaining worth more than a single touch', () => {
    const single = valuePosition(500, 30, 0.1, 1)
    const triple = valuePosition(500, 30, 0.1, 3)
    expect(triple).toBeGreaterThan(single)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/pricing/derivative.test.ts`
Expected: FAIL — `valuePosition is not a function`.

- [ ] **Step 3: Write minimal implementation** (append)

```ts
/**
 * Fair (mid) value of an open position — NO loading, NO capacity factor.
 * V = payout x sum_{k=1..payoutsRemaining} P(N_remaining >= k | pNow).
 */
export function valuePosition(
  payoutUsd: number,
  remainingDays: number,
  pNow: number,
  payoutsRemaining: number,
): number {
  if (remainingDays <= 0 || payoutsRemaining <= 0) return 0
  let expected = 0
  for (let k = 1; k <= payoutsRemaining; k++) {
    expected += probAtLeastK(remainingDays, pNow, k)
  }
  return Math.round(payoutUsd * expected * 100) / 100
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/pricing/derivative.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/derivative.ts tests/lib/pricing/derivative.test.ts
git commit -m "feat(pricing): valuePosition fair-value mark for open positions"
```

---

## Phase 2 — Schema & types

### Task 5: Migration — columns, deadlines, backfill

**Files:**
- Create: `supabase/migrations/20260621000001_recurring_derivative_pricing.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260621000001_recurring_derivative_pricing.sql

-- 1. coverage_tiers: how many times a position on this tier can pay out.
ALTER TABLE coverage_tiers
  ADD COLUMN IF NOT EXISTS max_payouts integer NOT NULL DEFAULT 1;

-- Basic = one-touch (1), Pro/premium = capped strip (3).
UPDATE coverage_tiers SET max_payouts = 1 WHERE name = 'basic';
UPDATE coverage_tiers SET max_payouts = 3 WHERE name = 'premium';

-- 2. hedger_positions: per-position multi-payout + capital reservation.
ALTER TABLE hedger_positions
  ADD COLUMN IF NOT EXISTS payouts_remaining integer,
  ADD COLUMN IF NOT EXISTS payouts_made integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_payout_date date,
  ADD COLUMN IF NOT EXISTS reserved_usd numeric;

-- Backfill open positions: reserve max_payouts x payout, set remaining.
UPDATE hedger_positions hp
SET payouts_remaining = COALESCE(hp.payouts_remaining, ct.max_payouts),
    reserved_usd       = COALESCE(hp.reserved_usd, ct.max_payouts * hp.payout_amount_usd)
FROM coverage_tiers ct
WHERE hp.tier_id = ct.id
  AND hp.status IN ('active', 'pending_payment');

-- 3. Recurring contracts are perpetual: drop the deadline for urban + nature.
UPDATE contracts
SET trigger_deadline = NULL
WHERE trigger_type IN ('urban', 'nature');

-- 4. Re-baseline base_probability as a DAILY hazard for recurring corridors.
--    Prior values were full-window probabilities. Set a conservative daily
--    baseline; admins tune per-corridor afterwards. (0.05 = ~5% of days breach.)
UPDATE coverage_tiers ct
SET base_probability = 0.05
FROM contracts c
WHERE ct.contract_id = c.id
  AND c.trigger_type IN ('urban', 'nature');
```

- [ ] **Step 2: Apply locally and verify** (if a local Supabase is running; otherwise apply via the project's migration command)

Run: `npx supabase db push` (or the project's standard migration command)
Expected: migration applies cleanly; `\d hedger_positions` shows the 4 new columns and `\d coverage_tiers` shows `max_payouts`.

> If no local DB is available, verify syntax only and note that the migration runs in CI/staging. Do not block the plan on a live DB.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260621000001_recurring_derivative_pricing.sql
git commit -m "feat(db): recurring pricing columns, drop deadlines, daily base_probability"
```

---

### Task 6: TypeScript types

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/supabase/database.types.ts`

- [ ] **Step 1: Update `lib/types.ts`**

In `CoverageTier`, add after `base_probability`:

```ts
  base_probability: number
  max_payouts: number
```

In `HedgerPosition`, add after `coverage_period_days?`:

```ts
  coverage_period_days?: number | null
  payouts_remaining?: number | null
  payouts_made?: number
  last_payout_date?: string | null
  reserved_usd?: number | null
```

- [ ] **Step 2: Update `lib/supabase/database.types.ts`**

In `coverage_tiers` `Row`/`Insert`/`Update`, add `max_payouts: number` (Row) and `max_payouts?: number` (Insert/Update). In `hedger_positions` `Row`/`Insert`/`Update`, add `payouts_remaining: number | null`, `payouts_made: number`, `last_payout_date: string | null`, `reserved_usd: number | null` (Row) with optional `?` variants for Insert/Update.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v 'processor.test.ts:367' | grep -E 'error' || echo OK`
Expected: `OK` (the one pre-existing `processor.test.ts:367` error is unrelated and ignored).

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts lib/supabase/database.types.ts
git commit -m "feat(types): max_payouts + position reservation/payout fields"
```

---

## Phase 3 — Purchase flow

### Task 7: Recurring branch in `createHedgerPaymentIntent`

**Files:**
- Modify: `lib/actions/purchase.ts`
- Test: `tests/lib/actions/purchase.test.ts`

- [ ] **Step 1: Update the failing tests**

Replace the existing period-factor expectation (around `tests/lib/actions/purchase.test.ts:141`) and add reservation assertions. The recurring branch must: charge `priceTenor` (not `premium_usd × periodFactor`), set `expires_at = now + tenor` (no deadline clamp), and store `reserved_usd = max_payouts × payout`, `payouts_remaining = max_payouts`.

```ts
it('recurring: charges priceTenor for the chosen tenor and reserves capital', async () => {
  // tier: payout 500, base_probability 0.05 (daily), max_payouts 1 (basic)
  // contract: urban, trigger_deadline null, with a latest reading
  // 7-day Basic premium = 500 * (1-(0.95)^7) * 1.15 * capFactor
  const { insertArg } = await runRecurringPurchase({ periodDays: 7 })
  expect(insertArg.coverage_period_days).toBe(7)
  expect(insertArg.reserved_usd).toBeCloseTo(500, 6)        // max_payouts 1 * 500
  expect(insertArg.payouts_remaining).toBe(1)
  // expires_at ~ now + 7d (not clamped to a deadline)
  const days = (new Date(insertArg.expires_at).getTime() - Date.now()) / 86_400_000
  expect(days).toBeGreaterThan(6.9)
  expect(days).toBeLessThan(7.1)
})
```

> Implement `runRecurringPurchase` as a small helper in the test mirroring the existing mock setup in this file (mock `createClient`/`createServiceClient`, a `coverage_tiers` row with `max_payouts`, a `contracts` row with `trigger_type: 'urban'` and `trigger_deadline: null`, and an `oracle_readings` latest row). Follow the existing mock patterns already in `purchase.test.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/actions/purchase.test.ts`
Expected: FAIL — current code uses `computePeriodFactor` and does not set `reserved_usd`.

- [ ] **Step 3: Implement the recurring branch**

In `lib/actions/purchase.ts`:

1. Replace the import:
```ts
import { dailyHazard, priceTenor, capacityFactor } from '@/lib/pricing/derivative'
```
(remove `import { computePeriodFactor } from '@/lib/pricing/engine'`).

2. Fetch the tier with `max_payouts`, contract with `trigger_type`, and the latest reading. Replace the pricing + expiry block (currently lines ~46–63) with:

```ts
  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .select('id, trigger_type, trigger_condition, trigger_deadline, created_at')
    .eq('id', tier.contract_id)
    .single()
  if (contractError || !contract) return { error: 'Contract not found' }

  const isRecurring = contract.trigger_type === 'urban' || contract.trigger_type === 'nature'

  let periodPremium: number
  let expiresAt: string
  let reservedUsd: number
  let payoutsRemaining: number

  if (isRecurring) {
    if (!periodDays) return { error: 'Choose a coverage period' }
    const { data: latest } = await supabase
      .from('oracle_readings')
      .select('value')
      .eq('contract_id', contract.id)
      .order('read_at', { ascending: false })
      .limit(1)
    const reading = latest?.[0] ?? null
    const p = dailyHazard(
      Number(tier.base_probability),
      reading,
      contract.trigger_condition as never,
    )
    const cap = capacityFactor(tier.current_capacity_usd, tier.max_capacity_usd)
    periodPremium = priceTenor(tier.payout_usd, periodDays, p, tier.max_payouts, { capacityFactor: cap }).premiumUsd
    expiresAt = new Date(Date.now() + periodDays * 86_400_000).toISOString()
    reservedUsd = tier.max_payouts * tier.payout_usd
    payoutsRemaining = tier.max_payouts
  } else {
    // One-time events/experiences: unchanged deadline-based behavior.
    periodPremium = Math.round(Number(tier.premium_usd) * 100) / 100
    expiresAt = new Date(contract.trigger_deadline!).getTime() > Date.now()
      ? new Date(contract.trigger_deadline!).toISOString()
      : new Date().toISOString()
    reservedUsd = tier.payout_usd
    payoutsRemaining = 1
  }
```

3. In the `hedger_positions` insert, set:
```ts
      premium_paid_usd: periodPremium,
      expires_at: expiresAt,
      coverage_period_days: isRecurring ? periodDays : null,
      reserved_usd: reservedUsd,
      payouts_remaining: payoutsRemaining,
```
and keep `amountCents = Math.max(50, Math.round(periodPremium * 100))`.

4. Update the capacity gate to account for the full reservation:
```ts
  const capacityError = validateBuyerCapacity(tier.current_capacity_usd, tier.max_payouts * tier.payout_usd)
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/actions/purchase.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/purchase.ts tests/lib/actions/purchase.test.ts
git commit -m "feat(purchase): recurring positions priced by tenor with capital reservation"
```

---

### Task 8: UI — live prices, default 1-day, drop periodFactor

**Files:**
- Modify: `components/markets/TierSelector.tsx`
- Modify: `components/markets/ContractDetailClient.tsx`
- Modify: `components/markets/PurchasePanel.tsx`
- Test: `tests/components/TierSelector.test.tsx`, `tests/components/PurchasePanel.test.tsx`

- [ ] **Step 1: Update `TierSelector` to take a per-tier price map**

Replace the `periodFactor` prop with an explicit price lookup so the component renders the engine price directly (no proration math in the view):

```tsx
interface Props {
  tiers: CoverageTier[]
  selectedTierId: string | null
  onSelect: (tierId: string) => void
  mode?: 'buy' | 'provide'
  /** Live premium per tier id for the selected tenor (buy mode). */
  priceByTier?: Record<string, number>
}
```

In the render, replace `const displayPremium = Math.round(tier.premium_usd * factor * 100) / 100` with:

```tsx
const displayPremium = priceByTier?.[tier.id] ?? tier.premium_usd
```

- [ ] **Step 2: Update the test for the new prop**

In `tests/components/TierSelector.test.tsx`, replace the two period-factor tests with:

```tsx
it('shows premium_usd sticker when no price map provided', () => {
  render(<TierSelector tiers={tiers} selectedTierId={null} onSelect={() => {}} />)
  expect(screen.getByText('$12.00')).toBeInTheDocument()
})
it('shows the live price from priceByTier when provided', () => {
  render(<TierSelector tiers={tiers} selectedTierId={null} onSelect={() => {}} priceByTier={{ 'tier-basic': 3.45 }} />)
  expect(screen.getByText('$3.45')).toBeInTheDocument()
})
```

(Use the existing `tiers` fixture ids in that file.)

- [ ] **Step 3: Compute live prices in `ContractDetailClient` and `PurchasePanel`**

Add a shared helper that both import:

```ts
// lib/pricing/quote.ts
import { dailyHazard, priceTenor, capacityFactor } from '@/lib/pricing/derivative'
import type { CoverageTier } from '@/lib/types'
import type { LatestOracleReading } from '@/lib/types'

export function quoteTiers(
  tiers: CoverageTier[],
  tenorDays: number,
  triggerCondition: Record<string, unknown>,
  reading: LatestOracleReading | null,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of tiers) {
    const p = dailyHazard(t.base_probability, reading ? { value: reading.value } : null, triggerCondition as never)
    const cap = capacityFactor(t.current_capacity_usd, t.max_capacity_usd)
    out[t.id] = priceTenor(t.payout_usd, tenorDays, p, t.max_payouts, { capacityFactor: cap }).premiumUsd
  }
  return out
}
```

> Confirm the `LatestOracleReading` shape in `lib/types.ts` has a `value: Record<string, unknown>` field; if the field name differs, adapt the `reading.value` access accordingly.

In `ContractDetailClient.tsx`:
- Initialize the period to 1 day for recurring: `useState<number | null>(isRecurring ? 1 : null)`.
- Remove `computePeriodFactor`/`periodFactor`. Compute `const priceByTier = isRecurring && selectedPeriodDays ? quoteTiers(contract.coverage_tiers, selectedPeriodDays, contract.trigger_condition, latestReading) : undefined`.
- Pass `priceByTier={priceByTier}` to `TierSelector` (drop `periodFactor`).

In `PurchasePanel.tsx`:
- Default `selectedPeriodDays` to `initialPeriodDays ?? (isRecurring ? 1 : null)`.
- Replace the period-button `from` price (`basicTier.premium_usd * pf`) with `quoteTiers(...)[basicTier.id]` for each `days`.
- Replace `periodFactor` passed to `TierSelector` with `priceByTier={quoteTiers(contract.coverage_tiers, selectedPeriodDays ?? 1, contract.trigger_condition, latestReading)}`.
- In the Stripe amount (line ~280), replace `selectedTier.premium_usd * periodFactor` with the quoted price for the selected tier/tenor.

> `PurchasePanel` does not currently receive `latestReading`; thread it through from `ContractDetailClient` as a new prop `latestReading={latestReading}` and add it to `PurchasePanel`'s `Props`.

- [ ] **Step 4: Run component tests**

Run: `npx vitest run tests/components/TierSelector.test.tsx tests/components/PurchasePanel.test.tsx`
Expected: PASS (update fixtures to include `max_payouts` and `base_probability` if TS complains).

- [ ] **Step 5: Commit**

```bash
git add components/markets/ lib/pricing/quote.ts tests/components/TierSelector.test.tsx tests/components/PurchasePanel.test.tsx
git commit -m "feat(markets): live engine prices in detail + purchase UI, default 1-day tenor"
```

---

## Phase 4 — Settlement

### Task 9: Per-position recurring settlement

**Files:**
- Modify: `lib/payout/processor.ts`
- Test: `tests/lib/payout/processor.test.ts`

- [ ] **Step 1: Write failing tests** for the recurring path

```ts
describe('recurring settlement', () => {
  it('pays a Basic position once and knocks it out, contract stays active', async () => {
    // contract: is_recurring true, urban; one trigger-day inside the window
    // position: tier max_payouts 1, payouts_remaining 1, window covers the trigger
    const { db } = await runRecurringSettlement({ maxPayouts: 1, triggerDays: ['2026-06-21'] })
    const contractUpdates = db.updates('contracts')
    expect(contractUpdates).toHaveLength(0) // contract never settled
    const posUpdate = db.lastUpdate('hedger_positions')
    expect(posUpdate.status).toBe('knocked_out')
    expect(posUpdate.payouts_remaining).toBe(0)
  })
  it('pays a Pro position up to 3 distinct trigger-days then knocks out', async () => {
    const { paidCount, posUpdate } = await runRecurringSettlement({
      maxPayouts: 3,
      triggerDays: ['2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21'],
    })
    expect(paidCount).toBe(3)
    expect(posUpdate.status).toBe('knocked_out')
  })
  it('never pays twice for the same calendar day', async () => {
    const { paidCount } = await runRecurringSettlement({
      maxPayouts: 3,
      triggerDays: ['2026-06-20', '2026-06-20'], // same day twice
    })
    expect(paidCount).toBe(1)
  })
})
```

> Build `runRecurringSettlement`/`db` helpers mirroring the existing mock harness in `processor.test.ts` (which already mocks `from(table)` chainables). Track `update` calls per table.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/payout/processor.test.ts`
Expected: FAIL — current `settleContract` settles the contract and pays once per position only.

- [ ] **Step 3: Implement the recurring branch**

In `processPayouts`, fetch **all** trigger-day dates per contract (not just the earliest):

```ts
  const { data: triggeredReadings } = await db
    .from('oracle_readings')
    .select('contract_id, read_at')
    .eq('trigger_met', true)
  // group: contractId -> Set<YYYY-MM-DD>
  const triggerDaysByContract = new Map<string, Set<string>>()
  for (const r of triggeredReadings ?? []) {
    const day = new Date(r.read_at).toISOString().slice(0, 10)
    const set = triggerDaysByContract.get(r.contract_id) ?? new Set<string>()
    set.add(day)
    triggerDaysByContract.set(r.contract_id, set)
  }
```

Then branch in `settleContract` on `contract.is_recurring`:

```ts
  if (contract.is_recurring) {
    return settleRecurring(db, stripe, contract, triggerDaysByContract.get(contract.id) ?? new Set())
  }
  // ...existing one-time logic unchanged (uses earliest trigger as before)...
```

Add `settleRecurring`:

```ts
async function settleRecurring(
  db: DbClient,
  stripe: StripeClient,
  contract: Contract,
  triggerDays: Set<string>,
): Promise<number> {
  const { data: positions } = await db
    .from('hedger_positions')
    .select('*')
    .eq('contract_id', contract.id)
    .eq('status', 'active')
  if (!positions || positions.length === 0) return 0

  let paid = 0
  for (const pos of positions as HedgerPosition[]) {
    const windowStart = new Date(pos.purchased_at).toISOString().slice(0, 10)
    const windowEnd = new Date(pos.expires_at).toISOString().slice(0, 10)
    let remaining = pos.payouts_remaining ?? 1
    let lastDay = pos.last_payout_date ?? null
    const days = [...triggerDays].sort()
    for (const day of days) {
      if (remaining <= 0) break
      if (day < windowStart || day > windowEnd) continue
      if (lastDay && day <= lastDay) continue // already paid up to here
      const amount = await payoutOnce(db, stripe, contract.id, pos, day)
      if (amount > 0) {
        paid++
        remaining--
        lastDay = day
      }
    }
    const knockedOut = remaining <= 0
    await db.from('hedger_positions').update({
      payouts_remaining: remaining,
      payouts_made: (pos.payouts_made ?? 0) + (((pos.payouts_remaining ?? 1) - remaining)),
      last_payout_date: lastDay,
      status: knockedOut ? 'knocked_out' : 'active',
    }).eq('id', pos.id)
  }
  // contract is NOT settled — recurring markets stay live.
  return paid
}
```

Add `payoutOnce` — a per-day variant of the existing `payoutPosition` whose idempotency key is `(position_id, day)` rather than position-only:

```ts
async function payoutOnce(
  db: DbClient,
  stripe: StripeClient,
  contractId: string,
  position: HedgerPosition,
  day: string,
): Promise<number> {
  const { data: existing } = await db
    .from('payouts')
    .select('id')
    .eq('hedger_position_id', position.id)
    .eq('trigger_day', day)
    .neq('status', 'failed')
    .maybeSingle()
  if (existing) return 0
  // ...same Stripe customer + balance-transaction flow as payoutPosition,
  //    inserting payouts row with an added `trigger_day: day` column...
}
```

> This requires a `trigger_day date` column on `payouts` and replacing the old unique constraint with a `(hedger_position_id, trigger_day)` unique index. Add to the migration (Task 5) — append:
> ```sql
> ALTER TABLE payouts ADD COLUMN IF NOT EXISTS trigger_day date;
> DROP INDEX IF EXISTS payouts_hedger_position_id_key;
> CREATE UNIQUE INDEX IF NOT EXISTS payouts_position_day_uniq
>   ON payouts (hedger_position_id, trigger_day) WHERE status <> 'failed';
> ```
> (Check the actual constraint name from `20260525000001_payout_unique_constraint.sql` and drop that one.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/payout/processor.test.ts`
Expected: PASS (existing one-time tests still green; new recurring tests green).

- [ ] **Step 5: Commit**

```bash
git add lib/payout/processor.ts tests/lib/payout/processor.test.ts supabase/migrations/20260621000001_recurring_derivative_pricing.sql
git commit -m "feat(payout): per-position per-day recurring settlement with cap-3 knockout"
```

---

## Phase 5 — Reprice sticker price

### Task 10: Recurring reprice = 1-day Basic sticker

**Files:**
- Modify: `lib/pricing/reprice.ts`
- Test: `tests/lib/pricing/reprice.test.ts` (create if absent)

- [ ] **Step 1: Write failing test**

```ts
it('recurring: premium_usd sticker = 1-day Basic price', async () => {
  // urban contract, basic tier base_probability 0.05, payout 500, empty pool
  // expected sticker = 500 * (1-0.95^1) * 1.15 * 1.0 = 28.75
  const { update } = await runReprice({ recurring: true, base: 0.05, payout: 500, name: 'basic' })
  expect(update.premium_usd).toBeCloseTo(28.75, 2)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/lib/pricing/reprice.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — branch `applyReprice` on `is_recurring`:

```ts
import { dailyHazard, priceTenor, capacityFactor } from '@/lib/pricing/derivative'
// ...
async function applyReprice(db, tier, contract, oracleMultiplier, reading) {
  const oldPremium = tier.premium_usd
  let premiumUsd: number
  let inputs: Record<string, unknown>
  if (contract.is_recurring) {
    const p = dailyHazard(tier.base_probability, reading, contract.trigger_condition as never)
    const cap = capacityFactor(tier.current_capacity_usd, tier.max_capacity_usd)
    const r = priceTenor(tier.payout_usd, 1, p, tier.max_payouts, { capacityFactor: cap })
    premiumUsd = r.premiumUsd // 1-day Basic/Pro sticker (per tier)
    inputs = { ...r.inputs, oracleMultiplier }
  } else {
    const res = priceTier(tier, contract, oracleMultiplier)
    premiumUsd = res.premiumUsd
    inputs = res.inputs
  }
  // ...existing update of coverage_tiers + pricing_history with premiumUsd/inputs...
}
```

Thread the already-fetched `reading` into `applyReprice` (it's available via `fetchLatestReading`); update `resolveOracleMultiplier` callers to also pass the reading, or fetch once and pass both.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/lib/pricing/reprice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/reprice.ts tests/lib/pricing/reprice.test.ts
git commit -m "feat(reprice): recurring sticker price = 1-day engine quote"
```

---

## Phase 6 — Dashboard live mark

### Task 11: Show live position value

**Files:**
- Modify: the dashboard position list component (find via `grep -rl "premium_paid_usd" components app | grep -i dashboard`)
- Test: corresponding component test

- [ ] **Step 1: Write failing test** asserting an open recurring position renders a "current value" derived from `valuePosition`.

```tsx
it('shows live mark-to-market value for an open recurring position', () => {
  // position: payout 500, expires in 5 days, 1 payout remaining; latest reading p_now ~0.1
  render(<DashboardPositionRow position={pos} pNow={0.1} />)
  // valuePosition(500, 5, 0.1, 1) ≈ 500*(1-0.9^5) ≈ 204.76
  expect(screen.getByText(/\$20[0-9]\.\d{2}/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run <that test file>`
Expected: FAIL.

- [ ] **Step 3: Implement** — compute remaining days from `expires_at`, `pNow` from the contract's latest reading + `dailyHazard`, and render `valuePosition(payout, remainingDays, pNow, payouts_remaining)` next to premium paid. Server component fetches the latest reading per contract; pass `pNow` (or the reading) into the row.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run <that test file>`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add <dashboard files> <test file>
git commit -m "feat(dashboard): live mark-to-market value on open positions"
```

---

## Phase 7 — Cleanup & full verification

### Task 12: Remove `computePeriodFactor`, final gate

**Files:**
- Modify: `lib/pricing/engine.ts`
- Modify: `tests/lib/pricing/engine.test.ts`

- [ ] **Step 1: Delete `computePeriodFactor`** from `lib/pricing/engine.ts` and the `describe('computePeriodFactor', ...)` block (lines ~123–157) from `tests/lib/pricing/engine.test.ts`. Keep `priceTier` and its tests intact (used by one-time contracts).

- [ ] **Step 2: Grep for stragglers**

Run: `grep -rn "computePeriodFactor\|periodFactor" lib components app tests | grep -v node_modules`
Expected: no results.

- [ ] **Step 3: Full verification gate**

Run:
```bash
npx vitest run
npx eslint lib/pricing lib/actions/purchase.ts lib/payout/processor.ts components/markets
npx tsc --noEmit 2>&1 | grep -v 'processor.test.ts:367' | grep error || echo "TYPECHECK OK"
npx next build
```
Expected: all tests pass; lint clean; `TYPECHECK OK`; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(pricing): remove computePeriodFactor; finalize recurring pricing"
```

- [ ] **Step 5: Open PR**

```bash
git push -u origin feat/recurring-derivative-pricing
gh pr create --title "feat: recurring protections priced as perpetual binary options" --body "Implements docs/superpowers/specs/2026-06-21-recurring-protection-pricing-design.md"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** §2 hazard → Task 2; §3 valuation → Tasks 1,3,4; §4 reservation → Tasks 5,7; §5 settlement → Task 9; §6 live mark → Task 11; §7 data model → Tasks 5,6; §8 module → Tasks 1–4,12; §9 UX → Task 8; §10 migration → Task 5; §11 testing → every task + Task 12 gate.
- **One-time contracts** (`events`/`experiences`) must stay green throughout — `priceTier`, `timeFactor`, and existing settlement are untouched; only the recurring branch is new.
- **Migration `base_probability = 0.05`** is a placeholder daily baseline; corridors get tuned by admins post-migration (acceptable per spec §2).
- **Capacity accounting:** payouts reduce `current_capacity_usd`; expiry releases `reserved_usd`. A follow-up may add an explicit reservation ledger; v1 reserves at the position level.
