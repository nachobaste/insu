# Premium Floor + Tenor-Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the premium-cap tenor-flattening and cheap-corridor margin problems at the product layer, with no calibration change: a $5 minimum premium floor, a tenor-availability rule that never lets a quote hit the cap, and a period menu extended to {1, 3, 7, 30} days.

**Architecture:** Two pure additions to `lib/pricing/derivative.ts` (`MIN_PREMIUM_USD` clamp inside `priceTenor`; a `tenorAvailable` predicate). One new shared module `lib/pricing/tenors.ts` holding the candidate period list and an `availablePeriods(p)` filter that both purchase components consume, replacing their duplicated hardcoded `{1,7,30}` arrays. A server-side guard in `purchase.ts` rejects a capped tenor. No DB migration, no calibration script change, no engine (`priceTier`/one-time) change.

**Tech Stack:** TypeScript, Next.js App Router (React client components), Vitest, Supabase.

**Decision provenance:** Agreed 2026-07-14 (session 210c4efc, "the direction is agreed"). Equal-hazard thresholds were rejected. Pro $500→$100×3 is explicitly deferred and NOT in this plan.

---

## Context the implementer needs

- `priceTenor(payoutUsd, tenorDays, p, maxPayouts, opts)` (`lib/pricing/derivative.ts:83`) already clamps the premium to `MAX_PREMIUM_FRACTION` (0.70) of the max payout. This is the cap that flattens tenors on high-hazard corridors. We add a *lower* clamp beside it.
- `probAtLeastK(T, p, k)` (`lib/pricing/derivative.ts:20`) returns P(≥k trigger-days in T days). `probAtLeastK(tenorDays, p, 1)` is the window trigger probability we gate availability on.
- `LOADING_FACTOR = 1.15`, `MAX_PREMIUM_FRACTION = 0.70`, both exported from `derivative.ts`.
- `dailyHazard(baseProbability, reading, condition)` (`derivative.ts:50`) is pure and client-safe (already imported into client components via `lib/pricing/quote.ts`). It returns the clamped daily hazard `p`.
- Urban contracts set the SAME `base_probability` on both tiers (calibrate writes per-contract), so availability computed from the basic tier applies to both. Basic (`max_payouts=1`) is the cap-binding tier, so gating on it is correct — Pro never caps at a tenor where Basic passes.
- Two components duplicate the period list and a "Needs 7+ days" Pro lock: `components/markets/ContractDetailClient.tsx:18` and `components/markets/PurchasePanel.tsx:17`.
- Tests run with `npm run test:run` (Vitest). Existing pricing tests: `tests/lib/pricing/derivative.test.ts`.
- Only 3 live corridors currently quote a Basic 1-day sticker under $5 (palmas-bosques $2.29, periferico-norte-centro $2.55, viaducto-poniente $4.31); they float up to $5 at the next reprice. This is the intended effect.

## File Structure

- **Modify** `lib/pricing/derivative.ts` — add `MIN_PREMIUM_USD`, apply it in `priceTenor`, add `tenorAvailable`.
- **Create** `lib/pricing/tenors.ts` — `PERIOD_OPTIONS` candidate list ({1,3,7,30}) and `availablePeriods(p)` filter.
- **Modify** `components/markets/ContractDetailClient.tsx` — consume `availablePeriods(p)` instead of local `PERIOD_OPTIONS`.
- **Modify** `components/markets/PurchasePanel.tsx` — same.
- **Modify** `lib/actions/purchase.ts` — reject a `periodDays` that isn't available.
- **Modify** `tests/lib/pricing/derivative.test.ts` — floor + `tenorAvailable` tests.
- **Create** `tests/lib/pricing/tenors.test.ts` — `availablePeriods` tests.

---

### Task 1: $5 minimum premium floor in `priceTenor`

**Files:**
- Modify: `lib/pricing/derivative.ts:13` (add constant), `lib/pricing/derivative.ts:96-98` (apply clamp)
- Test: `tests/lib/pricing/derivative.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/pricing/derivative.test.ts` (inside the existing `describe('priceTenor', ...)` block, or a new one; also add `MIN_PREMIUM_USD` to the import from `@/lib/pricing/derivative`):

