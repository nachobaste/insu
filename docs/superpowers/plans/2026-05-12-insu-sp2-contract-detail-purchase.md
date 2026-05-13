# SP2: Contract Detail + Purchase Flows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/markets/[slug]` contract detail page and a slide-over purchase panel supporting both hedger buy and risk provider deposit flows, with Stripe Elements for payment processing.

**Architecture:** Next.js 14 App Router — server component fetches contract + pricing history, passes to `ContractDetailClient` (client component) which manages the slide-over panel. Server Actions create Stripe `PaymentIntent`s server-side; a Supabase Edge Function handles the `payment_intent.succeeded` webhook. No new DB tables needed — all tables exist from SP1.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, @tremor/react (AreaChart), stripe, @stripe/stripe-js + @stripe/react-stripe-js, Vitest + Testing Library, Playwright

**Spec:** `docs/superpowers/specs/2026-05-12-insu-sp2-contract-detail-purchase.md`

---

## File Map

```
app/
  markets/[slug]/
    page.tsx                         Server component — fetches contract + tiers + pricing history
    loading.tsx                      Skeleton (left/right columns)
components/
  markets/
    ContractDetailClient.tsx         Client — left/right layout, panel open/close/mode state
    ContractMeta.tsx                 Trigger type, deadline, location, volume
    PriceChart.tsx                   Tremor AreaChart — premium_usd history per tier
    TierSelector.tsx                 Tier cards — interactive (buy/provide modes)
    PurchasePanel.tsx                Slide-over shell — mode toggle, AuthGate or buy/provide form
    AuthGate.tsx                     Inline sign-in prompt for unauthenticated users
    StripePaymentForm.tsx            Stripe Elements (CardElement) — confirms PaymentIntent
lib/
  actions/
    purchase.ts                      Server Actions: createHedgerPaymentIntent, createProviderPaymentIntent
  utils.ts                           Add categoryTextClass helper
  types.ts                           Add PricingHistoryRow, ContractDetailData
tests/
  components/
    ContractMeta.test.tsx
    TierSelector.test.tsx
    AuthGate.test.tsx
    PurchasePanel.test.tsx
    StripePaymentForm.test.tsx
  lib/
    purchase.test.ts
  e2e/
    markets.spec.ts
supabase/
  functions/
    stripe-webhook/
      index.ts                       Edge Function — payment_intent.succeeded handler
  migrations/
    20260512000001_seed_pricing_history.sql
vitest.setup.ts                      Add ResizeObserver mock (for Tremor)
tailwind.config.ts                   Add Tremor content path
.env.local.example                   Add STRIPE_SECRET_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET
```

---

## Task 1: Install Dependencies + Environment Variables

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `tailwind.config.ts`
- Modify: `.env.local.example`
- Modify: `vitest.setup.ts`

- [ ] **Step 1: Install runtime dependencies**

```bash
npm install stripe @stripe/stripe-js @stripe/react-stripe-js @tremor/react
```

Expected: packages added to `node_modules`, `package-lock.json` updated.

- [ ] **Step 2: Add Tremor content path to tailwind.config.ts**

```ts
// tailwind.config.ts — add to content array
content: [
  './pages/**/*.{ts,tsx}',
  './components/**/*.{ts,tsx}',
  './app/**/*.{ts,tsx}',
  './src/**/*.{ts,tsx}',
  './node_modules/@tremor/**/*.{js,ts,jsx,tsx}',  // ← add this line
],
```

- [ ] **Step 3: Add Stripe env vars to .env.local.example**

```
NEXT_PUBLIC_SUPABASE_URL=https://eagmczieznsogsxldedk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
SEED_ADMIN_USER_ID=your_admin_user_uuid_here
STRIPE_SECRET_KEY=sk_test_your_key_here
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_secret_here
```

Also add the three Stripe vars to your actual `.env.local` (get test keys from Stripe dashboard → Developers → API keys).

- [ ] **Step 4: Add ResizeObserver mock to vitest.setup.ts**

```ts
// vitest.setup.ts — full file
import '@testing-library/jest-dom'

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))
```

- [ ] **Step 5: Verify app still compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tailwind.config.ts .env.local.example vitest.setup.ts
git commit -m "chore: install Stripe, Tremor deps; add Stripe env vars"
```

---

## Task 2: TypeScript Types + Utils

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/utils.ts`

- [ ] **Step 1: Add new types to lib/types.ts**

Append to the end of `lib/types.ts`:

```ts
export interface PricingHistoryRow {
  id: string
  tier_id: string
  premium_usd_after: number
  calculated_at: string
}

export interface ContractDetailData extends ContractWithTiers {
  pricing_history: PricingHistoryRow[]
}
```

- [ ] **Step 2: Add categoryTextClass to lib/utils.ts**

Append to the end of `lib/utils.ts`:

```ts
export function categoryTextClass(slug: string): string {
  const map: Record<string, string> = {
    urban:       'text-category-urban',
    nature:      'text-category-nature',
    experiences: 'text-category-experiences',
    events:      'text-category-events',
  }
  return map[slug] ?? 'text-insu-muted'
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts lib/utils.ts
git commit -m "feat: add PricingHistoryRow, ContractDetailData types and categoryTextClass util"
```

---

## Task 3: Seed Pricing History Migration

**Files:**
- Create: `supabase/migrations/20260512000001_seed_pricing_history.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260512000001_seed_pricing_history.sql
-- Insert one initial pricing history row per coverage tier using current premium values.
-- This gives the SP2 chart at least one data point per tier before the SP3 pricing engine runs.
INSERT INTO pricing_history (contract_id, tier_id, bs_inputs, bs_output, premium_usd_before, premium_usd_after, calculated_at)
SELECT
  t.contract_id,
  t.id,
  '{}'::jsonb,
  '{}'::jsonb,
  t.premium_usd,
  t.premium_usd,
  now()
FROM coverage_tiers t;
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push
```

Expected output includes: `Applying migration 20260512000001_seed_pricing_history.sql`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260512000001_seed_pricing_history.sql
git commit -m "feat: seed pricing_history with initial data points from coverage_tiers"
```

---

## Task 4: ContractMeta Component (TDD)

**Files:**
- Create: `tests/components/ContractMeta.test.tsx`
- Create: `components/markets/ContractMeta.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/ContractMeta.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ContractMeta from '@/components/markets/ContractMeta'
import type { ContractWithTiers } from '@/lib/types'

const mockContract: ContractWithTiers = {
  id: 'abc-123',
  slug: 'power-outage-cdmx',
  title: 'Power outage in CDMX?',
  description: null,
  category_id: 'cat-1',
  category: { id: 'cat-1', name: 'Urban', slug: 'urban', color: '#94a3b8', icon_url: null, display_order: 1 },
  status: 'active',
  trigger_type: 'manual',
  trigger_condition: { description: 'Power outage > 2 hours' },
  trigger_deadline: '2026-06-30T23:59:59Z',
  location: { lat: 19.4, lng: -99.1, city: 'CDMX', country: 'MX' },
  icon_url: null,
  total_volume_usd: 50000,
  total_volume_mxn: 0,
  is_featured: false,
  settled_outcome: null,
  created_by: 'admin',
  created_at: '2026-01-01T00:00:00Z',
  settled_at: null,
  coverage_tiers: [],
}

