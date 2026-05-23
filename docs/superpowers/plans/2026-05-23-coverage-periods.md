# Coverage Periods Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 1-day, 7-day, and 30-day coverage periods to the purchase flow for recurring contracts (`weather`/`urban`), scaling the oracle-adjusted premium proportionally and filtering payouts to positions whose coverage window was active when the trigger fired.

**Architecture:** `computePeriodFactor` is a pure pricing helper. `TierSelector` accepts an optional `periodFactor` prop to display adjusted prices. `PurchasePanel` owns the period selection state and passes the factor down. `createHedgerPaymentIntent` scales the Stripe charge and stores the period on the position. `processPayouts` filters eligible positions by their `expires_at` when the trigger fires.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Supabase JS, Stripe, Vitest + @testing-library/react + @testing-library/user-event

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `supabase/migrations/20260523000001_add_coverage_period.sql` | Add `coverage_period_days` column to `hedger_positions` |
| Modify | `lib/types.ts` | Add `coverage_period_days` field to `HedgerPosition` |
| Modify | `lib/pricing/engine.ts` | Add `computePeriodFactor()` export |
| Modify | `tests/lib/pricing/engine.test.ts` | Tests for `computePeriodFactor` |
| Modify | `components/markets/TierSelector.tsx` | Accept `periodFactor?: number`, display adjusted premium |
| Modify | `tests/components/TierSelector.test.tsx` | Tests for period-adjusted price display |
| Modify | `components/markets/PurchasePanel.tsx` | Period selector UI, state, action wiring |
| Modify | `tests/components/PurchasePanel.test.tsx` | Tests for period selector behaviour |
| Modify | `lib/actions/purchase.ts` | Accept `periodDays?`, compute period premium, store on position |
| Create | `tests/lib/actions/purchase.test.ts` | Tests for period-aware payment intent creation |
| Modify | `lib/payout/processor.ts` | Filter positions by coverage window when trigger fires |
| Modify | `tests/lib/payout/processor.test.ts` | Tests for coverage-window filtering |

---

### Task 1: DB migration + type update

**Files:**
- Create: `supabase/migrations/20260523000001_add_coverage_period.sql`
- Modify: `lib/types.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260523000001_add_coverage_period.sql`:

```sql
ALTER TABLE hedger_positions
  ADD COLUMN IF NOT EXISTS coverage_period_days integer;
```

The existing `expires_at` column already exists on `hedger_positions` and currently equals `trigger_deadline` for all positions. Period purchases will set it to `MIN(now + period, trigger_deadline)`. No backfill is needed — null `coverage_period_days` means full-duration coverage.

- [ ] **Step 2: Add `coverage_period_days` to `HedgerPosition` in `lib/types.ts`**

Find the `HedgerPosition` interface (around line 80). Add one optional field:

```ts
export interface HedgerPosition {
  id: string
  user_id: string
  contract_id: string
  tier_id: string
  premium_paid_usd: number
  payout_amount_usd: number
  premium_paid_mxn: number
  payout_amount_mxn: number
  currency: string
  payment_provider: string
  payment_intent_id: string | null
  status: string
  purchased_at: string
  expires_at: string
  coverage_period_days?: number | null   // ← NEW
}
```

Optional (`?`) so existing code that constructs `HedgerPosition` objects (mocks, tests) keeps compiling without changes.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260523000001_add_coverage_period.sql lib/types.ts
git commit -m "feat: add coverage_period_days column and type"
```

---

### Task 2: `computePeriodFactor` in `lib/pricing/engine.ts` (TDD)

**Files:**
- Modify: `lib/pricing/engine.ts`
- Modify: `tests/lib/pricing/engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `tests/lib/pricing/engine.test.ts`. Add a new `describe('computePeriodFactor')` block after the existing `describe('priceTier')` block:

```ts
import { describe, it, expect } from 'vitest'
import { priceTier, computePeriodFactor } from '@/lib/pricing/engine'
// (keep all existing imports and tests above — only ADD the block below)

describe('computePeriodFactor', () => {
  // Contract: created 2026-01-01, deadline 2026-07-01 → 181 days
  const contract = {
    created_at: '2026-01-01T00:00:00Z',
    trigger_deadline: '2026-07-01T00:00:00Z',
  }

  it('returns correct factor for 7-day period on 181-day contract', () => {
    const factor = computePeriodFactor(7, contract)
    expect(factor).toBeCloseTo(7 / 181, 4)
  })

  it('returns correct factor for 30-day period', () => {
    const factor = computePeriodFactor(30, contract)
    expect(factor).toBeCloseTo(30 / 181, 4)
  })

  it('clamps to 1.0 when period >= contract duration', () => {
    expect(computePeriodFactor(200, contract)).toBe(1.0)
    expect(computePeriodFactor(181, contract)).toBe(1.0)
  })

  it('returns 1.0 when contract duration is zero or negative', () => {
    const sameDay = { created_at: '2026-01-01T00:00:00Z', trigger_deadline: '2026-01-01T00:00:00Z' }
    expect(computePeriodFactor(7, sameDay)).toBe(1.0)

    const backwards = { created_at: '2026-07-01T00:00:00Z', trigger_deadline: '2026-01-01T00:00:00Z' }
    expect(computePeriodFactor(7, backwards)).toBe(1.0)
  })

  it('returns 1.0 for 1-day period on 1-day contract', () => {
    const oneDay = { created_at: '2026-01-01T00:00:00Z', trigger_deadline: '2026-01-02T00:00:00Z' }
    expect(computePeriodFactor(1, oneDay)).toBe(1.0)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/lib/pricing/engine.test.ts
```

Expected: the new tests fail with "computePeriodFactor is not a function" (or similar import error).

- [ ] **Step 3: Implement `computePeriodFactor` in `lib/pricing/engine.ts`**

Add this export at the end of `lib/pricing/engine.ts` (after the existing `priceTier` function):

