# SP5: Portfolio Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/dashboard` — a single authenticated page with a stats strip, three tabs (Protections / Positions / Payouts), rich position cards, and live Supabase Realtime updates when a trigger fires.

**Architecture:** Server Component fetches all positions in one parallel query set and passes them to `DashboardClient`. `DashboardClient` mounts two Realtime channels on mount, patching in-memory state when `hedger_positions` or `provider_positions` rows update. Tab state lives in `?tab=` URL param. Mirrors the SP1 browse page pattern.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS, Supabase SSR client (`@supabase/ssr`), Supabase Realtime, vitest.

---

## File Map

```
lib/
  types.ts                          ← MODIFY: add HedgerPositionWithContract,
                                               ProviderPositionWithContract, PayoutWithContract
  actions/
    dashboard.ts                    ← NEW: getDashboardData(userId) — three parallel queries

app/
  dashboard/
    page.tsx                        ← NEW: Server Component — auth guard, data fetch, renders DashboardClient

components/
  dashboard/
    DashboardClient.tsx             ← NEW: "use client" — tabs, Realtime subscriptions
    StatsStrip.tsx                  ← NEW: 3 headline numbers derived from position arrays
    ProtectionsTab.tsx              ← NEW: groups active + expired hedger positions
    PositionsTab.tsx                ← NEW: lists provider positions
    PayoutsTab.tsx                  ← NEW: chronological payout log
    ProtectionCard.tsx              ← NEW: rich card for hedger positions
    PositionCard.tsx                ← NEW: rich card for provider positions
    PayoutRow.tsx                   ← NEW: single payout log row

components/
  layout/
    Header.tsx                      ← MODIFY: async + auth check, Portfolio link for logged-in users

tests/
  lib/
    actions/
      dashboard.test.ts             ← NEW: unit tests for getDashboardData

.gitignore                          ← MODIFY: add .superpowers/
```

---

## Task 0: Gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add .superpowers/ to .gitignore**

Open `.gitignore` and append:

```
# Brainstorm mockups
.superpowers/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore .superpowers/ brainstorm artifacts"
```

---

## Task 1: Types

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Append join types to lib/types.ts**

Add at the end of the file:

```ts
export interface HedgerPositionWithContract extends HedgerPosition {
  contract: Pick<Contract, 'id' | 'slug' | 'title' | 'trigger_type'>
  tier: Pick<CoverageTier, 'name'>
}

export interface ProviderPositionWithContract extends ProviderPosition {
  contract: Pick<Contract, 'id' | 'slug' | 'title' | 'trigger_type' | 'trigger_deadline'>
  tier: Pick<CoverageTier, 'name'>
}

export interface PayoutWithContract extends Payout {
  contract: Pick<Contract, 'id' | 'slug' | 'title'>
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/types.ts
git commit -m "chore: add HedgerPositionWithContract, ProviderPositionWithContract, PayoutWithContract join types"
```

---

## Task 2: getDashboardData (TDD)

**Files:**
- Create: `tests/lib/actions/dashboard.test.ts`
- Create: `lib/actions/dashboard.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/actions/dashboard.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

import { getDashboardData } from '@/lib/actions/dashboard'
import { createClient } from '@/lib/supabase/server'

function makeChainable(value: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order']) {
    b[m] = vi.fn().mockReturnValue(b)
  }
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(value).then(res)
  return b
}

function makeSupabase(opts: {
  hedgerData?: unknown[]
  hedgerError?: Error
  providerData?: unknown[]
  providerError?: Error
  payoutsData?: unknown[]
  payoutsError?: Error
} = {}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'hedger_positions')
        return makeChainable({ data: opts.hedgerData ?? [], error: opts.hedgerError ?? null })
      if (table === 'provider_positions')
        return makeChainable({ data: opts.providerData ?? [], error: opts.providerError ?? null })
      if (table === 'payouts')
        return makeChainable({ data: opts.payoutsData ?? [], error: opts.payoutsError ?? null })
      return makeChainable({ data: [], error: null })
    }),
  }
}

describe('getDashboardData', () => {
  beforeEach(() => vi.resetModules())

  it('returns all three arrays when queries succeed', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase({
      hedgerData: [{ id: 'hp-1', status: 'active' }],
      providerData: [{ id: 'pp-1', status: 'active' }],
      payoutsData: [{ id: 'pay-1', status: 'completed' }],
    }) as never)

    const result = await getDashboardData('user-1')
    expect(result.hedgerPositions).toHaveLength(1)
    expect(result.providerPositions).toHaveLength(1)
    expect(result.payouts).toHaveLength(1)
  })

  it('returns empty arrays when user has no data', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase() as never)

    const result = await getDashboardData('user-1')
    expect(result.hedgerPositions).toEqual([])
    expect(result.providerPositions).toEqual([])
    expect(result.payouts).toEqual([])
  })

  it('throws when hedger positions query fails', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase({
      hedgerError: new Error('DB error'),
    }) as never)

    await expect(getDashboardData('user-1')).rejects.toThrow('DB error')
  })

  it('throws when provider positions query fails', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase({
      providerError: new Error('DB error'),
    }) as never)

    await expect(getDashboardData('user-1')).rejects.toThrow('DB error')
  })

  it('throws when payouts query fails', async () => {
    vi.mocked(createClient).mockReturnValue(makeSupabase({
      payoutsError: new Error('DB error'),
    }) as never)

    await expect(getDashboardData('user-1')).rejects.toThrow('DB error')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/lib/actions/dashboard.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/actions/dashboard'`

