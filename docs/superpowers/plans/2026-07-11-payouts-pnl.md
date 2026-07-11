# Payouts Tab PnL Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Received / Spent / Net PnL summary strip to the top of the Payouts tab on the My Portfolio page.

**Architecture:** Pure client-side computation inside `PayoutsTab` from props the dashboard already loads — `received` sums `payouts[].amount_usd`, `spent` sums `hedgerPositions[].premium_paid_usd`, `net` is the difference. `PayoutsTab` gains a `hedgerPositions` prop wired from `DashboardClient`'s realtime-synced state. No server, query, or schema changes.

**Tech Stack:** Next.js App Router, React, Tailwind (project tokens: `insu-green`, `insu-text`, `insu-muted`, `bg-bg-card`; red is `text-red-400` — there is no `insu-red`), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-11-payouts-pnl-design.md`

**Branch:** `feat/payouts-pnl` (already created; spec committed).

**Copy constraint:** regulatory-safe vocabulary only — labels are "Received", "Spent", "Net". Never use "insurance", "premium", or "coverage" in UI text (the `premium_paid_usd` field name is internal and fine).

**Display note:** `formatCurrency` (in `lib/utils.ts`) renders `$1,234 USD` (no decimals, ISO code appended). Negative values come out as `-$50 USD` via `Intl.NumberFormat`; positive net gets an explicit `+` prefix added in the component.

---

### Task 1: PnL summary strip in `PayoutsTab`

**Files:**
- Create: `tests/components/PayoutsTab.test.tsx`
- Modify: `components/dashboard/PayoutsTab.tsx` (whole file — it's 20 lines)

- [ ] **Step 1: Write the failing tests**

Create `tests/components/PayoutsTab.test.tsx` with this exact content:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PayoutsTab } from '@/components/dashboard/PayoutsTab'
import type { PayoutWithContract, HedgerPositionWithContract } from '@/lib/types'

function makePayout(overrides: Partial<PayoutWithContract> = {}): PayoutWithContract {
  return {
    id: 'payout-1',
    contract_id: 'contract-1',
    hedger_position_id: 'pos-1',
    amount_usd: 100,
    amount_mxn: 2000,
    currency: 'USD',
    payment_provider: 'stripe',
    transfer_id: null,
    status: 'completed',
    created_at: '2026-07-01T12:00:00Z',
    completed_at: '2026-07-01T12:05:00Z',
    contract: {
      id: 'contract-1',
      slug: 'test-contract',
      title: 'Test Contract',
      status: 'active',
    },
    ...overrides,
  }
}

function makePosition(overrides: Partial<HedgerPositionWithContract> = {}): HedgerPositionWithContract {
  return {
    id: 'pos-1',
    user_id: 'user-1',
    contract_id: 'contract-1',
    tier_id: 'tier-1',
    premium_paid_usd: 50,
    payout_amount_usd: 500,
    premium_paid_mxn: 1000,
    payout_amount_mxn: 10000,
    currency: 'USD',
    payment_provider: 'stripe',
    payment_intent_id: null,
    status: 'active',
    purchased_at: '2026-06-24T12:00:00Z',
    expires_at: '2026-07-24T12:00:00Z',
    contract: {
      id: 'contract-1',
      slug: 'test-contract',
      title: 'Test Contract',
      trigger_type: 'urban',
      status: 'active',
      is_recurring: true,
      trigger_condition: { speed_kmh: { lt: 15 } },
    },
    tier: {
      name: 'basic',
      base_probability: 0.05,
      max_payouts: 30,
    },
    ...overrides,
  }
}

describe('PayoutsTab PnL summary', () => {
  it('shows a positive net with + prefix and green color when payouts exceed spend', () => {
    // received 100+100=200, spent 50 → net +150
    render(
      <PayoutsTab
        payouts={[makePayout({ id: 'a' }), makePayout({ id: 'b' })]}
        hedgerPositions={[makePosition()]}
      />,
    )

    expect(screen.getByText('Received')).toBeInTheDocument()
    expect(screen.getByText('$200 USD')).toBeInTheDocument()
    expect(screen.getByText('Spent')).toBeInTheDocument()
    expect(screen.getByText('$50 USD')).toBeInTheDocument()
    const net = screen.getByText('+$150 USD')
    expect(net).toBeInTheDocument()
    expect(net.className).toContain('text-insu-green')
  })

  it('shows a negative net in red when spend exceeds payouts', () => {
    // received 100, spent 50+120=170 → net -70
    render(
      <PayoutsTab
        payouts={[makePayout()]}
        hedgerPositions={[
          makePosition({ id: 'p1' }),
          makePosition({ id: 'p2', premium_paid_usd: 120 }),
        ]}
      />,
    )

    const net = screen.getByText('-$70 USD')
    expect(net).toBeInTheDocument()
    expect(net.className).toContain('text-red-400')
  })

  it('includes processing payouts in the received total', () => {
    // completed 100 + processing 250 = 350 received, spent 50 → net +300
    render(
      <PayoutsTab
        payouts={[
          makePayout({ id: 'a' }),
          makePayout({ id: 'b', amount_usd: 250, status: 'processing', completed_at: null }),
        ]}
        hedgerPositions={[makePosition()]}
      />,
    )

    expect(screen.getByText('$350 USD')).toBeInTheDocument()
    expect(screen.getByText('+$300 USD')).toBeInTheDocument()
  })

  it('renders the strip and the empty message when the user has spend but no payouts', () => {
    render(<PayoutsTab payouts={[]} hedgerPositions={[makePosition()]} />)

    expect(screen.getByText('Spent')).toBeInTheDocument()
    expect(screen.getByText('-$50 USD')).toBeInTheDocument()
    expect(screen.getByText(/No payouts yet/)).toBeInTheDocument()
  })

  it('renders only the empty message when there are no positions and no payouts', () => {
    render(<PayoutsTab payouts={[]} hedgerPositions={[]} />)

    expect(screen.queryByText('Received')).not.toBeInTheDocument()
    expect(screen.queryByText('Net')).not.toBeInTheDocument()
    expect(screen.getByText(/No payouts yet/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/components/PayoutsTab.test.tsx`