```ts
export function computePeriodFactor(
  periodDays: number,
  contract: Pick<Contract, 'created_at' | 'trigger_deadline'>,
): number {
  const contractDays =
    (new Date(contract.trigger_deadline).getTime() - new Date(contract.created_at).getTime()) /
    86_400_000
  if (contractDays <= 0) return 1.0
  return Math.min(1.0, periodDays / contractDays)
}
```

`Contract` is already imported at the top of the file.

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/lib/pricing/engine.test.ts
```

Expected: all tests pass (existing 8 + new 5 = 13 total).

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/engine.ts tests/lib/pricing/engine.test.ts
git commit -m "feat: add computePeriodFactor to pricing engine"
```

---

### Task 3: `TierSelector` — display period-adjusted premium (TDD)

**Files:**
- Modify: `components/markets/TierSelector.tsx`
- Modify: `tests/components/TierSelector.test.tsx`

- [ ] **Step 1: Write the failing tests**

Open `tests/components/TierSelector.test.tsx`. Add two new tests inside the existing `describe('TierSelector')` block:

```ts
it('shows raw premium_usd when no periodFactor provided', () => {
  render(<TierSelector tiers={tiers} selectedTierId={null} onSelect={vi.fn()} />)
  expect(screen.getByText(/\$12\.00/)).toBeInTheDocument()
})

it('shows period-scaled premium when periodFactor is provided', () => {
  // periodFactor = 7/181 ≈ 0.03867 → 12 * 0.03867 ≈ 0.46 → formatted as $0.46
  render(
    <TierSelector
      tiers={tiers}
      selectedTierId={null}
      onSelect={vi.fn()}
      periodFactor={7 / 181}
    />,
  )
  // $12.00 should NOT appear
  expect(screen.queryByText(/\$12\.00/)).not.toBeInTheDocument()
  // scaled amount should appear (exact value depends on formatCurrency rounding)
  expect(screen.getByText(/\$0\.\d+/)).toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to confirm the new tests fail**

```bash
npx vitest run tests/components/TierSelector.test.tsx
```

Expected: the two new tests fail (`$12.00` still shows when periodFactor given, `periodFactor` prop not recognised).

- [ ] **Step 3: Update `TierSelector.tsx`**

Replace the full content of `components/markets/TierSelector.tsx`:

```tsx
'use client'

import { cn, formatCurrency } from '@/lib/utils'
import type { CoverageTier, CoverageLevel } from '@/lib/types'

interface Props {
  tiers: CoverageTier[]
  selectedTierId: string | null
  onSelect: (tierId: string) => void
  mode?: 'buy' | 'provide'
  periodFactor?: number
}

const TIER_LABELS: Record<CoverageLevel, string> = {
  basic:   'Basic',
  premium: 'Premium',
}