describe('ContractMeta', () => {
  it('renders trigger type label', () => {
    render(<ContractMeta contract={mockContract} />)
    expect(screen.getByText('Manual')).toBeInTheDocument()
  })

  it('renders trigger condition description', () => {
    render(<ContractMeta contract={mockContract} />)
    expect(screen.getByText('Power outage > 2 hours')).toBeInTheDocument()
  })

  it('renders location city and country', () => {
    render(<ContractMeta contract={mockContract} />)
    expect(screen.getByText('CDMX, MX')).toBeInTheDocument()
  })

  it('renders formatted volume', () => {
    render(<ContractMeta contract={mockContract} />)
    expect(screen.getByText('$50k')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- --run tests/components/ContractMeta.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/markets/ContractMeta'"

- [ ] **Step 3: Implement ContractMeta**

```tsx
// components/markets/ContractMeta.tsx
import { formatVolume } from '@/lib/utils'
import type { ContractWithTiers } from '@/lib/types'

interface Props {
  contract: ContractWithTiers
}

const TRIGGER_LABELS: Record<string, string> = {
  weather: 'Weather',
  urban:   'Urban event',
  event:   'Event cancellation',
  manual:  'Manual',
}

export default function ContractMeta({ contract }: Props) {
  const deadline = new Date(contract.trigger_deadline).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
  const condition = contract.trigger_condition as Record<string, unknown>
  const conditionText = (condition.description as string) ?? JSON.stringify(condition)
  const { city, country } = contract.location

  return (
    <dl className="space-y-3 rounded-card border border-white/[0.07] bg-bg-card p-5 text-[13px]">
      {[
        ['Trigger type',  TRIGGER_LABELS[contract.trigger_type] ?? contract.trigger_type],
        ['Condition',     conditionText],
        ['Deadline',      deadline],
        ['Location',      `${city}, ${country}`],
        ['Total volume',  formatVolume(contract.total_volume_usd)],
      ].map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <dt className="text-insu-muted">{label}</dt>
          <dd className="text-right font-medium text-insu-text">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- --run tests/components/ContractMeta.test.tsx
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/components/ContractMeta.test.tsx components/markets/ContractMeta.tsx
git commit -m "feat: ContractMeta component with trigger, deadline, location, volume"
```

---

## Task 5: TierSelector Component (TDD)

**Files:**
- Create: `tests/components/TierSelector.test.tsx`
- Create: `components/markets/TierSelector.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/TierSelector.test.tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import TierSelector from '@/components/markets/TierSelector'
import type { CoverageTier } from '@/lib/types'

const tiers: CoverageTier[] = [
  {
    id: 'tier-basic',
    contract_id: 'c1',
    name: 'basic',
    premium_usd: 12,
    payout_usd: 500,
    premium_mxn: 204,
    payout_mxn: 8500,
    max_capacity_usd: 100000,
    current_capacity_usd: 0,
    base_probability: 0.1,
    last_priced_at: null,
    pricing_inputs: null,
  },
  {
    id: 'tier-premium',
    contract_id: 'c1',
    name: 'premium',
    premium_usd: 38,
    payout_usd: 2000,
    premium_mxn: 646,
    payout_mxn: 34000,
    max_capacity_usd: 100000,
    current_capacity_usd: 0,
    base_probability: 0.1,
    last_priced_at: null,
    pricing_inputs: null,
  },
]

describe('TierSelector', () => {
  it('renders both tier names', () => {
    render(<TierSelector tiers={tiers} selectedTierId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Basic')).toBeInTheDocument()
    expect(screen.getByText('Premium')).toBeInTheDocument()
  })

  it('shows selected indicator on selected tier', () => {
    render(<TierSelector tiers={tiers} selectedTierId="tier-basic" onSelect={vi.fn()} />)
    expect(screen.getByText('✓ Selected')).toBeInTheDocument()
  })

  it('calls onSelect with tier id when clicked', async () => {
    const onSelect = vi.fn()
    render(<TierSelector tiers={tiers} selectedTierId={null} onSelect={onSelect} />)
    await userEvent.click(screen.getAllByRole('button')[1]) // second button = Premium
    expect(onSelect).toHaveBeenCalledWith('tier-premium')
  })

  it('shows capacity remaining in provide mode', () => {
    render(<TierSelector tiers={tiers} selectedTierId={null} onSelect={vi.fn()} mode="provide" />)
    expect(screen.getAllByText(/capacity remaining/i).length).toBeGreaterThan(0)
  })

  it('disables full tier', () => {
    const fullTiers = [{ ...tiers[0], current_capacity_usd: 100000 }]
    render(<TierSelector tiers={fullTiers} selectedTierId={null} onSelect={vi.fn()} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- --run tests/components/TierSelector.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/markets/TierSelector'"

- [ ] **Step 3: Implement TierSelector**

```tsx
// components/markets/TierSelector.tsx
'use client'

import { cn, formatCurrency } from '@/lib/utils'
import type { CoverageTier, CoverageLevel } from '@/lib/types'

interface Props {
  tiers: CoverageTier[]
  selectedTierId: string | null
  onSelect: (tierId: string) => void
  mode?: 'buy' | 'provide'
}

const TIER_LABELS: Record<CoverageLevel, string> = {
  basic:   'Basic',
  premium: 'Premium',
}

export default function TierSelector({ tiers, selectedTierId, onSelect, mode = 'buy' }: Props) {
  const sorted = [...tiers].sort((a, b) => (a.name === 'basic' ? -1 : b.name === 'basic' ? 1 : 0))

  return (
    <div className="space-y-2">
      {sorted.map((tier) => {
        const isSelected = tier.id === selectedTierId
        const remaining = tier.max_capacity_usd - tier.current_capacity_usd
        const isFull = remaining <= 0

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
                <span className="text-insu-text">{formatCurrency(tier.premium_usd, 'USD')}</span>
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

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- --run tests/components/TierSelector.test.tsx
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/components/TierSelector.test.tsx components/markets/TierSelector.tsx
git commit -m "feat: TierSelector component with buy/provide modes and capacity check"
```

---

## Task 6: AuthGate Component (TDD)

**Files:**
- Create: `tests/components/AuthGate.test.tsx`
- Create: `components/markets/AuthGate.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/AuthGate.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import AuthGate from '@/components/markets/AuthGate'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

describe('AuthGate', () => {
  it('renders sign-in message', () => {
    render(<AuthGate next="/markets/power-outage-cdmx" />)
    expect(screen.getByText(/sign in to buy/i)).toBeInTheDocument()
  })

  it('renders sign-in link with encoded next param', () => {
    render(<AuthGate next="/markets/power-outage-cdmx" />)
    const link = screen.getByRole('link', { name: /sign in/i })
    expect(link).toHaveAttribute(
      'href',
      '/auth/login?next=%2Fmarkets%2Fpower-outage-cdmx'
    )
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- --run tests/components/AuthGate.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/markets/AuthGate'"

- [ ] **Step 3: Implement AuthGate**

```tsx
// components/markets/AuthGate.tsx
import Link from 'next/link'

interface Props {
  next: string
}

export default function AuthGate({ next }: Props) {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <p className="text-[14px] text-insu-muted">
        Sign in to buy protection or provide capital.
      </p>
      <Link
        href={`/auth/login?next=${encodeURIComponent(next)}`}
        className="rounded-lg bg-insu-accent px-6 py-2.5 text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a]"
      >
        Sign in
      </Link>
    </div>
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- --run tests/components/AuthGate.test.tsx
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/components/AuthGate.test.tsx components/markets/AuthGate.tsx
git commit -m "feat: AuthGate component with sign-in link and next param"
```

---

## Task 7: PriceChart Component

**Files:**
- Create: `components/markets/PriceChart.tsx`

- [ ] **Step 1: Implement PriceChart**

```tsx
// components/markets/PriceChart.tsx
'use client'

import { AreaChart } from '@tremor/react'
import type { CoverageTier, PricingHistoryRow } from '@/lib/types'

interface ChartPoint {
  date: string
  Basic?: number
  Premium?: number
}

function buildChartData(history: PricingHistoryRow[], tiers: CoverageTier[]): ChartPoint[] {
  const byDate = new Map<string, ChartPoint>()

  history.forEach((row) => {
    const date = row.calculated_at.split('T')[0]
    const tier = tiers.find((t) => t.id === row.tier_id)
    if (!tier) return
    if (!byDate.has(date)) byDate.set(date, { date })
    const label = tier.name === 'basic' ? 'Basic' : 'Premium'
    byDate.get(date)![label] = row.premium_usd_after
  })

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

interface Props {
  history: PricingHistoryRow[]
  tiers: CoverageTier[]
}

export default function PriceChart({ history, tiers }: Props) {
  const data = buildChartData(history, tiers)

  if (data.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-card border border-white/[0.07] bg-bg-card text-[13px] text-insu-muted">
        No pricing history yet
      </div>
    )
  }

  return (
    <div className="dark rounded-card border border-white/[0.07] bg-bg-card p-5">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-insu-muted">
        Premium history
      </p>
      <AreaChart
        data={data}
        index="date"
        categories={['Basic', 'Premium']}
        colors={['amber', 'violet']}
        valueFormatter={(v) => `$${v}`}
        showLegend
        showGridLines={false}
        className="h-[160px]"
      />
    </div>
  )
}
```

Note: the `dark` class on the wrapper activates Tremor's dark-mode styles so the chart text is visible on the dark background.

- [ ] **Step 2: Run full test suite to check for regressions**

```bash
npm test -- --run
```

Expected: all existing tests still pass (PriceChart has no dedicated unit test — Tremor charts require a real browser for meaningful assertions; the component is covered by the E2E test in Task 13).

- [ ] **Step 3: Commit**

```bash
git add components/markets/PriceChart.tsx
git commit -m "feat: PriceChart component with Tremor AreaChart"
```

---

## Task 8: PurchasePanel Component (TDD)

**Files:**
- Create: `tests/components/PurchasePanel.test.tsx`
- Create: `components/markets/PurchasePanel.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/PurchasePanel.test.tsx
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
  trigger_deadline: '2026-06-30T23:59:59Z',
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
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- --run tests/components/PurchasePanel.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/markets/PurchasePanel'"

- [ ] **Step 3: Implement PurchasePanel**

```tsx
// components/markets/PurchasePanel.tsx
'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { ContractWithTiers } from '@/lib/types'
import TierSelector from './TierSelector'
import AuthGate from './AuthGate'
import StripePaymentForm from './StripePaymentForm'
import { createHedgerPaymentIntent, createProviderPaymentIntent } from '@/lib/actions/purchase'

type PanelMode = 'buy' | 'provide'
type Step = 'select' | 'payment' | 'done'

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
  const [depositAmount, setDepositAmount] = useState('')
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedTier = contract.coverage_tiers.find((t) => t.id === selectedTierId)

  function switchMode(next: PanelMode) {
    setMode(next)
    setSelectedTierId(null)
    setStep('select')
    setClientSecret(null)
    setError(null)
  }

  function handleClose() {
    setStep('select')
    setSelectedTierId(null)
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
        ? await createHedgerPaymentIntent(selectedTierId)
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
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-insu-muted">
                    Select tier
                  </p>
                  <TierSelector
                    tiers={contract.coverage_tiers}
                    selectedTierId={selectedTierId}
                    onSelect={setSelectedTierId}
                    mode={mode}
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
                  amountUsd={mode === 'buy' ? selectedTier.premium_usd : parseFloat(depositAmount)}
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

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- --run tests/components/PurchasePanel.test.tsx
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/components/PurchasePanel.test.tsx components/markets/PurchasePanel.tsx
git commit -m "feat: PurchasePanel slide-over with buy/provide mode toggle and auth gate"
```

---

## Task 9: StripePaymentForm Component

**Files:**
- Create: `tests/components/StripePaymentForm.test.tsx`
- Create: `components/markets/StripePaymentForm.tsx`

- [ ] **Step 1: Write the test**

```tsx
// tests/components/StripePaymentForm.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import StripePaymentForm from '@/components/markets/StripePaymentForm'

vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn().mockResolvedValue(null) }))
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CardElement: () => <div data-testid="card-element" />,
  useStripe: () => null,
  useElements: () => null,
}))

describe('StripePaymentForm', () => {
  it('renders the pay button with formatted amount', () => {
    render(
      <StripePaymentForm clientSecret="pi_secret" amountUsd={38} onSuccess={vi.fn()} onError={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: /pay \$38/i })).toBeInTheDocument()
  })

  it('disables pay button when stripe is not loaded', () => {
    render(
      <StripePaymentForm clientSecret="pi_secret" amountUsd={38} onSuccess={vi.fn()} onError={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: /pay/i })).toBeDisabled()
  })

  it('renders the card element', () => {
    render(
      <StripePaymentForm clientSecret="pi_secret" amountUsd={38} onSuccess={vi.fn()} onError={vi.fn()} />
    )
    expect(screen.getByTestId('card-element')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- --run tests/components/StripePaymentForm.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/markets/StripePaymentForm'"

- [ ] **Step 3: Implement StripePaymentForm**

```tsx
// components/markets/StripePaymentForm.tsx
'use client'

import { useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

const CARD_STYLE = {
  style: {
    base: {
      color: '#e8edf5',
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: '14px',
      '::placeholder': { color: '#5a6580' },
    },
    invalid: { color: '#f87171' },
  },
}

interface FormProps {
  clientSecret: string
  amountUsd: number
  onSuccess: () => void
  onError: (msg: string) => void
}

function CardPaymentForm({ clientSecret, amountUsd, onSuccess, onError }: FormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setLoading(true)

    const card = elements.getElement(CardElement)
    if (!card) { setLoading(false); return }

    const { error } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card },
    })

    setLoading(false)
    if (error) {
      onError(error.message ?? 'Payment failed')
    } else {
      onSuccess()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-insu-muted">
          Card details
        </label>
        <div className="rounded-lg border border-white/[0.07] bg-bg px-4 py-3">
          <CardElement options={CARD_STYLE} />
        </div>
      </div>
      <button
        type="submit"
        disabled={!stripe || loading}
        className="w-full rounded-lg bg-insu-accent py-3 text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a] disabled:opacity-40"
      >
        {loading ? 'Processing…' : `Pay $${amountUsd.toLocaleString()}`}
      </button>
    </form>
  )
}

interface Props {
  clientSecret: string
  amountUsd: number
  onSuccess: () => void
  onError: (msg: string) => void
}

export default function StripePaymentForm(props: Props) {
  return (
    <Elements stripe={stripePromise}>
      <CardPaymentForm {...props} />
    </Elements>
  )
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- --run tests/components/StripePaymentForm.test.tsx
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add tests/components/StripePaymentForm.test.tsx components/markets/StripePaymentForm.tsx
git commit -m "feat: StripePaymentForm with Stripe Elements CardElement"
```

---

## Task 10: Server Actions

**Files:**
- Create: `lib/actions/purchase.ts`
- Create: `tests/lib/purchase.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/purchase.test.ts
import { describe, it, expect } from 'vitest'
import { validateCapacity } from '@/lib/actions/purchase'

describe('validateCapacity', () => {
  it('returns null when capacity is available', () => {
    expect(validateCapacity(100000, 50000, 500)).toBeNull()
  })

  it('returns error when tier is full', () => {
    expect(validateCapacity(100000, 100000, 100)).toMatch(/at capacity/)
  })

  it('returns error when requested amount exceeds remaining', () => {
    expect(validateCapacity(100000, 95000, 10000)).toMatch(/Maximum available/)
  })

  it('returns null when amount equals exactly remaining capacity', () => {
    expect(validateCapacity(100000, 95000, 5000)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npm test -- --run tests/lib/purchase.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/actions/purchase'"

- [ ] **Step 3: Implement lib/actions/purchase.ts**

```ts
// lib/actions/purchase.ts
'use server'

import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? 'sk_test_placeholder', {
  apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
})

export function validateCapacity(
  maxCapacity: number,
  currentCapacity: number,
  requestedAmount: number,
): string | null {
  const remaining = maxCapacity - currentCapacity
  if (remaining <= 0) return 'This tier is at capacity'
  if (requestedAmount > remaining) return `Maximum available: $${remaining.toLocaleString()}`
  return null
}

export async function createHedgerPaymentIntent(
  tierId: string,
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
    .select('id, trigger_deadline')
    .eq('id', tier.contract_id)
    .single()

  if (contractError || !contract) return { error: 'Contract not found' }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(Number(tier.premium_usd) * 100),
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
      premium_paid_usd: tier.premium_usd,
      payout_amount_usd: tier.payout_usd,
      premium_paid_mxn: tier.premium_mxn,
      payout_amount_mxn: tier.payout_mxn,
      currency: 'USD',
      payment_provider: 'stripe',
      payment_intent_id: paymentIntent.id,
      status: 'pending_payment',
      expires_at: contract.trigger_deadline,
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

- [ ] **Step 4: Run test — expect PASS**

```bash
npm test -- --run tests/lib/purchase.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/actions/purchase.ts tests/lib/purchase.test.ts
git commit -m "feat: Server Actions createHedgerPaymentIntent + createProviderPaymentIntent"
```

---

## Task 11: Contract Detail Page

**Files:**
- Create: `app/markets/[slug]/page.tsx`
- Create: `app/markets/[slug]/loading.tsx`
- Create: `components/markets/ContractDetailClient.tsx`

- [ ] **Step 1: Create the server page**

```tsx
// app/markets/[slug]/page.tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import ContractDetailClient from '@/components/markets/ContractDetailClient'
import type { ContractDetailData } from '@/lib/types'

export default async function MarketPage({ params }: { params: { slug: string } }) {
  const isConfigured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  if (!isConfigured) notFound()

  const supabase = createClient()

  const [contractResult, userResult] = await Promise.all([
    supabase
      .from('contracts')
      .select(`
        *,
        category:categories(*),
        coverage_tiers(*),
        pricing_history(id, tier_id, premium_usd_after, calculated_at)
      `)
      .eq('slug', params.slug)
      .in('status', ['active', 'settled'])
      .single(),
    supabase.auth.getUser(),
  ])

  if (contractResult.error || !contractResult.data) notFound()

  const contract = contractResult.data as unknown as ContractDetailData
  const userId = userResult.data.user?.id ?? null

  return (
    <>
      <Header />
      <ContractDetailClient contract={contract} userId={userId} />
    </>
  )
}
```

- [ ] **Step 2: Create the loading skeleton**

```tsx
// app/markets/[slug]/loading.tsx
export default function Loading() {
  return (
    <main className="mx-auto max-w-[1320px] px-8 py-10">
      <div className="grid grid-cols-[1fr_360px] gap-8">
        <div className="space-y-5">
          <div className="h-6 w-40 animate-pulse rounded-lg bg-white/5" />
          <div className="h-8 w-3/4 animate-pulse rounded-lg bg-white/5" />
          <div className="h-[220px] animate-pulse rounded-card bg-white/5" />
          <div className="h-[160px] animate-pulse rounded-card bg-white/5" />
        </div>
        <div className="space-y-3">
          <div className="h-[96px] animate-pulse rounded-card bg-white/5" />
          <div className="h-[96px] animate-pulse rounded-card bg-white/5" />
          <div className="h-12 animate-pulse rounded-lg bg-white/5" />
          <div className="h-12 animate-pulse rounded-lg bg-white/5" />
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Create ContractDetailClient**

```tsx
// components/markets/ContractDetailClient.tsx
'use client'

import { useState } from 'react'
import { cn, formatCurrency, categoryTextClass } from '@/lib/utils'
import type { ContractDetailData } from '@/lib/types'
import ContractMeta from './ContractMeta'
import PriceChart from './PriceChart'
import PurchasePanel from './PurchasePanel'

type PanelMode = 'buy' | 'provide'

interface Props {
  contract: ContractDetailData
  userId: string | null
}

export default function ContractDetailClient({ contract, userId }: Props) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelMode, setPanelMode] = useState<PanelMode>('buy')

  const slug = contract.category.slug
  const sortedTiers = [...contract.coverage_tiers].sort((a, b) =>
    a.name === 'basic' ? -1 : b.name === 'basic' ? 1 : 0,
  )

  function openPanel(mode: PanelMode) {
    setPanelMode(mode)
    setPanelOpen(true)
  }

  return (
    <main className="mx-auto max-w-[1320px] px-8 py-10">
      <div className="grid grid-cols-[1fr_360px] items-start gap-8">
        {/* Left column */}
        <div className="space-y-5">
          <div>
            <span className={cn('text-[11px] font-bold uppercase tracking-[0.12em]', categoryTextClass(slug))}>
              {contract.category.name}
            </span>
            <h1 className="mt-1 text-[24px] font-semibold leading-snug text-insu-text">
              {contract.title}
            </h1>
            {contract.description && (
              <p className="mt-2 text-[14px] text-insu-muted">{contract.description}</p>
            )}
          </div>

          <PriceChart history={contract.pricing_history} tiers={contract.coverage_tiers} />

          <ContractMeta contract={contract} />
        </div>

        {/* Right column — sticky */}
        <div className="sticky top-[80px] space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-insu-muted">
            Select tier
          </p>

          <div className="space-y-2">
            {sortedTiers.map((tier) => (
              <div
                key={tier.id}
                className="rounded-card border border-white/[0.07] bg-bg-card p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold capitalize text-insu-text">
                    {tier.name}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1 font-mono text-[12px]">
                  <span className="text-insu-text">{formatCurrency(tier.premium_usd, 'USD')}</span>
                  <span className="text-insu-muted">→</span>
                  <span className="text-insu-green">{formatCurrency(tier.payout_usd, 'USD')}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2 pt-1">
            <button
              onClick={() => openPanel('buy')}
              className="w-full rounded-lg bg-insu-accent py-3 text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a]"
            >
              Buy Protection
            </button>
            <button
              onClick={() => openPanel('provide')}
              className="w-full rounded-lg border border-white/[0.07] bg-bg-card py-3 text-[14px] font-semibold text-insu-text transition-all hover:border-white/15"
            >
              Provide Capital
            </button>
          </div>
        </div>
      </div>

      <PurchasePanel
        contract={contract}
        userId={userId}
        open={panelOpen}
        initialMode={panelMode}
        onClose={() => setPanelOpen(false)}
      />
    </main>
  )
}
```

- [ ] **Step 4: Start the dev server and verify the page renders**

```bash
npm run dev
```

Visit `http://localhost:3000/markets/<any-slug-from-seed>`. Example slugs seeded in SP1: check `scripts/seed.ts` or Supabase dashboard for contract slugs.

Verify: left/right split renders, chart shows, meta data renders, Buy/Provide buttons open the slide-over panel.

- [ ] **Step 5: Commit**

```bash
git add app/markets components/markets/ContractDetailClient.tsx
git commit -m "feat: contract detail page — left/right split, price chart, purchase panel"
```

---

## Task 12: Stripe Webhook Edge Function

**Files:**
- Create: `supabase/functions/stripe-webhook/index.ts`

- [ ] **Step 1: Create the Edge Function**

```ts
// supabase/functions/stripe-webhook/index.ts
import Stripe from 'https://esm.sh/stripe@15?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  // @ts-ignore — Deno-compatible http client
  httpClient: Stripe.createFetchHttpClient(),
  apiVersion: '2024-06-20',
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const signature = req.headers.get('stripe-signature')
  if (!signature) return new Response('Missing stripe-signature', { status: 400 })

  const body = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
    )
  } catch (err) {
    return new Response(`Webhook error: ${(err as Error).message}`, { status: 400 })
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent
    const { position_type, position_id } = pi.metadata ?? {}

    if (!position_id || !position_type) {
      return new Response('Missing metadata', { status: 400 })
    }

    if (position_type === 'hedger') {
      const { data: position } = await supabase
        .from('hedger_positions')
        .update({ status: 'active' })
        .eq('id', position_id)
        .select('tier_id, premium_paid_usd, contract_id')
        .single()

      if (position) {
        // Increment tier capacity and contract volume
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
      }
    } else if (position_type === 'provider') {
      await supabase
        .from('provider_positions')
        .update({ status: 'active' })
        .eq('id', position_id)
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

- [ ] **Step 2: Set Stripe secrets in Supabase**

```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_your_key_here
npx supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_your_secret_here
```

- [ ] **Step 3: Deploy the Edge Function**

```bash
npx supabase functions deploy stripe-webhook
```

Expected: Function deployed at `https://eagmczieznsogsxldedk.supabase.co/functions/v1/stripe-webhook`

- [ ] **Step 4: Register webhook in Stripe dashboard**

Go to Stripe Dashboard → Developers → Webhooks → Add endpoint.
- URL: `https://eagmczieznsogsxldedk.supabase.co/functions/v1/stripe-webhook`
- Events: select `payment_intent.succeeded`
- Copy the signing secret into `STRIPE_WEBHOOK_SECRET` in `.env.local` and run `supabase secrets set` again with the real value.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "feat: Stripe webhook Edge Function — marks positions active on payment_intent.succeeded"
```

---

## Task 13: E2E Smoke Test for Markets Page

**Files:**
- Create: `tests/e2e/markets.spec.ts`

- [ ] **Step 1: Write the E2E test**

```ts
// tests/e2e/markets.spec.ts
import { test, expect } from '@playwright/test'

// These tests require the dev server running (npm run dev) and
// a seeded Supabase database with at least one active contract.
// Run with: npx playwright test tests/e2e/markets.spec.ts

test('contract detail page renders key elements', async ({ page }) => {
  // Get the slug from the browse page first
  await page.goto('/')
  const firstCard = page.locator('article').first()
  await firstCard.click()

  // Should navigate to /markets/[slug]
  await expect(page).toHaveURL(/\/markets\//)

  // Category badge
  await expect(page.locator('main span').first()).toBeVisible()

  // Contract title (h1)
  await expect(page.locator('h1')).toBeVisible()

  // Action buttons
  await expect(page.getByRole('button', { name: /buy protection/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /provide capital/i })).toBeVisible()
})

test('purchase panel opens on Buy Protection click', async ({ page }) => {
  await page.goto('/')
  await page.locator('article').first().click()
  await page.waitForURL(/\/markets\//)

  await page.getByRole('button', { name: /buy protection/i }).click()

  // Panel should be visible
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('purchase panel shows auth gate when not logged in', async ({ page }) => {
  await page.goto('/')
  await page.locator('article').first().click()
  await page.waitForURL(/\/markets\//)

  await page.getByRole('button', { name: /buy protection/i }).click()

  // Auth gate sign-in link
  await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible()
})

test('purchase panel closes on backdrop click', async ({ page }) => {
  await page.goto('/')
  await page.locator('article').first().click()
  await page.waitForURL(/\/markets\//)

  await page.getByRole('button', { name: /buy protection/i }).click()
  await expect(page.getByRole('dialog')).toBeVisible()

  // Click backdrop (left of the panel)
  await page.mouse.click(100, 300)
  await expect(page.getByRole('dialog')).not.toBeVisible()
})
```

- [ ] **Step 2: Run the E2E tests**

```bash
npx playwright test tests/e2e/markets.spec.ts
```

Expected: all 4 tests PASS (requires dev server running and seeded DB).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/markets.spec.ts
git commit -m "test: E2E smoke tests for contract detail page and purchase panel"
```

---

## Task 14: Full Test Suite + TypeScript Check

**Files:** None new — verification only.

- [ ] **Step 1: Run all unit tests**

```bash
npm test -- --run
```

Expected: all tests PASS with 0 failures.

- [ ] **Step 2: Fix any failures before continuing**

If any test fails, fix the root cause. Do not skip or comment out tests.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve test failures and TypeScript errors from SP2 integration"
```

If no fixes were needed, skip this step.
