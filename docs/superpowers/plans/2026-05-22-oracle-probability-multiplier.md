# Oracle Probability Multiplier — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute an oracle multiplier from the latest oracle reading at reprice time and apply it to `base_probability`, so premiums rise when conditions approach the trigger threshold and fall when conditions are favorable.

**Architecture:** Three targeted changes — a new pure `computeOracleMultiplier` function, an updated `priceTier` signature, and a DB lookup added to the reprice orchestrator. No new DB columns, no new cron job. The multiplier is stored in the existing `pricing_inputs` JSONB for full audit trail.

**Tech Stack:** TypeScript, Vitest, Next.js 14 App Router, Supabase JS client

---

## File Map

```
lib/oracle/
  multiplier.ts           ← NEW: pure function, no DB
lib/pricing/
  engine.ts               ← MODIFY: add oracleMultiplier param to priceTier
  reprice.ts              ← MODIFY: fetch oracle reading, compute multiplier, pass to priceTier
tests/lib/oracle/
  multiplier.test.ts      ← NEW: unit tests for computeOracleMultiplier
tests/lib/pricing/
  engine.test.ts          ← MODIFY: add oracleMultiplier tests
  reprice.test.ts         ← MODIFY: expand mock + add oracle path tests
```

---

## Task 1: `lib/oracle/multiplier.ts` (TDD)

**Files:**
- Create: `tests/lib/oracle/multiplier.test.ts`
- Create: `lib/oracle/multiplier.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/oracle/multiplier.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeOracleMultiplier } from '@/lib/oracle/multiplier'
import type { TriggerCondition } from '@/lib/oracle/trigger'

function reading(value: Record<string, unknown>) {
  return { value }
}

function cond(metric: string, threshold: number, operator: TriggerCondition['operator']): TriggerCondition {
  return { metric, threshold, operator }
}

describe('computeOracleMultiplier', () => {
  it('gte: returns 1.0 exactly at threshold', () => {
    expect(computeOracleMultiplier(reading({ temp_c: 35 }), cond('temp_c', 35, 'gte'))).toBeCloseTo(1.0, 5)
  })

  it('gte: returns < 1 when below threshold', () => {
    const result = computeOracleMultiplier(reading({ temp_c: 17.5 }), cond('temp_c', 35, 'gte'))
    expect(result).toBeCloseTo(0.5, 5)
  })

  it('gte: returns > 1 when above threshold', () => {
    const result = computeOracleMultiplier(reading({ temp_c: 70 }), cond('temp_c', 35, 'gte'))
    expect(result).toBeCloseTo(2.0, 5)
  })

  it('gt: same proximity direction as gte', () => {
    expect(computeOracleMultiplier(reading({ temp_c: 35 }), cond('temp_c', 35, 'gt'))).toBeCloseTo(1.0, 5)
  })

  it('lte: returns 1.0 exactly at threshold', () => {
    // trigger fires when actual <= threshold; actual = threshold → proximity = threshold/actual = 1
    expect(computeOracleMultiplier(reading({ jam: 5 }), cond('jam', 5, 'lte'))).toBeCloseTo(1.0, 5)
  })

  it('lte: returns > 1 when actual < threshold (conditions worsening toward trigger)', () => {
    // threshold=10, actual=5 → proximity = 10/5 = 2.0 → multiplier = 2.0
    const result = computeOracleMultiplier(reading({ jam: 5 }), cond('jam', 10, 'lte'))
    expect(result).toBeCloseTo(2.0, 5)
  })

  it('lt: same proximity direction as lte', () => {
    expect(computeOracleMultiplier(reading({ jam: 5 }), cond('jam', 5, 'lt'))).toBeCloseTo(1.0, 5)
  })

  it('clamps at MIN=0.3 for very favorable conditions', () => {
    // gte: actual=1, threshold=100 → proximity=0.01 → clamped to 0.3
    expect(computeOracleMultiplier(reading({ temp_c: 1 }), cond('temp_c', 100, 'gte'))).toBe(0.3)
  })

  it('clamps at MAX=3.0 for extreme conditions', () => {
    // gte: actual=1000, threshold=10 → proximity=100 → clamped to 3.0
    expect(computeOracleMultiplier(reading({ temp_c: 1000 }), cond('temp_c', 10, 'gte'))).toBe(3.0)
  })

  it('returns 1.0 when metric is missing from reading', () => {
    expect(computeOracleMultiplier(reading({ other: 99 }), cond('temp_c', 35, 'gte'))).toBe(1.0)
  })

  it('returns 1.0 when metric value is not a number', () => {
    expect(computeOracleMultiplier(reading({ temp_c: 'hot' }), cond('temp_c', 35, 'gte'))).toBe(1.0)
  })

  it('returns 1.0 when threshold is zero (guard against division by zero)', () => {
    expect(computeOracleMultiplier(reading({ temp_c: 35 }), cond('temp_c', 0, 'gte'))).toBe(1.0)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/lib/oracle/multiplier.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/oracle/multiplier'`

