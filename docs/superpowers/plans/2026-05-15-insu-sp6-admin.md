# SP6: Admin Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a role-gated `/admin` area with sidebar navigation, contract CRUD, manual trigger override, oracle monitor, and payout retry.

**Architecture:** Next.js App Router layout nesting — `app/admin/layout.tsx` handles the role check and persistent sidebar once; each section is a separate Server Component page with its own data fetch. Client components handle interactivity (oracle click-to-select, payout filter tabs, trigger override form). All business logic lives in `lib/actions/admin.ts` as server actions.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (server client + service role), Stripe SDK (already installed), Tailwind CSS, Vitest

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `lib/types.ts` | Modify | Add `AdminAuditLog`, `UpsertContractInput`, `PayoutWithUser`, `OracleReadingWithContract` |
| `lib/actions/admin.ts` | Create | `upsertContract`, `overrideContractTrigger`, `retryPayout` server actions |
| `tests/lib/actions/admin.test.ts` | Create | Unit tests for all three server actions |
| `app/admin/layout.tsx` | Create | Role check → redirect + sidebar shell |
| `components/admin/AdminSidebar.tsx` | Create | Client component — `usePathname` active link |
| `app/admin/contracts/page.tsx` | Create | Server Component — fetch all contracts + render list |
| `components/admin/contracts/ContractList.tsx` | Create | Table with Edit links + New button |
| `app/admin/contracts/new/page.tsx` | Create | Server Component — fetch categories, render blank form |
| `app/admin/contracts/[id]/page.tsx` | Create | Server Component — fetch contract + tiers, render edit form |
| `components/admin/contracts/ContractForm.tsx` | Create | Client component — structured form, trigger_condition fields swap by type |
| `app/admin/trigger/page.tsx` | Create | Server Component — fetch active contracts, render TriggerOverride |
| `components/admin/trigger/TriggerOverride.tsx` | Create | Client component — contract select, summary, outcome choice, confirm |
| `app/admin/oracle/page.tsx` | Create | Server Component — fetch contracts + latest readings, render OracleMonitor |
| `components/admin/oracle/OracleMonitor.tsx` | Create | Client component — master/detail, bar chart, reading log |
| `app/admin/payouts/page.tsx` | Create | Server Component — fetch all payouts with joins, render PayoutQueue |
| `components/admin/payouts/PayoutQueue.tsx` | Create | Client component — stats strip, filter tabs, retry button |

---

## Task 1: Schema — admin_audit_log table

**Files:**
- Run SQL in Supabase SQL editor (no migration file — matches SP4 pattern)

- [ ] **Step 1: Run this SQL in the Supabase dashboard SQL editor**

```sql
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users(id),
  action text not null,
  contract_id uuid references public.contracts(id),
  payout_id uuid references public.payouts(id),
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

create policy "Admins can insert audit log"
  on public.admin_audit_log
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "Admins can read audit log"
  on public.admin_audit_log
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );
```

- [ ] **Step 2: Verify table exists**

In Supabase dashboard → Table Editor, confirm `admin_audit_log` appears with the columns above.

- [ ] **Step 3: Commit**

```bash
git add -p
git commit -m "chore: admin_audit_log schema (applied in Supabase)"
```

---

## Task 2: Types — extend lib/types.ts

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add these types at the bottom of `lib/types.ts`**

```typescript
export interface AdminAuditLog {
  id: string
  admin_id: string
  action: string
  contract_id: string | null
  payout_id: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

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

- [ ] **Step 2: Commit**

```bash
git add lib/types.ts
git commit -m "chore: add admin types — AdminAuditLog, UpsertContractInput, PayoutWithUser"
```

---

## Task 3: Admin actions — upsertContract (TDD)

**Files:**
- Create: `lib/actions/admin.ts`
- Create: `tests/lib/actions/admin.test.ts`

- [ ] **Step 1: Create the test file with test helpers and upsertContract tests**

```typescript
// tests/lib/actions/admin.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('stripe', () => ({ default: vi.fn() }))

import { upsertContract, overrideContractTrigger, retryPayout } from '@/lib/actions/admin'
import { createClient } from '@/lib/supabase/server'
import Stripe from 'stripe'

function makeChainable(result: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'update', 'not', 'is']) {
    b[m] = vi.fn().mockReturnValue(b)
  }
  b.insert = vi.fn().mockReturnValue(b)
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
  b.single = vi.fn().mockResolvedValue(result)
  return b
}

// profilesCallIdx tracks how many times from('profiles') has been called
// Call 1: role check → { role: 'admin' }
// Call 2+: stripe customer lookup → { stripe_customer_id }
function makeSupabase({
  role = 'admin',
  userId = 'admin-1',
  tables = {} as Record<string, unknown>,
  stripeCustId = null as string | null,
} = {}) {
  let profilesCallIdx = 0
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        profilesCallIdx++
        if (profilesCallIdx === 1) {
          return makeChainable({ data: { role }, error: null })
        }
        return makeChainable({ data: { stripe_customer_id: stripeCustId }, error: null })
      }
      return makeChainable(tables[table] ?? { data: null, error: null })
    }),
  }
}

const baseInput = {
  title: 'Rain CDMX',
  description: null,
  category_id: 'cat-1',
  status: 'active' as const,
  trigger_type: 'weather' as const,
  trigger_condition: { metric: 'rainfall', comparator: '>', threshold: 25, unit: 'mm/hr' },
  trigger_deadline: new Date(Date.now() + 86400000 * 30).toISOString(),
  location: { city: 'CDMX', country: 'MX', lat: 19.4, lng: -99.1 },
  icon_url: null,
  is_featured: false,
  basic_tier: { premium_usd: 45, payout_usd: 500, max_capacity_usd: 50000 },
  premium_tier: { premium_usd: 120, payout_usd: 2000, max_capacity_usd: 100000 },
}

describe('upsertContract', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts contract and two tiers on create, returns new id', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase({
      tables: {
        contracts: { data: { id: 'contract-new' }, error: null },
        coverage_tiers: { data: null, error: null },
      },
    }) as never)

    const id = await upsertContract(baseInput)
    expect(id).toBe('contract-new')
  })

  it('updates contract and tiers on edit, returns existing id', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase({
      tables: {
        contracts: { data: null, error: null },
        coverage_tiers: { data: [{ id: 'tier-basic', name: 'basic' }, { id: 'tier-prem', name: 'premium' }], error: null },
      },
    }) as never)

    const id = await upsertContract({ ...baseInput, id: 'contract-existing' })
    expect(id).toBe('contract-existing')
  })

  it('throws if deadline is in the past', async () => {
    const past = new Date(Date.now() - 86400000).toISOString()
    await expect(upsertContract({ ...baseInput, trigger_deadline: past }))
      .rejects.toThrow('Deadline must be in the future')
  })

  it('throws if basic payout does not exceed basic premium', async () => {
    const bad = { ...baseInput, basic_tier: { premium_usd: 500, payout_usd: 100, max_capacity_usd: 50000 } }
    await expect(upsertContract(bad)).rejects.toThrow('Payout must exceed premium')
  })

  it('throws if calling user is not admin', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase({ role: 'hedger' }) as never)
    await expect(upsertContract(baseInput)).rejects.toThrow('Forbidden')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/lib/actions/admin.test.ts
```

Expected: FAIL — `upsertContract` is not defined.

- [ ] **Step 3: Create `lib/actions/admin.ts` with `upsertContract`**

```typescript
'use server'

import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import type { UpsertContractInput } from '@/lib/types'

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY ?? '', { apiVersion: '2023-10-16' as never })
}

