# Corridor Instant Period Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Morning/Evening toggle on a traffic-corridor market detail page switch instantly (no page reload) by preloading both contracts and swapping client-side.

**Architecture:** The server page (`app/markets/[slug]/page.tsx`) fetches full data bundles for both periods when a sibling exists and hands them to a new client wrapper (`CorridorMarketView`) that holds the active-period state. The existing `CorridorPeriodSwitch` becomes a controlled toggle (buttons + `onSelect`). The URL is kept in sync via `window.history.replaceState` with no reload. Single-contract (non-corridor) pages are unchanged.

**Tech Stack:** Next.js App Router (server + client components), TypeScript, Supabase JS client, Vitest + React Testing Library, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-19-corridor-instant-period-toggle-design.md`

---

## File Structure

- `lib/corridors.ts` — add the `PeriodBundle` type (kept here, alongside `CommutePeriod`, to avoid a `lib/types` ↔ `lib/corridors` import cycle).
- `components/markets/CorridorPeriodSwitch.tsx` — convert from `<Link>` navigation to a controlled toggle (`active` + `onSelect` + `options`).
- `components/markets/CorridorMarketView.tsx` — **new** client wrapper holding `activePeriod` state and rendering the active bundle.
- `app/markets/[slug]/page.tsx` — fetch both bundles when a sibling exists; render the wrapper for the paired case, single layout otherwise.
- `tests/components/CorridorPeriodSwitch.test.tsx` — **new** unit test for the controlled toggle.
- `tests/components/CorridorMarketView.test.tsx` — **new** test for instant swap + URL sync.

---

## Task 1: Convert `CorridorPeriodSwitch` to a controlled toggle

Because a server component cannot pass an `onSelect` function to a client component, the page must stop rendering the switch directly. This task converts the switch and removes its direct use from the page (the toggle is temporarily not rendered until Task 3 reintroduces it via the wrapper). Build stays green throughout.

**Files:**
- Modify: `components/markets/CorridorPeriodSwitch.tsx`
- Modify: `app/markets/[slug]/page.tsx`
- Test: `tests/components/CorridorPeriodSwitch.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/components/CorridorPeriodSwitch.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { CorridorPeriodSwitch } from '@/components/markets/CorridorPeriodSwitch'

const options = [
  { period: 'morning' as const, slug: 'm-slug', windowStart: '07:00:00' },
  { period: 'evening' as const, slug: 'e-slug', windowStart: '17:00:00' },
]