Expected: FAIL — TypeScript/props error (`hedgerPositions` not a prop) and/or missing "Received"/"Net" elements. The last test's `No payouts yet` assertion may pass; the suite as a whole must fail.

- [ ] **Step 3: Implement the summary strip**

Replace the entire content of `components/dashboard/PayoutsTab.tsx` with:

```tsx
import { PayoutRow } from './PayoutRow'
import { cn, formatCurrency } from '@/lib/utils'
import type { PayoutWithContract, HedgerPositionWithContract } from '@/lib/types'

interface PayoutsTabProps {
  payouts: PayoutWithContract[]
  hedgerPositions: HedgerPositionWithContract[]
}

export function PayoutsTab({ payouts, hedgerPositions }: PayoutsTabProps) {
  const received = payouts.reduce((sum, p) => sum + p.amount_usd, 0)
  const spent = hedgerPositions.reduce((sum, p) => sum + p.premium_paid_usd, 0)
  const net = received - spent
  const showSummary = payouts.length > 0 || hedgerPositions.length > 0

  return (
    <div>
      {showSummary && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/[0.07] bg-bg-card p-4 text-center">
            <p className="font-mono text-2xl font-bold text-insu-green">{formatCurrency(received)}</p>
            <p className="mt-1 font-body text-[11px] uppercase tracking-wide text-insu-muted">Received</p>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-bg-card p-4 text-center">
            <p className="font-mono text-2xl font-bold text-insu-text">{formatCurrency(spent)}</p>
            <p className="mt-1 font-body text-[11px] uppercase tracking-wide text-insu-muted">Spent</p>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-bg-card p-4 text-center">
            <p className={cn(
              'font-mono text-2xl font-bold',
              net >= 0 ? 'text-insu-green' : 'text-red-400',
            )}>
              {net >= 0 ? `+${formatCurrency(net)}` : formatCurrency(net)}
            </p>
            <p className="mt-1 font-body text-[11px] uppercase tracking-wide text-insu-muted">Net</p>
          </div>
        </div>
      )}

      {payouts.length === 0 ? (
        <div className="py-12 text-center">
          <p className="font-body text-sm text-insu-muted">
            No payouts yet. Payouts appear here when a trigger fires.
          </p>
        </div>
      ) : (
        <div>
          {payouts.map(p => <PayoutRow key={p.id} payout={p} />)}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/components/PayoutsTab.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/components/PayoutsTab.test.tsx components/dashboard/PayoutsTab.tsx
git commit -m "feat(dashboard): PnL summary strip in Payouts tab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Note: `DashboardClient` doesn't compile against the new required prop until Task 2 — that's the immediate next task, and the commit keeps the test-backed unit change atomic.

---

### Task 2: Wire `hedgerPositions` through `DashboardClient`

**Files:**
- Modify: `components/dashboard/DashboardClient.tsx:170` (the `PayoutsTab` usage)

- [ ] **Step 1: Pass the prop**

In `components/dashboard/DashboardClient.tsx`, change the payouts tab render (currently line 170):

```tsx
      {activeTab === 'payouts' && <PayoutsTab payouts={payouts} />}
```

to:

```tsx
      {activeTab === 'payouts' && <PayoutsTab payouts={payouts} hedgerPositions={hedgerPositions} />}
```

Use the `hedgerPositions` state variable (realtime-synced), not the `initialHedger` prop.

- [ ] **Step 2: Type-check and run the full test suite**

Run: `npx tsc --noEmit && npm run test:run`
Expected: tsc exits clean; all vitest suites PASS.

(If `tsc` reports phantom errors from files with ` 2` in their names, that's the iCloud duplicate-file issue — scrub with `find . -name '* 2.*' -not -path './node_modules/*'` and re-run.)

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/DashboardClient.tsx
git commit -m "feat(dashboard): pass hedger positions to PayoutsTab for PnL

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Verify in the running app

**Files:** none (verification only)

- [ ] **Step 1: Run the dev server and eyeball the tab**

Run: `npm run dev`, open `http://localhost:3000/dashboard?tab=payouts` logged in as a user with positions.
Expected: three cards — Received (green), Spent (neutral), Net (green `+$…` or red `-$…`) — above the payout list; empty message still shows below the strip when there are no payouts. Verify no "insurance/premium/coverage" wording appears.

- [ ] **Step 2: Done — hand off to finishing-a-development-branch**

Push the branch and open a PR per the project's normal flow (prod deploys manually via `vercel --prod --yes` after merge).
