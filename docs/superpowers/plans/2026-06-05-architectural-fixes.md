# Architectural Fixes: Cron Auth, Operator Mismatch, Payout Safety

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three correctness bugs: de-duplicate cron auth logic, reconcile the form/oracle operator mismatch that silently breaks trigger evaluation, and reorder payout settlement so a Stripe failure can't leave a contract permanently settled with no payouts.

**Architecture:** Extract a shared `validateCronRequest` helper; fix `ContractForm` to store canonical `operator` values (not display symbols) via a one-time migration; reorder `settleContract` so the DB update happens after Stripe succeeds.

**Tech Stack:** TypeScript, Next.js App Router, Supabase (Postgres JSONB), Vitest

---

### Task 1: Extract cron auth to `lib/auth/cronAuth.ts`

**Files:**
- Create: `lib/auth/cronAuth.ts`
- Modify: `app/api/oracle-poll/route.ts`
- Modify: `app/api/reprice/route.ts`
- Modify: `app/api/payout-process/route.ts`
- Test: `tests/lib/auth/cronAuth.test.ts`

**Context:** The same 6-line timing-safe Bearer-token check is copy-pasted verbatim in all three cron route files. Extracting it prevents drift, and makes the route files trivial to read.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/lib/auth/cronAuth.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { validateCronRequest } from '@/lib/auth/cronAuth'