- [ ] **Step 3: Implement getDashboardData**

Create `lib/actions/dashboard.ts`:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import type {
  DashboardData,
  HedgerPositionWithContract,
  ProviderPositionWithContract,
  PayoutWithContract,
} from '@/lib/types'

export interface DashboardData {
  hedgerPositions: HedgerPositionWithContract[]
  providerPositions: ProviderPositionWithContract[]
  payouts: PayoutWithContract[]
}

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const supabase = createClient()

  const [hedgerResult, providerResult, payoutsResult] = await Promise.all([
    supabase
      .from('hedger_positions')
      .select('*, contract:contracts(id, slug, title, trigger_type), tier:coverage_tiers(name)')
      .eq('user_id', userId)
      .in('status', ['active', 'paid_out', 'expired']),
    supabase
      .from('provider_positions')
      .select('*, contract:contracts(id, slug, title, trigger_type, trigger_deadline), tier:coverage_tiers(name)')
      .eq('user_id', userId)
      .in('status', ['active', 'settled']),
    supabase
      .from('payouts')
      .select('*, contract:contracts(id, slug, title), hedger_position:hedger_positions!inner(user_id)')
      .eq('hedger_position.user_id', userId)
      .order('created_at', { ascending: false }),
  ])

  if (hedgerResult.error) throw hedgerResult.error
  if (providerResult.error) throw providerResult.error
  if (payoutsResult.error) throw payoutsResult.error

  return {
    hedgerPositions: (hedgerResult.data ?? []) as HedgerPositionWithContract[],
    providerPositions: (providerResult.data ?? []) as ProviderPositionWithContract[],
    payouts: (payoutsResult.data ?? []) as PayoutWithContract[],
  }
}
```

> Note: `DashboardData` is defined here rather than in `lib/types.ts` because it's an action return shape, not a domain type.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/lib/actions/dashboard.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/actions/dashboard.ts tests/lib/actions/dashboard.test.ts
git commit -m "feat: getDashboardData action — three parallel Supabase queries for dashboard"
```

---

## Task 3: ProtectionCard

**Files:**
- Create: `components/dashboard/ProtectionCard.tsx`

- [ ] **Step 1: Create ProtectionCard**

Create `components/dashboard/ProtectionCard.tsx`:

```tsx
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { HedgerPositionWithContract } from '@/lib/types'

export function ProtectionCard({ position }: { position: HedgerPositionWithContract }) {
  const {
    contract, tier, status,
    premium_paid_usd, payout_amount_usd,
    purchased_at, expires_at,
  } = position

  const now = Date.now()
  const expiresMs = new Date(expires_at).getTime()
  const purchasedMs = new Date(purchased_at).getTime()
  const totalDays = Math.max(1, Math.round((expiresMs - purchasedMs) / 86_400_000))
  const daysLeft = Math.max(0, Math.round((expiresMs - now) / 86_400_000))
  const progressPct = Math.min(100, (daysLeft / totalDays) * 100)

  const isPaidOut = status === 'paid_out'
  const isExpired = status === 'expired'

  const badge = isPaidOut
    ? { label: 'PAID OUT ✓', bg: 'bg-[#14532d]', text: 'text-insu-green', ring: 'ring-insu-green' }
    : isExpired
    ? { label: 'EXPIRED', bg: 'bg-[#1c2333]', text: 'text-insu-muted', ring: 'ring-white/10' }
    : { label: 'ACTIVE', bg: 'bg-[#14532d]', text: 'text-insu-green', ring: 'ring-insu-green/20' }

  const dateStr = new Date(expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <Link href={`/markets/${contract.slug}`} className="block">
      <div className={cn(
        'rounded-xl border bg-bg-card p-4 transition-colors hover:bg-bg-card-hover',
        isPaidOut ? 'border-insu-green/20' : 'border-white/[0.07]',
        isExpired && 'opacity-50',
      )}>
        {/* header */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-body text-sm font-bold text-insu-text">{contract.title}</p>
            <p className="mt-0.5 font-body text-[11px] capitalize text-insu-muted">
              {tier.name} tier · {contract.trigger_type}
            </p>
          </div>
          <span className={cn(
            'shrink-0 rounded-full px-2 py-0.5 font-mono text-[8px] ring-1',
            badge.bg, badge.text, badge.ring,
          )}>
            {badge.label}
          </span>
        </div>

        {/* numbers */}
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="text-center">
            <p className="font-body text-[8px] uppercase tracking-wide text-insu-muted">Paid</p>
            <p className="mt-0.5 font-mono text-sm text-insu-text">${premium_paid_usd}</p>
          </div>
          <div className="text-center">
            <p className="font-body text-[8px] uppercase tracking-wide text-insu-muted">
              {isPaidOut ? 'Received' : 'Payout'}
            </p>
            <p className="mt-0.5 font-mono text-sm text-insu-green">${payout_amount_usd}</p>
          </div>
          <div className="text-center">
            <p className="font-body text-[8px] uppercase tracking-wide text-insu-muted">
              {isPaidOut ? 'Settled' : 'Expires'}
            </p>
            <p className="mt-0.5 font-body text-sm text-insu-text">{dateStr}</p>
          </div>
        </div>

        {/* progress bar — active only */}
        {status === 'active' && (
          <div>
            <div className="h-[3px] overflow-hidden rounded-full bg-[#0d1117]">
              <div
                className="h-full rounded-full bg-insu-accent transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="mt-1 font-body text-[8px] text-insu-muted">
              {daysLeft} days left of {totalDays}
            </p>
          </div>
        )}
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/dashboard/ProtectionCard.tsx
git commit -m "feat: ProtectionCard — rich hedger position card with status badge and time bar"
```

---

## Task 4: PositionCard and PayoutRow

**Files:**
- Create: `components/dashboard/PositionCard.tsx`
- Create: `components/dashboard/PayoutRow.tsx`

- [ ] **Step 1: Create PositionCard**

Create `components/dashboard/PositionCard.tsx`:

```tsx
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { ProviderPositionWithContract } from '@/lib/types'

export function PositionCard({ position }: { position: ProviderPositionWithContract }) {
  const {
    contract, tier, status,
    capital_deposited_usd, expected_return_usd, actual_return_usd,
    settled_at,
  } = position

  const isActive = status === 'active'
  const isLoss = !isActive && actual_return_usd !== null && actual_return_usd < capital_deposited_usd

  const badge = isActive
    ? { label: 'ACTIVE', bg: 'bg-[#1a2a1a]', text: 'text-insu-green', ring: 'ring-insu-green/20' }
    : isLoss
    ? { label: 'LOSS SHARE', bg: 'bg-[#2a1a1a]', text: 'text-red-400', ring: 'ring-red-500/20' }
    : { label: 'SETTLED ✓', bg: 'bg-[#1a2e1a]', text: 'text-insu-green', ring: 'ring-insu-green' }

  const yieldPct = capital_deposited_usd > 0
    ? ((expected_return_usd / capital_deposited_usd) * 100).toFixed(1)
    : '0.0'

  const yieldDisplay = isActive
    ? `+$${expected_return_usd} (${yieldPct}%)`
    : actual_return_usd !== null
    ? `$${actual_return_usd}`
    : '-'

  const settleDisplay = settled_at
    ? new Date(settled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : contract.trigger_deadline
    ? new Date(contract.trigger_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '-'

  return (
    <Link href={`/markets/${contract.slug}`} className="block">
      <div className="rounded-xl border border-white/[0.07] bg-bg-card p-4 transition-colors hover:bg-bg-card-hover">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-body text-sm font-bold text-insu-text">{contract.title}</p>
            <p className="mt-0.5 font-body text-[11px] capitalize text-insu-muted">
              {tier.name} tier · deployed capital
            </p>
          </div>
          <span className={cn(
            'shrink-0 rounded-full px-2 py-0.5 font-mono text-[8px] ring-1',
            badge.bg, badge.text, badge.ring,
          )}>
            {badge.label}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <p className="font-body text-[8px] uppercase tracking-wide text-insu-muted">Capital</p>
            <p className="mt-0.5 font-mono text-sm text-insu-text">${capital_deposited_usd.toLocaleString()}</p>
          </div>
          <div className="text-center">
            <p className="font-body text-[8px] uppercase tracking-wide text-insu-muted">Yield</p>
            <p className={cn(
              'mt-0.5 font-mono text-sm',
              isLoss ? 'text-red-400' : 'text-insu-accent',
            )}>
              {yieldDisplay}
            </p>
          </div>
          <div className="text-center">
            <p className="font-body text-[8px] uppercase tracking-wide text-insu-muted">Settles</p>
            <p className="mt-0.5 font-body text-sm text-insu-text">{settleDisplay}</p>
          </div>
        </div>
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: Create PayoutRow**

Create `components/dashboard/PayoutRow.tsx`:

```tsx
import Link from 'next/link'
import type { PayoutWithContract } from '@/lib/types'