```ts
describe('priceTenor minimum premium floor', () => {
  it('floors a tiny fair premium at MIN_PREMIUM_USD', () => {
    // palmas-bosques Basic 1-day: payout 100, p 0.0198 -> fair ≈ $2.28, below floor
    const { premiumUsd } = priceTenor(100, 1, 0.0198, 1)
    expect(premiumUsd).toBe(MIN_PREMIUM_USD)
  })

  it('does not raise a premium already above the floor', () => {
    // p 0.10 -> fair 100*0.10*1.15 = $11.50
    const { premiumUsd } = priceTenor(100, 1, 0.10, 1)
    expect(premiumUsd).toBeCloseTo(11.5, 2)
  })

  it('the cap still wins over the floor for high hazard', () => {
    // p 0.20 over 30 days -> raw far above cap; cap = 100*1*0.70 = $70
    const { premiumUsd } = priceTenor(100, 30, 0.20, 1)
    expect(premiumUsd).toBe(70)
  })

  it('MIN_PREMIUM_USD is 5', () => {
    expect(MIN_PREMIUM_USD).toBe(5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/lib/pricing/derivative.test.ts`
Expected: FAIL — `MIN_PREMIUM_USD` is not exported (import error) / floor assertions fail.

- [ ] **Step 3: Add the constant**

In `lib/pricing/derivative.ts`, directly after the `MAX_PREMIUM_FRACTION` export (line 13):

```ts
/**
 * A recurring premium is never quoted below this floor. Below ~$5 the Stripe
 * fee (~$0.45) eats the margin and the sticker looks unserious; a floor is
 * standard for real-world micro-risk products. Applies only to the recurring
 * tenor path (one-time contracts price via priceTier and are unaffected).
 */
export const MIN_PREMIUM_USD = 5
```

- [ ] **Step 4: Apply the clamp in `priceTenor`**

In `lib/pricing/derivative.ts`, replace the premium clamp (currently lines 96-98):

```ts
  const rawPremiumUsd = payoutUsd * expectedPayouts * loading * cap
  const maxPremiumUsd = payoutUsd * maxPayouts * MAX_PREMIUM_FRACTION
  const premiumUsd = Math.round(Math.min(rawPremiumUsd, maxPremiumUsd) * 100) / 100
```

with:

```ts
  const rawPremiumUsd = payoutUsd * expectedPayouts * loading * cap
  const maxPremiumUsd = payoutUsd * maxPayouts * MAX_PREMIUM_FRACTION
  // Floor then cap: raise tiny premiums to the floor, but never above the cap
  // (the cap wins if the two ever cross, which only happens for tiny payouts).
  const flooredUsd = Math.max(MIN_PREMIUM_USD, rawPremiumUsd)
  const premiumUsd = Math.round(Math.min(flooredUsd, maxPremiumUsd) * 100) / 100
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:run -- tests/lib/pricing/derivative.test.ts`
Expected: PASS (all four new tests + existing tests).

- [ ] **Step 6: Commit**

```bash
git add lib/pricing/derivative.ts tests/lib/pricing/derivative.test.ts
git commit -m "feat(pricing): $5 minimum premium floor on recurring tenor quotes"
```

---

### Task 2: `tenorAvailable` predicate

**Files:**
- Modify: `lib/pricing/derivative.ts` (append new function after `priceTenor`)
- Test: `tests/lib/pricing/derivative.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/pricing/derivative.test.ts` (add `tenorAvailable` to the import):

```ts
describe('tenorAvailable', () => {
  it('1-day is available for every realistic hazard', () => {
    expect(tenorAvailable(1, 0.2045)).toBe(true) // hottest live corridor
    expect(tenorAvailable(1, 0.0198)).toBe(true)
  })

  it('hot corridor (p≈0.20) allows 3 days but not 7', () => {
    expect(tenorAvailable(3, 0.2045)).toBe(true)
    expect(tenorAvailable(7, 0.2045)).toBe(false)
  })

  it('calm corridor (p≈0.02) allows 30 days', () => {
    expect(tenorAvailable(30, 0.0198)).toBe(true)
  })

  it('gates exactly on LOADING_FACTOR * P(>=1) <= MAX_PREMIUM_FRACTION', () => {
    // Construct p so P(>=1) over 1 day = 0.70/1.15 exactly at the boundary
    const boundaryP = MAX_PREMIUM_FRACTION / LOADING_FACTOR // ≈ 0.6087
    expect(tenorAvailable(1, boundaryP)).toBe(true)          // == boundary, allowed
    expect(tenorAvailable(1, boundaryP + 0.001)).toBe(false) // just over, blocked
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/lib/pricing/derivative.test.ts`
Expected: FAIL — `tenorAvailable` is not exported.

- [ ] **Step 3: Implement `tenorAvailable`**

Append to `lib/pricing/derivative.ts` (after `priceTenor`, before `valuePosition`):