describe('validateCronRequest', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
  })

  it('returns null when authorization header matches secret', () => {
    const req = new NextRequest('http://localhost/api/test', {
      headers: { authorization: 'Bearer test-secret' },
    })
    expect(validateCronRequest(req)).toBeNull()
  })

  it('returns 401 response when authorization header is wrong', async () => {
    const req = new NextRequest('http://localhost/api/test', {
      headers: { authorization: 'Bearer wrong' },
    })
    const res = validateCronRequest(req)
    expect(res?.status).toBe(401)
    expect(await res?.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 401 when authorization header is missing', async () => {
    const req = new NextRequest('http://localhost/api/test')
    const res = validateCronRequest(req)
    expect(res?.status).toBe(401)
  })

  it('returns 500 when CRON_SECRET env var is not set', async () => {
    delete process.env.CRON_SECRET
    const req = new NextRequest('http://localhost/api/test', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const res = validateCronRequest(req)
    expect(res?.status).toBe(500)
    expect(await res?.json()).toEqual({ error: 'Server misconfiguration' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu
npx vitest run tests/lib/auth/cronAuth.test.ts
```

Expected: FAIL — `validateCronRequest` does not exist yet.

- [ ] **Step 3: Create `lib/auth/cronAuth.ts`**

```typescript
import { timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

export function validateCronRequest(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(req.headers.get('authorization') ?? '')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/lib/auth/cronAuth.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Update `app/api/oracle-poll/route.ts`**

Replace the entire file with:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { validateCronRequest } from '@/lib/auth/cronAuth'
import { pollContracts } from '@/lib/oracle/poll'

async function handlePoll(req: NextRequest) {
  const authError = validateCronRequest(req)
  if (authError) return authError
  const count = await pollContracts()
  return NextResponse.json({ readings: count })
}

// Vercel Cron sends GET; POST is kept for manual triggering
export const GET = handlePoll
export const POST = handlePoll
```

- [ ] **Step 6: Update `app/api/reprice/route.ts`**

Replace the entire file with:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { validateCronRequest } from '@/lib/auth/cronAuth'
import { repriceAll } from '@/lib/pricing/reprice'

async function handleReprice(req: NextRequest) {
  const authError = validateCronRequest(req)
  if (authError) return authError
  const count = await repriceAll()
  return NextResponse.json({ repriced: count })
}

// Vercel Cron sends GET; POST is kept for manual triggering
export const GET = handleReprice
export const POST = handleReprice
```

- [ ] **Step 7: Update `app/api/payout-process/route.ts`**

Replace the entire file with:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { validateCronRequest } from '@/lib/auth/cronAuth'
import { processPayouts, expireContracts } from '@/lib/payout/processor'

async function handlePayouts(req: NextRequest) {
  const authError = validateCronRequest(req)
  if (authError) return authError
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  const [paid, expired] = await Promise.all([
    processPayouts(db, stripe),
    expireContracts(db),
  ])
  return NextResponse.json({ paid, expired })
}

// Vercel Cron sends GET; POST is kept for manual triggering
export const GET = handlePayouts
export const POST = handlePayouts
```

- [ ] **Step 8: Run the full route tests to confirm no regressions**

```bash
npx vitest run tests/api/
```

Expected: PASS — all 6 tests across the 3 route test files.

- [ ] **Step 9: Commit**

```bash
git add lib/auth/cronAuth.ts \
        app/api/oracle-poll/route.ts \
        app/api/reprice/route.ts \
        app/api/payout-process/route.ts \
        tests/lib/auth/cronAuth.test.ts
git commit -m "refactor: extract cron auth to lib/auth/cronAuth"
```

---

### Task 2: Fix comparator/operator mismatch

**Files:**
- Create: `supabase/migrations/20260606000002_fix_trigger_condition_operator.sql`
- Modify: `components/admin/contracts/ContractForm.tsx`

**Context:** `ContractForm.tsx` stores `{ comparator: '>', '<', '=' }` in the DB, but `lib/oracle/trigger.ts` `evaluateTrigger` reads `condition.operator` (expecting `'gt' | 'gte' | 'lt' | 'lte'`). Existing contracts all have the wrong key name AND wrong value format, so no oracle trigger has ever evaluated correctly. The fix is two-part: a one-time migration to repair stored JSONB, and a form change to write the correct values going forward.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260606000002_fix_trigger_condition_operator.sql`:

```sql
-- Convert stored trigger_condition from { comparator: '>'/'<'/'=' } to { operator: 'gt'/'lt'/'gte' }
-- to match the interface expected by lib/oracle/trigger.ts evaluateTrigger()
UPDATE contracts
SET trigger_condition = (trigger_condition - 'comparator') ||
  jsonb_build_object('operator',
    CASE trigger_condition->>'comparator'
      WHEN '>'  THEN 'gt'
      WHEN '>=' THEN 'gte'
      WHEN '<'  THEN 'lt'
      WHEN '<=' THEN 'lte'
      WHEN '='  THEN 'gte'
      ELSE 'gt'
    END
  )
WHERE trigger_condition ? 'comparator'
  AND trigger_type IN ('weather', 'urban');
```

- [ ] **Step 2: Apply the migration locally**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu
npx supabase db push
```

Expected: Migration applied successfully (or "No changes" if local DB already matches).

- [ ] **Step 3: Update `components/admin/contracts/ContractForm.tsx`**

At the top of the file, replace the `COMPARATORS` constant and add a mapping table. Change the `buildTriggerCondition` function to output `operator` instead of `comparator`. Change `parseTriggerCondition` to read `operator` back and convert to display symbol.

**Replace:**
```typescript
const WEATHER_METRICS = ['rainfall', 'temperature', 'wind', 'snow']
const URBAN_METRICS = ['delay', 'congestion']
const COMPARATORS = ['>', '<', '=']
```

**With:**
```typescript
const WEATHER_METRICS = ['rainfall', 'temperature', 'wind', 'snow']
const URBAN_METRICS = ['delay', 'congestion']
const COMPARATORS = ['>', '>=', '<', '<='] as const
const SYMBOL_TO_OPERATOR: Record<string, 'gt' | 'gte' | 'lt' | 'lte'> = {
  '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte',
}
const OPERATOR_TO_SYMBOL: Record<string, string> = {
  gt: '>', gte: '>=', lt: '<', lte: '<=',
}
```

**Replace `buildTriggerCondition`:**
```typescript
function buildTriggerCondition(
  type: string,
  state: { metric: string; comparator: string; threshold: string; unit: string; description: string },
): Record<string, unknown> {
  if (type === 'weather' || type === 'urban') {
    return {
      metric: state.metric,
      operator: SYMBOL_TO_OPERATOR[state.comparator] ?? 'gt',
      threshold: Number(state.threshold),
      unit: state.unit,
    }
  }
  if (type === 'event') return { description: state.description }
  return {}
}
```

**Replace `parseTriggerCondition`:**
```typescript
function parseTriggerCondition(
  type: string,
  condition: Record<string, unknown>,
) {
  if (type === 'weather' || type === 'urban') {
    const operator = String(condition.operator ?? condition.comparator ?? 'gt')
    const comparator = OPERATOR_TO_SYMBOL[operator] ?? operator
    return {
      metric: String(condition.metric ?? ''),
      comparator,
      threshold: String(condition.threshold ?? ''),
      unit: String(condition.unit ?? ''),
      description: '',
    }
  }
  if (type === 'event') {
    return { metric: '', comparator: '>', threshold: '', unit: '', description: String(condition.description ?? '') }
  }
  return { metric: '', comparator: '>', threshold: '', unit: '', description: '' }
}
```

Also update the `handleTypeChange` default to use `'>'` (already is, no change needed).

- [ ] **Step 4: Run the full test suite to confirm no regressions**

```bash
npx vitest run
```

Expected: All tests pass. OracleConditions tests already use the canonical `operator` format so no changes needed there.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260606000002_fix_trigger_condition_operator.sql \
        components/admin/contracts/ContractForm.tsx
git commit -m "fix: store canonical operator values in trigger_condition (gte/gt/lt/lte)"
```

---

### Task 3: Reorder payout settlement for transaction safety

**Files:**
- Modify: `lib/payout/processor.ts`
- Modify: `tests/lib/payout/processor.test.ts`

**Context:** `settleContract()` currently marks the contract `settled` in the DB as its first action, before any Stripe calls. If Stripe fails for all positions, the contract is permanently settled with no payouts — `processPayouts` will never retry it (it filters `status = 'active'`). The fix: move the contract settlement to after all positions are processed, and add an idempotency guard so re-runs don't create duplicate payout records for positions that already have a non-failed payout.

**Reordering invariant:** Eligible positions still filtered to `status = 'active'`, so a paid-out position from a previous partial run is never reprocessed.

- [ ] **Step 1: Write the failing test for idempotency**

Add to `tests/lib/payout/processor.test.ts` inside the `describe('processPayouts')` block:

```typescript
it('does not create a second payout record when a non-failed payout already exists for the position', async () => {
  // Simulate a re-run where the position is still active but already has a processing payout
  const dbWithExistingPayout = makeDb()
  // Override payouts.select to return an existing processing record
  const existingPayoutRecord = { id: 'payout-existing', status: 'processing' }
  dbWithExistingPayout.from = vi.fn((table: string) => {
    if (table === 'payouts') {
      return {
        insert: dbWithExistingPayout._payoutsInsert,
        update: dbWithExistingPayout._payoutsUpdate,
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            neq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: existingPayoutRecord, error: null }),
            }),
          }),
        }),
      }
    }
    return makeDb().from(table)
  }) as never

  // Re-use the original makeDb for other tables
  const baseDb = makeDb()
  const combinedDb = {
    from: vi.fn((table: string) => {
      if (table === 'payouts') {
        return {
          insert: baseDb._payoutsInsert,
          update: baseDb._payoutsUpdate,
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: existingPayoutRecord, error: null }),
              }),
            }),
          }),
        }
      }
      return baseDb.from(table)
    }),
    _payoutsInsert: baseDb._payoutsInsert,
  }

  await processPayouts(combinedDb as never, makeStripe() as never)
  expect(combinedDb._payoutsInsert).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/payout/processor.test.ts
```

Expected: FAIL on the new idempotency test (no `select` on `payouts` table yet).

- [ ] **Step 3: Update `lib/payout/processor.ts` — reorder `settleContract` and add idempotency guard**

Replace the `settleContract` function body:

```typescript
async function settleContract(
  db: DbClient,
  stripe: StripeClient,
  contract: Contract,
  triggerReadAt: string,
): Promise<number> {
  const { data: positions } = await db
    .from('hedger_positions')
    .select('*')
    .eq('contract_id', contract.id)
    .eq('status', 'active')

  if (!positions) return 0

  const eligiblePositions = (positions as HedgerPosition[]).filter((pos) =>
    !pos.coverage_period_days ||
    new Date(pos.expires_at) >= new Date(triggerReadAt),
  )

  let paid = 0
  let totalHedgerPayout = 0
  for (const position of eligiblePositions) {
    const amountPaid = await payoutPosition(db, stripe, contract.id, position)
    if (amountPaid > 0) {
      paid++
      totalHedgerPayout += amountPaid
    }
  }

  // Mark contract settled after payouts are processed.
  // If this function is retried due to an earlier crash, positions already paid out
  // are filtered by .eq('status', 'active') above so they won't be double-charged.
  await db.from('contracts')
    .update({ settled_outcome: true, status: 'settled', settled_at: new Date().toISOString() })
    .eq('id', contract.id)

  await settleProviderPositions(db, contract.id, totalHedgerPayout)

  return paid
}
```

Replace the beginning of `payoutPosition` to add the idempotency guard (insert right after the tier fetch, before the Stripe customer lookup):

The current `payoutPosition` function starts with the tier fetch. Add the idempotency check right after it, before profile/Stripe work:

```typescript
async function payoutPosition(
  db: DbClient,
  stripe: StripeClient,
  contractId: string,
  position: HedgerPosition,
): Promise<number> {
  const { data: tier } = await db
    .from('coverage_tiers')
    .select('payout_usd, payout_mxn')
    .eq('id', position.tier_id)
    .single()
  const payoutAmountUsd = tier ? Number((tier as { payout_usd: number }).payout_usd) : position.payout_amount_usd
  const payoutAmountMxn = tier ? Number((tier as { payout_mxn: number }).payout_mxn) : position.payout_amount_mxn

  // Idempotency: skip if a non-failed payout already exists (prevents duplicate charges on retry)
  const { data: existingPayout } = await db
    .from('payouts')
    .select('id, status')
    .eq('hedger_position_id', position.id)
    .neq('status', 'failed')
    .maybeSingle()
  if (existingPayout) return 0

  const { data: profile } = await db
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', position.user_id)
    .single()

  // ... rest of function unchanged ...
```

The full `payoutPosition` replacement:

```typescript
async function payoutPosition(
  db: DbClient,
  stripe: StripeClient,
  contractId: string,
  position: HedgerPosition,
): Promise<number> {
  const { data: tier } = await db
    .from('coverage_tiers')
    .select('payout_usd, payout_mxn')
    .eq('id', position.tier_id)
    .single()
  const payoutAmountUsd = tier ? Number((tier as { payout_usd: number }).payout_usd) : position.payout_amount_usd
  const payoutAmountMxn = tier ? Number((tier as { payout_mxn: number }).payout_mxn) : position.payout_amount_mxn

  // Idempotency: skip if a non-failed payout already exists (prevents duplicate charges on retry)
  const { data: existingPayout } = await db
    .from('payouts')
    .select('id, status')
    .eq('hedger_position_id', position.id)
    .neq('status', 'failed')
    .maybeSingle()
  if (existingPayout) return 0

  const { data: profile } = await db
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', position.user_id)
    .single()

  let customerId = (profile as { stripe_customer_id: string | null } | null)?.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({ metadata: { user_id: position.user_id } })
    customerId = customer.id
    await db.from('profiles').update({ stripe_customer_id: customerId }).eq('id', position.user_id)
  }

  const { data: payout } = await db.from('payouts')
    .insert({
      contract_id: contractId,
      hedger_position_id: position.id,
      amount_usd: payoutAmountUsd,
      amount_mxn: payoutAmountMxn,
      currency: position.currency,
      payment_provider: 'stripe',
      status: 'processing',
    })
    .select('id')
    .single()

  if (!payout) {
    console.error(`Failed to create payout record for position ${position.id}`)
    return 0
  }

  let txnId: string
  try {
    const txn = await stripe.customers.createBalanceTransaction(customerId, {
      amount: -Math.round(payoutAmountUsd * 100),
      currency: 'usd',
    })
    txnId = txn.id
  } catch (err) {
    console.error(`Stripe balance transaction failed for position ${position.id}:`, err)
    await db.from('payouts')
      .update({ status: 'failed' })
      .eq('id', (payout as { id: string }).id)
    return 0
  }

  await db.from('payouts')
    .update({ status: 'completed', transfer_id: txnId, completed_at: new Date().toISOString() })
    .eq('id', (payout as { id: string }).id)

  await db.from('hedger_positions').update({ status: 'paid_out' }).eq('id', position.id)
  return payoutAmountUsd
}
```

- [ ] **Step 4: Update the existing `makeDb` mock to support `payouts.select`**

The `payouts` branch in `makeDb` must support a `select` chain that by default returns `null` (no existing payout):

```typescript
if (table === 'payouts') {
  return {
    insert: payoutsInsert,
    update: payoutsUpdate,
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        neq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  }
}
```

Replace only the `payouts` branch in `makeDb`. All other tests remain unchanged because `data: null` means "no existing payout → proceed as normal".

- [ ] **Step 5: Simplify the idempotency test now that `makeDb` supports it**

Now that `makeDb` returns `null` for `payouts.select` by default, the idempotency test can be simplified. Replace the overly complex test written in Step 1 with:

```typescript
it('does not create a second payout record when a non-failed payout already exists for the position', async () => {
  const db = makeDb()
  // Override the payouts.select to return an existing processing record
  const payoutsChain = {
    eq: vi.fn().mockReturnValue({
      neq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'payout-existing', status: 'processing' }, error: null }),
      }),
    }),
  }
  const originalFrom = db.from.bind(db)
  db.from = vi.fn((table: string) => {
    if (table === 'payouts') {
      return {
        insert: db._payoutsInsert,
        update: db._payoutsUpdate,
        select: vi.fn().mockReturnValue(payoutsChain),
      }
    }
    return originalFrom(table)
  }) as never

  await processPayouts(db as never, makeStripe() as never)
  expect(db._payoutsInsert).not.toHaveBeenCalled()
})
```

- [ ] **Step 6: Add a test confirming contract is settled AFTER positions**

Add to the `describe('processPayouts')` block:

```typescript
it('marks contract settled after processing payouts (not before)', async () => {
  const callOrder: string[] = []
  const db = makeDb()

  const originalFrom = db.from.bind(db)
  db.from = vi.fn((table: string) => {
    const branch = originalFrom(table)
    if (table === 'contracts') {
      const originalUpdate = branch.update.bind(branch)
      branch.update = vi.fn((...args: unknown[]) => {
        callOrder.push('contracts.update')
        return originalUpdate(...args)
      })
    }
    if (table === 'payouts') {
      const originalInsert = branch.insert.bind(branch)
      branch.insert = vi.fn((...args: unknown[]) => {
        callOrder.push('payouts.insert')
        return originalInsert(...args)
      })
    }
    return branch
  }) as never

  await processPayouts(db as never, makeStripe() as never)
  const payoutsInsertIdx = callOrder.indexOf('payouts.insert')
  const contractsUpdateIdx = callOrder.indexOf('contracts.update')
  expect(payoutsInsertIdx).toBeGreaterThanOrEqual(0)
  expect(contractsUpdateIdx).toBeGreaterThan(payoutsInsertIdx)
})
```

- [ ] **Step 7: Run all processor tests**

```bash
npx vitest run tests/lib/payout/processor.test.ts
```

Expected: All tests pass (existing + 2 new).

- [ ] **Step 8: Run the full test suite**

```bash
npx vitest run
```

Expected: All 200+ tests pass.

- [ ] **Step 9: Commit**

```bash
git add lib/payout/processor.ts tests/lib/payout/processor.test.ts
git commit -m "fix: settle contract after payouts to prevent orphaned settlement on Stripe failure"
```

---

### Final: Push

```bash
git push
```