export default function TierSelector({ tiers, selectedTierId, onSelect, mode = 'buy', periodFactor }: Props) {
  const sorted = [...tiers].sort((a, b) => (a.name === 'basic' ? -1 : b.name === 'basic' ? 1 : 0))
  const factor = periodFactor ?? 1.0

  return (
    <div className="space-y-2">
      {sorted.map((tier) => {
        const isSelected = tier.id === selectedTierId
        const remaining = tier.max_capacity_usd - tier.current_capacity_usd
        const isFull = remaining <= 0
        const displayPremium = Math.round(tier.premium_usd * factor * 100) / 100

        return (
          <button
            key={tier.id}
            disabled={isFull}
            onClick={() => onSelect(tier.id)}
            className={cn(
              'w-full rounded-card border p-4 text-left transition-all',
              isSelected
                ? 'border-insu-accent bg-insu-accent/5'
                : 'border-white/[0.07] bg-bg-card hover:border-white/15',
              isFull && 'cursor-not-allowed opacity-40',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-insu-text">
                {TIER_LABELS[tier.name]}
              </span>
              {isSelected && (
                <span className="text-[11px] font-bold text-insu-accent">✓ Selected</span>
              )}
            </div>

            {mode === 'buy' ? (
              <div className="mt-1 flex items-center gap-1 font-mono text-[12px]">
                <span className="text-insu-text">{formatCurrency(displayPremium, 'USD')}</span>
                <span className="text-insu-muted">premium →</span>
                <span className="text-insu-green">{formatCurrency(tier.payout_usd, 'USD')}</span>
                <span className="text-insu-muted">payout</span>
              </div>
            ) : (
              <p className="mt-1 font-mono text-[12px] text-insu-muted">
                {formatCurrency(remaining, 'USD')} capacity remaining
              </p>
            )}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/components/TierSelector.test.tsx
```

Expected: all tests pass (5 existing + 2 new = 7 total).

- [ ] **Step 5: Commit**

```bash
git add components/markets/TierSelector.tsx tests/components/TierSelector.test.tsx
git commit -m "feat: TierSelector accepts periodFactor and displays scaled premium"
```

---

### Task 4: `PurchasePanel` — period selector UI (TDD)

**Files:**
- Modify: `components/markets/PurchasePanel.tsx`
- Modify: `tests/components/PurchasePanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Open `tests/components/PurchasePanel.test.tsx`. Add a `recurringContract` fixture and new tests. The full updated file:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import PurchasePanel from '@/components/markets/PurchasePanel'
import type { ContractWithTiers } from '@/lib/types'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('@/lib/actions/purchase', () => ({
  createHedgerPaymentIntent: vi.fn().mockResolvedValue({ clientSecret: 'pi_test_secret' }),
  createProviderPaymentIntent: vi.fn().mockResolvedValue({ clientSecret: 'pi_test_secret' }),
}))

vi.mock('@/components/markets/StripePaymentForm', () => ({
  default: () => <div data-testid="stripe-form" />,
}))

const mockContract: ContractWithTiers = {
  id: 'abc-123',
  slug: 'power-outage-cdmx',
  title: 'Power outage in CDMX?',
  description: null,
  category_id: 'cat-1',
  category: { id: 'cat-1', name: 'Urban', slug: 'urban', color: '#94a3b8', icon_url: null, display_order: 1 },
  status: 'active',
  trigger_type: 'manual',
  trigger_condition: {},
  trigger_deadline: '2026-12-31T23:59:59Z',
  location: { lat: 19.4, lng: -99.1, city: 'CDMX', country: 'MX' },
  icon_url: null,
  total_volume_usd: 50000,
  total_volume_mxn: 0,
  is_featured: false,
  settled_outcome: null,
  created_by: 'admin',
  created_at: '2026-01-01T00:00:00Z',
  settled_at: null,
  coverage_tiers: [
    { id: 'tier-basic', contract_id: 'abc-123', name: 'basic', premium_usd: 12, payout_usd: 500, premium_mxn: 204, payout_mxn: 8500, max_capacity_usd: 100000, current_capacity_usd: 0, base_probability: 0.1, last_priced_at: null, pricing_inputs: null },
    { id: 'tier-premium', contract_id: 'abc-123', name: 'premium', premium_usd: 38, payout_usd: 2000, premium_mxn: 646, payout_mxn: 34000, max_capacity_usd: 100000, current_capacity_usd: 0, base_probability: 0.1, last_priced_at: null, pricing_inputs: null },
  ],
}

// Recurring contract (weather) — same shape but different trigger_type and slug
const recurringContract: ContractWithTiers = {
  ...mockContract,
  id: 'wx-456',
  slug: 'heat-wave-cdmx',
  title: 'Heat wave in CDMX?',
  trigger_type: 'weather',
}

describe('PurchasePanel', () => {
  it('shows AuthGate when userId is null', () => {
    render(<PurchasePanel contract={mockContract} userId={null} open initialMode="buy" onClose={vi.fn()} />)
    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument()
  })

  it('shows tier selector when user is present', () => {
    render(<PurchasePanel contract={mockContract} userId="user-1" open initialMode="buy" onClose={vi.fn()} />)
    expect(screen.getByText(/select tier/i)).toBeInTheDocument()
  })

  it('toggles to provide mode', async () => {
    render(<PurchasePanel contract={mockContract} userId="user-1" open initialMode="buy" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /provide capital/i }))
    expect(screen.getAllByText(/capacity remaining/i).length).toBeGreaterThan(0)
  })

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn()
    render(<PurchasePanel contract={mockContract} userId="user-1" open initialMode="buy" onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name: /close panel/i }))
    expect(onClose).toHaveBeenCalled()
  })

  it('panel is translated off-screen when open is false', () => {
    render(<PurchasePanel contract={mockContract} userId="user-1" open={false} initialMode="buy" onClose={vi.fn()} />)
    expect(screen.getByRole('dialog').className).toContain('translate-x-full')
  })

  // Period selector — recurring contract
  it('shows period pills for weather contract in buy mode', () => {
    render(<PurchasePanel contract={recurringContract} userId="user-1" open initialMode="buy" onClose={vi.fn()} />)
    expect(screen.getByText('1 day')).toBeInTheDocument()
    expect(screen.getByText('7 days')).toBeInTheDocument()
    expect(screen.getByText('30 days')).toBeInTheDocument()
  })

  it('does not show period pills for manual contract', () => {
    render(<PurchasePanel contract={mockContract} userId="user-1" open initialMode="buy" onClose={vi.fn()} />)
    expect(screen.queryByText('7 days')).not.toBeInTheDocument()
  })

  it('does not show period pills in provide mode for recurring contract', async () => {
    render(<PurchasePanel contract={recurringContract} userId="user-1" open initialMode="buy" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /provide capital/i }))
    expect(screen.queryByText('7 days')).not.toBeInTheDocument()
  })

  it('period pills reset when switching back to buy mode', async () => {
    render(<PurchasePanel contract={recurringContract} userId="user-1" open initialMode="buy" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /7 days/i }))
    await userEvent.click(screen.getByRole('button', { name: /provide capital/i }))
    await userEvent.click(screen.getByRole('button', { name: /buy protection/i }))
    // After switching back, no period is selected — Continue is disabled
    const continueBtn = screen.getByRole('button', { name: /continue to payment/i })
    expect(continueBtn).toBeDisabled()
  })

  it('Continue button is disabled until period is selected for recurring contract', () => {
    render(<PurchasePanel contract={recurringContract} userId="user-1" open initialMode="buy" onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /continue to payment/i })).toBeDisabled()
  })

  it('Continue button enables after period and tier are both selected', async () => {
    render(<PurchasePanel contract={recurringContract} userId="user-1" open initialMode="buy" onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /7 days/i }))
    await userEvent.click(screen.getByRole('button', { name: /basic/i }))
    expect(screen.getByRole('button', { name: /continue to payment/i })).not.toBeDisabled()
  })
})
```

- [ ] **Step 2: Run tests to confirm new tests fail**

```bash
npx vitest run tests/components/PurchasePanel.test.tsx
```

Expected: the 6 new period-selector tests fail (no period pills rendered yet).

- [ ] **Step 3: Implement period selector in `PurchasePanel.tsx`**

Replace the full content of `components/markets/PurchasePanel.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { cn, formatCurrency } from '@/lib/utils'
import type { ContractWithTiers } from '@/lib/types'
import { computePeriodFactor } from '@/lib/pricing/engine'
import TierSelector from './TierSelector'
import AuthGate from './AuthGate'
import StripePaymentForm from './StripePaymentForm'
import { createHedgerPaymentIntent, createProviderPaymentIntent } from '@/lib/actions/purchase'

type PanelMode = 'buy' | 'provide'
type Step = 'select' | 'payment' | 'done'

const PERIOD_OPTIONS = [
  { days: 1,  label: '1 day' },
  { days: 7,  label: '7 days' },
  { days: 30, label: '30 days' },
] as const

interface Props {
  contract: ContractWithTiers
  userId: string | null
  open: boolean
  initialMode: PanelMode
  onClose: () => void
}

