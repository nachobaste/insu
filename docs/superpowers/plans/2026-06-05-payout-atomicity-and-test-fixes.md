# Payout Atomicity & Test Suite Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a silent data corruption bug where Stripe failures leave payout records permanently stuck in `processing` status, and repair all 23 pre-existing failing tests so the test suite is a reliable safety net.

**Architecture:** Fix 1 is a targeted one-liner in `processor.ts`: mark payouts `failed` (not leave them `processing`) when Stripe throws, making them retryable via the existing `retryPayout` admin function. Fix 2 is purely test-side — no production code changes — fixing mocks and assertions in 7 test files.

**Tech Stack:** Next.js App Router, Supabase, Stripe, Vitest, React Testing Library

---

## File Map

| File | Action | Why |
|---|---|---|
| `lib/payout/processor.ts` | MODIFY | Mark payout `failed` on Stripe error |
| `tests/lib/payout/processor.test.ts` | MODIFY | Add test for Stripe failure path |
| `vitest.setup.ts` | MODIFY | Add `next/navigation` mock (fixes Header) |
| `tests/lib/actions/dashboard.test.ts` | MODIFY | Add `auth.getUser` to Supabase mock |
| `tests/lib/actions/admin.test.ts` | MODIFY | Add `STRIPE_SECRET_KEY` to test env |
| `tests/lib/actions/purchase.test.ts` | MODIFY | Fix capacity mock — wrong export name |
| `tests/lib/actions/oracle/injectReading.test.ts` | MODIFY | Add profiles table mock returning admin role |
| `tests/components/TierSelector.test.tsx` | MODIFY | Fix button selector and disable logic assertions |
| `tests/components/PurchasePanel.test.tsx` | MODIFY | Wrap state assertions in `waitFor` |

---

### Task 1: Payout atomicity — mark `failed` on Stripe error

**Files:**
- Modify: `lib/payout/processor.ts`
- Modify: `tests/lib/payout/processor.test.ts`

**Background:** In `payoutPosition()`, when `stripe.customers.createBalanceTransaction()` throws, the payout record is already inserted with `status='processing'`. The catch block currently just logs and returns 0, leaving the record stuck. `retryPayout` in admin.ts explicitly throws `'Payout is already processing'` for these records, blocking any retry. Marking them `failed` instead makes them retryable.

- [ ] **Step 1: Write the failing test**

In `tests/lib/payout/processor.test.ts`, add this test inside the existing `describe('processPayouts', ...)` block, after the last existing test:

```typescript
it('marks payout as failed when Stripe balance transaction throws', async () => {
  const db = makeDb()
  const stripe = {
    customers: {
      create: vi.fn().mockResolvedValue({ id: 'cus_test123' }),
      createBalanceTransaction: vi.fn().mockRejectedValue(new Error('Stripe network error')),
    },
  }
  await processPayouts(db as never, stripe as never)
  // payout should be updated to 'failed', not left as 'processing'
  expect(db._payoutsUpdateEq).toHaveBeenCalledWith('id', 'payout-1')
  const updateArg = db.from.mock.results
    .map((r: { value: unknown }) => r.value)
    .find((v: Record<string, unknown>) => typeof v === 'object' && v !== null && 'update' in v)
  // The payout update must have been called with status: 'failed'
  const payoutsFrom = db.from.mock.calls
    .map((call: [string], i: number) => ({ table: call[0], result: db.from.mock.results[i].value }))
    .filter(({ table }: { table: string }) => table === 'payouts')
  expect(payoutsFrom.length).toBeGreaterThan(0)
})
```

Actually, the existing `makeDb` mock tracks `_payoutsUpdateEq`. We need to assert the update was called with `{ status: 'failed' }`. The existing mock structure uses a shared `payoutsUpdateEq` for all payout updates. Use a simpler assertion:

Replace the test above with this cleaner version:

```typescript
it('marks payout as failed when Stripe balance transaction throws', async () => {
  const db = makeDb()
  const failingStripe = {
    customers: {
      create: vi.fn().mockResolvedValue({ id: 'cus_test123' }),
      createBalanceTransaction: vi.fn().mockRejectedValue(new Error('Stripe network error')),
    },
  }
  const count = await processPayouts(db as never, failingStripe as never)
  expect(count).toBe(0)
  // The payouts table must have been updated (to 'failed') after the Stripe error
  expect(db._payoutsUpdateEq).toHaveBeenCalledWith('id', 'payout-1')
})
```

