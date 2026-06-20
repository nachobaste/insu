# Contract Expiration & Recurring Logic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically expire one-time contracts (concerts, carnivals) from the dashboard after their deadline passes, while keeping recurring contracts (hurricane, traffic) live forever; also expire individual hedger positions on recurring contracts when their coverage window closes.

**Architecture:** Add `is_recurring` boolean to contracts + make `trigger_deadline` nullable (recurring contracts have no meaningful deadline). A new `expireContracts()` function runs inside the existing daily `payout-process` cron: it settles passed one-time contracts with `settled_outcome = false` and returns provider capital in full, then marks stale hedger positions on recurring contracts as `expired`. The admin form gains a toggle that unlocks/locks the deadline field accordingly.

**Tech Stack:** Next.js App Router, Supabase (Postgres), Vitest, TypeScript

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260606000001_add_is_recurring.sql` | CREATE | Add `is_recurring` column, make `trigger_deadline` nullable, backfill |
| `lib/types.ts` | MODIFY | Add `is_recurring: boolean`, change `trigger_deadline: string \| null` |
| `lib/payout/processor.ts` | MODIFY | Add `expireContracts()` export |
| `tests/lib/payout/processor.test.ts` | MODIFY | Add `expireContracts` test suite |
| `app/api/payout-process/route.ts` | MODIFY | Call both `processPayouts` + `expireContracts`, return both counts |
| `tests/api/payout-process.test.ts` | MODIFY | Update expected response shape |
| `lib/actions/admin.ts` | MODIFY | Include `is_recurring` in upsert, relax deadline validation for recurring |
| `components/admin/contracts/ContractForm.tsx` | MODIFY | Add `is_recurring` toggle; hide/clear deadline when recurring |

---

### Task 1: Migration — add `is_recurring`, make `trigger_deadline` nullable

**Files:**
- Create: `supabase/migrations/20260606000001_add_is_recurring.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260606000001_add_is_recurring.sql

ALTER TABLE contracts
  ADD COLUMN is_recurring boolean NOT NULL DEFAULT false;

-- Recurring: weather and urban contracts always roll over
UPDATE contracts SET is_recurring = true
WHERE trigger_type IN ('weather', 'urban');

-- Recurring contracts have no meaningful hard deadline
ALTER TABLE contracts
  ALTER COLUMN trigger_deadline DROP NOT NULL;
```

- [ ] **Step 2: Apply locally and verify**

```bash
npx supabase db reset
# or if running supabase locally:
npx supabase migration up
```

Expected: migration applies without error. `\d contracts` in psql shows `is_recurring bool` column and `trigger_deadline timestamptz` (nullable).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260606000001_add_is_recurring.sql
git commit -m "feat: add is_recurring to contracts and make trigger_deadline nullable"
```

---

### Task 2: Update TypeScript types

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Write the failing type check**

Add a test file temporarily to confirm the types compile correctly after the change — or just update the types and rely on `tsc --noEmit` to catch regressions.

- [ ] **Step 2: Update `Contract` interface**

In `lib/types.ts`, change line:
```typescript
trigger_deadline: string
```
to:
```typescript
trigger_deadline: string | null
is_recurring: boolean
```

- [ ] **Step 3: Update `UpsertContractInput` interface**

In `lib/types.ts`, change:
```typescript
export interface UpsertContractInput {
  id?: string
  title: string
  description: string | null
  category_id: string
  status: ContractStatus
  trigger_type: TriggerType
  trigger_condition: Record<string, unknown>
  trigger_deadline: string
  location: ContractLocation
  icon_url: string | null
  is_featured: boolean
  basic_tier: { premium_usd: number; payout_usd: number; max_capacity_usd: number }
  premium_tier: { premium_usd: number; payout_usd: number; max_capacity_usd: number }
}
```
to:
```typescript
export interface UpsertContractInput {
  id?: string
  title: string
  description: string | null
  category_id: string
  status: ContractStatus
  trigger_type: TriggerType
  trigger_condition: Record<string, unknown>
  trigger_deadline: string | null
  location: ContractLocation
  icon_url: string | null
  is_featured: boolean
  is_recurring: boolean
  basic_tier: { premium_usd: number; payout_usd: number; max_capacity_usd: number }
  premium_tier: { premium_usd: number; payout_usd: number; max_capacity_usd: number }
}
```

- [ ] **Step 4: Run type check**