export default function PurchasePanel({ contract, userId, open, initialMode, onClose }: Props) {
  const [mode, setMode] = useState<PanelMode>(initialMode)
  const [step, setStep] = useState<Step>('select')
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null)
  const [selectedPeriodDays, setSelectedPeriodDays] = useState<number | null>(null)
  const [depositAmount, setDepositAmount] = useState('')
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isRecurring = (['weather', 'urban'] as const).includes(
    contract.trigger_type as 'weather' | 'urban',
  )

  const periodFactor =
    isRecurring && selectedPeriodDays
      ? computePeriodFactor(selectedPeriodDays, contract)
      : 1.0

  const basicTier = [...contract.coverage_tiers].sort((a, b) =>
    a.name === 'basic' ? -1 : b.name === 'basic' ? 1 : 0,
  )[0]

  const selectedTier = contract.coverage_tiers.find((t) => t.id === selectedTierId)

  function switchMode(next: PanelMode) {
    setMode(next)
    setSelectedTierId(null)
    setSelectedPeriodDays(null)
    setStep('select')
    setClientSecret(null)
    setError(null)
  }

  function handleClose() {
    setStep('select')
    setSelectedTierId(null)
    setSelectedPeriodDays(null)
    setClientSecret(null)
    setError(null)
    onClose()
  }

  async function handleContinue() {
    if (!selectedTierId) return
    setLoading(true)
    setError(null)

    const result =
      mode === 'buy'
        ? await createHedgerPaymentIntent(selectedTierId, selectedPeriodDays ?? undefined)
        : await createProviderPaymentIntent(selectedTierId, parseFloat(depositAmount) || 0)

    setLoading(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setClientSecret(result.clientSecret)
    setStep('payment')
  }

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={handleClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Purchase panel"
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-bg-card shadow-2xl transition-transform duration-300',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.07] px-6 py-5">
          <span className="line-clamp-1 text-[14px] font-semibold text-insu-text">
            {contract.title}
          </span>
          <button
            onClick={handleClose}
            aria-label="Close panel"
            className="ml-4 rounded-lg p-1.5 text-insu-muted transition-colors hover:bg-white/5 hover:text-insu-text"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!userId ? (
            <AuthGate next={`/markets/${contract.slug}`} />
          ) : step === 'done' ? (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="text-4xl">✓</div>
              <p className="text-[15px] font-semibold text-insu-text">
                {mode === 'buy' ? 'Protection confirmed!' : 'Capital deposited!'}
              </p>
              {mode === 'buy' && selectedTier && (
                <p className="text-[13px] text-insu-muted">
                  You&apos;re covered up to{' '}
                  <span className="font-semibold text-insu-green">
                    ${selectedTier.payout_usd.toLocaleString()}
                  </span>
                </p>
              )}
              <button
                onClick={handleClose}
                className="mt-2 rounded-lg bg-insu-accent px-6 py-2.5 text-[14px] font-bold text-bg"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Mode toggle */}
              <div className="mb-5 flex rounded-lg bg-bg p-1">
                {(['buy', 'provide'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => switchMode(m)}
                    className={cn(
                      'flex-1 rounded-md py-2 text-[13px] font-semibold transition-all',
                      mode === m ? 'bg-insu-accent text-bg' : 'text-insu-muted hover:text-insu-text',
                    )}
                  >
                    {m === 'buy' ? 'Buy Protection' : 'Provide Capital'}
                  </button>
                ))}
              </div>

              {step === 'select' ? (
                <>
                  {/* Period selector — recurring buy only */}
                  {isRecurring && mode === 'buy' && (
                    <div className="mb-5">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-insu-muted">
                        Coverage period
                      </p>
                      <div className="flex gap-2">
                        {PERIOD_OPTIONS.map(({ days, label }) => {
                          const pf = computePeriodFactor(days, contract)
                          const fromPrice = formatCurrency(
                            Math.round(basicTier.premium_usd * pf * 100) / 100,
                            'USD',
                          )
                          return (
                            <button
                              key={days}
                              onClick={() => setSelectedPeriodDays(days)}
                              className={cn(
                                'flex flex-1 flex-col items-center rounded-lg border py-2.5 text-[11px] font-semibold transition-all',
                                selectedPeriodDays === days
                                  ? 'border-insu-accent/50 bg-insu-accent/5 text-insu-accent'
                                  : 'border-white/[0.07] bg-bg-card text-insu-muted hover:border-white/15',
                              )}
                            >
                              {label}
                              <span className="mt-0.5 font-mono text-[9px] font-normal opacity-70">
                                from {fromPrice}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-insu-muted">
                    Select tier
                  </p>
                  <TierSelector
                    tiers={contract.coverage_tiers}
                    selectedTierId={selectedTierId}
                    onSelect={setSelectedTierId}
                    mode={mode}
                    periodFactor={mode === 'buy' ? periodFactor : undefined}
                  />

                  {mode === 'provide' && selectedTierId && (
                    <div className="mt-4">
                      <label
                        htmlFor="deposit-amount"
                        className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-insu-muted"
                      >
                        Deposit amount (USD)
                      </label>
                      <input
                        id="deposit-amount"
                        type="number"
                        min="10"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        placeholder="e.g. 1000"
                        className="w-full rounded-lg border border-white/[0.07] bg-bg px-4 py-2.5 text-[14px] text-insu-text outline-none focus:border-insu-accent/40"
                      />
                    </div>
                  )}

                  {error && (
                    <p role="alert" className="mt-3 rounded-lg bg-red-500/10 px-4 py-2 text-[13px] text-red-400">
                      {error}
                    </p>
                  )}

                  <button
                    onClick={handleContinue}
                    disabled={
                      !selectedTierId ||
                      loading ||
                      (isRecurring && mode === 'buy' && selectedPeriodDays === null) ||
                      (mode === 'provide' && (!depositAmount || parseFloat(depositAmount) < 10))
                    }
                    className="mt-5 w-full rounded-lg bg-insu-accent py-3 text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a] disabled:opacity-40"
                  >
                    {loading ? 'Loading…' : 'Continue to payment'}
                  </button>
                </>
              ) : clientSecret && selectedTier ? (
                <StripePaymentForm
                  clientSecret={clientSecret}
                  amountUsd={mode === 'buy'
                    ? Math.round(selectedTier.premium_usd * periodFactor * 100) / 100
                    : parseFloat(depositAmount)}
                  onSuccess={() => setStep('done')}
                  onError={(msg) => { setError(msg); setStep('select') }}
                />
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/components/PurchasePanel.test.tsx
```

Expected: all tests pass (5 existing + 6 new = 11 total).

- [ ] **Step 5: Commit**

```bash
git add components/markets/PurchasePanel.tsx tests/components/PurchasePanel.test.tsx
git commit -m "feat: add coverage period selector to PurchasePanel"
```

---

### Task 5: `createHedgerPaymentIntent` — period-aware purchase action (TDD)

**Files:**
- Modify: `lib/actions/purchase.ts`
- Create: `tests/lib/actions/purchase.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/actions/purchase.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase server client
const mockGetUser = vi.fn()
const mockTierQuery = vi.fn()
const mockContractQuery = vi.fn()
const mockPositionInsert = vi.fn()
const mockPaymentIntentUpdate = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      if (table === 'coverage_tiers') return mockTierQuery()
      if (table === 'contracts') return mockContractQuery()
      if (table === 'hedger_positions') return mockPositionInsert()
      return {}
    }),
  })),
}))

// Mock Stripe
const mockPaymentIntentsCreate = vi.fn()
const mockPaymentIntentsUpdate = vi.fn()

vi.mock('stripe', () => ({
  default: vi.fn(() => ({
    paymentIntents: {
      create: mockPaymentIntentsCreate,
      update: mockPaymentIntentsUpdate,
    },
  })),
}))

vi.mock('@/lib/utils/capacity', () => ({
  validateCapacity: vi.fn().mockReturnValue(null), // no error = capacity OK
}))

// Contract: 365-day duration (Jan 1 → Dec 31 2026)
const mockTier = {
  id: 'tier-basic',
  contract_id: 'c1',
  name: 'basic',
  premium_usd: 12,
  payout_usd: 500,
  premium_mxn: 204,
  payout_mxn: 8500,
  max_capacity_usd: 100000,
  current_capacity_usd: 0,
}

const mockContract = {
  id: 'c1',
  trigger_deadline: '2026-12-31T23:59:59Z',
  created_at: '2026-01-01T00:00:00Z',
}

function setupMocks() {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })

  const tierChain = { select: vi.fn(), eq: vi.fn(), single: vi.fn() }
  tierChain.select.mockReturnValue(tierChain)
  tierChain.eq.mockReturnValue(tierChain)
  tierChain.single.mockResolvedValue({ data: mockTier, error: null })
  mockTierQuery.mockReturnValue(tierChain)

  const contractChain = { select: vi.fn(), eq: vi.fn(), single: vi.fn() }
  contractChain.select.mockReturnValue(contractChain)
  contractChain.eq.mockReturnValue(contractChain)
  contractChain.single.mockResolvedValue({ data: mockContract, error: null })
  mockContractQuery.mockReturnValue(contractChain)

  const posInsertChain = { insert: vi.fn(), select: vi.fn(), single: vi.fn() }
  posInsertChain.insert.mockReturnValue(posInsertChain)
  posInsertChain.select.mockReturnValue(posInsertChain)
  posInsertChain.single.mockResolvedValue({ data: { id: 'pos-1' }, error: null })
  mockPositionInsert.mockReturnValue(posInsertChain)

  mockPaymentIntentsCreate.mockResolvedValue({ id: 'pi_test', client_secret: 'secret_test' })
  mockPaymentIntentsUpdate.mockResolvedValue({})
}