describe('CorridorPeriodSwitch (controlled)', () => {
  it('marks the active period and fires onSelect when another is clicked', async () => {
    const onSelect = vi.fn()
    render(<CorridorPeriodSwitch active="morning" options={options} onSelect={onSelect} />)

    expect(screen.getByRole('button', { name: /morning/i })).toHaveAttribute('aria-current', 'true')

    await userEvent.click(screen.getByRole('button', { name: /evening/i }))
    expect(onSelect).toHaveBeenCalledWith('evening')
  })

  it('renders nothing when there are fewer than two options', () => {
    const { container } = render(
      <CorridorPeriodSwitch active="morning" options={[options[0]]} onSelect={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/components/CorridorPeriodSwitch.test.tsx`
Expected: FAIL — the current component renders `<Link>`/`<span>`, not `<button>`s, and has no `onSelect` prop (TypeScript/role errors).

- [ ] **Step 3: Rewrite `CorridorPeriodSwitch` as a controlled toggle**

Replace the entire contents of `components/markets/CorridorPeriodSwitch.tsx` with:

```tsx
'use client'

import { cn } from '@/lib/utils'
import { formatWindow, type CommutePeriod } from '@/lib/corridors'

export interface PeriodOption {
  period: CommutePeriod
  slug: string
  windowStart: string
}

interface Props {
  active: CommutePeriod
  options: PeriodOption[]
  onSelect: (period: CommutePeriod) => void
}

const PERIOD_LABELS: Record<CommutePeriod, string> = {
  morning: 'Morning',
  evening: 'Evening',
}

/**
 * Controlled Morning/Evening toggle for a corridor's paired protections.
 * The parent owns the active period; selecting fires `onSelect`.
 */
export function CorridorPeriodSwitch({ active, options, onSelect }: Props) {
  if (options.length < 2) return null

  const sorted = [...options].sort((a, b) =>
    a.period === 'morning' ? -1 : b.period === 'morning' ? 1 : 0,
  )

  return (
    <div className="flex items-center gap-1.5">
      {sorted.map((opt) => {
        const isActive = opt.period === active
        return (
          <button
            key={opt.period}
            type="button"
            onClick={() => onSelect(opt.period)}
            aria-current={isActive ? 'true' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.07em] transition-colors',
              isActive
                ? 'border-category-urban/30 bg-category-urban/10 text-category-urban'
                : 'border-white/10 text-insu-muted hover:border-white/20 hover:text-insu-text',
            )}
          >
            <span>{PERIOD_LABELS[opt.period]}</span>
            <span className="font-normal normal-case tracking-normal opacity-70">
              {formatWindow(opt.windowStart)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Remove the switch from the page to keep the build green**

Replace the entire contents of `app/markets/[slug]/page.tsx` with (this is the original page minus the sibling/switch logic; the toggle returns in Task 3):

```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import ContractDetailClient from '@/components/markets/ContractDetailClient'
import { TrafficPulseBar } from '@/components/markets/TrafficPulseBar'
import { TrafficPulseBarRefresher } from '@/components/markets/TrafficPulseBarRefresher'
import { CorridorMap } from '@/components/markets/CorridorMap'
import type { ContractDetailData, LatestOracleReading, OracleReading, Corridor } from '@/lib/types'

export default async function MarketPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const isConfigured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  if (!isConfigured) notFound()

  const supabase = await createClient()

  const [contractResult, userResult] = await Promise.all([
    supabase
      .from('contracts')
      .select(`
        *,
        category:categories(*),
        coverage_tiers(*),
        pricing_history(id, tier_id, premium_usd_after, calculated_at),
        corridor:corridors(*)
      `)
      .eq('slug', slug)
      .in('status', ['active', 'settled'])
      .single(),
    supabase.auth.getUser(),
  ])

  const contractData = contractResult.data
  if (contractResult.error || !contractData) notFound()

  const contract = contractData as unknown as ContractDetailData
  const userId = userResult.data.user?.id ?? null

  const [latestReadingResult, sparklineResult] = await Promise.all([
    supabase
      .from('oracle_readings')
      .select('value, read_at, source, trigger_met')
      .eq('contract_id', contract.id)
      .order('read_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    contract.trigger_type === 'urban'
      ? supabase
          .from('oracle_readings')
          .select('*')
          .eq('contract_id', contract.id)
          .order('read_at', { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null, error: null }),
  ])

  if (latestReadingResult.error) {
    console.error('[MarketPage] oracle fetch failed:', latestReadingResult.error.message)
  }
  if (sparklineResult.error) {
    console.error('[MarketPage] sparkline fetch failed:', sparklineResult.error.message)
  }

  const latestReading = latestReadingResult.data as LatestOracleReading | null
  const sparklineReadings = (sparklineResult.data ?? []) as OracleReading[]
  const corridor = contract.corridor as Corridor | null
  const triggerCondition = contract.trigger_condition

  return (
    <>
      <Header />
      {contract.trigger_type === 'urban' && corridor && (
        <div className="mx-auto max-w-4xl space-y-3 px-4 pb-2 pt-4">
          <TrafficPulseBar
            readings={sparklineReadings}
            threshold={Number(triggerCondition.threshold ?? 50)}
            windowStart={corridor.window_start}
            windowEnd={corridor.window_end}
            triggerDescription={String(triggerCondition.description ?? '')}
          />
          <CorridorMap
            originLat={corridor.origin_lat}
            originLng={corridor.origin_lng}
            destLat={corridor.dest_lat}
            destLng={corridor.dest_lng}
            corridorName={corridor.name}
          />
          <TrafficPulseBarRefresher />
        </div>
      )}
      <ContractDetailClient contract={contract} userId={userId} latestReading={latestReading} />
    </>
  )
}
```

- [ ] **Step 5: Run the test + typecheck to verify they pass**

Run: `npx vitest run tests/components/CorridorPeriodSwitch.test.tsx`
Expected: PASS (2 tests).

Run: `npx tsc --noEmit 2>&1 | grep -E "CorridorPeriodSwitch|markets/\[slug\]" || echo "clean"`
Expected: `clean` (no errors in the touched files; pre-existing unrelated errors elsewhere are out of scope).

- [ ] **Step 6: Commit**

```bash
git add components/markets/CorridorPeriodSwitch.tsx app/markets/[slug]/page.tsx tests/components/CorridorPeriodSwitch.test.tsx
git commit -m "refactor(markets): make CorridorPeriodSwitch a controlled toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Add `PeriodBundle` type and the `CorridorMarketView` wrapper

**Files:**
- Modify: `lib/corridors.ts`
- Create: `components/markets/CorridorMarketView.tsx`
- Test: `tests/components/CorridorMarketView.test.tsx` (create)

- [ ] **Step 1: Add the `PeriodBundle` type to `lib/corridors.ts`**

At the top of `lib/corridors.ts`, replace the existing import line:

```ts
import type { ContractWithTiers, Corridor } from './types'
```

with:

```ts
import type {
  ContractWithTiers,
  Corridor,
  ContractDetailData,
  LatestOracleReading,
  OracleReading,
} from './types'
```

Then, immediately after the `export type CommutePeriod = 'morning' | 'evening'` line, add:

```ts
/** Everything the detail page needs to render one period of a corridor pair. */
export interface PeriodBundle {
  period: CommutePeriod
  slug: string
  contract: ContractDetailData
  corridor: Corridor
  latestReading: LatestOracleReading | null
  sparklineReadings: OracleReading[]
}
```

- [ ] **Step 2: Write the failing test for the wrapper**

Create `tests/components/CorridorMarketView.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CorridorMarketView } from '@/components/markets/CorridorMarketView'
import type { PeriodBundle } from '@/lib/corridors'

// Mock the heavy children so the test isolates the wrapper's swap behaviour.
vi.mock('@/components/markets/ContractDetailClient', () => ({
  default: ({ contract }: { contract: { title: string } }) => (
    <div data-testid="detail">{contract.title}</div>
  ),
}))
vi.mock('@/components/markets/CorridorMap', () => ({ CorridorMap: () => <div data-testid="map" /> }))
vi.mock('@/components/markets/TrafficPulseBar', () => ({ TrafficPulseBar: () => <div data-testid="pulse" /> }))
vi.mock('@/components/markets/TrafficPulseBarRefresher', () => ({ TrafficPulseBarRefresher: () => null }))

function makeBundle(period: 'morning' | 'evening', slug: string, title: string): PeriodBundle {
  return {
    period,
    slug,
    // Only the fields the wrapper/children touch are needed for this test.
    contract: { title, trigger_condition: {} } as unknown as PeriodBundle['contract'],
    corridor: {
      window_start: period === 'morning' ? '07:00:00' : '17:00:00',
      window_end: period === 'morning' ? '10:00:00' : '20:00:00',
      origin_lat: 0, origin_lng: 0, dest_lat: 0, dest_lng: 0, name: `${period} corridor`,
    } as unknown as PeriodBundle['corridor'],
    latestReading: null,
    sparklineReadings: [],
  }
}

const bundles = [
  makeBundle('morning', 'reforma-am', 'Reforma Morning'),
  makeBundle('evening', 'reforma-pm', 'Reforma Evening'),
]

describe('CorridorMarketView', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/markets/reforma-am')
  })

  it('renders the initial period and swaps instantly without navigation', async () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    render(<CorridorMarketView bundles={bundles} initialPeriod="morning" userId={null} />)

    expect(screen.getByTestId('detail')).toHaveTextContent('Reforma Morning')

    await userEvent.click(screen.getByRole('button', { name: /evening/i }))

    expect(screen.getByTestId('detail')).toHaveTextContent('Reforma Evening')
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/markets/reforma-pm')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/components/CorridorMarketView.test.tsx`
Expected: FAIL — `CorridorMarketView` does not exist yet (import error).

- [ ] **Step 4: Implement `CorridorMarketView`**

Create `components/markets/CorridorMarketView.tsx`:

```tsx
'use client'

import { useState } from 'react'
import ContractDetailClient from './ContractDetailClient'
import { TrafficPulseBar } from './TrafficPulseBar'
import { TrafficPulseBarRefresher } from './TrafficPulseBarRefresher'
import { CorridorMap } from './CorridorMap'
import { CorridorPeriodSwitch, type PeriodOption } from './CorridorPeriodSwitch'
import type { CommutePeriod, PeriodBundle } from '@/lib/corridors'

interface Props {
  bundles: PeriodBundle[]
  initialPeriod: CommutePeriod
  userId: string | null
}

/**
 * Renders a corridor's morning/evening protections from preloaded bundles,
 * swapping between them client-side with no page reload. Keeps the URL in sync
 * via history.replaceState so refresh/share preserves the selected period.
 */
export function CorridorMarketView({ bundles, initialPeriod, userId }: Props) {
  const [activePeriod, setActivePeriod] = useState<CommutePeriod>(initialPeriod)

  const active = bundles.find((b) => b.period === activePeriod) ?? bundles[0]
  const options: PeriodOption[] = bundles.map((b) => ({
    period: b.period,
    slug: b.slug,
    windowStart: b.corridor.window_start,
  }))

  function handleSelect(period: CommutePeriod) {
    const next = bundles.find((b) => b.period === period)
    if (!next) return
    setActivePeriod(period)
    window.history.replaceState(null, '', `/markets/${next.slug}`)
  }

  const { contract, corridor } = active
  const triggerCondition = contract.trigger_condition

  return (
    <>
      <div className="mx-auto max-w-4xl space-y-3 px-4 pb-2 pt-4">
        <CorridorPeriodSwitch active={activePeriod} options={options} onSelect={handleSelect} />
        <TrafficPulseBar
          readings={active.sparklineReadings}
          threshold={Number(triggerCondition.threshold ?? 50)}
          windowStart={corridor.window_start}
          windowEnd={corridor.window_end}
          triggerDescription={String(triggerCondition.description ?? '')}
        />
        <CorridorMap
          key={active.slug}
          originLat={corridor.origin_lat}
          originLng={corridor.origin_lng}
          destLat={corridor.dest_lat}
          destLng={corridor.dest_lng}
          corridorName={corridor.name}
        />
        <TrafficPulseBarRefresher />
      </div>
      <ContractDetailClient
        key={active.slug}
        contract={contract}
        userId={userId}
        latestReading={active.latestReading}
      />
    </>
  )
}
```

- [ ] **Step 5: Run the test + typecheck to verify they pass**

Run: `npx vitest run tests/components/CorridorMarketView.test.tsx`
Expected: PASS (1 test).

Run: `npx tsc --noEmit 2>&1 | grep -E "CorridorMarketView|corridors.ts" || echo "clean"`
Expected: `clean`.

- [ ] **Step 6: Commit**

```bash
git add lib/corridors.ts components/markets/CorridorMarketView.tsx tests/components/CorridorMarketView.test.tsx
git commit -m "feat(markets): add CorridorMarketView for instant period swap

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire the page to preload both bundles and render the wrapper

**Files:**
- Modify: `app/markets/[slug]/page.tsx`

- [ ] **Step 1: Replace the page with the paired-bundle version**

Replace the entire contents of `app/markets/[slug]/page.tsx` with:

```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import ContractDetailClient from '@/components/markets/ContractDetailClient'
import { TrafficPulseBar } from '@/components/markets/TrafficPulseBar'
import { TrafficPulseBarRefresher } from '@/components/markets/TrafficPulseBarRefresher'
import { CorridorMap } from '@/components/markets/CorridorMap'
import { CorridorMarketView } from '@/components/markets/CorridorMarketView'
import { getContractPeriod, type PeriodBundle } from '@/lib/corridors'
import type { ContractDetailData, LatestOracleReading, OracleReading, Corridor } from '@/lib/types'

const CONTRACT_SELECT = `
  *,
  category:categories(*),
  coverage_tiers(*),
  pricing_history(id, tier_id, premium_usd_after, calculated_at),
  corridor:corridors(*)
`

/** Load the oracle readings for one corridor contract into a renderable bundle. */
async function loadBundle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  contract: ContractDetailData,
): Promise<PeriodBundle> {
  const corridor = contract.corridor as Corridor

  const [latestReadingResult, sparklineResult] = await Promise.all([
    supabase
      .from('oracle_readings')
      .select('value, read_at, source, trigger_met')
      .eq('contract_id', contract.id)
      .order('read_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('oracle_readings')
      .select('*')
      .eq('contract_id', contract.id)
      .order('read_at', { ascending: false })
      .limit(6),
  ])

  if (latestReadingResult.error) {
    console.error('[MarketPage] oracle fetch failed:', latestReadingResult.error.message)
  }
  if (sparklineResult.error) {
    console.error('[MarketPage] sparkline fetch failed:', sparklineResult.error.message)
  }

  return {
    period: getContractPeriod(corridor),
    slug: contract.slug,
    contract,
    corridor,
    latestReading: latestReadingResult.data as LatestOracleReading | null,
    sparklineReadings: (sparklineResult.data ?? []) as OracleReading[],
  }
}

export default async function MarketPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const isConfigured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  if (!isConfigured) notFound()

  const supabase = await createClient()

  const [contractResult, userResult] = await Promise.all([
    supabase.from('contracts').select(CONTRACT_SELECT).eq('slug', slug).in('status', ['active', 'settled']).single(),
    supabase.auth.getUser(),
  ])

  const contractData = contractResult.data
  if (contractResult.error || !contractData) notFound()

  const contract = contractData as unknown as ContractDetailData
  const userId = userResult.data.user?.id ?? null
  const corridor = contract.corridor as Corridor | null

  // For a corridor contract, find its sibling (same road, opposite period).
  let sibling: ContractDetailData | null = null
  if (contract.trigger_type === 'urban' && corridor) {
    const { data: roadCorridors } = await supabase
      .from('corridors')
      .select('id')
      .eq('road', corridor.road)

    const siblingCorridorId = ((roadCorridors ?? []) as { id: string }[])
      .map((c) => c.id)
      .find((id) => id !== corridor.id)

    if (siblingCorridorId) {
      const { data: siblingData } = await supabase
        .from('contracts')
        .select(CONTRACT_SELECT)
        .eq('corridor_id', siblingCorridorId)
        .in('status', ['active', 'settled'])
        .maybeSingle()
      if (siblingData) sibling = siblingData as unknown as ContractDetailData
    }
  }

  // Paired corridor: preload both periods, toggle instantly client-side.
  if (contract.trigger_type === 'urban' && corridor && sibling) {
    const [openedBundle, siblingBundle] = await Promise.all([
      loadBundle(supabase, contract),
      loadBundle(supabase, sibling),
    ])
    return (
      <>
        <Header />
        <CorridorMarketView
          bundles={[openedBundle, siblingBundle]}
          initialPeriod={getContractPeriod(corridor)}
          userId={userId}
        />
      </>
    )
  }

  // Single contract: non-corridor, or a road with only one active period.
  const [latestReadingResult, sparklineResult] = await Promise.all([
    supabase
      .from('oracle_readings')
      .select('value, read_at, source, trigger_met')
      .eq('contract_id', contract.id)
      .order('read_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    contract.trigger_type === 'urban'
      ? supabase
          .from('oracle_readings')
          .select('*')
          .eq('contract_id', contract.id)
          .order('read_at', { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null, error: null }),
  ])

  if (latestReadingResult.error) {
    console.error('[MarketPage] oracle fetch failed:', latestReadingResult.error.message)
  }
  if (sparklineResult.error) {
    console.error('[MarketPage] sparkline fetch failed:', sparklineResult.error.message)
  }

  const latestReading = latestReadingResult.data as LatestOracleReading | null
  const sparklineReadings = (sparklineResult.data ?? []) as OracleReading[]
  const triggerCondition = contract.trigger_condition

  return (
    <>
      <Header />
      {contract.trigger_type === 'urban' && corridor && (
        <div className="mx-auto max-w-4xl space-y-3 px-4 pb-2 pt-4">
          <TrafficPulseBar
            readings={sparklineReadings}
            threshold={Number(triggerCondition.threshold ?? 50)}
            windowStart={corridor.window_start}
            windowEnd={corridor.window_end}
            triggerDescription={String(triggerCondition.description ?? '')}
          />
          <CorridorMap
            originLat={corridor.origin_lat}
            originLng={corridor.origin_lng}
            destLat={corridor.dest_lat}
            destLng={corridor.dest_lng}
            corridorName={corridor.name}
          />
          <TrafficPulseBarRefresher />
        </div>
      )}
      <ContractDetailClient contract={contract} userId={userId} latestReading={latestReading} />
    </>
  )
}
```

- [ ] **Step 2: Typecheck the touched file**

Run: `npx tsc --noEmit 2>&1 | grep -E "markets/\[slug\]" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Run the full component + lib test suites (no regressions)**

Run: `npx vitest run tests/components tests/lib/corridors.test.ts`
Expected: PASS — including the new `CorridorPeriodSwitch` and `CorridorMarketView` tests, and the unchanged `ContractSection` tests.

- [ ] **Step 4: Production build gate**

Run: `npx next build`
Expected: build completes; `/markets/[slug]` is listed as a route with no errors.

- [ ] **Step 5: Manual verification on the dev server**

With the dev server running (`npm run dev`), confirm instant toggling with Playwright:

```bash
cat > ./_toggle.cjs <<'EOF'
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/markets/reforma-alameda-manana', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const before = await page.locator('h1').first().textContent();
  // Toggling should NOT trigger a navigation; track it.
  let navigated = false;
  page.on('framenavigated', f => { if (f === page.mainFrame()) navigated = true; });
  await page.getByRole('button', { name: /evening/i }).click();
  await page.waitForTimeout(800);
  const after = await page.locator('h1').first().textContent();
  console.log('title before:', before);
  console.log('title after :', after);
  console.log('URL now     :', page.url());
  console.log('navigated?  :', navigated, '(expected false)');
  await browser.close();
})();
EOF
node ./_toggle.cjs; rm -f ./_toggle.cjs
```

Expected: the `h1` title changes (e.g. "…Mañana" → "…Tarde"), the URL ends with `…-tarde`, and `navigated? : false`.

- [ ] **Step 6: Commit**

```bash
git add app/markets/[slug]/page.tsx
git commit -m "feat(markets): preload both corridor periods for instant toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **Pre-existing test/type noise:** `npx tsc --noEmit` and `npx vitest run` (whole suite) have pre-existing failures unrelated to this work (e.g. `tests/lib/actions/dashboard.test.ts`, `tests/lib/payout/processor.test.ts`, and stale `.next/types/* 2.ts` duplicate artifacts). Scope your checks to the touched files as shown. Do not "fix" unrelated failures as part of this plan.
- **No deploy in this plan.** Deployment to Vercel (`vercel --prod`) is triggered by the user separately.
- **`router.refresh()` behaviour:** `TrafficPulseBarRefresher` calls `router.refresh()` every 10 min. This re-runs the server page, re-fetches both bundles, and updates props while preserving the client `activePeriod` state — no extra work needed.