```ts
/**
 * Is a tenor offerable without its Basic (one-touch) premium hitting the cap?
 * A tenor is available iff the loaded fair premium fits under MAX_PREMIUM_FRACTION
 * at capacity factor 1.0: LOADING_FACTOR * P(>=1 trigger in window) <= cap.
 * Basic is the cap-binding tier, so this gate also protects the Pro strip.
 * Keeps every listed tenor differentiated and priced above expected loss; long
 * horizons on hot corridors are what recurring coverage is for.
 */
export function tenorAvailable(tenorDays: number, p: number): boolean {
  const windowTriggerProb = probAtLeastK(tenorDays, p, 1)
  return LOADING_FACTOR * windowTriggerProb <= MAX_PREMIUM_FRACTION + 1e-9
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- tests/lib/pricing/derivative.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/derivative.ts tests/lib/pricing/derivative.test.ts
git commit -m "feat(pricing): tenorAvailable predicate gating tenors under the premium cap"
```

---

### Task 3: Shared `lib/pricing/tenors.ts` (candidate menu + filter)

**Files:**
- Create: `lib/pricing/tenors.ts`
- Test: `tests/lib/pricing/tenors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/pricing/tenors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PERIOD_OPTIONS, availablePeriods } from '@/lib/pricing/tenors'

describe('PERIOD_OPTIONS', () => {
  it('is exactly {1, 3, 7, 30} days in order', () => {
    expect(PERIOD_OPTIONS.map((o) => o.days)).toEqual([1, 3, 7, 30])
  })
})

describe('availablePeriods', () => {
  it('calm corridor (p≈0.02) keeps the full menu', () => {
    expect(availablePeriods(0.0198).map((o) => o.days)).toEqual([1, 3, 7, 30])
  })

  it('mid corridor (p≈0.086) drops 30 but keeps 7', () => {
    expect(availablePeriods(0.0862).map((o) => o.days)).toEqual([1, 3, 7])
  })

  it('hot corridor (p≈0.20) is short-only {1, 3}', () => {
    expect(availablePeriods(0.2045).map((o) => o.days)).toEqual([1, 3])
  })

  it('always offers at least the 1-day option', () => {
    expect(availablePeriods(0.95).map((o) => o.days)).toEqual([1])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/lib/pricing/tenors.test.ts`
Expected: FAIL — module `@/lib/pricing/tenors` does not exist.

- [ ] **Step 3: Create the module**

Create `lib/pricing/tenors.ts`:

```ts
import { tenorAvailable } from '@/lib/pricing/derivative'

export interface PeriodOption {
  days: number
  label: string
}

/** Candidate protection periods offered on recurring contracts. */
export const PERIOD_OPTIONS: readonly PeriodOption[] = [
  { days: 1, label: '1 day' },
  { days: 3, label: '3 days' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
] as const

/**
 * The subset of PERIOD_OPTIONS whose premium stays under the cap for daily
 * hazard `p`. The 1-day option is always offered (it never caps at realistic
 * hazards, and a corridor with no buyable period would be a dead listing).
 */
export function availablePeriods(p: number): PeriodOption[] {
  const options = PERIOD_OPTIONS.filter((o) => tenorAvailable(o.days, p))
  return options.length > 0 ? options : [PERIOD_OPTIONS[0]]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- tests/lib/pricing/tenors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/tenors.ts tests/lib/pricing/tenors.test.ts
git commit -m "feat(pricing): shared {1,3,7,30} period menu with hazard-based availability"
```

---

### Task 4: Wire `ContractDetailClient` to `availablePeriods`

**Files:**
- Modify: `components/markets/ContractDetailClient.tsx`

- [ ] **Step 1: Replace the local period list and import the shared helper**

In `components/markets/ContractDetailClient.tsx`, delete the local `PERIOD_OPTIONS` block (lines 18-22) and add imports near the other `@/lib/pricing` imports (line 5):

```ts
import { quoteTiers } from '@/lib/pricing/quote'
import { availablePeriods } from '@/lib/pricing/tenors'
import { dailyHazard } from '@/lib/pricing/derivative'
```

- [ ] **Step 2: Compute the hazard and available periods**

In `ContractDetailClient`, after `sortedTiers` is defined (around line 48), add:

```ts
  const basicTier = sortedTiers[0]
  const hazard = basicTier
    ? dailyHazard(
        basicTier.base_probability,
        latestReading ? { value: latestReading.value } : null,
        contract.trigger_condition as never,
      )
    : 0
  const periodOptions = availablePeriods(hazard)
```

- [ ] **Step 3: Render the computed options**

Replace `PERIOD_OPTIONS.map(({ days, label }) => (` (line 140) with `periodOptions.map(({ days, label }) => (`.

- [ ] **Step 4: Reset an unavailable pre-selection**

If a previously-selected period is no longer offered (e.g. reading changed the hazard), clear it. After the `periodOptions` line in Step 2, add:

```ts
  const selectedStillOffered =
    selectedPeriodDays == null || periodOptions.some((o) => o.days === selectedPeriodDays)
```