describe('createHedgerPaymentIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupMocks()
  })

  it('charges full premium when no period given', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-basic')
    // 12.00 USD = 1200 cents
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 1200 }),
    )
  })

  it('charges period-scaled premium for 7-day period', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    // Contract is 365 days; periodFactor = 7/365 ≈ 0.01918; 12 * 0.01918 ≈ 0.23; cents = 23
    await createHedgerPaymentIntent('tier-basic', 7)
    const call = mockPaymentIntentsCreate.mock.calls[0][0]
    // Allow ±2 cents for rounding
    expect(call.amount).toBeGreaterThanOrEqual(21)
    expect(call.amount).toBeLessThanOrEqual(25)
  })

  it('stores coverage_period_days on the position', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-basic', 7)
    const posChain = mockPositionInsert()
    const insertArg = posChain.insert.mock.calls[0][0]
    expect(insertArg.coverage_period_days).toBe(7)
  })

  it('stores null coverage_period_days when no period given', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-basic')
    const posChain = mockPositionInsert()
    const insertArg = posChain.insert.mock.calls[0][0]
    expect(insertArg.coverage_period_days).toBeNull()
  })

  it('sets expires_at to trigger_deadline when no period given', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-basic')
    const posChain = mockPositionInsert()
    const insertArg = posChain.insert.mock.calls[0][0]
    expect(insertArg.expires_at).toBe(mockContract.trigger_deadline)
  })

  it('sets expires_at before trigger_deadline for 7-day period', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    await createHedgerPaymentIntent('tier-basic', 7)
    const posChain = mockPositionInsert()
    const insertArg = posChain.insert.mock.calls[0][0]
    // expires_at should be ~7 days from now, which is well before Dec 31 2026
    expect(new Date(insertArg.expires_at) < new Date(mockContract.trigger_deadline)).toBe(true)
  })

  it('returns clientSecret on success', async () => {
    const { createHedgerPaymentIntent } = await import('@/lib/actions/purchase')
    const result = await createHedgerPaymentIntent('tier-basic', 7)
    expect(result).toEqual({ clientSecret: 'secret_test' })
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/lib/actions/purchase.test.ts
```

Expected: most tests fail (action doesn't accept `periodDays` yet).

- [ ] **Step 3: Update `lib/actions/purchase.ts`**

Replace the full content:

```ts
'use server'

import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { validateCapacity } from '@/lib/utils/capacity'
import { computePeriodFactor } from '@/lib/pricing/engine'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder')

export async function createHedgerPaymentIntent(
  tierId: string,
  periodDays?: number,
): Promise<{ clientSecret: string } | { error: string }> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to purchase protection' }

  const { data: tier, error: tierError } = await supabase
    .from('coverage_tiers')
    .select('*')
    .eq('id', tierId)
    .single()

  if (tierError || !tier) return { error: 'Coverage tier not found' }

  const capacityError = validateCapacity(
    tier.max_capacity_usd,
    tier.current_capacity_usd,
    tier.premium_usd,
  )
  if (capacityError) return { error: capacityError }

  const { data: contract, error: contractError } = await supabase
    .from('contracts')
    .select('id, trigger_deadline, created_at')
    .eq('id', tier.contract_id)
    .single()

  if (contractError || !contract) return { error: 'Contract not found' }

  const periodFactor = periodDays ? computePeriodFactor(periodDays, contract) : 1.0
  const periodPremium = Math.round(Number(tier.premium_usd) * periodFactor * 100) / 100

  const coverageEndMs = periodDays
    ? Math.min(
        Date.now() + periodDays * 86_400_000,
        new Date(contract.trigger_deadline).getTime(),
      )
    : new Date(contract.trigger_deadline).getTime()
  const expiresAt = new Date(coverageEndMs).toISOString()

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(periodPremium * 100),
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    metadata: { position_type: 'hedger', tier_id: tierId, user_id: user.id },
  })

  const { data: position, error: positionError } = await supabase
    .from('hedger_positions')
    .insert({
      user_id: user.id,
      contract_id: tier.contract_id,
      tier_id: tierId,
      premium_paid_usd: periodPremium,
      payout_amount_usd: tier.payout_usd,
      premium_paid_mxn: tier.premium_mxn,
      payout_amount_mxn: tier.payout_mxn,
      currency: 'USD',
      payment_provider: 'stripe',
      payment_intent_id: paymentIntent.id,
      status: 'pending_payment',
      expires_at: expiresAt,
      coverage_period_days: periodDays ?? null,
    })
    .select('id')
    .single()

  if (positionError || !position) return { error: 'Failed to create position' }

  await stripe.paymentIntents.update(paymentIntent.id, {
    metadata: { position_type: 'hedger', position_id: position.id, tier_id: tierId, user_id: user.id },
  })

  return { clientSecret: paymentIntent.client_secret! }
}