- [ ] **Step 2: Also update the payout mock to track what it was updated WITH**

The existing `makeDb` mock uses a shared `payoutsUpdateEq`. To assert `status: 'failed'` we need the `update()` call itself. Update `makeDb` — find the `payouts` table section:

```typescript
// Find this in makeDb:
if (table === 'payouts') {
  return {
    insert: payoutsInsert,
    update: vi.fn().mockReturnValue({ eq: payoutsUpdateEq }),
  }
}
```

Replace with:
```typescript
if (table === 'payouts') {
  return {
    insert: payoutsInsert,
    update: payoutsUpdate,
  }
}
```

And add `payoutsUpdate` alongside the other mocks at the top of `makeDb`:
```typescript
const payoutsUpdate = vi.fn().mockReturnValue({ eq: payoutsUpdateEq })
```

And expose it on the returned object:
```typescript
_payoutsUpdate: payoutsUpdate,
```

Now update the test to assert the right status:
```typescript
it('marks payout as failed when Stripe balance transaction throws', async () => {
  const db = makeDb()
  const failingStripe = {
    customers: {
      create: vi.fn().mockResolvedValue({ id: 'cus_test123' }),
      createBalanceTransaction: vi.fn().mockRejectedValue(new Error('Stripe network error')),
    },
  }
  const count = await processPayouts(db as never, failingStripe as never)
  expect(count).toBe(0)
  expect(db._payoutsUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
})
```

- [ ] **Step 3: Run to confirm it fails**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run tests/lib/payout/processor.test.ts 2>&1 | tail -15
```

Expected: new test fails (payout is not updated to 'failed' yet).

- [ ] **Step 4: Implement the fix in `lib/payout/processor.ts`**

Find the catch block in `payoutPosition()` — it looks like:
```typescript
  } catch (err) {
    console.error(`Stripe balance transaction failed for position ${position.id}:`, err)
    return 0
  }
```

Replace it with:
```typescript
  } catch (err) {
    console.error(`Stripe balance transaction failed for position ${position.id}:`, err)
    await db.from('payouts')
      .update({ status: 'failed' })
      .eq('id', (payout as { id: string }).id)
    return 0
  }
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run tests/lib/payout/processor.test.ts 2>&1 | tail -15
```

Expected: all processor tests pass including the new one.

- [ ] **Step 6: Commit**

```bash
git add lib/payout/processor.ts tests/lib/payout/processor.test.ts
git commit -m "fix: mark payout as failed when Stripe throws so it can be retried"
```

---

### Task 2: Fix `vitest.setup.ts` — add `next/navigation` mock

**Files:**
- Modify: `vitest.setup.ts`

**Background:** `tests/components/Header.test.tsx` fails because `LogoutButton` calls `useRouter()` from `next/navigation`, which requires the Next.js App Router context that doesn't exist in jsdom. Adding a global mock in the setup file fixes it for all component tests.

- [ ] **Step 1: Run Header test to confirm failure**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run tests/components/Header.test.tsx 2>&1 | tail -15
```

Expected: `invariant expected app router to be mounted`.

- [ ] **Step 2: Add `next/navigation` mock to `vitest.setup.ts`**

Append to the end of `vitest.setup.ts`:
```typescript
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
```

- [ ] **Step 3: Run Header test to confirm it passes**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run tests/components/Header.test.tsx 2>&1 | tail -15
```

Expected: all Header tests pass.

- [ ] **Step 4: Commit**

```bash
git add vitest.setup.ts
git commit -m "fix: add next/navigation mock to vitest setup"
```

---

### Task 3: Fix `dashboard.test.ts` — add `auth` to Supabase mock

**Files:**
- Modify: `tests/lib/actions/dashboard.test.ts`

**Background:** `getDashboardData()` calls `supabase.auth.getUser()` before any table queries. The test mock returns an object with only a `from()` method — no `auth` property — so all 5 tests throw `Cannot read properties of undefined (reading 'getUser')`.

- [ ] **Step 1: Run to confirm failures**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run tests/lib/actions/dashboard.test.ts 2>&1 | tail -20
```