```bash
npx tsc --noEmit
```

Expected: zero errors (or only pre-existing ones unrelated to this change — fix any new ones).

- [ ] **Step 5: Update `mockContract` in processor tests to include new field**

In `tests/lib/payout/processor.test.ts`, add `is_recurring: false` to `mockContract`:
```typescript
const mockContract: Contract = {
  // ... existing fields ...
  trigger_deadline: new Date(Date.now() + 86400000).toISOString(),
  is_recurring: false,
  // ...
}
```

- [ ] **Step 6: Run tests to make sure nothing broke**

```bash
npx vitest run tests/lib/payout/processor.test.ts
```

Expected: all 13 existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/types.ts tests/lib/payout/processor.test.ts
git commit -m "feat: add is_recurring and nullable trigger_deadline to Contract types"
```

---

### Task 3: `expireContracts` function + tests

**Files:**
- Modify: `lib/payout/processor.ts`
- Modify: `tests/lib/payout/processor.test.ts`

The function must:
1. Settle one-time contracts (`is_recurring = false`) whose `trigger_deadline` has passed with `settled_outcome = false`
2. Set active hedger positions on those contracts to `expired`
3. Settle provider positions on those contracts with full capital return (no loss — event didn't trigger)
4. Expire active hedger positions on *any* contract (including recurring) where `expires_at < now()`

Returns: number of one-time contracts expired.

- [ ] **Step 1: Write failing tests first**

Append a new `describe('expireContracts', ...)` block to `tests/lib/payout/processor.test.ts`:

```typescript
import { processPayouts, expireContracts } from '@/lib/payout/processor'

// Add these mock objects near the top of the file with existing mocks:

const recurringContract: Contract = {
  ...mockContract,
  id: 'c-recurring',
  slug: 'traffic-cdmx',
  trigger_type: 'urban',
  is_recurring: true,
  trigger_deadline: null,
}

const expiredOneTimeContract: Contract = {
  ...mockContract,
  id: 'c-onetime',
  slug: 'bad-bunny',
  trigger_type: 'event',
  is_recurring: false,
  trigger_deadline: new Date(Date.now() - 86_400_000).toISOString(), // 1 day ago
  settled_outcome: null,
}

const staleHedgerPosition: HedgerPosition = {
  ...mockHedgerPosition,
  id: 'pos-stale',
  contract_id: 'c-recurring',
  coverage_period_days: 7,
  expires_at: new Date(Date.now() - 3_600_000).toISOString(), // 1 hour ago
}

function makeExpireDb(opts: {
  expiredContracts?: Contract[]
  hedgerPositions?: HedgerPosition[]
  providerPositions?: ProviderPosition[]
} = {}) {
  const expiredContracts = opts.expiredContracts ?? [expiredOneTimeContract]
  const hedgerPositions = opts.hedgerPositions ?? []
  const providerPositions = opts.providerPositions ?? []

  const contractUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const hedgerUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const providerUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const providerUpdate = vi.fn().mockReturnValue({ eq: providerUpdateEq })

  // Tracks which table's update chain is being built
  let lastUpdateTable = ''

  return {
    from: vi.fn((table: string) => {
      lastUpdateTable = table
      if (table === 'contracts') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  lt: vi.fn().mockResolvedValue({ data: expiredContracts, error: null }),
                }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({ eq: contractUpdateEq }),
        }
      }
      if (table === 'hedger_positions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: hedgerPositions, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lt: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'provider_positions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: providerPositions, error: null }),
            }),
          }),
          update: providerUpdate,
        }
      }
      return {}
    }),
    _contractUpdateEq: contractUpdateEq,
    _hedgerUpdateEq: hedgerUpdateEq,
    _providerUpdate: providerUpdate,
    _providerUpdateEq: providerUpdateEq,
  }
}

