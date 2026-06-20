# Corridor Detail Page Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the traffic-corridor market detail page so the title leads, the live-traffic pulse bar and map sit side by side, and the purchase rail is fully visible on load — all within one unified two-column grid.

**Architecture:** Move the corridor visuals from a separate centered block into `ContractDetailClient`'s existing two-column grid via two new optional left-column slots (`periodToggle`, `evidence`). A new `CorridorEvidence` component renders the pulse bar + map side by side. `CorridorMarketView` and the single-corridor path in `page.tsx` pass the slots; non-corridor contracts pass nothing and render unchanged.

**Tech Stack:** Next.js App Router (server + client components), React, TypeScript, Tailwind, Vitest + React Testing Library, Playwright (visual gate).

**Spec:** `docs/superpowers/specs/2026-06-19-corridor-detail-layout-redesign-design.md`

---

## File Structure

- `components/markets/ContractDetailClient.tsx` — add optional `periodToggle`/`evidence` left-column slots; make the main grid + right rail responsive. Backward compatible (slots optional).
- `components/markets/CorridorEvidence.tsx` — **new**; renders `TrafficPulseBar` + `CorridorMap` side by side plus the refresher.
- `components/markets/CorridorMarketView.tsx` — render `ContractDetailClient` with the slots; remove its own top block.
- `app/markets/[slug]/page.tsx` — single-corridor path passes the `evidence` slot; remove its top block + now-unused imports.
- `tests/components/ContractDetailClient.test.tsx` — **new**; verifies slot rendering.

Tasks are ordered so the build and the live page stay working at every commit (the slots are optional, so callers can adopt them one at a time).

---

## Task 1: Add optional slots + responsive grid to `ContractDetailClient`

**Files:**
- Modify: `components/markets/ContractDetailClient.tsx`
- Test: `tests/components/ContractDetailClient.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/components/ContractDetailClient.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ContractDetailClient from '@/components/markets/ContractDetailClient'
import type { ContractDetailData } from '@/lib/types'

// Mock heavy children so the test isolates the slot wiring.
vi.mock('@/components/markets/PriceChart', () => ({ default: () => <div data-testid="price-chart" /> }))
vi.mock('@/components/markets/OracleConditions', () => ({ default: () => <div data-testid="oracle" /> }))
vi.mock('@/components/markets/ContractMeta', () => ({ default: () => <div data-testid="meta" /> }))
vi.mock('@/components/markets/PurchasePanel', () => ({ default: () => <div data-testid="panel" /> }))
vi.mock('@/components/markets/TierSelector', () => ({ default: () => <div data-testid="tiers" /> }))

const contract = {
  id: 'c1',
  slug: 'reforma-am',
  title: 'Reforma → Alameda',
  description: 'desc',
  category: { id: 'cat', slug: 'urban', name: 'Urban' },
  trigger_type: 'urban',
  trigger_condition: {},
  coverage_tiers: [],
  pricing_history: [],
  location: { city: 'Mexico City', country: 'MX', lat: 0, lng: 0 },
} as unknown as ContractDetailData

describe('ContractDetailClient slots', () => {
  it('renders periodToggle and evidence when provided', () => {
    render(
      <ContractDetailClient
        contract={contract}
        userId={null}
        latestReading={null}
        periodToggle={<div data-testid="toggle" />}
        evidence={<div data-testid="evidence" />}
      />,
    )
    expect(screen.getByTestId('toggle')).toBeInTheDocument()
    expect(screen.getByTestId('evidence')).toBeInTheDocument()
  })

  it('omits the slots when not provided', () => {
    render(<ContractDetailClient contract={contract} userId={null} latestReading={null} />)
    expect(screen.queryByTestId('toggle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('evidence')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/components/ContractDetailClient.test.tsx`
Expected: FAIL — `ContractDetailClient` doesn't accept `periodToggle`/`evidence` yet (TS error / testids not found).

- [ ] **Step 3: Add the `ReactNode` import**

In `components/markets/ContractDetailClient.tsx`, change:

```tsx
import { useState } from 'react'
```

to:

```tsx
import { useState, type ReactNode } from 'react'
```

- [ ] **Step 4: Add the slot props to the interface and destructure**

Change:

```tsx
interface Props {
  contract: ContractDetailData
  userId: string | null
  latestReading: LatestOracleReading | null
}

export default function ContractDetailClient({ contract, userId, latestReading }: Props) {
```

to:

```tsx
interface Props {
  contract: ContractDetailData
  userId: string | null
  latestReading: LatestOracleReading | null
  /** Optional content rendered at the very top of the left column (e.g. period toggle). */
  periodToggle?: ReactNode
  /** Optional content rendered below the description, above the price chart (e.g. corridor evidence). */
  evidence?: ReactNode
}

export default function ContractDetailClient({ contract, userId, latestReading, periodToggle, evidence }: Props) {
```

- [ ] **Step 5: Make the grid responsive**

Change:

```tsx
      <div className="grid grid-cols-[1fr_360px] items-start gap-8">
        {/* Left column */}
        <div className="space-y-5">
          <div>
```

to:

```tsx
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[1fr_360px]">
        {/* Left column */}
        <div className="space-y-5">
          {periodToggle}
          <div>
```

- [ ] **Step 6: Insert the evidence slot below the description**

Change:

```tsx
            {contract.description && (
              <p className="mt-2 text-[14px] text-insu-muted">{contract.description}</p>
            )}
          </div>

          <PriceChart history={contract.pricing_history} tiers={contract.coverage_tiers} />
```

to:

```tsx
            {contract.description && (
              <p className="mt-2 text-[14px] text-insu-muted">{contract.description}</p>
            )}
          </div>

          {evidence}

          <PriceChart history={contract.pricing_history} tiers={contract.coverage_tiers} />
```

- [ ] **Step 7: Make the right rail sticky only at `lg`**

Change:

```tsx
        {/* Right column — sticky */}
        <div className="sticky top-[80px] space-y-4">
```

to:

```tsx
        {/* Right column — sticky on desktop, stacked below lg */}
        <div className="space-y-4 lg:sticky lg:top-[80px]">
```

- [ ] **Step 8: Run the test + typecheck to verify they pass**

Run: `npx vitest run tests/components/ContractDetailClient.test.tsx`
Expected: PASS (2 tests).

Run: `npx tsc --noEmit 2>&1 | grep -E "ContractDetailClient" || echo "clean"`
Expected: `clean`.

- [ ] **Step 9: Commit**

```bash
git add components/markets/ContractDetailClient.tsx tests/components/ContractDetailClient.test.tsx
git commit -m "feat(markets): add optional left-column slots + responsive grid to ContractDetailClient

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Create the `CorridorEvidence` component

**Files:**
- Create: `components/markets/CorridorEvidence.tsx`

- [ ] **Step 1: Create the component**

Create `components/markets/CorridorEvidence.tsx`:

```tsx
import { TrafficPulseBar } from './TrafficPulseBar'
import { TrafficPulseBarRefresher } from './TrafficPulseBarRefresher'
import { CorridorMap } from './CorridorMap'
import type { Corridor, OracleReading } from '@/lib/types'

interface Props {
  corridor: Corridor
  readings: OracleReading[]
  triggerCondition: Record<string, unknown>
}

/**
 * Live-traffic evidence for a corridor contract: the pulse bar and map shown
 * side by side on desktop (stacked on narrow screens), plus the 10-min refresher.
 */
export function CorridorEvidence({ corridor, readings, triggerCondition }: Props) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.3fr]">
        <TrafficPulseBar
          readings={readings}
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
      </div>
      <TrafficPulseBarRefresher />
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "CorridorEvidence" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add components/markets/CorridorEvidence.tsx
git commit -m "feat(markets): add CorridorEvidence (pulse bar + map side by side)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Render `CorridorMarketView` through the slots

**Files:**
- Modify: `components/markets/CorridorMarketView.tsx`

- [ ] **Step 1: Replace the entire file**

Replace the entire contents of `components/markets/CorridorMarketView.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import ContractDetailClient from './ContractDetailClient'
import { CorridorEvidence } from './CorridorEvidence'
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
    // replaceState (not router.replace) keeps the swap instant: it syncs the URL
    // without a server round-trip / RSC refetch, which is the whole point here.
    window.history.replaceState(null, '', `/markets/${next.slug}`)
  }

  const { contract, corridor } = active

  return (
    <ContractDetailClient
      key={active.slug}
      contract={contract}
      userId={userId}
      latestReading={active.latestReading}
      periodToggle={
        <CorridorPeriodSwitch active={activePeriod} options={options} onSelect={handleSelect} />
      }
      evidence={
        <CorridorEvidence
          corridor={corridor}
          readings={active.sparklineReadings}
          triggerCondition={contract.trigger_condition}
        />
      }
    />
  )
}
```

- [ ] **Step 2: Run the existing wrapper test (still green)**

