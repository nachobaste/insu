# Oracle Conditions UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface live oracle readings as a "Current conditions" block on the contract detail page, between the price chart and contract meta section.

**Architecture:** Pure display component `OracleConditions` receives a `LatestOracleReading` and renders with one of three color states based on proximity to trigger threshold. The server component (`page.tsx`) fetches the latest reading sequentially after the contract query, then passes it down to the client component.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, Vitest + @testing-library/react, Supabase JS

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `lib/types.ts` | Add `LatestOracleReading` interface |
| Create | `components/markets/OracleConditions.tsx` | Pure display component — all proximity/state logic |
| Create | `tests/components/OracleConditions.test.tsx` | 9 unit tests |
| Modify | `app/markets/[slug]/page.tsx` | Sequential oracle reading query + prop pass-through |
| Modify | `components/markets/ContractDetailClient.tsx` | Accept `latestReading` prop, render `OracleConditions` |

---

### Task 1: `LatestOracleReading` type + `OracleConditions` component

**Files:**
- Modify: `lib/types.ts`
- Create: `components/markets/OracleConditions.tsx`
- Create: `tests/components/OracleConditions.test.tsx`

- [ ] **Step 1: Add `LatestOracleReading` to `lib/types.ts`**

Open `lib/types.ts` and append after the existing `OracleReading` interface (around line 124):

```ts
export interface LatestOracleReading {
  value: Record<string, unknown>
  read_at: string
  source: string
  trigger_met: boolean
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/components/OracleConditions.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import OracleConditions from '@/components/markets/OracleConditions'
import type { LatestOracleReading } from '@/lib/types'
import type { TriggerCondition } from '@/lib/oracle/trigger'

const gteCondition: TriggerCondition = { metric: 'temp_c', threshold: 35, operator: 'gte' }
const lteCondition: TriggerCondition = { metric: 'temp_c', threshold: 20, operator: 'lte' }

function makeReading(overrides: Partial<LatestOracleReading> = {}): LatestOracleReading {
  return {
    value: { temp_c: 28.5 },
    read_at: new Date(Date.now() - 14 * 60000).toISOString(),
    source: 'openweathermap',
    trigger_met: false,
    ...overrides,
  }
}

describe('OracleConditions', () => {
  it('renders metric value and threshold label for gte', () => {
    render(<OracleConditions reading={makeReading()} triggerCondition={gteCondition} oracleMultiplier={1.34} />)
    expect(screen.getByText('28.5')).toBeInTheDocument()
    expect(screen.getByText(/Triggers at ≥ 35/)).toBeInTheDocument()
  })

  it('displays correct proximity % for gte', () => {
    // 28.5 / 35 ≈ 0.814 → 81%
    render(<OracleConditions reading={makeReading()} triggerCondition={gteCondition} oracleMultiplier={1.34} />)
    expect(screen.getByText('81% to trigger')).toBeInTheDocument()
  })

  it('displays correct proximity % for lte', () => {
    // threshold/actual = 20/40 = 0.5 → 50%
    render(
      <OracleConditions
        reading={makeReading({ value: { temp_c: 40 } })}
        triggerCondition={lteCondition}
        oracleMultiplier={0.7}
      />,
    )
    expect(screen.getByText('50% to trigger')).toBeInTheDocument()
  })

  it('shows "Premium elevated" and impact for multiplier 1.34', () => {
    // 28.5 / 35 = 81% → elevated state
    render(<OracleConditions reading={makeReading()} triggerCondition={gteCondition} oracleMultiplier={1.34} />)
    expect(screen.getByText('Premium elevated')).toBeInTheDocument()
    expect(screen.getByText('+34% vs baseline')).toBeInTheDocument()
  })

  it('shows "Premium discounted" and impact for multiplier 0.7', () => {
    // 9.8 / 35 = 28% → low state
    render(
      <OracleConditions
        reading={makeReading({ value: { temp_c: 9.8 } })}
        triggerCondition={gteCondition}
        oracleMultiplier={0.7}
      />,
    )
    expect(screen.getByText('Premium discounted')).toBeInTheDocument()
    expect(screen.getByText('-30% vs baseline')).toBeInTheDocument()
  })

  it('hides price impact line when oracleMultiplier === 1.0', () => {
    render(<OracleConditions reading={makeReading()} triggerCondition={gteCondition} oracleMultiplier={1.0} />)
    expect(screen.queryByText(/vs baseline/)).not.toBeInTheDocument()
  })

  it('shows trigger-met state when trigger_met is true', () => {
    render(
      <OracleConditions
        reading={makeReading({ trigger_met: true })}
        triggerCondition={gteCondition}
        oracleMultiplier={3.0}
      />,
    )
    expect(screen.getByText('⚡ Trigger threshold crossed')).toBeInTheDocument()
    expect(screen.getByText('Premium at maximum')).toBeInTheDocument()
  })

  it('returns null when metric key missing from reading value', () => {
    const { container } = render(
      <OracleConditions
        reading={makeReading({ value: {} })}
        triggerCondition={gteCondition}
        oracleMultiplier={1.0}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('applies °C unit label for temp_c metric', () => {
    render(<OracleConditions reading={makeReading()} triggerCondition={gteCondition} oracleMultiplier={1.0} />)
    expect(screen.getByText('°C')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx vitest run tests/components/OracleConditions.test.tsx
```