Then guard the quote/coverage rendering: change line 58's condition
`const priceByTier = isRecurring && selectedPeriodDays`
to
`const priceByTier = isRecurring && selectedPeriodDays && selectedStillOffered`
and the `selectedPeriodDays != null &&` CoverageDates guard (line 155) to
`selectedPeriodDays != null && selectedStillOffered &&`.

- [ ] **Step 5: Typecheck and run tests**

Run: `npx tsc --noEmit && npm run test:run`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/markets/ContractDetailClient.tsx
git commit -m "feat(markets): market detail offers only available periods from {1,3,7,30}"
```

---

### Task 5: Wire `PurchasePanel` to `availablePeriods`

**Files:**
- Modify: `components/markets/PurchasePanel.tsx`

- [ ] **Step 1: Replace the local period list and import the shared helper**

In `components/markets/PurchasePanel.tsx`, delete the local `PERIOD_OPTIONS` block (lines 17-20) and add imports beside the existing `@/lib/pricing/quote` import (line 7):

```ts
import { quoteTiers } from '@/lib/pricing/quote'
import { availablePeriods } from '@/lib/pricing/tenors'
import { dailyHazard } from '@/lib/pricing/derivative'
```

- [ ] **Step 2: Compute available periods from the basic tier hazard**

In `PurchasePanel`, after the component's tiers are in scope (near the other derived values around line 66), add:

```ts
  const basicTier = [...contract.coverage_tiers].sort((a, b) =>
    a.name === 'basic' ? -1 : b.name === 'basic' ? 1 : 0,
  )[0]
  const hazard = basicTier
    ? dailyHazard(
        basicTier.base_probability,
        latestReading ? { value: latestReading.value } : null,
        contract.trigger_condition as never,
      )
    : 0
  const periodOptions = availablePeriods(hazard)
```

- [ ] **Step 3: Render the computed options**

Find the period-selector map (the `PERIOD_OPTIONS.map(...)` near the "Protection period" label around line 247) and replace `PERIOD_OPTIONS` with `periodOptions`.

- [ ] **Step 4: Typecheck and run tests**

Run: `npx tsc --noEmit && npm run test:run`
Expected: no type errors; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/markets/PurchasePanel.tsx
git commit -m "feat(markets): purchase panel offers only available periods from {1,3,7,30}"
```

---

### Task 6: Server-side guard against buying a capped tenor

**Files:**
- Modify: `lib/actions/purchase.ts:84-108` (recurring branch)
- Test: none (server action; covered by the pure `tenorAvailable` tests). Manual verification in Task 7.

- [ ] **Step 1: Import the predicate**

In `lib/actions/purchase.ts`, extend the pricing import (line 7):

```ts
import { dailyHazard, priceTenor, capacityFactor, tenorAvailable } from '@/lib/pricing/derivative'
```

- [ ] **Step 2: Reject an unavailable period**

In the `if (isRecurring)` branch, immediately after `p` is computed (after line 105, before `const cap = ...`), add:

```ts
    if (!tenorAvailable(periodDays, p)) {
      return { error: 'That protection period is not available for this market. Choose a shorter window or use recurring coverage.' }
    }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/purchase.ts
git commit -m "fix(purchase): reject a protection period that would breach the premium cap"
```

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `npm run test:run`
Expected: all tests pass, including `tests/lib/pricing/derivative.test.ts` and `tests/lib/pricing/tenors.test.ts`.

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `npm run dev`, open a hot corridor (e.g. gt-cesa-zona10 PM) and a calm one (palmas-bosques).
Expected: hot corridor shows only `1 day` / `3 days`; calm corridor shows `1 / 3 / 7 / 30`; the calm corridor's Basic 1-day price reads `$5` (floored, was $2.29).

- [ ] **Step 4: Confirm reprice sticker effect (read-only)**

The floor lands on stickers at the next 00:00Z reprice. No action needed; note in the PR that palmas-bosques, periferico-norte-centro, and viaducto-poniente Basic stickers will rise to $5.

---

## Deployment note

Prod does NOT auto-deploy on merge. After merge, run `vercel --prod --yes` from a `main` checkout. The floor reaches stickers at the next 00:00Z reprice cron; live quotes on market pages reflect all three changes immediately on deploy. No DB migration, no calibration run.

## Out of scope (explicitly deferred)

- Pro payout $500 → $100×3 (independent decision, "don't reprice until we define this").
- Any calibration / threshold / base_probability change (equal-hazard was rejected).
- One-time contract pricing (`priceTier`) — the floor and availability rule are recurring-only by design.
- Pro-card copy ("pays up to 3×") — belongs with the deferred Pro change.
```
