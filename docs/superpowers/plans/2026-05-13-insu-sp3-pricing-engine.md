# SP3: Pricing Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically reprice coverage tier premiums every 6 hours and on each confirmed purchase using an actuarial formula (base probability × utilization factor × time factor × loading factor).

**Architecture:** Two pure-TypeScript modules (`lib/pricing/engine.ts` for the formula, `lib/pricing/reprice.ts` for DB orchestration) driven by a secret-protected Next.js API route (`/api/reprice`) that Vercel cron calls every 6 hours. The Stripe webhook also calls `repriceTier` after each successful payment to immediately reflect capacity changes.

**Tech Stack:** Next.js 14 App Router, TypeScript, @supabase/supabase-js, Vercel Cron, Vitest

---

## File Map

```
lib/pricing/
  engine.ts                   ← NEW: pure pricing formula, no DB
  reprice.ts                  ← NEW: DB orchestrator (repriceAll + repriceTier)
app/api/
  reprice/
    route.ts                  ← NEW: POST endpoint, secret-protected
  stripe-webhook/
    route.ts                  ← MODIFY: call repriceTier after position activation
vercel.json                   ← NEW: Vercel cron schedule
tests/
  lib/pricing/
    engine.test.ts            ← NEW: pure unit tests
    reprice.test.ts           ← NEW: integration tests with mocked DB
  api/
    reprice.test.ts           ← NEW: route auth + response tests
.env.local.example            ← MODIFY: add CRON_SECRET
```

---

## Task 1: Environment Setup + Vercel Cron Config

**Files:**
- Modify: `.env.local.example`
- Create: `vercel.json`

- [ ] **Step 1: Add CRON_SECRET to .env.local.example**

Open `.env.local.example` and append:

```
CRON_SECRET=a_random_secret_string
```

- [ ] **Step 2: Create vercel.json**

```json
{
  "crons": [
    {
      "path": "/api/reprice",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

Vercel automatically adds `Authorization: Bearer ${CRON_SECRET}` to cron-triggered requests when `CRON_SECRET` is set as a Vercel environment variable.

- [ ] **Step 3: Add CRON_SECRET to your local .env.local**

Add this line to your `.env.local` (create the file if it doesn't exist):
```
CRON_SECRET=dev-cron-secret
```

- [ ] **Step 4: Commit**

```bash
git add .env.local.example vercel.json
git commit -m "chore: add CRON_SECRET env var and Vercel cron schedule"
```

---

## Task 2: Pricing Engine (TDD)

**Files:**
- Create: `tests/lib/pricing/engine.test.ts`
- Create: `lib/pricing/engine.ts`

- [ ] **Step 1: Create test directory**

```bash
mkdir -p tests/lib/pricing
```

- [ ] **Step 2: Write the failing tests**

Create `tests/lib/pricing/engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { priceTier } from '@/lib/pricing/engine'
import type { CoverageTier, Contract } from '@/lib/types'

function makeTier(overrides: Partial<CoverageTier> = {}): CoverageTier {
  return {
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
    ...overrides,
  }
}

function makeContract(daysFromNow: number, overrides: Partial<Contract> = {}): Contract {
  const deadline = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString()
  return {
    id: 'c1',
    slug: 'test-contract',
    title: 'Test',
    description: null,
    category_id: 'cat-1',
    status: 'active',
    trigger_type: 'manual',
    trigger_condition: {},
    trigger_deadline: deadline,
    location: { lat: 0, lng: 0, city: 'Test', country: 'MX' },
    icon_url: null,
    total_volume_usd: 0,
    total_volume_mxn: 0,
    is_featured: false,
    settled_outcome: null,
    created_by: 'admin',
    created_at: new Date().toISOString(),
    settled_at: null,
    ...overrides,
  }
}