export async function createProviderPaymentIntent(
  tierId: string,
  amountUsd: number,
): Promise<{ clientSecret: string } | { error: string }> {
  if (!amountUsd || amountUsd < 10) return { error: 'Minimum deposit is $10' }

  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You must be signed in to provide capital' }

  const { data: tier, error: tierError } = await supabase
    .from('coverage_tiers')
    .select('*')
    .eq('id', tierId)
    .single()

  if (tierError || !tier) return { error: 'Coverage tier not found' }

  const capacityError = validateCapacity(tier.max_capacity_usd, tier.current_capacity_usd, amountUsd)
  if (capacityError) return { error: capacityError }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amountUsd * 100),
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    metadata: { position_type: 'provider', tier_id: tierId, user_id: user.id },
  })

  const { data: position, error: positionError } = await supabase
    .from('provider_positions')
    .insert({
      user_id: user.id,
      contract_id: tier.contract_id,
      tier_id: tierId,
      capital_deposited_usd: amountUsd,
      capital_deposited_mxn: 0,
      currency: 'USD',
      payment_provider: 'stripe',
      payment_intent_id: paymentIntent.id,
      expected_return_usd: 0,
      expected_return_mxn: 0,
      status: 'pending_payment',
    })
    .select('id')
    .single()

  if (positionError || !position) return { error: 'Failed to create position' }

  await stripe.paymentIntents.update(paymentIntent.id, {
    metadata: { position_type: 'provider', position_id: position.id, tier_id: tierId, user_id: user.id },
  })

  return { clientSecret: paymentIntent.client_secret! }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/lib/actions/purchase.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Run full suite to check for regressions**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/purchase.ts tests/lib/actions/purchase.test.ts
git commit -m "feat: createHedgerPaymentIntent supports coverage period scaling"
```

---

### Task 6: `processPayouts` — filter by coverage window (TDD)

**Files:**
- Modify: `lib/payout/processor.ts`
- Modify: `tests/lib/payout/processor.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `tests/lib/payout/processor.test.ts`. The `mockHedgerPosition` already has `expires_at` set to tomorrow. Add three new tests inside the existing `describe('processPayouts')` block, and two helper positions for coverage tests:

Add after the existing `mockHedgerPosition` definition (around line 41):

```ts
// Position whose coverage expired an hour ago
const expiredPosition: HedgerPosition = {
  ...mockHedgerPosition,
  id: 'pos-expired',
  coverage_period_days: 7,
  expires_at: new Date(Date.now() - 3600_000).toISOString(), // 1 hour ago
}

// Position whose coverage is still active
const activePosition: HedgerPosition = {
  ...mockHedgerPosition,
  id: 'pos-active',
  coverage_period_days: 7,
  expires_at: new Date(Date.now() + 86_400_000).toISOString(), // 1 day from now
}
```

Add at the end of `describe('processPayouts')`:

```ts
  it('skips position whose coverage_period expired before trigger fired', async () => {
    // trigger read_at = now; position expired 1 hour ago
    const db = makeDb({
      triggeredReadings: [{ contract_id: 'c1', read_at: new Date().toISOString() }],
      hedgerPositions: [expiredPosition],
    })
    const stripe = makeStripe()
    const count = await processPayouts(db as never, stripe as never)
    expect(count).toBe(0)
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled()
  })

  it('pays position whose coverage is still active when trigger fires', async () => {
    const db = makeDb({
      triggeredReadings: [{ contract_id: 'c1', read_at: new Date().toISOString() }],
      hedgerPositions: [activePosition],
    })
    const stripe = makeStripe()
    const count = await processPayouts(db as never, stripe as never)
    expect(count).toBe(1)
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalled()
  })

  it('always pays position with null coverage_period_days (full-duration)', async () => {
    // null coverage_period_days = full contract coverage, always eligible
    const fullDurationPosition: HedgerPosition = {
      ...mockHedgerPosition,
      id: 'pos-full',
      coverage_period_days: undefined,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }
    const db = makeDb({
      triggeredReadings: [{ contract_id: 'c1', read_at: new Date().toISOString() }],
      hedgerPositions: [fullDurationPosition],
    })
    const count = await processPayouts(db as never, makeStripe() as never)
    expect(count).toBe(1)
  })
```