Expected: 5 failures with `Cannot read properties of undefined`.

- [ ] **Step 2: Read the file**

Read `tests/lib/actions/dashboard.test.ts` in full to locate the `makeSupabase` function and understand what the mock currently returns.

- [ ] **Step 3: Add `auth` to the mock**

Find the object returned by `makeSupabase` (or equivalent mock factory). Add an `auth` property alongside `from`:

```typescript
auth: {
  getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
},
```

The exact placement depends on the mock structure — it must be a sibling of `from` on the returned object.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run tests/lib/actions/dashboard.test.ts 2>&1 | tail -15
```

Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/lib/actions/dashboard.test.ts
git commit -m "fix: add auth.getUser mock to dashboard tests"
```

---

### Task 4: Fix `admin.test.ts` — add `STRIPE_SECRET_KEY` env var

**Files:**
- Modify: `tests/lib/actions/admin.test.ts`

**Background:** `overrideContractTrigger()` and `retryPayout()` both call `getStripe()` which throws `'STRIPE_SECRET_KEY is not configured'` if the env var is missing. The tests don't set it up.

- [ ] **Step 1: Run to confirm failures**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run tests/lib/actions/admin.test.ts 2>&1 | tail -20
```

Expected: 2 failures with `STRIPE_SECRET_KEY is not configured`.

- [ ] **Step 2: Read the file**

Read `tests/lib/actions/admin.test.ts` to find the existing `beforeEach` block.

- [ ] **Step 3: Add the env var**

Inside the existing `beforeEach` (or add one if none exists), add:
```typescript
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_key'
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run tests/lib/actions/admin.test.ts 2>&1 | tail -15
```

Expected: all admin tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/lib/actions/admin.test.ts
git commit -m "fix: add STRIPE_SECRET_KEY to admin test env setup"
```

---

### Task 5: Fix `purchase.test.ts` — correct capacity mock export names

**Files:**
- Modify: `tests/lib/actions/purchase.test.ts`

**Background:** `lib/actions/purchase.ts` imports `validateBuyerCapacity` and `validateProviderCapacity` from `@/lib/utils/capacity`. The test mock only provides `validateCapacity` (wrong name), so all 7 tests fail with `No "validateBuyerCapacity" export is defined on the mock`.

- [ ] **Step 1: Run to confirm failures**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run tests/lib/actions/purchase.test.ts 2>&1 | tail -20
```

Expected: 7 failures with `No "validateBuyerCapacity" export is defined`.

- [ ] **Step 2: Read the file**

Read `tests/lib/actions/purchase.test.ts` to find the `vi.mock('@/lib/utils/capacity', ...)` call.

- [ ] **Step 3: Fix the mock**

Find the capacity mock (it currently has `validateCapacity`) and replace it with the correct export names:

```typescript
vi.mock('@/lib/utils/capacity', () => ({
  validateBuyerCapacity: vi.fn().mockReturnValue(null),
  validateProviderCapacity: vi.fn().mockReturnValue(null),
}))
```

Remove the old `validateCapacity` entry entirely.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run tests/lib/actions/purchase.test.ts 2>&1 | tail -15
```

Expected: all purchase tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/lib/actions/purchase.test.ts
git commit -m "fix: correct capacity mock export names in purchase tests"
```

---

### Task 6: Fix `injectReading.test.ts` — add profiles mock returning admin role

**Files:**
- Modify: `tests/lib/actions/oracle/injectReading.test.ts`

**Background:** `injectReading()` queries `profiles` table to check `role === 'admin'` before proceeding. The test mock handles contracts and oracle_readings but not profiles — so `profile` comes back null/undefined and every test returns `{ ok: false, error: 'Forbidden' }`.

- [ ] **Step 1: Run to confirm failures**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run tests/lib/actions/oracle/injectReading.test.ts 2>&1 | tail -20
```

Expected: 5 failures with `Forbidden`.

- [ ] **Step 2: Read the file**

Read `tests/lib/actions/oracle/injectReading.test.ts` in full to find the `mockFrom` factory and understand how tables are dispatched.

- [ ] **Step 3: Add profiles table handling to the mock**

Inside the `mockFrom` function (or wherever table routing happens), add a case for `profiles`:

```typescript
if (table === 'profiles') {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
      }),
    }),
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run tests/lib/actions/oracle/injectReading.test.ts 2>&1 | tail -15
```

Expected: all injectReading tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/lib/actions/oracle/injectReading.test.ts
git commit -m "fix: add profiles admin mock to injectReading tests"
```

---

### Task 7: Fix `TierSelector.test.tsx` — button selector and disable logic

**Files:**
- Modify: `tests/components/TierSelector.test.tsx`

**Background:** Two failures:
1. Test clicks `getAllByRole('button')[1]` expecting the Premium tier but TierSelector sorts basic-first, so index 1 is Basic. The click fires but with the wrong tier ID.
2. Test expects a button disabled when `current_capacity_usd === max_capacity_usd`, but in `'buy'` mode the disable condition is `current_capacity_usd < payout_usd`. These are different checks — the test needs to match the actual logic.

- [ ] **Step 1: Run to confirm failures**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run tests/components/TierSelector.test.tsx 2>&1 | tail -20
```

Expected: 2 failures.

- [ ] **Step 2: Read the file**

Read `tests/components/TierSelector.test.tsx` in full. Also read `components/markets/TierSelector.tsx` lines 1-40 to understand the disable logic.

- [ ] **Step 3: Fix the button selector test**

Find the test `"calls onSelect with tier id when clicked"`. Change the button selection from index-based to label-based. The Premium tier renders as "Pro" in the UI (TierSelector.tsx maps `name !== 'basic'` → label "Pro"). Use:

```typescript
await userEvent.click(screen.getByRole('button', { name: /pro/i }))
expect(onSelect).toHaveBeenCalledWith('tier-premium')
```

Or use `getByText` if the button doesn't have a label that matches — read the component to confirm the rendered text.

- [ ] **Step 4: Fix the disable test**

Find the test `"disables full tier"`. The disable logic for `'buy'` mode is `current_capacity_usd < payout_usd`. Update the test tier so this condition is true — set `payout_usd` higher than `current_capacity_usd`:

```typescript
const fullTiers: CoverageTier[] = [{
  ...tiers[0],
  id: 'tier-full',
  current_capacity_usd: 100,  // less than payout
  payout_usd: 500,            // payout exceeds available capacity
}]
// render with mode='buy' (default) and assert the button is disabled
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run tests/components/TierSelector.test.tsx 2>&1 | tail -15
```

Expected: all TierSelector tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/components/TierSelector.test.tsx
git commit -m "fix: correct TierSelector test button selector and disable assertion"
```

---

### Task 8: Fix `PurchasePanel.test.tsx` — wrap state assertions in `waitFor`

**Files:**
- Modify: `tests/components/PurchasePanel.test.tsx`

**Background:** The test clicks period and tier buttons then immediately asserts the Continue button is enabled. React state updates are async — the assertion fires before the state has propagated, so the button is still disabled. Wrapping in `waitFor` lets React flush updates.

- [ ] **Step 1: Run to confirm failure**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run tests/components/PurchasePanel.test.tsx 2>&1 | tail -20
```

Expected: 1 failure — "Continue button enables after period and tier are both selected".

- [ ] **Step 2: Read the file**

Read `tests/components/PurchasePanel.test.tsx` in full to find the failing test and its imports.

- [ ] **Step 3: Add `waitFor` import if missing**

At the top of the file, ensure `waitFor` is imported:
```typescript
import { render, screen, waitFor } from '@testing-library/react'
```

- [ ] **Step 4: Wrap the assertion**

Find the failing test. After the `userEvent.click` calls, wrap the `expect` in `waitFor`:

```typescript
await waitFor(() => {
  expect(screen.getByRole('button', { name: /continue/i })).not.toBeDisabled()
})
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run tests/components/PurchasePanel.test.tsx 2>&1 | tail -15
```

Expected: all PurchasePanel tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/components/PurchasePanel.test.tsx
git commit -m "fix: wrap PurchasePanel Continue button assertion in waitFor"
```

---

### Task 9: Full test run + push

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu && npx vitest run 2>&1 | tail -20
```

Expected: 0 failures (or only failures unrelated to the 23 we targeted — document any remainders).

- [ ] **Step 2: Push**

```bash
git push
```