Expected: all 9 tests fail with "Cannot find module '@/components/markets/OracleConditions'".

- [ ] **Step 4: Implement `OracleConditions.tsx`**

Create `components/markets/OracleConditions.tsx`:

```tsx
import type { LatestOracleReading } from '@/lib/types'
import type { TriggerCondition } from '@/lib/oracle/trigger'

const METRIC_UNITS: Record<string, string> = {
  temp_c: '°C',
  temp_f: '°F',
  rain_mm: 'mm',
  wind_kmh: 'km/h',
  jam_factor: '',
}

const SOURCE_LABELS: Record<string, string> = {
  openweathermap: 'OpenWeatherMap',
  tomorrow_io: 'Tomorrow.io',
  waze: 'Waze',
}

const OPERATOR_LABELS: Record<TriggerCondition['operator'], string> = {
  gte: '≥',
  lte: '≤',
  gt: '>',
  lt: '<',
}

type State = 'low' | 'elevated' | 'met'

const STATE_CONFIG: Record<State, { text: string; bar: string; border: string; dot: string; label: string }> = {
  low: {
    text: 'text-insu-green',
    bar: 'bg-insu-green',
    border: 'border-insu-green/10',
    dot: 'bg-insu-green',
    label: 'Premium discounted',
  },
  elevated: {
    text: 'text-insu-accent',
    bar: 'bg-gradient-to-r from-insu-green to-insu-accent',
    border: 'border-insu-accent/20',
    dot: 'bg-insu-accent',
    label: 'Premium elevated',
  },
  met: {
    text: 'text-red-400',
    bar: 'bg-red-500',
    border: 'border-red-500/20',
    dot: 'bg-red-500',
    label: 'Premium at maximum',
  },
}

function formatAge(readAt: string): string {
  const minsAgo = Math.floor((Date.now() - new Date(readAt).getTime()) / 60000)
  return minsAgo < 60 ? `${minsAgo} min ago` : `${Math.floor(minsAgo / 60)} h ago`
}

interface Props {
  reading: LatestOracleReading
  triggerCondition: TriggerCondition
  oracleMultiplier: number
}

export default function OracleConditions({ reading, triggerCondition, oracleMultiplier }: Props) {
  const actual = reading.value[triggerCondition.metric]
  if (typeof actual !== 'number' || !isFinite(actual)) return null

  const proximity =
    triggerCondition.operator === 'gte' || triggerCondition.operator === 'gt'
      ? actual / triggerCondition.threshold
      : triggerCondition.threshold / actual

  const state: State =
    reading.trigger_met || proximity >= 1.0 ? 'met' : proximity >= 0.6 ? 'elevated' : 'low'
  const displayPct = Math.min(100, Math.round(proximity * 100))
  const impactPct = Math.round((oracleMultiplier - 1) * 100)
  const cfg = STATE_CONFIG[state]

  const unit = METRIC_UNITS[triggerCondition.metric] ?? ''
  const sourceName = SOURCE_LABELS[reading.source] ?? reading.source
  const operatorLabel = OPERATOR_LABELS[triggerCondition.operator]

  return (
    <div className={`rounded-[10px] border bg-bg-card p-[14px_16px] ${cfg.border}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-insu-muted">
          Current conditions
        </span>
        <span className="text-[9px] text-insu-muted/60">
          {sourceName} · {formatAge(reading.read_at)}
        </span>
      </div>

      <div className="mb-2.5 flex items-end gap-2.5">
        <span className={`text-[26px] font-bold leading-none ${cfg.text}`}>
          {actual.toFixed(1)}
        </span>
        <div className="mb-0.5">
          {unit && (
            <div className={`text-[13px] font-semibold leading-none ${cfg.text}`}>{unit}</div>
          )}
          <div className="text-[10px] text-insu-muted">
            Triggers at {operatorLabel} {triggerCondition.threshold}
            {unit ? ` ${unit}` : ''}
          </div>
        </div>
      </div>

      <div className="mb-2.5">
        <div className="mb-1 flex justify-between text-[9px] text-insu-muted">
          <span>Conditions now</span>
          <span className={cfg.text}>
            {state === 'met' ? '⚡ Trigger threshold crossed' : `${displayPct}% to trigger`}
          </span>
        </div>
        <div className="relative h-[5px] overflow-hidden rounded-full bg-white/5">
          <div
            className={`h-full rounded-full ${cfg.bar}`}
            style={{ width: `${state === 'met' ? 100 : displayPct}%` }}
          />
        </div>
      </div>

      {impactPct !== 0 && (
        <div className="flex items-center justify-between border-t border-white/5 pt-2.5">
          <div className="flex items-center gap-1.5">
            <div className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
            <span className="text-[10px] text-insu-muted">{cfg.label}</span>
          </div>
          <span className={`font-mono text-[12px] font-bold ${cfg.text}`}>
            {impactPct > 0 ? '+' : ''}
            {impactPct}% vs baseline
          </span>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run tests and verify they pass**

```bash
npx vitest run tests/components/OracleConditions.test.tsx
```

Expected: 9/9 PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts components/markets/OracleConditions.tsx tests/components/OracleConditions.test.tsx
git commit -m "feat: add OracleConditions component with LatestOracleReading type"
```

---

### Task 2: Wire page.tsx + ContractDetailClient

**Files:**
- Modify: `app/markets/[slug]/page.tsx`
- Modify: `components/markets/ContractDetailClient.tsx`

- [ ] **Step 1: Add sequential oracle query to `page.tsx`**

In `app/markets/[slug]/page.tsx`, after `const userId = userResult.data.user?.id ?? null`, add the oracle reading fetch. Also import `LatestOracleReading` and update the `ContractDetailClient` call.

Replace:
```ts
import type { ContractDetailData } from '@/lib/types'
```
With:
```ts
import type { ContractDetailData, LatestOracleReading } from '@/lib/types'
```

After `const userId = userResult.data.user?.id ?? null`, add:
```ts
const { data: latestReadingRaw } = await supabase
  .from('oracle_readings')
  .select('value, read_at, source, trigger_met')
  .eq('contract_id', contract.id)
  .order('read_at', { ascending: false })
  .limit(1)
  .maybeSingle()

const latestReading = latestReadingRaw as LatestOracleReading | null
```

Update the JSX return to pass `latestReading`:
```tsx
<ContractDetailClient contract={contract} userId={userId} latestReading={latestReading} />
```

The full updated file:
```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import ContractDetailClient from '@/components/markets/ContractDetailClient'
import type { ContractDetailData, LatestOracleReading } from '@/lib/types'

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contract = (contractResult as any).data as ContractDetailData
  const userId = userResult.data.user?.id ?? null

  const { data: latestReadingRaw } = await supabase
    .from('oracle_readings')
    .select('value, read_at, source, trigger_met')
    .eq('contract_id', contract.id)
    .order('read_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const latestReading = latestReadingRaw as LatestOracleReading | null

  return (
    <>
      <Header />
      <ContractDetailClient contract={contract} userId={userId} latestReading={latestReading} />
    </>
  )
}
```

- [ ] **Step 2: Update `ContractDetailClient.tsx` to accept and render oracle data**

Replace `components/markets/ContractDetailClient.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import { cn, formatCurrency, categoryTextClass, countryFlag } from '@/lib/utils'
import type { ContractDetailData, LatestOracleReading } from '@/lib/types'
import type { TriggerCondition } from '@/lib/oracle/trigger'
import ContractMeta from './ContractMeta'
import OracleConditions from './OracleConditions'
import PriceChart from './PriceChart'
import PurchasePanel from './PurchasePanel'

type PanelMode = 'buy' | 'provide'

interface Props {
  contract: ContractDetailData
  userId: string | null
  latestReading: LatestOracleReading | null
}

export default function ContractDetailClient({ contract, userId, latestReading }: Props) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelMode, setPanelMode] = useState<PanelMode>('buy')

  const slug = contract.category.slug
  const sortedTiers = [...contract.coverage_tiers].sort((a, b) =>
    a.name === 'basic' ? -1 : b.name === 'basic' ? 1 : 0,
  )

  const rawMultiplier = contract.coverage_tiers[0]?.pricing_inputs?.oracleMultiplier
  const oracleMultiplier = typeof rawMultiplier === 'number' ? rawMultiplier : 1.0

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
            {contract.location?.city && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-insu-muted">
                <span aria-hidden="true">{countryFlag(contract.location?.country ?? 'MX')}</span>
                <span>{contract.location.city}</span>
              </p>
            )}
            {contract.description && (
              <p className="mt-2 text-[14px] text-insu-muted">{contract.description}</p>
            )}
          </div>

          <PriceChart history={contract.pricing_history} tiers={contract.coverage_tiers} />

          {latestReading && (
            <OracleConditions
              reading={latestReading}
              triggerCondition={contract.trigger_condition as unknown as TriggerCondition}
              oracleMultiplier={oracleMultiplier}
            />
          )}

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

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run
```

Expected: all existing tests pass (no regressions), 9 new OracleConditions tests pass.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/markets/[slug]/page.tsx components/markets/ContractDetailClient.tsx
git commit -m "feat: wire oracle reading into contract detail page as current conditions block"
```