Also update `makeChainable` to include `read_at` in the mock — the `triggeredReadings` type needs to include it. Update the `makeDb` factory's `triggeredReadings` type:

Find this line in `makeDb`:
```ts
triggeredReadings?: Array<{ contract_id: string }>
```
Change to:
```ts
triggeredReadings?: Array<{ contract_id: string; read_at?: string }>
```

And the default:
```ts
const triggeredReadings = opts.triggeredReadings ?? [{ contract_id: 'c1' }]
```
Change to:
```ts
const triggeredReadings = opts.triggeredReadings ?? [{ contract_id: 'c1', read_at: new Date().toISOString() }]
```

- [ ] **Step 2: Run tests to confirm new tests fail**

```bash
npx vitest run tests/lib/payout/processor.test.ts
```

Expected: the 3 new tests fail (processor doesn't filter by `expires_at` yet; expired position still gets paid).

- [ ] **Step 3: Update `lib/payout/processor.ts`**

Replace the full content:

```ts
import { createClient } from '@supabase/supabase-js'
import { evaluateTrigger, type TriggerCondition } from './trigger'
import { fetchWeatherReading, fetchWazeReading } from './fetcher'
import type { Contract, HedgerPosition, ProviderPosition } from '@/lib/types'

interface FetchedReading {
  source: string
  reading_type: string
  value: Record<string, unknown>
}

type ReadingFetcher = (contract: Contract) => Promise<FetchedReading | null>

interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

interface StripeClient {
  customers: {
    create: (params: { metadata: Record<string, string> }) => Promise<{ id: string }>
    createBalanceTransaction: (
      customerId: string,
      params: { amount: number; currency: string },
    ) => Promise<{ id: string }>
  }
}

function getClient(): DbClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  )
}

export async function processPayouts(
  db: DbClient = getClient(),
  stripe: StripeClient,
): Promise<number> {
  const { data: triggeredReadings } = await db
    .from('oracle_readings')
    .select('contract_id, read_at')
    .eq('trigger_met', true)

  if (!triggeredReadings || triggeredReadings.length === 0) return 0

  // Build map of contractId → earliest trigger timestamp
  const triggerMap = new Map<string, string>()
  for (const r of triggeredReadings as Array<{ contract_id: string; read_at: string }>) {
    const existing = triggerMap.get(r.contract_id)
    if (!existing || r.read_at < existing) {
      triggerMap.set(r.contract_id, r.read_at)
    }
  }

  const contractIds = Array.from(triggerMap.keys())

  const { data: contracts } = await db
    .from('contracts')
    .select('*')
    .in('id', contractIds)
    .eq('status', 'active')
    .is('settled_outcome', null)

  if (!contracts || contracts.length === 0) return 0

  let total = 0
  for (const contract of contracts as Contract[]) {
    const triggerReadAt = triggerMap.get(contract.id) ?? new Date().toISOString()
    total += await settleContract(db, stripe, contract, triggerReadAt)
  }
  return total
}

async function settleContract(
  db: DbClient,
  stripe: StripeClient,
  contract: Contract,
  triggerReadAt: string,
): Promise<number> {
  await db.from('contracts')
    .update({ settled_outcome: true, status: 'settled', settled_at: new Date().toISOString() })
    .eq('id', contract.id)

  const { data: positions } = await db
    .from('hedger_positions')
    .select('*')
    .eq('contract_id', contract.id)
    .eq('status', 'active')

  if (!positions) return 0

  // Only pay positions whose coverage window included the trigger timestamp
  const eligiblePositions = (positions as HedgerPosition[]).filter((pos) =>
    !pos.coverage_period_days ||
    new Date(pos.expires_at) >= new Date(triggerReadAt),
  )

  let paid = 0
  for (const position of eligiblePositions) {
    await payoutPosition(db, stripe, contract.id, position)
    paid++
  }

  const totalHedgerPayout = eligiblePositions.reduce((sum, p) => sum + p.payout_amount_usd, 0)
  await settleProviderPositions(db, contract.id, totalHedgerPayout)

  return paid
}

async function payoutPosition(
  db: DbClient,
  stripe: StripeClient,
  contractId: string,
  position: HedgerPosition,
): Promise<void> {
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
      amount_usd: position.payout_amount_usd,
      amount_mxn: position.payout_amount_mxn,
      currency: position.currency,
      payment_provider: 'stripe',
      status: 'processing',
    })
    .select('id')
    .single()

  if (!payout) {
    console.error(`Failed to create payout record for position ${position.id}`)
    return
  }

  let txnId: string
  try {
    const txn = await stripe.customers.createBalanceTransaction(customerId, {
      amount: -Math.round(position.payout_amount_usd * 100),
      currency: 'usd',
    })
    txnId = txn.id
  } catch (err) {
    console.error(`Stripe balance transaction failed for position ${position.id}:`, err)
    return
  }

  await db.from('payouts')
    .update({ status: 'completed', transfer_id: txnId, completed_at: new Date().toISOString() })
    .eq('id', (payout as { id: string }).id)

  await db.from('hedger_positions').update({ status: 'paid_out' }).eq('id', position.id)
}

async function settleProviderPositions(
  db: DbClient,
  contractId: string,
  totalHedgerPayout: number,
): Promise<void> {
  const { data: positions } = await db
    .from('provider_positions')
    .select('*')
    .eq('contract_id', contractId)
    .eq('status', 'active')

  if (!positions || positions.length === 0) return

  const totalProviderCapital = (positions as ProviderPosition[])
    .reduce((sum, p) => sum + p.capital_deposited_usd, 0)

  for (const position of positions as ProviderPosition[]) {
    const lossShare = totalProviderCapital > 0
      ? (position.capital_deposited_usd / totalProviderCapital) * totalHedgerPayout
      : 0
    const actualReturn = Math.round(Math.max(0, position.capital_deposited_usd - lossShare) * 100) / 100

    await db.from('provider_positions')
      .update({ status: 'settled', actual_return_usd: actualReturn, settled_at: new Date().toISOString() })
      .eq('id', position.id)
  }
}
```

Wait — this file is `lib/payout/processor.ts` but it imports from `'./trigger'` and `'./fetcher'` — those are oracle files in `lib/oracle/`. Let me re-read... actually on re-reading, `pollContracts` is the one in `lib/oracle/poll.ts` that uses trigger/fetcher. The `processor.ts` doesn't import those. The processor I wrote above incorrectly includes the poll logic. Remove the `FetchedReading`, `ReadingFetcher`, and `defaultFetcher` — those belong in poll.ts, not processor.ts.

The correct `processor.ts` only handles payouts. Use this:

```ts
import { createClient } from '@supabase/supabase-js'
import type { Contract, HedgerPosition, ProviderPosition } from '@/lib/types'

interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

interface StripeClient {
  customers: {
    create: (params: { metadata: Record<string, string> }) => Promise<{ id: string }>
    createBalanceTransaction: (
      customerId: string,
      params: { amount: number; currency: string },
    ) => Promise<{ id: string }>
  }
}

function getClient(): DbClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  )
}

export async function processPayouts(
  db: DbClient = getClient(),
  stripe: StripeClient,
): Promise<number> {
  const { data: triggeredReadings } = await db
    .from('oracle_readings')
    .select('contract_id, read_at')
    .eq('trigger_met', true)

  if (!triggeredReadings || triggeredReadings.length === 0) return 0

  // Build map of contractId → earliest trigger timestamp
  const triggerMap = new Map<string, string>()
  for (const r of triggeredReadings as Array<{ contract_id: string; read_at: string }>) {
    const existing = triggerMap.get(r.contract_id)
    if (!existing || r.read_at < existing) {
      triggerMap.set(r.contract_id, r.read_at)
    }
  }

  const contractIds = Array.from(triggerMap.keys())

  const { data: contracts } = await db
    .from('contracts')
    .select('*')
    .in('id', contractIds)
    .eq('status', 'active')
    .is('settled_outcome', null)

  if (!contracts || contracts.length === 0) return 0

  let total = 0
  for (const contract of contracts as Contract[]) {
    const triggerReadAt = triggerMap.get(contract.id) ?? new Date().toISOString()
    total += await settleContract(db, stripe, contract, triggerReadAt)
  }
  return total
}

async function settleContract(
  db: DbClient,
  stripe: StripeClient,
  contract: Contract,
  triggerReadAt: string,
): Promise<number> {
  await db.from('contracts')
    .update({ settled_outcome: true, status: 'settled', settled_at: new Date().toISOString() })
    .eq('id', contract.id)

  const { data: positions } = await db
    .from('hedger_positions')
    .select('*')
    .eq('contract_id', contract.id)
    .eq('status', 'active')

  if (!positions) return 0

  // Skip positions whose coverage window closed before the trigger fired
  const eligiblePositions = (positions as HedgerPosition[]).filter((pos) =>
    !pos.coverage_period_days ||
    new Date(pos.expires_at) >= new Date(triggerReadAt),
  )

  let paid = 0
  for (const position of eligiblePositions) {
    await payoutPosition(db, stripe, contract.id, position)
    paid++
  }

  const totalHedgerPayout = eligiblePositions.reduce((sum, p) => sum + p.payout_amount_usd, 0)
  await settleProviderPositions(db, contract.id, totalHedgerPayout)

  return paid
}

async function payoutPosition(
  db: DbClient,
  stripe: StripeClient,
  contractId: string,
  position: HedgerPosition,
): Promise<void> {
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
      amount_usd: position.payout_amount_usd,
      amount_mxn: position.payout_amount_mxn,
      currency: position.currency,
      payment_provider: 'stripe',
      status: 'processing',
    })
    .select('id')
    .single()

  if (!payout) {
    console.error(`Failed to create payout record for position ${position.id}`)
    return
  }

  let txnId: string
  try {
    const txn = await stripe.customers.createBalanceTransaction(customerId, {
      amount: -Math.round(position.payout_amount_usd * 100),
      currency: 'usd',
    })
    txnId = txn.id
  } catch (err) {
    console.error(`Stripe balance transaction failed for position ${position.id}:`, err)
    return
  }

  await db.from('payouts')
    .update({ status: 'completed', transfer_id: txnId, completed_at: new Date().toISOString() })
    .eq('id', (payout as { id: string }).id)

  await db.from('hedger_positions').update({ status: 'paid_out' }).eq('id', position.id)
}

async function settleProviderPositions(
  db: DbClient,
  contractId: string,
  totalHedgerPayout: number,
): Promise<void> {
  const { data: positions } = await db
    .from('provider_positions')
    .select('*')
    .eq('contract_id', contractId)
    .eq('status', 'active')

  if (!positions || positions.length === 0) return

  const totalProviderCapital = (positions as ProviderPosition[])
    .reduce((sum, p) => sum + p.capital_deposited_usd, 0)

  for (const position of positions as ProviderPosition[]) {
    const lossShare = totalProviderCapital > 0
      ? (position.capital_deposited_usd / totalProviderCapital) * totalHedgerPayout
      : 0
    const actualReturn = Math.round(Math.max(0, position.capital_deposited_usd - lossShare) * 100) / 100

    await db.from('provider_positions')
      .update({ status: 'settled', actual_return_usd: actualReturn, settled_at: new Date().toISOString() })
      .eq('id', position.id)
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/lib/payout/processor.test.ts
```

Expected: all tests pass (8 existing + 3 new = 11 total).

- [ ] **Step 5: Run the full suite**

```bash
npx vitest run
```

Expected: all tests pass with no regressions.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/payout/processor.ts tests/lib/payout/processor.test.ts
git commit -m "feat: filter payout eligibility by coverage window"
```