describe('expireContracts', () => {
  it('returns 0 when no one-time contracts have passed deadline', async () => {
    const db = makeExpireDb({ expiredContracts: [] })
    const count = await expireContracts(db as never)
    expect(count).toBe(0)
  })

  it('returns 1 when one expired one-time contract is found', async () => {
    const db = makeExpireDb()
    const count = await expireContracts(db as never)
    expect(count).toBe(1)
  })

  it('settles expired one-time contract with settled_outcome=false', async () => {
    const db = makeExpireDb()
    await expireContracts(db as never)
    expect(db._contractUpdateEq).toHaveBeenCalledWith('id', 'c-onetime')
    const updateCall = db.from.mock.calls.find(([t]: [string]) => t === 'contracts')
    expect(updateCall).toBeDefined()
  })

  it('settles provider positions with full capital return when contract expires without trigger', async () => {
    const providerPos: ProviderPosition = {
      ...mockProviderPosition,
      id: 'pp-event',
      contract_id: 'c-onetime',
      capital_deposited_usd: 5000,
    }
    const db = makeExpireDb({ providerPositions: [providerPos] })
    await expireContracts(db as never)
    expect(db._providerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'settled',
        actual_return_usd: 5000,
      }),
    )
    expect(db._providerUpdateEq).toHaveBeenCalledWith('id', 'pp-event')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/lib/payout/processor.test.ts
```

Expected: `expireContracts` tests fail with "expireContracts is not a function" (import doesn't exist yet).

- [ ] **Step 3: Implement `expireContracts` in `lib/payout/processor.ts`**

Add after the existing `repriceAll` export, before the end of file:

```typescript
export async function expireContracts(db: DbClient = getClient()): Promise<number> {
  const now = new Date().toISOString()

  // 1. Find one-time contracts whose deadline has passed without triggering
  const { data: pastDeadline } = await db
    .from('contracts')
    .select('id')
    .eq('status', 'active')
    .eq('is_recurring', false)
    .is('settled_outcome', null)
    .lt('trigger_deadline', now)

  let expiredCount = 0

  for (const contract of (pastDeadline ?? []) as Array<{ id: string }>) {
    // Settle contract with no-trigger outcome
    await db.from('contracts')
      .update({ status: 'settled', settled_outcome: false, settled_at: now })
      .eq('id', contract.id)

    // Expire all active hedger positions — event didn't fire, no payout
    await db.from('hedger_positions')
      .update({ status: 'expired' })
      .eq('contract_id', contract.id)
      .eq('status', 'active')

    // Return full capital to providers — no loss since trigger never fired
    const { data: providerPositions } = await db
      .from('provider_positions')
      .select('id, capital_deposited_usd')
      .eq('contract_id', contract.id)
      .eq('status', 'active')

    for (const pos of (providerPositions ?? []) as Array<{ id: string; capital_deposited_usd: number }>) {
      await db.from('provider_positions')
        .update({ status: 'settled', actual_return_usd: pos.capital_deposited_usd, settled_at: now })
        .eq('id', pos.id)
    }

    expiredCount++
  }

  // 2. Expire stale hedger positions on any active contract (covers recurring contracts)
  await db.from('hedger_positions')
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lt('expires_at', now)

  return expiredCount
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/lib/payout/processor.test.ts
```

Expected: all tests pass (existing 13 + new expireContracts tests).

- [ ] **Step 5: Commit**

```bash
git add lib/payout/processor.ts tests/lib/payout/processor.test.ts
git commit -m "feat: add expireContracts — settle one-time contracts past deadline, expire stale positions"
```

---

### Task 4: Wire `expireContracts` into the payout-process cron route

**Files:**
- Modify: `app/api/payout-process/route.ts`
- Modify: `tests/api/payout-process.test.ts`

- [ ] **Step 1: Update the route**

Replace the contents of `app/api/payout-process/route.ts`:

```typescript
import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { processPayouts, expireContracts } from '@/lib/payout/processor'

async function handlePayouts(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(req.headers.get('authorization') ?? '')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
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

- [ ] **Step 2: Update the route test**

Replace `tests/api/payout-process.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/payout/processor', () => ({
  processPayouts: vi.fn().mockResolvedValue(2),
  expireContracts: vi.fn().mockResolvedValue(1),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue({}),
}))
vi.mock('stripe', () => {
  class MockStripe {
    constructor(key: string) {}
  }
  return { default: MockStripe }
})

async function makeRequest(secret: string) {
  vi.resetModules()
  const { POST } = await import('@/app/api/payout-process/route')
  return POST(new NextRequest('http://localhost/api/payout-process', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  }))
}

describe('POST /api/payout-process', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
    process.env.STRIPE_SECRET_KEY = 'sk_test_key'
  })

  it('returns 401 with wrong secret', async () => {
    const res = await makeRequest('wrong')
    expect(res.status).toBe(401)
  })

  it('returns paid and expired counts with correct secret', async () => {
    const res = await makeRequest('test-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ paid: 2, expired: 1 })
  })
})
```

- [ ] **Step 3: Run all tests**

```bash
npx vitest run tests/api/payout-process.test.ts tests/lib/payout/processor.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/api/payout-process/route.ts tests/api/payout-process.test.ts
git commit -m "feat: run expireContracts alongside processPayouts in daily cron"
```

---

### Task 5: Admin action — include `is_recurring`, relax deadline validation

**Files:**
- Modify: `lib/actions/admin.ts`

- [ ] **Step 1: Update `upsertContract`**

In `lib/actions/admin.ts`, change the validation block:
```typescript
// Before:
if (new Date(input.trigger_deadline) <= new Date()) {
  throw new Error('Deadline must be in the future')
}
```
to:
```typescript
if (!input.is_recurring && input.trigger_deadline && new Date(input.trigger_deadline) <= new Date()) {
  throw new Error('Deadline must be in the future')
}
```

And in `contractFields`, add `is_recurring` and `trigger_deadline`:
```typescript
const contractFields = {
  title: input.title,
  description: input.description,
  category_id: input.category_id,
  status: input.status,
  trigger_type: input.trigger_type,
  trigger_condition: input.trigger_condition,
  trigger_deadline: input.is_recurring ? null : input.trigger_deadline,
  location: input.location,
  icon_url: input.icon_url,
  is_featured: input.is_featured,
  is_recurring: input.is_recurring,
}
```

- [ ] **Step 2: Run type check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/admin.ts
git commit -m "feat: persist is_recurring in admin upsert, skip deadline validation for recurring contracts"
```

---

### Task 6: Admin ContractForm — `is_recurring` toggle

**Files:**
- Modify: `components/admin/contracts/ContractForm.tsx`

- [ ] **Step 1: Add `isRecurring` state and toggle**

After the existing `isFeatured` state (around line 67), add:
```typescript
const [isRecurring, setIsRecurring] = useState(contract?.is_recurring ?? false)
```

- [ ] **Step 2: Build the toggle UI**

After the `is_featured` checkbox in the JSX, add an `is_recurring` toggle. Find the featured checkbox in the form and add below it:

```tsx
{/* Recurring toggle */}
<div className="flex items-center gap-3">
  <label className="text-[13px] font-medium text-insu-text">Recurring contract</label>
  <button
    type="button"
    onClick={() => setIsRecurring(v => !v)}
    className={cn(
      'relative h-6 w-11 rounded-full transition-colors',
      isRecurring ? 'bg-insu-accent' : 'bg-white/10',
    )}
  >
    <span
      className={cn(
        'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
        isRecurring ? 'translate-x-5' : 'translate-x-0.5',
      )}
    />
  </button>
  <span className="text-[12px] text-insu-muted">
    {isRecurring ? 'Rolls over (no deadline)' : 'One-time event (expires at deadline)'}
  </span>
</div>
```

- [ ] **Step 3: Make deadline field conditional**

Find the `deadline` input in the JSX. Wrap it so it's hidden when `isRecurring` is true:

```tsx
{!isRecurring && (
  <div>
    <label className="...">Trigger deadline</label>
    <input
      type="date"
      value={deadline}
      onChange={e => setDeadline(e.target.value)}
      required
      className="..."
    />
  </div>
)}
```

- [ ] **Step 4: Include `is_recurring` and handle nullable deadline in form submission**

Find the `handleSubmit` / form submission block where `UpsertContractInput` is built. Add `is_recurring` and make `trigger_deadline` nullable:

```typescript
const input: UpsertContractInput = {
  // ... existing fields ...
  trigger_deadline: isRecurring ? null : deadline,
  is_recurring: isRecurring,
  // ...
}
```

- [ ] **Step 5: Run type check and start dev server to visually verify**

```bash
npx tsc --noEmit
```

Then start the dev server and navigate to `/admin/contracts/new` — confirm the toggle appears, flipping it hides the deadline field, and the recurring label updates.

- [ ] **Step 6: Commit**

```bash
git add components/admin/contracts/ContractForm.tsx
git commit -m "feat: add is_recurring toggle to admin ContractForm, hide deadline for recurring contracts"
```

---

### Task 7: Full test run + push

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Apply migration to remote Supabase**

```bash
npx supabase db push
```

Expected: migration `20260606000001_add_is_recurring.sql` applied successfully.

- [ ] **Step 4: Commit and push**

```bash
git push
```