async function assertAdmin() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if ((profile as { role: string } | null)?.role !== 'admin') throw new Error('Forbidden')
  return { supabase, userId: user.id }
}

export async function upsertContract(input: UpsertContractInput): Promise<string> {
  if (new Date(input.trigger_deadline) <= new Date()) {
    throw new Error('Deadline must be in the future')
  }
  if (input.basic_tier.payout_usd <= input.basic_tier.premium_usd) {
    throw new Error('Payout must exceed premium')
  }
  if (input.premium_tier.payout_usd <= input.premium_tier.premium_usd) {
    throw new Error('Payout must exceed premium')
  }

  const { supabase, userId } = await assertAdmin()

  const contractFields = {
    title: input.title,
    description: input.description,
    category_id: input.category_id,
    status: input.status,
    trigger_type: input.trigger_type,
    trigger_condition: input.trigger_condition,
    trigger_deadline: input.trigger_deadline,
    location: input.location,
    icon_url: input.icon_url,
    is_featured: input.is_featured,
  }

  if (input.id) {
    await supabase.from('contracts').update(contractFields).eq('id', input.id)

    const { data: tiers } = await supabase
      .from('coverage_tiers')
      .select('id, name')
      .eq('contract_id', input.id)

    for (const tier of (tiers ?? []) as Array<{ id: string; name: string }>) {
      const vals = tier.name === 'basic' ? input.basic_tier : input.premium_tier
      await supabase.from('coverage_tiers').update({
        premium_usd: vals.premium_usd,
        payout_usd: vals.payout_usd,
        max_capacity_usd: vals.max_capacity_usd,
      }).eq('id', tier.id)
    }

    return input.id
  }

  const { data: contract } = await supabase
    .from('contracts')
    .insert({ ...contractFields, created_by: userId })
    .select('id')
    .single()

  const contractId = (contract as { id: string }).id

  await supabase.from('coverage_tiers').insert([
    { contract_id: contractId, name: 'basic', ...input.basic_tier },
    { contract_id: contractId, name: 'premium', ...input.premium_tier },
  ])

  return contractId
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/lib/actions/admin.test.ts
```

Expected: all 5 `upsertContract` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/admin.ts tests/lib/actions/admin.test.ts
git commit -m "feat: upsertContract server action with tests"
```

---

## Task 4: Admin actions — overrideContractTrigger (TDD)

**Files:**
- Modify: `lib/actions/admin.ts`
- Modify: `tests/lib/actions/admin.test.ts`

- [ ] **Step 1: Add overrideContractTrigger tests to the test file**

Add this describe block after the `upsertContract` describe block in `tests/lib/actions/admin.test.ts` (no new imports needed — all imports are already at the top):

```typescript
describe('overrideContractTrigger', () => {
  beforeEach(() => vi.clearAllMocks())

  it('settles contract and inserts audit log — no trigger (outcome=false)', async () => {
    const mockSupabase = makeSupabase({
      tables: {
        contracts: { data: null, error: null },
        admin_audit_log: { data: null, error: null },
        hedger_positions: { data: [], error: null },
      },
    })
    vi.mocked(createClient).mockReturnValue(mockSupabase as never)

    await overrideContractTrigger({ contractId: 'c-1', outcome: false, reason: 'test' })

    const fromCalls = mockSupabase.from.mock.calls.map((c: unknown[]) => c[0])
    expect(fromCalls).toContain('contracts')
    expect(fromCalls).toContain('admin_audit_log')
    // Stripe should NOT be called when outcome = false
    expect(vi.mocked(Stripe)).not.toHaveBeenCalled()
  })

  it('settles contract, issues Stripe credits for each hedger — outcome=true', async () => {
    const mockSupabase = makeSupabase({
      stripeCustId: 'cus_existing',
      tables: {
        contracts: { data: null, error: null },
        admin_audit_log: { data: null, error: null },
        hedger_positions: {
          data: [
            { id: 'hp-1', user_id: 'user-1', payout_amount_usd: 500, payout_amount_mxn: 8500, currency: 'USD', status: 'active' },
          ],
          error: null,
        },
        payouts: { data: { id: 'pay-1' }, error: null },
      },
    })
    vi.mocked(createClient).mockReturnValue(mockSupabase as never)

    const mockStripeInstance = {
      customers: {
        create: vi.fn().mockResolvedValue({ id: 'cus_new' }),
        createBalanceTransaction: vi.fn().mockResolvedValue({ id: 'txn_1' }),
      },
    }
    vi.mocked(Stripe).mockReturnValue(mockStripeInstance as never)

    await overrideContractTrigger({ contractId: 'c-1', outcome: true, reason: 'oracle outage' })

    expect(mockStripeInstance.customers.createBalanceTransaction).toHaveBeenCalledWith(
      'cus_existing',
      { amount: -50000, currency: 'usd' },
    )
  })

  it('throws Forbidden if caller is not admin', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase({ role: 'hedger' }) as never)
    await expect(
      overrideContractTrigger({ contractId: 'c-1', outcome: false, reason: 'test' })
    ).rejects.toThrow('Forbidden')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/lib/actions/admin.test.ts
```

Expected: FAIL — `overrideContractTrigger` is not exported.

- [ ] **Step 3: Add `overrideContractTrigger` to `lib/actions/admin.ts`**

Add after `upsertContract`:

```typescript
export async function overrideContractTrigger({
  contractId,
  outcome,
  reason,
}: {
  contractId: string
  outcome: boolean
  reason: string
}): Promise<void> {
  const { supabase, userId } = await assertAdmin()

  await supabase.from('contracts').update({
    settled_outcome: outcome,
    status: 'settled',
    settled_at: new Date().toISOString(),
  }).eq('id', contractId)

  await supabase.from('admin_audit_log').insert({
    admin_id: userId,
    action: 'trigger_override',
    contract_id: contractId,
    reason,
    metadata: { outcome },
  })

  if (!outcome) return

  const { data: positions } = await supabase
    .from('hedger_positions')
    .select('*')
    .eq('contract_id', contractId)
    .eq('status', 'active')

  if (!positions || (positions as unknown[]).length === 0) return

  const stripe = getStripe()

  for (const position of positions as Array<{
    id: string; user_id: string; payout_amount_usd: number
    payout_amount_mxn: number; currency: string
  }>) {
    const { data: newPayout } = await supabase.from('payouts').insert({
      contract_id: contractId,
      hedger_position_id: position.id,
      amount_usd: position.payout_amount_usd,
      amount_mxn: position.payout_amount_mxn,
      currency: position.currency,
      payment_provider: 'stripe',
      status: 'processing',
    }).select('id').single()

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', position.user_id)
      .single()

    let customerId = (profile as { stripe_customer_id: string | null } | null)?.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({ metadata: { user_id: position.user_id } })
      customerId = customer.id
      await supabase.from('profiles').update({ stripe_customer_id: customerId }).eq('id', position.user_id)
    }

    const txn = await stripe.customers.createBalanceTransaction(customerId, {
      amount: -Math.round(position.payout_amount_usd * 100),
      currency: 'usd',
    })

    await supabase.from('payouts').update({
      status: 'completed',
      transfer_id: txn.id,
      completed_at: new Date().toISOString(),
    }).eq('id', (newPayout as { id: string }).id)

    await supabase.from('hedger_positions').update({ status: 'paid_out' }).eq('id', position.id)
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/lib/actions/admin.test.ts
```

Expected: all `overrideContractTrigger` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/admin.ts tests/lib/actions/admin.test.ts
git commit -m "feat: overrideContractTrigger server action with tests"
```

---

## Task 5: Admin actions — retryPayout (TDD)

**Files:**
- Modify: `lib/actions/admin.ts`
- Modify: `tests/lib/actions/admin.test.ts`

- [ ] **Step 1: Add retryPayout tests to the test file**

Add this describe block after the `overrideContractTrigger` describe block (no new imports needed):

```typescript
describe('retryPayout', () => {
  beforeEach(() => vi.clearAllMocks())

  it('issues Stripe credit and marks payout completed', async () => {
    const mockPayout = {
      id: 'pay-stuck',
      amount_usd: 500,
      contract_id: 'c-1',
      hedger_position: { id: 'hp-1', user_id: 'user-1', payout_amount_usd: 500, currency: 'USD' },
    }
    const mockSupabase = makeSupabase({
      stripeCustId: 'cus_existing',
      tables: {
        payouts: { data: mockPayout, error: null },
      },
    })
    vi.mocked(createClient).mockReturnValue(mockSupabase as never)

    const mockStripeInstance = {
      customers: {
        create: vi.fn().mockResolvedValue({ id: 'cus_new' }),
        createBalanceTransaction: vi.fn().mockResolvedValue({ id: 'txn_retry' }),
      },
    }
    vi.mocked(Stripe).mockReturnValue(mockStripeInstance as never)

    await retryPayout('pay-stuck')

    expect(mockStripeInstance.customers.createBalanceTransaction).toHaveBeenCalledWith(
      'cus_existing',
      { amount: -50000, currency: 'usd' },
    )
  })

  it('throws if payout is not found or not in processing state', async () => {
    const mockSupabase = makeSupabase({
      tables: { payouts: { data: null, error: null } },
    })
    vi.mocked(createClient).mockReturnValue(mockSupabase as never)
    await expect(retryPayout('pay-missing')).rejects.toThrow('Payout not found')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/lib/actions/admin.test.ts
```

Expected: FAIL — `retryPayout` is not exported.

- [ ] **Step 3: Add `retryPayout` to `lib/actions/admin.ts`**

Add after `overrideContractTrigger`:

```typescript
export async function retryPayout(payoutId: string): Promise<void> {
  const { supabase } = await assertAdmin()

  const { data: payout } = await supabase
    .from('payouts')
    .select('id, amount_usd, contract_id, hedger_position:hedger_positions(id, user_id, payout_amount_usd, currency)')
    .eq('id', payoutId)
    .eq('status', 'processing')
    .single()

  if (!payout) throw new Error('Payout not found')

  const p = payout as {
    id: string; amount_usd: number; contract_id: string
    hedger_position: { id: string; user_id: string; payout_amount_usd: number; currency: string }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', p.hedger_position.user_id)
    .single()

  const stripe = getStripe()
  let customerId = (profile as { stripe_customer_id: string | null } | null)?.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({ metadata: { user_id: p.hedger_position.user_id } })
    customerId = customer.id
    await supabase.from('profiles').update({ stripe_customer_id: customerId }).eq('id', p.hedger_position.user_id)
  }

  const txn = await stripe.customers.createBalanceTransaction(customerId, {
    amount: -Math.round(p.amount_usd * 100),
    currency: 'usd',
  })

  await supabase.from('payouts').update({
    status: 'completed',
    transfer_id: txn.id,
    completed_at: new Date().toISOString(),
  }).eq('id', payoutId)
}
```

- [ ] **Step 4: Run all tests to confirm everything passes**

```bash
npx vitest run tests/lib/actions/admin.test.ts
```

Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/admin.ts tests/lib/actions/admin.test.ts
git commit -m "feat: retryPayout server action with tests"
```

---

## Task 6: Admin layout + sidebar

**Files:**
- Create: `app/admin/layout.tsx`
- Create: `components/admin/AdminSidebar.tsx`

- [ ] **Step 1: Create `components/admin/AdminSidebar.tsx`**

```typescript
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/admin/contracts', label: 'Contracts', icon: '📋' },
  { href: '/admin/trigger', label: 'Trigger', icon: '⚡' },
  { href: '/admin/oracle', label: 'Oracle', icon: '🌐' },
  { href: '/admin/payouts', label: 'Payouts', icon: '💸' },
] as const

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex w-44 flex-shrink-0 flex-col border-r border-white/[0.07] bg-bg px-3 py-5">
      <p className="mb-5 px-2 font-display text-sm tracking-[3px] text-insu-accent">
        ADMIN
      </p>
      <nav className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors',
              pathname.startsWith(href)
                ? 'bg-white/[0.07] text-insu-text'
                : 'text-insu-dim hover:bg-white/[0.04] hover:text-insu-text',
            )}
          >
            <span>{icon}</span>
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
```

- [ ] **Step 2: Create `app/admin/layout.tsx`**

```typescript
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import { AdminSidebar } from '@/components/admin/AdminSidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if ((profile as { role: string } | null)?.role !== 'admin') redirect('/')

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <div className="flex flex-1">
        <AdminSidebar />
        <main className="flex-1 overflow-auto p-8">{children}</main>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create a redirect page at `app/admin/page.tsx`**

```typescript
import { redirect } from 'next/navigation'

export default function AdminRoot() {
  redirect('/admin/contracts')
}
```

- [ ] **Step 4: Start the dev server and navigate to `/admin`**

```bash
npm run dev
```

Open `http://localhost:3000/admin`. Confirm:
- Non-admin users are redirected to `/`
- Admin users see the sidebar with 4 links and are redirected to `/admin/contracts` (404 for now — that's fine)

- [ ] **Step 5: Commit**

```bash
git add app/admin/ components/admin/AdminSidebar.tsx
git commit -m "feat: admin layout — role-gated shell with sidebar"
```

---

## Task 7: Contracts list page

**Files:**
- Create: `app/admin/contracts/page.tsx`
- Create: `components/admin/contracts/ContractList.tsx`

- [ ] **Step 1: Create `components/admin/contracts/ContractList.tsx`**

```typescript
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { ContractWithTiers } from '@/lib/types'

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-insu-green/10 text-insu-green',
  pending: 'bg-insu-accent/10 text-insu-accent',
  settled: 'bg-white/5 text-insu-dim',
  cancelled: 'bg-white/5 text-insu-dim',
}

export function ContractList({ contracts }: { contracts: ContractWithTiers[] }) {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl tracking-wide text-insu-text">Contracts</h1>
        <Link
          href="/admin/contracts/new"
          className="rounded-md bg-insu-accent px-4 py-2 text-sm font-bold text-bg hover:bg-[#f7b84a]"
        >
          + New Contract
        </Link>
      </div>

      <div className="rounded-lg border border-white/[0.07] overflow-hidden">
        <div className="grid grid-cols-[1fr_100px_80px_90px_60px] gap-3 border-b border-white/[0.07] bg-white/[0.02] px-4 py-2.5 text-[11px] uppercase tracking-wider text-insu-muted">
          <span>Title</span><span>Category</span><span>Type</span><span>Status</span><span>Action</span>
        </div>

        {contracts.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-insu-muted">No contracts yet.</p>
        )}

        {contracts.map((c) => (
          <div
            key={c.id}
            className={cn(
              'grid grid-cols-[1fr_100px_80px_90px_60px] gap-3 border-b border-white/[0.04] px-4 py-3 text-sm last:border-0',
              (c.status === 'settled' || c.status === 'cancelled') && 'opacity-60',
            )}
          >
            <div>
              <p className="font-medium text-insu-text">{c.title}</p>
              <p className="mt-0.5 text-[11px] text-insu-muted">
                Deadline {new Date(c.trigger_deadline).toLocaleDateString()}
              </p>
            </div>
            <span className="self-center text-insu-dim capitalize">{c.category?.name ?? '—'}</span>
            <span className="self-center text-insu-dim">{c.trigger_type}</span>
            <span className={cn('self-center rounded px-2 py-0.5 text-[11px] font-medium w-fit', STATUS_STYLES[c.status] ?? STATUS_STYLES.settled)}>
              {c.status}
            </span>
            <Link
              href={`/admin/contracts/${c.id}`}
              className="self-center text-[13px] text-blue-400 hover:text-blue-300"
            >
              Edit
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `app/admin/contracts/page.tsx`**

```typescript
import { createClient } from '@/lib/supabase/server'
import { ContractList } from '@/components/admin/contracts/ContractList'
import type { ContractWithTiers } from '@/lib/types'

export default async function AdminContractsPage() {
  const supabase = createClient()
  const { data } = await supabase
    .from('contracts')
    .select('*, category:categories(*), coverage_tiers(*)')
    .order('created_at', { ascending: false })

  return <ContractList contracts={(data ?? []) as ContractWithTiers[]} />
}
```

- [ ] **Step 3: Verify in browser**

Navigate to `http://localhost:3000/admin/contracts`. Confirm the contract list renders with correct columns and the "+ New Contract" button appears.

- [ ] **Step 4: Commit**

```bash
git add app/admin/contracts/page.tsx components/admin/contracts/ContractList.tsx
git commit -m "feat: admin contracts list page"
```

---

## Task 8: Contract form — create and edit

**Files:**
- Create: `components/admin/contracts/ContractForm.tsx`
- Create: `app/admin/contracts/new/page.tsx`
- Create: `app/admin/contracts/[id]/page.tsx`

- [ ] **Step 1: Create `components/admin/contracts/ContractForm.tsx`**

```typescript
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { upsertContract } from '@/lib/actions/admin'
import type { Category, ContractWithTiers, UpsertContractInput } from '@/lib/types'

const WEATHER_METRICS = ['rainfall', 'temperature', 'wind', 'snow']
const URBAN_METRICS = ['delay', 'congestion']
const COMPARATORS = ['>', '<', '=']

function buildTriggerCondition(
  type: string,
  state: { metric: string; comparator: string; threshold: string; unit: string; description: string },
): Record<string, unknown> {
  if (type === 'weather' || type === 'urban') {
    return { metric: state.metric, comparator: state.comparator, threshold: Number(state.threshold), unit: state.unit }
  }
  if (type === 'event') return { description: state.description }
  return {}
}

function parseTriggerCondition(
  type: string,
  condition: Record<string, unknown>,
) {
  if (type === 'weather' || type === 'urban') {
    return {
      metric: String(condition.metric ?? ''),
      comparator: String(condition.comparator ?? '>'),
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

interface Props {
  categories: Category[]
  contract?: ContractWithTiers
}

export function ContractForm({ categories, contract }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState(contract?.title ?? '')
  const [description, setDescription] = useState(contract?.description ?? '')
  const [categoryId, setCategoryId] = useState(contract?.category_id ?? categories[0]?.id ?? '')
  const [status, setStatus] = useState<string>(contract?.status ?? 'pending')
  const [triggerType, setTriggerType] = useState<string>(contract?.trigger_type ?? 'weather')
  const [deadline, setDeadline] = useState(
    contract?.trigger_deadline
      ? new Date(contract.trigger_deadline).toISOString().split('T')[0]
      : '',
  )
  const [locationCity, setLocationCity] = useState(contract?.location?.city ?? '')
  const [locationCountry, setLocationCountry] = useState(contract?.location?.country ?? '')
  const [locationLat, setLocationLat] = useState(String(contract?.location?.lat ?? ''))
  const [locationLng, setLocationLng] = useState(String(contract?.location?.lng ?? ''))
  const [iconUrl, setIconUrl] = useState(contract?.icon_url ?? '')
  const [isFeatured, setIsFeatured] = useState(contract?.is_featured ?? false)

  const [condState, setCondState] = useState(() =>
    parseTriggerCondition(contract?.trigger_type ?? 'weather', contract?.trigger_condition ?? {}),
  )

  const basicTier = contract?.coverage_tiers?.find((t) => t.name === 'basic')
  const premiumTier = contract?.coverage_tiers?.find((t) => t.name === 'premium')
  const [basicPremium, setBasicPremium] = useState(String(basicTier?.premium_usd ?? ''))
  const [basicPayout, setBasicPayout] = useState(String(basicTier?.payout_usd ?? ''))
  const [basicCapacity, setBasicCapacity] = useState(String(basicTier?.max_capacity_usd ?? ''))
  const [premPremium, setPremPremium] = useState(String(premiumTier?.premium_usd ?? ''))
  const [premPayout, setPremPayout] = useState(String(premiumTier?.payout_usd ?? ''))
  const [premCapacity, setPremCapacity] = useState(String(premiumTier?.max_capacity_usd ?? ''))

  function handleTypeChange(newType: string) {
    setTriggerType(newType)
    setCondState({ metric: '', comparator: '>', threshold: '', unit: '', description: '' })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const input: UpsertContractInput = {
      ...(contract?.id ? { id: contract.id } : {}),
      title,
      description: description || null,
      category_id: categoryId,
      status: status as UpsertContractInput['status'],
      trigger_type: triggerType as UpsertContractInput['trigger_type'],
      trigger_condition: buildTriggerCondition(triggerType, condState),
      trigger_deadline: new Date(deadline).toISOString(),
      location: {
        city: locationCity, country: locationCountry,
        lat: Number(locationLat), lng: Number(locationLng),
      },
      icon_url: iconUrl || null,
      is_featured: isFeatured,
      basic_tier: { premium_usd: Number(basicPremium), payout_usd: Number(basicPayout), max_capacity_usd: Number(basicCapacity) },
      premium_tier: { premium_usd: Number(premPremium), payout_usd: Number(premPayout), max_capacity_usd: Number(premCapacity) },
    }

    startTransition(async () => {
      try {
        await upsertContract(input)
        router.push('/admin/contracts')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed')
      }
    })
  }

  const inputCls = 'w-full rounded-md border border-white/[0.07] bg-bg px-3 py-2 text-sm text-insu-text placeholder:text-insu-muted focus:border-insu-accent/40 focus:outline-none'
  const labelCls = 'mb-1 block text-[11px] uppercase tracking-wider text-insu-muted'
  const selectCls = inputCls + ' cursor-pointer'

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-5">
      <h1 className="font-display text-2xl tracking-wide text-insu-text">
        {contract ? 'Edit Contract' : 'New Contract'}
      </h1>

      {error && (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      <div>
        <label className={labelCls}>Title</label>
        <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>

      <div>
        <label className={labelCls}>Description</label>
        <textarea className={inputCls} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Category</label>
          <select className={selectCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            {['active', 'pending', 'settled', 'cancelled'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Trigger type</label>
          <select className={selectCls} value={triggerType} onChange={(e) => handleTypeChange(e.target.value)}>
            {['weather', 'urban', 'event', 'manual'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Deadline</label>
          <input type="date" className={inputCls} value={deadline} onChange={(e) => setDeadline(e.target.value)} required />
        </div>
      </div>

      {/* Trigger condition block */}
      <div className="rounded-lg border border-insu-accent/20 bg-insu-accent/[0.03] p-4">
        <p className="mb-3 text-[11px] uppercase tracking-wider text-insu-accent">
          Trigger Condition — {triggerType}
        </p>

        {(triggerType === 'weather' || triggerType === 'urban') && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Metric</label>
              <select className={selectCls} value={condState.metric} onChange={(e) => setCondState((s) => ({ ...s, metric: e.target.value }))}>
                {(triggerType === 'weather' ? WEATHER_METRICS : URBAN_METRICS).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Comparator</label>
              <select className={selectCls} value={condState.comparator} onChange={(e) => setCondState((s) => ({ ...s, comparator: e.target.value }))}>
                {COMPARATORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Threshold</label>
              <input className={inputCls} placeholder="e.g. 25" value={condState.threshold} onChange={(e) => setCondState((s) => ({ ...s, threshold: e.target.value }))} />
            </div>
            <div className="col-span-3">
              <label className={labelCls}>Unit</label>
              <input className={inputCls} placeholder="e.g. mm/hr, min" value={condState.unit} onChange={(e) => setCondState((s) => ({ ...s, unit: e.target.value }))} />
            </div>
          </div>
        )}

        {triggerType === 'event' && (
          <div>
            <label className={labelCls}>Condition description</label>
            <input className={inputCls} placeholder="e.g. Stadium capacity exceeds 90%" value={condState.description} onChange={(e) => setCondState((s) => ({ ...s, description: e.target.value }))} />
          </div>
        )}

        {triggerType === 'manual' && (
          <p className="text-sm text-insu-muted">No oracle condition — settlement is triggered manually via the Trigger Override section.</p>
        )}
      </div>

      {/* Location */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>City</label>
          <input className={inputCls} value={locationCity} onChange={(e) => setLocationCity(e.target.value)} required />
        </div>
        <div>
          <label className={labelCls}>Country</label>
          <input className={inputCls} value={locationCountry} onChange={(e) => setLocationCountry(e.target.value)} required />
        </div>
        <div>
          <label className={labelCls}>Latitude</label>
          <input className={inputCls} type="number" step="any" value={locationLat} onChange={(e) => setLocationLat(e.target.value)} required />
        </div>
        <div>
          <label className={labelCls}>Longitude</label>
          <input className={inputCls} type="number" step="any" value={locationLng} onChange={(e) => setLocationLng(e.target.value)} required />
        </div>
      </div>

      {/* Coverage tiers */}
      <div className="rounded-lg border border-white/[0.07] p-4">
        <p className="mb-3 text-[11px] uppercase tracking-wider text-insu-muted">Coverage Tiers (USD)</p>
        <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-3 mb-2">
          <div />
          <span className="text-[11px] uppercase tracking-wider text-insu-muted">Premium</span>
          <span className="text-[11px] uppercase tracking-wider text-insu-muted">Payout</span>
          <span className="text-[11px] uppercase tracking-wider text-insu-muted">Max Capacity</span>
        </div>
        <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-3 mb-2 items-center">
          <span className="text-sm text-insu-dim">Basic</span>
          <input className={inputCls} type="number" min="0" step="0.01" value={basicPremium} onChange={(e) => setBasicPremium(e.target.value)} required />
          <input className={inputCls} type="number" min="0" step="0.01" value={basicPayout} onChange={(e) => setBasicPayout(e.target.value)} required />
          <input className={inputCls} type="number" min="0" value={basicCapacity} onChange={(e) => setBasicCapacity(e.target.value)} required />
        </div>
        <div className="grid grid-cols-[60px_1fr_1fr_1fr] gap-3 items-center">
          <span className="text-sm text-insu-dim">Premium</span>
          <input className={inputCls} type="number" min="0" step="0.01" value={premPremium} onChange={(e) => setPremPremium(e.target.value)} required />
          <input className={inputCls} type="number" min="0" step="0.01" value={premPayout} onChange={(e) => setPremPayout(e.target.value)} required />
          <input className={inputCls} type="number" min="0" value={premCapacity} onChange={(e) => setPremCapacity(e.target.value)} required />
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} className="rounded" />
          <span className="text-sm text-insu-dim">Featured on homepage</span>
        </label>
      </div>

      <div className="flex gap-3 justify-end pt-2">
        <button
          type="button"
          onClick={() => router.push('/admin/contracts')}
          className="rounded-md border border-white/[0.07] px-4 py-2 text-sm text-insu-dim hover:text-insu-text"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-insu-accent px-5 py-2 text-sm font-bold text-bg disabled:opacity-60 hover:bg-[#f7b84a]"
        >
          {isPending ? 'Saving…' : 'Save Contract'}
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Create `app/admin/contracts/new/page.tsx`**

```typescript
import { createClient } from '@/lib/supabase/server'
import { ContractForm } from '@/components/admin/contracts/ContractForm'
import type { Category } from '@/lib/types'

export default async function NewContractPage() {
  const supabase = createClient()
  const { data } = await supabase
    .from('categories')
    .select('*')
    .order('display_order')

  return <ContractForm categories={(data ?? []) as Category[]} />
}
```

- [ ] **Step 3: Create `app/admin/contracts/[id]/page.tsx`**

```typescript
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ContractForm } from '@/components/admin/contracts/ContractForm'
import type { Category, ContractWithTiers } from '@/lib/types'

export default async function EditContractPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  const [categoriesResult, contractResult] = await Promise.all([
    supabase.from('categories').select('*').order('display_order'),
    supabase
      .from('contracts')
      .select('*, category:categories(*), coverage_tiers(*)')
      .eq('id', params.id)
      .single(),
  ])

  if (!contractResult.data) notFound()

  return (
    <ContractForm
      categories={(categoriesResult.data ?? []) as Category[]}
      contract={contractResult.data as ContractWithTiers}
    />
  )
}
```

- [ ] **Step 4: Test create and edit flows in browser**

1. Click "+ New Contract" → form renders with empty fields, trigger type defaults to `weather`, condition block shows metric/comparator/threshold fields
2. Change trigger type to `event` → condition block swaps to description field
3. Change to `manual` → condition block shows explanation text
4. Fill out a contract and submit → redirects to `/admin/contracts`, new contract appears in list
5. Click "Edit" on a contract → form loads with existing values pre-filled
6. Edit title, save → redirects back, updated title shows in list

- [ ] **Step 5: Commit**

```bash
git add app/admin/contracts/ components/admin/contracts/ContractForm.tsx
git commit -m "feat: admin contract create/edit form"
```

---

## Task 9: Trigger override page

**Files:**
- Create: `app/admin/trigger/page.tsx`
- Create: `components/admin/trigger/TriggerOverride.tsx`

- [ ] **Step 1: Create `components/admin/trigger/TriggerOverride.tsx`**

```typescript
'use client'

import { useState, useTransition } from 'react'
import { overrideContractTrigger } from '@/lib/actions/admin'
import { cn } from '@/lib/utils'
import type { Contract, HedgerPosition } from '@/lib/types'

interface ContractSummary {
  contract: Contract
  hedgerCount: number
  totalPayout: number
  oracleStatus: string
  lastValue: string
}

interface Props {
  contracts: Contract[]
  summaries: ContractSummary[]
}

export function TriggerOverride({ contracts, summaries }: Props) {
  const [contractId, setContractId] = useState('')
  const [outcome, setOutcome] = useState<boolean | null>(null)
  const [reason, setReason] = useState('')
  const [isPending, startTransition] = useTransition()
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const summary = summaries.find((s) => s.contract.id === contractId)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!contractId || outcome === null || !reason.trim()) return
    setError(null)

    startTransition(async () => {
      try {
        await overrideContractTrigger({ contractId, outcome: outcome!, reason })
        setSuccess(true)
        setContractId('')
        setOutcome(null)
        setReason('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Override failed')
      }
    })
  }

  const inputCls = 'w-full rounded-md border border-white/[0.07] bg-bg px-3 py-2 text-sm text-insu-text focus:border-insu-accent/40 focus:outline-none'
  const labelCls = 'mb-1 block text-[11px] uppercase tracking-wider text-insu-muted'

  return (
    <div className="max-w-lg">
      <h1 className="mb-1 font-display text-2xl tracking-wide text-insu-text">Trigger Override</h1>
      <p className="mb-6 text-sm text-insu-muted">Force-settle a contract, bypassing the oracle. This cannot be undone.</p>

      {success && (
        <div className="mb-4 rounded-md border border-insu-green/30 bg-insu-green/10 px-4 py-3 text-sm text-insu-green">
          Contract settled successfully. Payouts queued.
        </div>
      )}

      {error && (
        <p className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className={labelCls}>Contract</label>
          <select
            className={inputCls + ' cursor-pointer'}
            value={contractId}
            onChange={(e) => { setContractId(e.target.value); setOutcome(null) }}
            required
          >
            <option value="">Select a contract…</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {new Date(c.trigger_deadline).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>

        {summary && (
          <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className={labelCls}>Active hedgers</p>
                <p className="font-mono text-insu-text">{summary.hedgerCount}</p>
              </div>
              <div>
                <p className={labelCls}>Total payout</p>
                <p className="font-mono text-insu-green">${summary.totalPayout.toLocaleString()}</p>
              </div>
              <div>
                <p className={labelCls}>Oracle</p>
                <p className="font-mono text-insu-dim">{summary.oracleStatus}</p>
              </div>
              <div>
                <p className={labelCls}>Trigger type</p>
                <p className="text-insu-dim">{summary.contract.trigger_type}</p>
              </div>
              <div className="col-span-2">
                <p className={labelCls}>Last reading</p>
                <p className="text-insu-dim">{summary.lastValue || '—'}</p>
              </div>
            </div>
          </div>
        )}

        <div>
          <label className={labelCls}>Settlement outcome</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setOutcome(true)}
              className={cn(
                'rounded-lg border p-4 text-left transition-colors',
                outcome === true
                  ? 'border-insu-green bg-insu-green/10'
                  : 'border-white/[0.07] hover:border-white/20',
              )}
            >
              <p className="mb-1 text-sm font-bold text-insu-green">⚡ TRIGGER FIRED</p>
              <p className="text-[12px] text-insu-muted">Hedgers receive payouts. Settles as outcome = true.</p>
            </button>
            <button
              type="button"
              onClick={() => setOutcome(false)}
              className={cn(
                'rounded-lg border p-4 text-left transition-colors',
                outcome === false
                  ? 'border-insu-dim bg-white/[0.04]'
                  : 'border-white/[0.07] hover:border-white/20',
              )}
            >
              <p className="mb-1 text-sm font-bold text-insu-dim">✕ NO TRIGGER</p>
              <p className="text-[12px] text-insu-muted">No payouts. Providers keep yield. outcome = false.</p>
            </button>
          </div>
        </div>

        <div>
          <label className={labelCls}>Reason (required)</label>
          <textarea
            className={inputCls}
            rows={2}
            placeholder="e.g. Oracle API outage confirmed by OWM support"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />
        </div>

        <button
          type="submit"
          disabled={isPending || outcome === null || !contractId || !reason.trim()}
          className="w-full rounded-md bg-red-500 py-2.5 text-sm font-bold tracking-wide text-white disabled:opacity-40 hover:bg-red-400"
        >
          {isPending
            ? 'Processing…'
            : outcome === null
              ? 'SELECT AN OUTCOME TO CONFIRM'
              : `CONFIRM OVERRIDE — ${outcome ? 'TRIGGER FIRED' : 'NO TRIGGER'}`}
        </button>

        {contractId && outcome !== null && (
          <p className="text-center text-[12px] text-insu-muted">
            This will immediately settle the contract{outcome ? ` and queue Stripe payouts for ${summary?.hedgerCount ?? '?'} hedgers` : ''}.
          </p>
        )}
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Create `app/admin/trigger/page.tsx`**

```typescript
import { createClient } from '@/lib/supabase/server'
import { TriggerOverride } from '@/components/admin/trigger/TriggerOverride'
import type { Contract, HedgerPosition } from '@/lib/types'

export default async function AdminTriggerPage() {
  const supabase = createClient()

  const { data: contracts } = await supabase
    .from('contracts')
    .select('*')
    .eq('status', 'active')
    .order('trigger_deadline')

  const activeContracts = (contracts ?? []) as Contract[]

  // Build summaries: hedger count + total payout exposure per contract
  const summaries = await Promise.all(
    activeContracts.map(async (contract) => {
      const { data: positions } = await supabase
        .from('hedger_positions')
        .select('payout_amount_usd')
        .eq('contract_id', contract.id)
        .eq('status', 'active')

      const hedgers = (positions ?? []) as Pick<HedgerPosition, 'payout_amount_usd'>[]
      const totalPayout = hedgers.reduce((sum, p) => sum + p.payout_amount_usd, 0)

      const { data: reading } = await supabase
        .from('oracle_readings')
        .select('trigger_met, value, read_at')
        .eq('contract_id', contract.id)
        .order('read_at', { ascending: false })
        .limit(1)
        .single()

      const r = reading as { trigger_met: boolean; value: Record<string, unknown>; read_at: string } | null

      return {
        contract,
        hedgerCount: hedgers.length,
        totalPayout,
        oracleStatus: r ? (r.trigger_met ? 'TRIGGERED' : 'NO TRIGGER') : 'NO READINGS',
        lastValue: r ? JSON.stringify(r.value).slice(0, 40) : '—',
      }
    }),
  )

  return <TriggerOverride contracts={activeContracts} summaries={summaries} />
}
```

- [ ] **Step 3: Test in browser**

Navigate to `http://localhost:3000/admin/trigger`. Confirm:
- Dropdown shows active contracts
- Selecting a contract reveals the summary card with hedger count and payout total
- Outcome cards are selectable; confirm button label updates
- Reason textarea is required
- Submit button is disabled until contract + outcome + reason are filled

- [ ] **Step 4: Commit**

```bash
git add app/admin/trigger/ components/admin/trigger/
git commit -m "feat: admin trigger override page"
```

---

## Task 10: Oracle monitor page

**Files:**
- Create: `app/admin/oracle/page.tsx`
- Create: `components/admin/oracle/OracleMonitor.tsx`

- [ ] **Step 1: Create `components/admin/oracle/OracleMonitor.tsx`**

```typescript
'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { Contract, OracleReading } from '@/lib/types'

interface ContractWithLatestReading {
  contract: Contract
  latest: OracleReading | null
  readings: OracleReading[]
}

function getStatus(item: ContractWithLatestReading): 'triggered' | 'stale' | 'ok' | 'no-data' {
  if (!item.latest) return 'no-data'
  const ageMs = Date.now() - new Date(item.latest.read_at).getTime()
  if (ageMs > 10 * 60 * 1000) return 'stale'
  if (item.latest.trigger_met) return 'triggered'
  return 'ok'
}

function parseValue(reading: OracleReading): string {
  const v = reading.value
  if (typeof v === 'object' && v !== null) {
    const vals = Object.values(v)
    if (vals.length > 0) {
      const inner = vals[0]
      if (typeof inner === 'object' && inner !== null) {
        const deepVal = Object.values(inner as Record<string, unknown>)[0]
        return String(deepVal ?? '')
      }
      return String(inner ?? '')
    }
  }
  return JSON.stringify(v)
}

function parseThreshold(contract: Contract): string {
  const c = contract.trigger_condition as Record<string, unknown>
  if (c.comparator && c.threshold !== undefined) {
    return `${c.comparator} ${c.threshold} ${c.unit ?? ''}`
  }
  return '—'
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export function OracleMonitor({ items }: { items: ContractWithLatestReading[] }) {
  const [selectedId, setSelectedId] = useState(items[0]?.contract.id ?? null)
  const selected = items.find((i) => i.contract.id === selectedId)

  const maxValue = selected
    ? Math.max(...selected.readings.map((r) => Number(parseValue(r)) || 0), 1)
    : 1

  const threshold = selected
    ? Number((selected.contract.trigger_condition as Record<string, unknown>).threshold) || 0
    : 0

  return (
    <div className="flex h-[calc(100vh-140px)] gap-0 overflow-hidden rounded-lg border border-white/[0.07]">
      {/* Left: contract list */}
      <div className="w-52 flex-shrink-0 overflow-y-auto border-r border-white/[0.07] p-3">
        <p className="mb-2 px-1 text-[10px] uppercase tracking-wider text-insu-muted">
          {items.length} Active Contracts
        </p>
        <div className="flex flex-col gap-2">
          {items.map((item) => {
            const status = getStatus(item)
            return (
              <button
                key={item.contract.id}
                onClick={() => setSelectedId(item.contract.id)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  selectedId === item.contract.id
                    ? 'border-insu-accent bg-insu-accent/[0.05]'
                    : status === 'triggered'
                      ? 'border-red-500/60 hover:border-red-500'
                      : status === 'stale'
                        ? 'border-insu-accent/40 hover:border-insu-accent/60'
                        : 'border-white/[0.07] hover:border-white/20',
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-1">
                  <span className="text-[12px] font-medium text-insu-text truncate">{item.contract.title}</span>
                  <span className={cn(
                    'flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase',
                    status === 'triggered' ? 'bg-red-500 text-white'
                      : status === 'stale' ? 'bg-insu-accent/20 text-insu-accent'
                        : status === 'ok' ? 'bg-white/5 text-insu-muted'
                          : 'bg-white/5 text-insu-muted',
                  )}>
                    {status === 'triggered' ? '⚡ YES'
                      : status === 'stale' ? '⚠ STALE'
                        : status === 'ok' ? 'NO'
                          : '—'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                  {[
                    ['Source', item.contract.trigger_type],
                    ['Last read', item.latest ? timeAgo(item.latest.read_at) : '—'],
                    ['Value', item.latest ? parseValue(item.latest) : '—'],
                    ['Threshold', parseThreshold(item.contract)],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="text-[9px] uppercase tracking-wider text-insu-muted">{k}</p>
                      <p className={cn('text-[11px]',
                        k === 'Last read' && status === 'stale' ? 'text-insu-accent' : 'text-insu-dim'
                      )}>{v}</p>
                    </div>
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Right: detail panel */}
      {selected ? (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-5 flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-insu-text">{selected.contract.title}</h2>
              <p className="mt-0.5 text-[12px] text-insu-muted">
                {selected.contract.trigger_type} · {parseThreshold(selected.contract)} · Deadline {new Date(selected.contract.trigger_deadline).toLocaleDateString()}
              </p>
            </div>
            {selected.latest && (
              <span className={cn(
                'rounded px-2 py-1 text-[11px] font-bold uppercase tracking-wide',
                selected.latest.trigger_met ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-insu-muted',
              )}>
                {selected.latest.trigger_met ? '⚡ TRIGGERED' : 'NO TRIGGER'}
              </span>
            )}
          </div>

          {/* Bar chart */}
          <div className="mb-5 rounded-lg border border-white/[0.07] bg-white/[0.02] p-4">
            <div className="relative flex h-16 items-end gap-1">
              {threshold > 0 && (
                <div
                  className="pointer-events-none absolute inset-x-0 border-t border-dashed border-insu-accent/50"
                  style={{ bottom: `${Math.min(100, (threshold / maxValue) * 100)}%` }}
                />
              )}
              {selected.readings.slice(0, 9).reverse().map((r, i) => {
                const val = Number(parseValue(r)) || 0
                const heightPct = maxValue > 0 ? Math.max(2, (val / maxValue) * 100) : 2
                return (
                  <div
                    key={r.id}
                    title={`${val} · ${timeAgo(r.read_at)}`}
                    className={cn('flex-1 rounded-sm', r.trigger_met ? 'bg-red-500' : 'bg-blue-400')}
                    style={{ height: `${heightPct}%`, opacity: 0.4 + (i / 9) * 0.6 }}
                  />
                )
              })}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-insu-muted">
              <span>{selected.readings[Math.min(8, selected.readings.length - 1)] ? timeAgo(selected.readings[Math.min(8, selected.readings.length - 1)].read_at) : ''}</span>
              {threshold > 0 && <span className="text-insu-accent">— threshold {threshold}</span>}
              <span className="text-blue-400">now: {selected.latest ? parseValue(selected.latest) : '—'}</span>
            </div>
          </div>

          {/* Reading log */}
          <p className="mb-2 text-[10px] uppercase tracking-wider text-insu-muted">Reading Log</p>
          <div className="rounded-lg border border-white/[0.07] overflow-hidden">
            <div className="grid grid-cols-[80px_1fr_80px_60px] border-b border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[10px] uppercase tracking-wider text-insu-muted">
              <span>Time</span><span>Raw value</span><span>Parsed</span><span>Trigger</span>
            </div>
            {selected.readings.slice(0, 20).map((r) => (
              <div key={r.id} className="grid grid-cols-[80px_1fr_80px_60px] border-b border-white/[0.04] px-3 py-2 text-[12px] last:border-0">
                <span className="text-insu-muted">{timeAgo(r.read_at)}</span>
                <span className="truncate font-mono text-[11px] text-insu-muted">{JSON.stringify(r.value)}</span>
                <span className="font-mono text-blue-400">{parseValue(r)}</span>
                <span className={r.trigger_met ? 'font-bold text-red-400' : 'text-insu-muted'}>
                  {r.trigger_met ? 'YES' : 'NO'}
                </span>
              </div>
            ))}
            {selected.readings.length === 0 && (
              <p className="px-3 py-4 text-sm text-insu-muted">No readings yet.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-insu-muted">Select a contract to view oracle readings.</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `app/admin/oracle/page.tsx`**

```typescript
import { createClient } from '@/lib/supabase/server'
import { OracleMonitor } from '@/components/admin/oracle/OracleMonitor'
import type { Contract, OracleReading } from '@/lib/types'

export default async function AdminOraclePage() {
  const supabase = createClient()

  const { data: contracts } = await supabase
    .from('contracts')
    .select('*')
    .eq('status', 'active')
    .order('created_at')

  const activeContracts = (contracts ?? []) as Contract[]

  const items = await Promise.all(
    activeContracts.map(async (contract) => {
      const { data: readings } = await supabase
        .from('oracle_readings')
        .select('*')
        .eq('contract_id', contract.id)
        .order('read_at', { ascending: false })
        .limit(20)

      const rows = (readings ?? []) as OracleReading[]

      return {
        contract,
        latest: rows[0] ?? null,
        readings: rows,
      }
    }),
  )

  return <OracleMonitor items={items} />
}
```

- [ ] **Step 3: Test in browser**

Navigate to `http://localhost:3000/admin/oracle`. Confirm:
- Left panel shows contract cards with source, last read time, value, threshold, and badge
- Triggered contracts show red `⚡ YES` badge with red border
- Stale contracts (>10 min) show amber `⚠ STALE` badge
- Clicking a contract card loads detail panel on the right
- Bar chart renders with dashed threshold line
- Reading log shows raw JSON, parsed value, and YES/NO trigger column

- [ ] **Step 4: Commit**

```bash
git add app/admin/oracle/ components/admin/oracle/
git commit -m "feat: admin oracle monitor — master/detail with bar chart"
```

---

## Task 11: Payout queue page

**Files:**
- Create: `app/admin/payouts/page.tsx`
- Create: `components/admin/payouts/PayoutQueue.tsx`

- [ ] **Step 1: Create `components/admin/payouts/PayoutQueue.tsx`**

```typescript
'use client'

import { useState, useTransition } from 'react'
import { retryPayout } from '@/lib/actions/admin'
import { cn } from '@/lib/utils'

interface PayoutRow {
  id: string
  amount_usd: number
  status: string
  created_at: string
  transfer_id: string | null
  contractTitle: string
  userFullName: string | null
}

interface Props {
  payouts: PayoutRow[]
}

type Filter = 'all' | 'processing' | 'completed'

export function PayoutQueue({ payouts: initialPayouts }: Props) {
  const [payouts, setPayouts] = useState(initialPayouts)
  const [filter, setFilter] = useState<Filter>('all')
  const [retrying, setRetrying] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [, startTransition] = useTransition()

  const processingCount = payouts.filter((p) => p.status === 'processing').length
  const completedCount = payouts.filter((p) => p.status === 'completed').length
  const totalVolume = payouts.reduce((sum, p) => sum + p.amount_usd, 0)

  const filtered = filter === 'all' ? payouts
    : payouts.filter((p) => p.status === filter)

  function handleRetry(payoutId: string) {
    setRetrying(payoutId)
    setErrors((prev) => { const next = { ...prev }; delete next[payoutId]; return next })

    startTransition(async () => {
      try {
        await retryPayout(payoutId)
        setPayouts((prev) =>
          prev.map((p) => p.id === payoutId ? { ...p, status: 'completed' } : p),
        )
      } catch (err) {
        setErrors((prev) => ({
          ...prev,
          [payoutId]: err instanceof Error ? err.message : 'Retry failed',
        }))
      } finally {
        setRetrying(null)
      }
    })
  }

  const statCls = 'rounded-lg border p-4 text-center'

  return (
    <div>
      <h1 className="mb-5 font-display text-2xl tracking-wide text-insu-text">Payout Queue</h1>

      {/* Stats strip */}
      <div className="mb-6 grid grid-cols-4 gap-4">
        <div className={cn(statCls, 'border-white/[0.07]')}>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-insu-muted">Total</p>
          <p className="font-mono text-2xl text-insu-text">{payouts.length}</p>
        </div>
        <div className={cn(statCls, 'border-insu-green/30')}>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-insu-muted">Completed</p>
          <p className="font-mono text-2xl text-insu-green">{completedCount}</p>
        </div>
        <div className={cn(statCls, processingCount > 0 ? 'border-insu-accent/40' : 'border-white/[0.07]')}>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-insu-muted">Processing</p>
          <p className={cn('font-mono text-2xl', processingCount > 0 ? 'text-insu-accent' : 'text-insu-text')}>{processingCount}</p>
        </div>
        <div className={cn(statCls, 'border-white/[0.07]')}>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-insu-muted">Volume</p>
          <p className="font-mono text-2xl text-insu-text">${(totalVolume / 1000).toFixed(0)}k</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="mb-4 flex gap-2">
        {(['all', 'processing', 'completed'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-md px-3 py-1.5 text-[12px] font-medium capitalize transition-colors',
              filter === f
                ? 'bg-white/[0.07] text-insu-text'
                : 'text-insu-muted hover:text-insu-dim',
            )}
          >
            {f === 'processing' ? `Processing (${processingCount})` : f === 'all' ? 'All' : 'Completed'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-white/[0.07] overflow-hidden">
        <div className="grid grid-cols-[1fr_130px_80px_90px_90px_80px] gap-3 border-b border-white/[0.07] bg-white/[0.02] px-4 py-2.5 text-[10px] uppercase tracking-wider text-insu-muted">
          <span>User / Contract</span><span>Transfer ID</span><span>Amount</span><span>Created</span><span>Status</span><span>Action</span>
        </div>

        {filtered.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-insu-muted">No payouts found.</p>
        )}

        {filtered.map((payout) => (
          <div key={payout.id}>
            <div
              className={cn(
                'grid grid-cols-[1fr_130px_80px_90px_90px_80px] gap-3 border-b border-white/[0.04] px-4 py-3 text-sm last:border-0 items-center',
                payout.status === 'processing' && 'border-insu-accent/20',
                payout.status === 'completed' && 'opacity-65',
              )}
            >
              <div>
                <p className="font-medium text-insu-text">{payout.userFullName ?? 'Unknown'}</p>
                <p className="text-[11px] text-insu-muted">{payout.contractTitle}</p>
              </div>
              <span className="truncate font-mono text-[11px] text-insu-muted">
                {payout.transfer_id ?? '—'}
              </span>
              <span className="font-mono text-insu-green">${payout.amount_usd.toLocaleString()}</span>
              <span className="text-insu-muted">{new Date(payout.created_at).toLocaleDateString()}</span>
              <span className={cn(
                'rounded px-2 py-0.5 text-[11px] font-medium w-fit',
                payout.status === 'completed' ? 'bg-insu-green/10 text-insu-green' : 'bg-insu-accent/10 text-insu-accent',
              )}>
                {payout.status}
              </span>
              <div>
                {payout.status === 'processing' && (
                  <button
                    onClick={() => handleRetry(payout.id)}
                    disabled={retrying === payout.id}
                    className="rounded-md bg-insu-accent px-3 py-1 text-[12px] font-bold text-bg disabled:opacity-50 hover:bg-[#f7b84a]"
                  >
                    {retrying === payout.id ? '…' : 'Retry'}
                  </button>
                )}
              </div>
            </div>
            {errors[payout.id] && (
              <div className="border-b border-white/[0.04] bg-red-500/5 px-4 py-2 text-[12px] text-red-400">
                {errors[payout.id]}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `app/admin/payouts/page.tsx`**

```typescript
import { createClient } from '@/lib/supabase/server'
import { PayoutQueue } from '@/components/admin/payouts/PayoutQueue'

export default async function AdminPayoutsPage() {
  const supabase = createClient()

  const { data } = await supabase
    .from('payouts')
    .select(`
      id,
      amount_usd,
      status,
      created_at,
      transfer_id,
      contract:contracts(title),
      hedger_position:hedger_positions(
        profile:profiles(full_name)
      )
    `)
    .order('created_at', { ascending: false })

  const payouts = (data ?? []).map((row) => {
    const r = row as {
      id: string; amount_usd: number; status: string; created_at: string; transfer_id: string | null
      contract: { title: string } | null
      hedger_position: { profile: { full_name: string | null } | null } | null
    }
    return {
      id: r.id,
      amount_usd: r.amount_usd,
      status: r.status,
      created_at: r.created_at,
      transfer_id: r.transfer_id,
      contractTitle: r.contract?.title ?? '—',
      userFullName: r.hedger_position?.profile?.full_name ?? null,
    }
  })

  return <PayoutQueue payouts={payouts} />
}
```

- [ ] **Step 3: Test in browser**

Navigate to `http://localhost:3000/admin/payouts`. Confirm:
- Stats strip shows correct totals
- "Processing (N)" tab filters to stuck rows
- Processing rows show amber border and Retry button
- Clicking Retry updates the row to "completed" in place without page reload
- Completed rows show the Stripe transfer ID and no Retry button

- [ ] **Step 4: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add app/admin/payouts/ components/admin/payouts/
git commit -m "feat: admin payout queue with retry action"
```