describe('priceTier', () => {
  it('loading factor always applied — output exceeds payout × probability', () => {
    const { premiumUsd } = priceTier(makeTier(), makeContract(60))
    expect(premiumUsd).toBeGreaterThan(500 * 0.10)
  })

  it('premium increases as utilization rises', () => {
    const contract = makeContract(60)
    const low  = priceTier(makeTier({ current_capacity_usd: 0 }),      contract).premiumUsd
    const mid  = priceTier(makeTier({ current_capacity_usd: 50000 }),   contract).premiumUsd
    const high = priceTier(makeTier({ current_capacity_usd: 100000 }),  contract).premiumUsd
    expect(low).toBeLessThan(mid)
    expect(mid).toBeLessThan(high)
  })

  it('premium is flat beyond 30 days', () => {
    const tier = makeTier()
    const at60 = priceTier(tier, makeContract(60)).premiumUsd
    const at45 = priceTier(tier, makeContract(45)).premiumUsd
    expect(at60).toBeCloseTo(at45, 2)
  })

  it('premium increases as deadline approaches within 30 days', () => {
    const tier = makeTier()
    const at30 = priceTier(tier, makeContract(30)).premiumUsd
    const at15 = priceTier(tier, makeContract(15)).premiumUsd
    const at2  = priceTier(tier, makeContract(2)).premiumUsd
    expect(at30).toBeLessThan(at15)
    expect(at15).toBeLessThan(at2)
  })

  it('matches known example: 500 × 0.10 × 1.30 × 1.33 × 1.15 ≈ 99.5', () => {
    // 60% utilization → utilizationFactor = 1 + 0.5×0.6 = 1.30
    // 10 days remaining → timeFactor = 1 + 0.5×(1−10/30) = 1.333
    const tier = makeTier({ current_capacity_usd: 60000 })
    const contract = makeContract(10)
    const { premiumUsd } = priceTier(tier, contract)
    expect(premiumUsd).toBeCloseTo(99.5, 0)
  })

  it('returns structured inputs', () => {
    const { inputs } = priceTier(makeTier({ current_capacity_usd: 50000 }), makeContract(10))
    expect(inputs).toMatchObject({
      utilization: 0.5,
      utilizationFactor: 1.25,
      loadingFactor: 1.15,
    })
    expect(inputs.daysRemaining).toBeGreaterThan(9)
    expect(inputs.daysRemaining).toBeLessThan(11)
  })
})
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
npx vitest run tests/lib/pricing/engine.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/pricing/engine'`

- [ ] **Step 4: Create the pricing engine**

```bash
mkdir -p lib/pricing
```

Create `lib/pricing/engine.ts`:

```ts
import type { CoverageTier, Contract } from '@/lib/types'

const LOADING_FACTOR = 1.15

export interface PricingInputs {
  utilization: number
  daysRemaining: number
  utilizationFactor: number
  timeFactor: number
  loadingFactor: number
}

export interface PricingResult {
  premiumUsd: number
  inputs: PricingInputs
}

export function priceTier(tier: CoverageTier, contract: Contract): PricingResult {
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

  const premiumUsd = tier.payout_usd * tier.base_probability * utilizationFactor * timeFactor * loadingFactor

  return {
    premiumUsd: Math.round(premiumUsd * 100) / 100,
    inputs: { utilization, daysRemaining, utilizationFactor, timeFactor, loadingFactor },
  }
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npx vitest run tests/lib/pricing/engine.test.ts
```

Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/pricing/engine.ts tests/lib/pricing/engine.test.ts
git commit -m "feat: pricing engine — actuarial formula with utilization + time decay"
```

---

## Task 3: Reprice Orchestrator (TDD)

**Files:**
- Create: `tests/lib/pricing/reprice.test.ts`
- Create: `lib/pricing/reprice.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/pricing/reprice.test.ts`:

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
  trigger_type: 'manual',
  trigger_condition: {},
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

// Builds a mock DB client with injectable response data
function makeDb(opts: {
  contracts?: typeof mockContract[]
  tier?: typeof mockTier | null
  contract?: typeof mockContract | null
} = {}) {
  const contracts = opts.contracts ?? [mockContract]
  const tier = opts.tier ?? mockTier
  const contract = opts.contract ?? mockContract

  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn().mockReturnValue({ eq: updateEq })
  const insert = vi.fn().mockResolvedValue({ error: null })

  const db = {
    from: vi.fn((table: string) => {
      if (table === 'contracts') {
        // Used in repriceAll: .select().eq() awaited as array
        // Used in repriceTier: .select().eq().single() awaited as single
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
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/lib/pricing/reprice.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/pricing/reprice'`

- [ ] **Step 3: Implement the reprice orchestrator**

Create `lib/pricing/reprice.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import { priceTier } from './engine'
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

async function applyReprice(db: DbClient, tier: CoverageTier, contract: Contract): Promise<void> {
  const oldPremium = tier.premium_usd
  const { premiumUsd, inputs } = priceTier(tier, contract)

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
    for (const tier of (contract.coverage_tiers ?? []) as CoverageTier[]) {
      await applyReprice(db, tier, contract as unknown as Contract)
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

  await applyReprice(db, tier as unknown as CoverageTier, contract as unknown as Contract)
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/lib/pricing/reprice.test.ts
```

Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/reprice.ts tests/lib/pricing/reprice.test.ts
git commit -m "feat: reprice orchestrator — repriceAll and repriceTier with DB writes"
```

---

## Task 4: Reprice API Route (TDD)

**Files:**
- Create: `tests/api/reprice.test.ts`
- Create: `app/api/reprice/route.ts`

- [ ] **Step 1: Create test directory**

```bash
mkdir -p tests/api
```

- [ ] **Step 2: Write the failing tests**

Create `tests/api/reprice.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/reprice/route'
import { repriceAll } from '@/lib/pricing/reprice'