export function PayoutRow({ payout }: { payout: PayoutWithContract }) {
  const { contract, amount_usd, status, created_at } = payout

  const dateStr = new Date(created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  const badge = status === 'completed'
    ? { label: 'COMPLETED', cls: 'bg-[#14532d] text-insu-green' }
    : { label: 'PROCESSING', cls: 'bg-[#2a1f0a] text-insu-accent' }

  return (
    <Link href={`/markets/${contract.slug}`} className="block">
      <div className="flex items-center justify-between border-b border-white/[0.07] py-3 transition-colors hover:bg-white/[0.02]">
        <div className="min-w-0">
          <p className="truncate font-body text-sm text-insu-text">{contract.title}</p>
          <p className="font-body text-[11px] text-insu-muted">{dateStr}</p>
        </div>
        <div className="ml-4 flex shrink-0 items-center gap-2">
          <span className="font-mono text-sm text-insu-green">${amount_usd}</span>
          <span className={`rounded-full px-2 py-0.5 font-mono text-[8px] ${badge.cls}`}>
            {badge.label}
          </span>
        </div>
      </div>
    </Link>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/PositionCard.tsx components/dashboard/PayoutRow.tsx
git commit -m "feat: PositionCard and PayoutRow — provider position card with yield %, payout log row"
```

---

## Task 5: StatsStrip

**Files:**
- Create: `components/dashboard/StatsStrip.tsx`

- [ ] **Step 1: Create StatsStrip**

Create `components/dashboard/StatsStrip.tsx`:

```tsx
import { formatCurrency } from '@/lib/utils'
import type { HedgerPositionWithContract, ProviderPositionWithContract } from '@/lib/types'

interface StatsStripProps {
  hedgerPositions: HedgerPositionWithContract[]
  providerPositions: ProviderPositionWithContract[]
}

export function StatsStrip({ hedgerPositions, providerPositions }: StatsStripProps) {
  const activeCovers = hedgerPositions.filter(p => p.status === 'active').length

  const coveredUpTo = hedgerPositions
    .filter(p => p.status === 'active')
    .reduce((sum, p) => sum + p.payout_amount_usd, 0)

  const providerYield = providerPositions
    .filter(p => p.status === 'active')
    .reduce((sum, p) => sum + p.expected_return_usd, 0)

  return (
    <div className="mb-6 grid grid-cols-3 gap-3">
      <div className="rounded-xl border border-white/[0.07] bg-bg-card p-4 text-center">
        <p className="font-mono text-2xl font-bold text-insu-text">{activeCovers}</p>
        <p className="mt-1 font-body text-[9px] uppercase tracking-wide text-insu-muted">Active covers</p>
      </div>
      <div className="rounded-xl border border-white/[0.07] bg-bg-card p-4 text-center">
        <p className="font-mono text-2xl font-bold text-insu-green">{formatCurrency(coveredUpTo)}</p>
        <p className="mt-1 font-body text-[9px] uppercase tracking-wide text-insu-muted">Covered up to</p>
      </div>
      <div className="rounded-xl border border-white/[0.07] bg-bg-card p-4 text-center">
        <p className="font-mono text-2xl font-bold text-insu-accent">{formatCurrency(providerYield)}</p>
        <p className="mt-1 font-body text-[9px] uppercase tracking-wide text-insu-muted">Provider yield</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/dashboard/StatsStrip.tsx
git commit -m "feat: StatsStrip — active covers, covered-up-to, provider yield derived from position arrays"
```

---

## Task 6: Tab Components

**Files:**
- Create: `components/dashboard/ProtectionsTab.tsx`
- Create: `components/dashboard/PositionsTab.tsx`
- Create: `components/dashboard/PayoutsTab.tsx`

- [ ] **Step 1: Create ProtectionsTab**

Create `components/dashboard/ProtectionsTab.tsx`:

```tsx
import Link from 'next/link'
import { ProtectionCard } from './ProtectionCard'
import type { HedgerPositionWithContract } from '@/lib/types'

export function ProtectionsTab({ positions }: { positions: HedgerPositionWithContract[] }) {
  const active = positions.filter(p => p.status === 'active')
  const history = positions.filter(p => p.status !== 'active')

  if (positions.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="font-body text-sm text-insu-muted">
          No active protections yet —{' '}
          <Link href="/" className="text-insu-accent underline underline-offset-2">
            Browse contracts →
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {active.length > 0 && (
        <div>
          <p className="mb-3 font-body text-[9px] uppercase tracking-wide text-insu-muted">
            Active ({active.length})
          </p>
          <div className="space-y-3">
            {active.map(p => <ProtectionCard key={p.id} position={p} />)}
          </div>
        </div>
      )}
      {history.length > 0 && (
        <div>
          <p className="mb-3 font-body text-[9px] uppercase tracking-wide text-insu-muted">
            Expired / Paid out ({history.length})
          </p>
          <div className="space-y-3">
            {history.map(p => <ProtectionCard key={p.id} position={p} />)}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create PositionsTab**

Create `components/dashboard/PositionsTab.tsx`:

```tsx
import Link from 'next/link'
import { PositionCard } from './PositionCard'
import type { ProviderPositionWithContract } from '@/lib/types'

export function PositionsTab({ positions }: { positions: ProviderPositionWithContract[] }) {
  if (positions.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="font-body text-sm text-insu-muted">
          No capital deployed yet —{' '}
          <Link href="/" className="text-insu-accent underline underline-offset-2">
            Browse contracts →
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {positions.map(p => <PositionCard key={p.id} position={p} />)}
    </div>
  )
}
```

- [ ] **Step 3: Create PayoutsTab**

Create `components/dashboard/PayoutsTab.tsx`:

```tsx
import { PayoutRow } from './PayoutRow'
import type { PayoutWithContract } from '@/lib/types'

export function PayoutsTab({ payouts }: { payouts: PayoutWithContract[] }) {
  if (payouts.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="font-body text-sm text-insu-muted">
          No payouts yet. Payouts appear here when a trigger fires.
        </p>
      </div>
    )
  }

  return (
    <div>
      {payouts.map(p => <PayoutRow key={p.id} payout={p} />)}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add components/dashboard/ProtectionsTab.tsx components/dashboard/PositionsTab.tsx components/dashboard/PayoutsTab.tsx
git commit -m "feat: ProtectionsTab, PositionsTab, PayoutsTab — dashboard tab content with empty states"
```

---

## Task 7: DashboardClient

**Files:**
- Create: `components/dashboard/DashboardClient.tsx`

- [ ] **Step 1: Create DashboardClient**

Create `components/dashboard/DashboardClient.tsx`:

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { StatsStrip } from './StatsStrip'
import { ProtectionsTab } from './ProtectionsTab'
import { PositionsTab } from './PositionsTab'
import { PayoutsTab } from './PayoutsTab'
import type {
  HedgerPositionWithContract,
  ProviderPositionWithContract,
  PayoutWithContract,
} from '@/lib/types'

type Tab = 'protections' | 'positions' | 'payouts'

interface DashboardClientProps {
  userId: string
  hedgerPositions: HedgerPositionWithContract[]
  providerPositions: ProviderPositionWithContract[]
  payouts: PayoutWithContract[]
  initialTab: Tab
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'protections', label: 'Protections' },
  { id: 'positions', label: 'Positions' },
  { id: 'payouts', label: 'Payouts' },
]

export function DashboardClient({
  userId,
  hedgerPositions: initialHedger,
  providerPositions: initialProvider,
  payouts,
  initialTab,
}: DashboardClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeTab = (searchParams.get('tab') as Tab | null) ?? initialTab

  const [hedgerPositions, setHedgerPositions] = useState(initialHedger)
  const [providerPositions, setProviderPositions] = useState(initialProvider)

  const setTab = (tab: Tab) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', tab)
    router.push(`/dashboard?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    const supabase = createClient()
    if (!supabase) return

    const hedgerChannel = supabase
      .channel('dashboard:hedger')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'hedger_positions',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setHedgerPositions(prev =>
            prev.map(p => p.id === payload.new.id ? { ...p, ...payload.new } : p)
          )
        }
      )
      .subscribe()

    const providerChannel = supabase
      .channel('dashboard:provider')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'provider_positions',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setProviderPositions(prev =>
            prev.map(p => p.id === payload.new.id ? { ...p, ...payload.new } : p)
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(hedgerChannel)
      supabase.removeChannel(providerChannel)
    }
  }, [userId])

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6">
        <p className="font-display text-[11px] uppercase tracking-[2px] text-insu-accent">My Portfolio</p>
        <p className="font-body text-[11px] text-insu-muted">Live updates · positions as of right now</p>
      </div>

      <StatsStrip hedgerPositions={hedgerPositions} providerPositions={providerPositions} />

      <div className="mb-6 flex gap-2 border-b border-white/[0.07] pb-3">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setTab(tab.id)}
            className={cn(
              'rounded-full px-4 py-1 font-body text-[11px] transition-colors',
              activeTab === tab.id
                ? 'bg-insu-accent font-bold text-bg'
                : 'border border-white/[0.07] text-insu-muted hover:text-insu-dim',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'protections' && <ProtectionsTab positions={hedgerPositions} />}
      {activeTab === 'positions' && <PositionsTab positions={providerPositions} />}
      {activeTab === 'payouts' && <PayoutsTab payouts={payouts} />}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/dashboard/DashboardClient.tsx
git commit -m "feat: DashboardClient — tab switcher, URL sync, Realtime subscriptions for position status"
```

---

## Task 8: page.tsx

**Files:**
- Create: `app/dashboard/page.tsx`

- [ ] **Step 1: Create the dashboard page**

Create `app/dashboard/page.tsx`:

```tsx
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import { DashboardClient } from '@/components/dashboard/DashboardClient'
import { getDashboardData } from '@/lib/actions/dashboard'

type Tab = 'protections' | 'positions' | 'payouts'
const VALID_TABS: Tab[] = ['protections', 'positions', 'payouts']

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { tab?: string }
}) {
  const isConfigured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  if (!isConfigured) notFound()

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const data = await getDashboardData(user.id)
  const initialTab: Tab = VALID_TABS.includes(searchParams.tab as Tab)
    ? (searchParams.tab as Tab)
    : 'protections'

  return (
    <>
      <Header />
      <DashboardClient
        userId={user.id}
        hedgerPositions={data.hedgerPositions}
        providerPositions={data.providerPositions}
        payouts={data.payouts}
        initialTab={initialTab}
      />
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: /dashboard page — auth-gated Server Component with SSR data fetch"
```

---

## Task 9: Header — Portfolio Link

**Files:**
- Modify: `components/layout/Header.tsx`

- [ ] **Step 1: Make Header async and add Portfolio link**

The Header is currently a static Server Component. Convert it to async so it can read the Supabase session, then show "Portfolio" for logged-in users and "Log In / Sign Up" for guests.

Replace the full content of `components/layout/Header.tsx` with:

```tsx
import Link from 'next/link'
import { Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'

export default async function Header() {
  let userId: string | null = null
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
  } catch {
    // Supabase not configured — render unauthenticated header
  }

  return (
    <header className="sticky top-0 z-50 flex h-[60px] items-center gap-5 border-b border-white/[0.07] bg-bg/85 px-8 backdrop-blur-xl">
      {/* Logo */}
      <Link href="/" className="flex flex-shrink-0 items-center gap-2.5">
        <svg width="28" height="22" viewBox="0 0 28 22" fill="none" aria-hidden>
          <polygon points="0,22 9,4 18,22" fill="#e8edf5" />
          <polygon points="10,22 19,4 28,22" fill="#f5a623" />
        </svg>
        <span className="font-display text-[26px] tracking-[4px] text-insu-text">
          INSU
        </span>
        <div className="mx-1 h-5 w-px bg-white/[0.07]" />
        <span className="text-[10px] font-medium uppercase leading-tight tracking-wide text-insu-muted">
          Everyday Risk,
          <br />
          Instantly Covered
        </span>
      </Link>

      {/* Search */}
      <div className="flex max-w-[440px] flex-1 items-center gap-2.5 rounded-lg border border-white/[0.07] bg-white/[0.04] px-3.5 py-2.5 transition-colors focus-within:border-insu-accent/30 focus-within:bg-insu-accent/[0.03]">
        <Search size={13} className="flex-shrink-0 text-insu-muted" />
        <input
          type="text"
          aria-label="Search contracts"
          placeholder="Search contracts, events, locations…"
          className="flex-1 bg-transparent font-body text-[13.5px] text-insu-text outline-none placeholder:text-insu-muted"
        />
      </div>

      <div className="flex-1" />

      {/* Nav links */}
      <Link
        href="/how-it-works"
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-insu-dim transition-colors hover:bg-white/[0.05] hover:text-insu-text"
      >
        How it works
      </Link>

      {userId ? (
        <Link
          href="/dashboard"
          className="rounded-lg border border-white/[0.07] px-4 py-1.5 text-[13px] font-semibold text-insu-dim transition-colors hover:border-white/15 hover:text-insu-text"
        >
          Portfolio
        </Link>
      ) : (
        <>
          <Link
            href="/auth/login"
            className="rounded-lg border border-white/[0.07] px-4 py-1.5 text-[13px] font-semibold text-insu-dim transition-colors hover:border-white/15 hover:text-insu-text"
          >
            Log In
          </Link>
          <Link
            href="/auth/signup"
            className="rounded-lg bg-insu-accent px-4 py-1.5 text-[13px] font-bold text-bg transition-all hover:-translate-y-px hover:bg-[#f7b84a] hover:shadow-[0_4px_16px_rgba(245,166,35,0.3)]"
          >
            Sign Up
          </Link>
        </>
      )}
    </header>
  )
}
```

- [ ] **Step 2: Run the full test suite to confirm no regressions**

```bash
npx vitest run
```

Expected: All tests pass (no new failures)

- [ ] **Step 3: Commit**

```bash
git add components/layout/Header.tsx
git commit -m "feat: Header — async auth check, Portfolio link for logged-in users"
```

---

## Self-Review

### Spec Coverage

| Spec requirement | Task |
|---|---|
| Single `/dashboard` route | Task 8 |
| `?tab=` URL param, default `protections` | Task 7 (DashboardClient), Task 8 (page.tsx) |
| Auth guard → redirect `/auth/login` | Task 8 |
| Stats strip: active covers, covered up to, provider yield | Task 5 |
| Protections tab: active + expired groups | Task 6 |
| Protection card: status badge, paid/payout/expiry, time bar | Task 3 |
| Positions tab: provider capital list | Task 6 |
| Position card: capital, yield + %, settles date, status badge | Task 4 |
| Payouts tab: chronological log | Task 6 |
| Payout row: contract, amount, date, status badge | Task 4 |
| Realtime: hedger_positions UPDATE patches state | Task 7 |
| Realtime: provider_positions UPDATE patches state | Task 7 |
| Empty states per tab with browse link | Task 6 |
| Header Portfolio link for authed users | Task 9 |
| Three join types in lib/types.ts | Task 1 |
| `getDashboardData` unit tests (5 tests) | Task 2 |
| `.superpowers/` gitignored | Task 0 |