Run: `npx vitest run tests/components/CorridorMarketView.test.tsx`
Expected: PASS. (The test mocks `ContractDetailClient` and asserts the title swap + `replaceState`; passing the new `periodToggle`/`evidence` props to the mocked component doesn't affect it.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "CorridorMarketView" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add components/markets/CorridorMarketView.tsx
git commit -m "refactor(markets): render CorridorMarketView via ContractDetailClient slots

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire the single-corridor page path + visual verification

**Files:**
- Modify: `app/markets/[slug]/page.tsx`

- [ ] **Step 1: Update the imports**

In `app/markets/[slug]/page.tsx`, change the import block:

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
```

to:

```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import ContractDetailClient from '@/components/markets/ContractDetailClient'
import { CorridorEvidence } from '@/components/markets/CorridorEvidence'
import { CorridorMarketView } from '@/components/markets/CorridorMarketView'
import { getContractPeriod, type PeriodBundle } from '@/lib/corridors'
import type { ContractDetailData, LatestOracleReading, OracleReading, Corridor } from '@/lib/types'
```

- [ ] **Step 2: Replace the single-branch return block**

Change:

```tsx
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

to:

```tsx
  return (
    <>
      <Header />
      <ContractDetailClient
        contract={contract}
        userId={userId}
        latestReading={latestReading}
        evidence={
          contract.trigger_type === 'urban' && corridor ? (
            <CorridorEvidence
              corridor={corridor}
              readings={sparklineReadings}
              triggerCondition={triggerCondition}
            />
          ) : undefined
        }
      />
    </>
  )
}
```

(Note: `triggerCondition` and `sparklineReadings` remain referenced, so no unused-var errors. `TrafficPulseBar`, `TrafficPulseBarRefresher`, and `CorridorMap` are no longer referenced in this file — their imports were removed in Step 1.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "markets/\[slug\]" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Run the full component + lib test suites**

Run: `npx vitest run tests/components tests/lib/corridors.test.ts`
Expected: PASS (includes the new `ContractDetailClient` slot test, the existing `CorridorMarketView`, `CorridorPeriodSwitch`, `ContractSection`, and corridors tests).

- [ ] **Step 5: Production build gate**

Run: `npx next build`
Expected: completes with `/markets/[slug]` listed as a route, no errors.

- [ ] **Step 6: Visual verification on the dev server**

A dev server may already be running on http://localhost:3000 (check with `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`; if not 200, start it with `npm run dev` in the background and wait for "Ready"). Then run:

```bash
cat > ./_layout.cjs <<'EOF'
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch();
  for (const vp of [{w:1440,h:900},{w:1280,h:800}]) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    await page.goto('http://localhost:3000/markets/reforma-alameda-manana', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3500);
    const h1 = page.locator('h1').first();
    const buy = page.getByRole('button', { name: /buy protection/i }).first();
    const inFold = async (loc) => {
      const box = await loc.boundingBox();
      return box ? (box.y >= 0 && box.y + box.height <= vp.h) : false;
    };
    const titleVisible = await inFold(h1);
    const buyVisible = await inFold(buy);
    const pageH = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log(`${vp.w}x${vp.h}: title in fold=${titleVisible}, Buy in fold=${buyVisible}, pageHeight=${pageH}px`);
    await page.screenshot({ path: `/tmp/redesign-${vp.w}.png` });
    await page.close();
  }
  await browser.close();
})();
EOF
node ./_layout.cjs; rm -f ./_layout.cjs
```

Expected: at both sizes, `title in fold=true` and `Buy in fold=true` (the core fix), and `pageHeight` shorter than the pre-redesign ~1206px at 1440×900. Paste the output and confirm by viewing `/tmp/redesign-1440.png` that the pulse bar and map are side by side and the purchase rail is visible without scrolling.

- [ ] **Step 7: Commit**

```bash
git add app/markets/[slug]/page.tsx
git commit -m "feat(markets): unify corridor detail layout via evidence slot

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Notes for the implementer

- **Pre-existing test/type noise:** `npx tsc --noEmit` and the full `npx vitest run` have pre-existing failures unrelated to this work (`tests/lib/actions/dashboard.test.ts`, `tests/lib/payout/processor.test.ts`, stale `.next/types/* 2.ts`). Scope typecheck greps to the touched files as shown; `tests/components tests/lib/corridors.test.ts` should be fully green.
- **Stale dev server:** if the dev server shows a Turbopack/Tailwind cache error after the file changes, restart it (`pkill -f "next dev"`, `rm -rf .next`, `npm run dev`).
- **No deploy in this plan** — deployment is triggered separately by the user.
- **`CorridorEvidence` needs no `'use client'`** — it composes client children (`CorridorMap`, `TrafficPulseBarRefresher`) and a shared component (`TrafficPulseBar`); it works whether rendered from the server page or the client `CorridorMarketView`.
- Apply all file contents verbatim.