vi.mock('@/lib/pricing/reprice', () => ({
  repriceAll: vi.fn().mockResolvedValue(3),
}))

function makeRequest(authHeader?: string): NextRequest {
  return new NextRequest('http://localhost/api/reprice', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

describe('POST /api/reprice', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
    vi.clearAllMocks()
    vi.mocked(repriceAll).mockResolvedValue(3)
  })

  it('returns 401 with no authorization header', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 401 with wrong secret', async () => {
    const res = await POST(makeRequest('Bearer wrong-secret'))
    expect(res.status).toBe(401)
  })

  it('returns 200 with correct secret', async () => {
    const res = await POST(makeRequest('Bearer test-secret'))
    expect(res.status).toBe(200)
  })

  it('returns repriced count in body', async () => {
    const res = await POST(makeRequest('Bearer test-secret'))
    const body = await res.json()
    expect(body.repriced).toBe(3)
  })

  it('calls repriceAll', async () => {
    await POST(makeRequest('Bearer test-secret'))
    expect(repriceAll).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
npx vitest run tests/api/reprice.test.ts
```

Expected: FAIL with `Cannot find module '@/app/api/reprice/route'`

- [ ] **Step 4: Create the API route**

```bash
mkdir -p app/api/reprice
```

Create `app/api/reprice/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { repriceAll } from '@/lib/pricing/reprice'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!auth || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const count = await repriceAll()
  return NextResponse.json({ repriced: count })
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npx vitest run tests/api/reprice.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add app/api/reprice/route.ts tests/api/reprice.test.ts
git commit -m "feat: /api/reprice route — secret-protected cron endpoint"
```

---

## Task 5: Wire repriceTier into Stripe Webhook

**Files:**
- Modify: `app/api/stripe-webhook/route.ts`

- [ ] **Step 1: Read the current webhook file**

Open `app/api/stripe-webhook/route.ts` and note the existing structure.

- [ ] **Step 2: Add repriceTier import and calls**

Replace the full contents of `app/api/stripe-webhook/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { repriceTier } from '@/lib/pricing/reprice'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })
  }

  const body = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    )
  } catch (err) {
    return NextResponse.json({ error: `Webhook error: ${(err as Error).message}` }, { status: 400 })
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent
    const { position_type, position_id } = pi.metadata ?? {}

    if (!position_id || !position_type) {
      return NextResponse.json({ error: 'Missing metadata' }, { status: 400 })
    }

    if (position_type === 'hedger') {
      const { data: position } = await supabase
        .from('hedger_positions')
        .update({ status: 'active' })
        .eq('id', position_id)
        .select('tier_id, premium_paid_usd, contract_id')
        .single()

      if (position) {
        const { data: tier } = await supabase
          .from('coverage_tiers')
          .select('current_capacity_usd')
          .eq('id', position.tier_id)
          .single()

        if (tier) {
          await supabase
            .from('coverage_tiers')
            .update({ current_capacity_usd: tier.current_capacity_usd + position.premium_paid_usd })
            .eq('id', position.tier_id)
        }

        const { data: contract } = await supabase
          .from('contracts')
          .select('total_volume_usd')
          .eq('id', position.contract_id)
          .single()

        if (contract) {
          await supabase
            .from('contracts')
            .update({ total_volume_usd: contract.total_volume_usd + position.premium_paid_usd })
            .eq('id', position.contract_id)
        }

        await repriceTier(position.tier_id)
      }
    } else if (position_type === 'provider') {
      const { data: position } = await supabase
        .from('provider_positions')
        .update({ status: 'active' })
        .eq('id', position_id)
        .select('tier_id')
        .single()

      if (position) {
        await repriceTier(position.tier_id)
      }
    }
  }

  return NextResponse.json({ received: true })
}
```

- [ ] **Step 3: Run the full test suite**

```bash
npm run test:run
```

Expected: all tests pass (no regressions)

- [ ] **Step 4: Commit**

```bash
git add app/api/stripe-webhook/route.ts
git commit -m "feat: reprice affected tier immediately after payment confirmed"
```

---

## Task 6: TypeScript Check + Full Verification

**Files:** None new — verification only.

- [ ] **Step 1: Run all unit tests**

```bash
npm run test:run
```

Expected: all tests pass with 0 failures.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Fix any failures before continuing**

If any test fails or TypeScript errors appear, fix the root cause. Do not skip or comment out tests.

- [ ] **Step 4: Manual smoke test (optional but recommended)**

With the dev server running and `.env.local` populated:

```bash
curl -X POST http://localhost:3000/api/reprice \
  -H "Authorization: Bearer dev-cron-secret"
```

Expected response: `{"repriced": <n>}` where n is the number of active tiers in your database.

- [ ] **Step 5: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve TypeScript or test failures from SP3 integration"
```

If no fixes were needed, skip this step.