- [ ] **Step 3: Implement `lib/oracle/multiplier.ts`**

Create `lib/oracle/multiplier.ts`:

```ts
import type { TriggerCondition } from './trigger'

const MIN_MULTIPLIER = 0.3
const MAX_MULTIPLIER = 3.0

export function computeOracleMultiplier(
  reading: { value: Record<string, unknown> },
  condition: TriggerCondition,
): number {
  if (condition.threshold === 0) return 1.0

  const actual = reading.value[condition.metric]
  if (typeof actual !== 'number') return 1.0

  const proximity =
    condition.operator === 'gte' || condition.operator === 'gt'
      ? actual / condition.threshold
      : condition.threshold / actual

  return Math.min(MAX_MULTIPLIER, Math.max(MIN_MULTIPLIER, proximity))
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/lib/oracle/multiplier.test.ts
```

Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/multiplier.ts tests/lib/oracle/multiplier.test.ts
git commit -m "feat: computeOracleMultiplier — proximity-ratio signal from oracle readings"
```

---

## Task 2: Update `lib/pricing/engine.ts`

**Files:**
- Modify: `lib/pricing/engine.ts`
- Modify: `tests/lib/pricing/engine.test.ts`

- [ ] **Step 1: Add oracle multiplier tests**

Open `tests/lib/pricing/engine.test.ts`. Append these two test cases inside the existing `describe('priceTier', () => {` block, after the last existing `it(...)`:

```ts
  it('oracle multiplier scales premium proportionally', () => {
    const tier = makeTier()
    const contract = makeContract(60)
    const base = priceTier(tier, contract, 1.0).premiumUsd
    const doubled = priceTier(tier, contract, 2.0).premiumUsd
    expect(doubled).toBeCloseTo(base * 2, 1)
  })

  it('oracle multiplier is stored in returned inputs', () => {
    const { inputs } = priceTier(makeTier(), makeContract(60), 1.5)
    expect(inputs.oracleMultiplier).toBe(1.5)
  })
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/lib/pricing/engine.test.ts
```

Expected: FAIL — the two new tests will fail because `priceTier` doesn't yet accept a third arg and `inputs` has no `oracleMultiplier`.

- [ ] **Step 3: Update `lib/pricing/engine.ts`**

Replace the full contents of `lib/pricing/engine.ts` with:

```ts
import type { CoverageTier, Contract } from '@/lib/types'

const LOADING_FACTOR = 1.15

export interface PricingInputs {
  utilization: number
  daysRemaining: number
  utilizationFactor: number
  timeFactor: number
  loadingFactor: number
  oracleMultiplier: number
}

export interface PricingResult {
  premiumUsd: number
  inputs: PricingInputs
}

export function priceTier(
  tier: CoverageTier,
  contract: Contract,
  oracleMultiplier = 1.0,
): PricingResult {
  const utilization = tier.max_capacity_usd > 0
    ? tier.current_capacity_usd / tier.max_capacity_usd
    : 0

  const daysRemaining = Math.max(
    0,
    (new Date(contract.trigger_deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  )

  const utilizationFactor = 1 + 0.5 * utilization
  const timeFactor = 1 + 0.5 * Math.max(0, 1 - daysRemaining / 30)
  const loadingFactor = LOADING_FACTOR

  const premiumUsd = tier.payout_usd * tier.base_probability * oracleMultiplier * utilizationFactor * timeFactor * loadingFactor

  return {
    premiumUsd: Math.round(premiumUsd * 100) / 100,
    inputs: { utilization, daysRemaining, utilizationFactor, timeFactor, loadingFactor, oracleMultiplier },
  }
}
```

- [ ] **Step 4: Run all engine tests — expect PASS**

```bash
npx vitest run tests/lib/pricing/engine.test.ts
```

Expected: PASS (all 8 tests — 6 existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/engine.ts tests/lib/pricing/engine.test.ts
git commit -m "feat: priceTier accepts oracleMultiplier param, stored in PricingInputs"
```

---

## Task 3: Update `lib/pricing/reprice.ts`

**Files:**
- Modify: `lib/pricing/reprice.ts`
- Modify: `tests/lib/pricing/reprice.test.ts`

- [ ] **Step 1: Expand the mock and add oracle tests**

Replace the full contents of `tests/lib/pricing/reprice.test.ts` with:

```ts
import { describe, it, expect, vi } from 'vitest'
import { repriceAll, repriceTier } from '@/lib/pricing/reprice'

const futureDeadline = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()

const mockTier = {
  id: 'tier-1',
  contract_id: 'c1',
  name: 'basic',
  premium_usd: 50,
  payout_usd: 500,
  premium_mxn: 850,
  payout_mxn: 8500,
  max_capacity_usd: 100000,
  current_capacity_usd: 0,
  base_probability: 0.10,
  last_priced_at: null,
  pricing_inputs: null,
}

const mockContract = {
  id: 'c1',
  slug: 'test',
  title: 'Test',
  description: null,
  category_id: 'cat-1',
  status: 'active',
  trigger_type: 'weather',
  trigger_condition: { metric: 'temp_c', threshold: 25, operator: 'gte' },
  trigger_deadline: futureDeadline,
  location: { lat: 0, lng: 0, city: 'Test', country: 'MX' },
  icon_url: null,
  total_volume_usd: 0,
  total_volume_mxn: 0,
  is_featured: false,
  settled_outcome: null,
  created_by: 'admin',
  created_at: new Date().toISOString(),
  settled_at: null,
  coverage_tiers: [mockTier],
}

// reading with temp_c = 50, threshold = 25 → proximity = 2.0 → multiplier = 2.0
const mockReading = { value: { temp_c: 50 } }

function makeDb(opts: {
  contracts?: typeof mockContract[]
  tier?: typeof mockTier | null
  contract?: typeof mockContract | null
  reading?: { value: Record<string, unknown> } | null
} = {}) {
  const contracts = opts.contracts ?? [mockContract]
  const tier = opts.tier !== undefined ? opts.tier : mockTier
  const contract = opts.contract !== undefined ? opts.contract : mockContract
  const reading = opts.reading !== undefined ? opts.reading : null

  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn().mockReturnValue({ eq: updateEq })
  const insert = vi.fn().mockResolvedValue({ error: null })

  const db = {
    from: vi.fn((table: string) => {
      if (table === 'contracts') {
        const single = vi.fn().mockResolvedValue({ data: contract, error: null })
        const eq = vi.fn().mockReturnValue(
          Object.assign(Promise.resolve({ data: contracts, error: null }), { single }),
        )
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      if (table === 'coverage_tiers') {
        const single = vi.fn().mockResolvedValue({ data: tier, error: null })
        const eq = vi.fn().mockReturnValue({ single })
        return { select: vi.fn().mockReturnValue({ eq }), update }
      }
      if (table === 'pricing_history') {
        return { insert }
      }
      if (table === 'oracle_readings') {
        const limit = vi.fn().mockResolvedValue({
          data: reading ? [{ value: reading.value }] : [],
          error: null,
        })
        const order = vi.fn().mockReturnValue({ limit })
        const eq = vi.fn().mockReturnValue({ order })
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      return {}
    }),
    _update: update,
    _updateEq: updateEq,
    _insert: insert,
  }
  return db as any
}

describe('repriceAll', () => {
  it('updates coverage_tiers for each active tier', async () => {
    const db = makeDb()
    await repriceAll(db)
    expect(db._update).toHaveBeenCalledTimes(1)
    expect(db._updateEq).toHaveBeenCalledWith('id', 'tier-1')
  })

  it('inserts a pricing_history row for each tier', async () => {
    const db = makeDb()
    await repriceAll(db)
    expect(db._insert).toHaveBeenCalledTimes(1)
    const insertArg = db._insert.mock.calls[0][0]
    expect(insertArg).toMatchObject({
      contract_id: 'c1',
      tier_id: 'tier-1',
      premium_usd_before: 50,
    })
    expect(insertArg.premium_usd_after).toBeGreaterThan(0)
  })

  it('reprices multiple tiers and returns count', async () => {
    const twoTiers = { ...mockContract, coverage_tiers: [mockTier, { ...mockTier, id: 'tier-2' }] }
    const db = makeDb({ contracts: [twoTiers] })
    const count = await repriceAll(db)
    expect(count).toBe(2)
    expect(db._update).toHaveBeenCalledTimes(2)
    expect(db._insert).toHaveBeenCalledTimes(2)
  })

  it('returns 0 and makes no writes when no contracts found', async () => {
    const db = makeDb({ contracts: [] })
    const count = await repriceAll(db)
    expect(count).toBe(0)
    expect(db._update).not.toHaveBeenCalled()
    expect(db._insert).not.toHaveBeenCalled()
  })

  it('applies oracle multiplier — premium doubles at 2× proximity', async () => {
    const dbWith = makeDb({ reading: mockReading })    // multiplier = 2.0
    const dbWithout = makeDb()                          // multiplier = 1.0 (no reading)
    await repriceAll(dbWith)
    await repriceAll(dbWithout)
    const premiumWith = dbWith._update.mock.calls[0][0].premium_usd
    const premiumWithout = dbWithout._update.mock.calls[0][0].premium_usd
    expect(premiumWith).toBeCloseTo(premiumWithout * 2, 1)
  })

  it('stores oracleMultiplier in pricing_inputs when reading is present', async () => {
    const db = makeDb({ reading: mockReading })  // multiplier = 2.0
    await repriceAll(db)
    const pricingInputs = db._update.mock.calls[0][0].pricing_inputs
    expect(pricingInputs.oracleMultiplier).toBeCloseTo(2.0, 5)
  })

  it('stores oracleMultiplier=1 in pricing_inputs when no reading exists', async () => {
    const db = makeDb()  // no reading
    await repriceAll(db)
    const pricingInputs = db._update.mock.calls[0][0].pricing_inputs
    expect(pricingInputs.oracleMultiplier).toBe(1)
  })
})

describe('repriceTier', () => {
  it('updates only the specified tier', async () => {
    const db = makeDb()
    await repriceTier('tier-1', db)
    expect(db._update).toHaveBeenCalledTimes(1)
    expect(db._updateEq).toHaveBeenCalledWith('id', 'tier-1')
  })

  it('inserts one pricing_history row', async () => {
    const db = makeDb()
    await repriceTier('tier-1', db)
    expect(db._insert).toHaveBeenCalledTimes(1)
  })

  it('skips writes when tier not found', async () => {
    const db = makeDb({ tier: null })
    await repriceTier('nonexistent', db)
    expect(db._update).not.toHaveBeenCalled()
    expect(db._insert).not.toHaveBeenCalled()
  })

  it('skips writes when contract is settled', async () => {
    const db = makeDb({ contract: { ...mockContract, status: 'settled' } })
    await repriceTier('tier-1', db)
    expect(db._update).not.toHaveBeenCalled()
    expect(db._insert).not.toHaveBeenCalled()
  })

  it('applies oracle multiplier via repriceTier — premium doubles at 2× proximity', async () => {
    const dbWith = makeDb({ reading: mockReading })    // multiplier = 2.0
    const dbWithout = makeDb()                          // multiplier = 1.0
    await repriceTier('tier-1', dbWith)
    await repriceTier('tier-1', dbWithout)
    const premiumWith = dbWith._update.mock.calls[0][0].premium_usd
    const premiumWithout = dbWithout._update.mock.calls[0][0].premium_usd
    expect(premiumWith).toBeCloseTo(premiumWithout * 2, 1)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/lib/pricing/reprice.test.ts
```

Expected: the 5 new tests will FAIL (oracle path not implemented yet). The original 8 tests may also fail because the mock now has `trigger_condition` set and `oracle_readings` table — but `reprice.ts` doesn't query it yet.

- [ ] **Step 3: Implement the oracle lookup in `lib/pricing/reprice.ts`**

Replace the full contents of `lib/pricing/reprice.ts` with:

```ts
import { createClient } from '@supabase/supabase-js'
import { priceTier } from './engine'
import { computeOracleMultiplier } from '@/lib/oracle/multiplier'
import type { TriggerCondition } from '@/lib/oracle/trigger'
import type { CoverageTier, Contract } from '@/lib/types'

interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

function getClient(): DbClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  )
}

async function fetchLatestReading(
  db: DbClient,
  contractId: string,
): Promise<{ value: Record<string, unknown> } | null> {
  const { data } = await db
    .from('oracle_readings')
    .select('value')
    .eq('contract_id', contractId)
    .order('read_at', { ascending: false })
    .limit(1)
  return data?.[0] ?? null
}

async function applyReprice(
  db: DbClient,
  tier: CoverageTier,
  contract: Contract,
  oracleMultiplier: number,
): Promise<void> {
  const oldPremium = tier.premium_usd
  const { premiumUsd, inputs } = priceTier(tier, contract, oracleMultiplier)

  await db.from('coverage_tiers')
    .update({
      premium_usd: premiumUsd,
      last_priced_at: new Date().toISOString(),
      pricing_inputs: inputs,
    })
    .eq('id', tier.id)

  await db.from('pricing_history')
    .insert({
      contract_id: tier.contract_id,
      tier_id: tier.id,
      bs_inputs: inputs,
      bs_output: { premiumUsd },
      premium_usd_before: oldPremium,
      premium_usd_after: premiumUsd,
    })
}

export async function repriceAll(db: DbClient = getClient()): Promise<number> {
  const { data: contracts } = await db
    .from('contracts')
    .select('*, coverage_tiers(*)')
    .eq('status', 'active')

  if (!contracts) return 0

  let count = 0
  for (const contract of contracts) {
    const reading = await fetchLatestReading(db, contract.id)
    const condition = contract.trigger_condition as unknown as TriggerCondition
    const oracleMultiplier = reading ? computeOracleMultiplier(reading, condition) : 1.0

    for (const tier of (contract.coverage_tiers ?? []) as CoverageTier[]) {
      await applyReprice(db, tier, contract as unknown as Contract, oracleMultiplier)
      count++
    }
  }
  return count
}

export async function repriceTier(tierId: string, db: DbClient = getClient()): Promise<void> {
  const { data: tier } = await db
    .from('coverage_tiers')
    .select('*')
    .eq('id', tierId)
    .single()

  if (!tier) return

  const { data: contract } = await db
    .from('contracts')
    .select('*')
    .eq('id', tier.contract_id)
    .single()

  if (!contract || contract.status !== 'active') return

  const reading = await fetchLatestReading(db, contract.id)
  const condition = contract.trigger_condition as unknown as TriggerCondition
  const oracleMultiplier = reading ? computeOracleMultiplier(reading, condition) : 1.0

  await applyReprice(db, tier as unknown as CoverageTier, contract as unknown as Contract, oracleMultiplier)
}
```

- [ ] **Step 4: Run reprice tests — expect PASS**

```bash
npx vitest run tests/lib/pricing/reprice.test.ts
```

Expected: PASS (all 13 tests — 8 existing + 5 new)

- [ ] **Step 5: Run full test suite — expect no regressions**

```bash
npm run test:run
```

Expected: all tests pass with 0 failures.

- [ ] **Step 6: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/pricing/reprice.ts tests/lib/pricing/reprice.test.ts
git commit -m "feat: wire oracle readings into reprice — proximity multiplier on base_probability"
```
