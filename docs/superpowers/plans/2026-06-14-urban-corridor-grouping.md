# Urban Corridor Grouping & Recommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a corridor-road filter chip row and a time-aware "Recommended" badge to the Urban contracts section, so buyers can find their commute corridor and know which window (Morning/Evening) to buy.

**Architecture:** New pure helper module `lib/corridors.ts` computes corridor periods, the current "recommended" period, and the distinct list of corridor roads. `app/page.tsx` joins `corridors` into the contracts query. `ContractSection.tsx` becomes a client component that renders the chip row (urban only) and computes each card's badge. `ContractCard.tsx` gains a `recommended` badge variant.

**Tech Stack:** Next.js App Router, React (client component with `useState`), Supabase (postgrest join), Vitest + Testing Library.

**Reference spec:** `docs/superpowers/specs/2026-06-14-urban-corridor-grouping-design.md`

---

## File Structure

- **Create** `lib/corridors.ts` — pure helpers: `getContractPeriod`, `getRecommendedPeriod`, `getUrbanRoads`
- **Create** `tests/lib/corridors.test.ts` — tests for the above
- **Modify** `components/contracts/ContractCard.tsx` — add `'recommended'` badge variant
- **Modify** `tests/components/ContractCard.test.tsx` — test the new badge variant
- **Modify** `app/page.tsx` — join `corridor:corridors(*)` into `getContracts()`
- **Modify** `components/contracts/ContractSection.tsx` — add road filter chips + recommendation-aware badge logic
- **Create** `tests/components/ContractSection.test.tsx` — tests for chips, filtering, and badge logic

---

### Task 1: `lib/corridors.ts` — period & road helpers

**Files:**
- Create: `lib/corridors.ts`
- Test: `tests/lib/corridors.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/corridors.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getContractPeriod, getRecommendedPeriod, getUrbanRoads } from '@/lib/corridors'
import type { ContractWithTiers, Corridor } from '@/lib/types'

function makeCorridor(overrides: Partial<Corridor> = {}): Corridor {
  return {
    id: 'cor-1',
    slug: 'reforma-am',
    name: 'Reforma → Alameda (Mañana)',
    road: 'Paseo de la Reforma',
    origin_lat: 19.4001,
    origin_lng: -99.1892,
    dest_lat: 19.4354,
    dest_lng: -99.1452,
    window_start: '07:00:00',
    window_end: '10:00:00',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeContract(overrides: Partial<ContractWithTiers>): ContractWithTiers {
  return {
    id: 'id-1',
    slug: 'test-contract',
    title: 'Test',
    description: null,
    category_id: 'cat-1',
    category: { id: 'cat-1', name: 'Urban', slug: 'urban', color: '#94a3b8', icon_url: null, display_order: 1 },
    status: 'active',
    trigger_type: 'urban',
    trigger_condition: {},
    trigger_deadline: '2027-01-01T00:00:00Z',
    is_recurring: false,
    location: { lat: 0, lng: 0, city: 'Mexico City', country: 'MX' },
    icon_url: null,
    total_volume_usd: 0,
    total_volume_mxn: 0,
    is_featured: false,
    settled_outcome: null,
    created_by: 'admin',
    created_at: new Date().toISOString(),
    settled_at: null,
    coverage_tiers: [],
    corridor: null,
    ...overrides,
  }
}

describe('getContractPeriod', () => {
  it('returns "morning" for a corridor whose window starts before noon', () => {
    expect(getContractPeriod(makeCorridor({ window_start: '07:00:00' }))).toBe('morning')
  })

  it('returns "evening" for a corridor whose window starts at or after noon', () => {
    expect(getContractPeriod(makeCorridor({ window_start: '17:00:00' }))).toBe('evening')
  })
})

describe('getRecommendedPeriod', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('recommends "morning" just before 06:00', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T05:59:00'))
    expect(getRecommendedPeriod()).toBe('morning')
  })

  it('recommends "evening" at 06:00', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T06:00:00'))
    expect(getRecommendedPeriod()).toBe('evening')
  })

  it('recommends "evening" just before 20:00', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T19:59:00'))
    expect(getRecommendedPeriod()).toBe('evening')
  })

  it('recommends "morning" at 20:00', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T20:00:00'))
    expect(getRecommendedPeriod()).toBe('morning')
  })

  it('recommends "morning" late at night', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T23:00:00'))
    expect(getRecommendedPeriod()).toBe('morning')
  })
})

describe('getUrbanRoads', () => {
  it('returns distinct corridor roads in alphabetical order', () => {
    const contracts = [
      makeContract({ id: '1', corridor: makeCorridor({ road: 'Paseo de la Reforma' }) }),
      makeContract({ id: '2', corridor: makeCorridor({ road: 'Circuito Bicentenario', slug: 'bicentenario-am' }) }),
      makeContract({ id: '3', corridor: makeCorridor({ road: 'Paseo de la Reforma', slug: 'reforma-pm', window_start: '17:00:00' }) }),
    ]
    expect(getUrbanRoads(contracts)).toEqual(['Circuito Bicentenario', 'Paseo de la Reforma'])
  })

  it('ignores contracts with no corridor', () => {
    const contracts = [
      makeContract({ id: '1', corridor: null }),
      makeContract({ id: '2', corridor: makeCorridor({ road: 'Av. de las Palmas', slug: 'palmas-am' }) }),
    ]
    expect(getUrbanRoads(contracts)).toEqual(['Av. de las Palmas'])
  })

  it('returns an empty array when no contracts have corridors', () => {
    expect(getUrbanRoads([makeContract({ id: '1', corridor: null })])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/corridors.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/corridors"` (module doesn't exist yet)

- [ ] **Step 3: Write the implementation**

Create `lib/corridors.ts`:

```ts
import type { ContractWithTiers, Corridor } from './types'

export type CommutePeriod = 'morning' | 'evening'

/** Morning if the corridor's window starts before noon, else evening. */
export function getContractPeriod(corridor: Corridor): CommutePeriod {
  const startHour = Number(corridor.window_start.split(':')[0])
  return startHour < 12 ? 'morning' : 'evening'
}

/** 06:00-20:00 -> evening (afternoon commute is next); otherwise -> morning. */
export function getRecommendedPeriod(now: Date = new Date()): CommutePeriod {
  const hour = now.getHours()
  return hour >= 6 && hour < 20 ? 'evening' : 'morning'
}

/** Distinct corridor road names across the given contracts, alphabetical. */
export function getUrbanRoads(contracts: ContractWithTiers[]): string[] {
  const roads = new Set<string>()
  for (const c of contracts) {
    if (c.corridor?.road) roads.add(c.corridor.road)
  }
  return [...roads].sort((a, b) => a.localeCompare(b))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/corridors.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/corridors.ts tests/lib/corridors.test.ts
git commit -m "feat: add corridor period and road helpers for Urban grouping"
```

---

### Task 2: `ContractCard` — add `recommended` badge variant

**Files:**
- Modify: `components/contracts/ContractCard.tsx:27-37`
- Test: `tests/components/ContractCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `tests/components/ContractCard.test.tsx`, inside the existing `describe('ContractCard', ...)` block:

```ts
  it('renders a recommended badge when badge="recommended"', () => {
    render(<ContractCard contract={mockContract} currency="USD" badge="recommended" />)
    expect(screen.getByText('recommended')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/components/ContractCard.test.tsx`
Expected: FAIL with a TypeScript error — `Type '"recommended"' is not assignable to type '"trending" | "new" | "live" | undefined'`

- [ ] **Step 3: Write the implementation**

In `components/contracts/ContractCard.tsx`, update the `Props` interface and `BADGE_STYLES`:

```ts
interface Props {
  contract: ContractWithTiers
  currency: Currency
  badge?: 'trending' | 'new' | 'live' | 'recommended'
}

const BADGE_STYLES = {
  trending:    'bg-insu-accent/15 text-insu-accent border border-insu-accent/25',
  new:         'bg-insu-green/10 text-insu-green border border-insu-green/25',
  live:        'bg-red-500/12 text-red-400 border border-red-500/25 animate-pulse',
  recommended: 'bg-blue-400/15 text-blue-400 border border-blue-400/25',
}
```

(This replaces the existing `Props` interface at line 27-31 and `BADGE_STYLES` at line 33-37.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/ContractCard.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add components/contracts/ContractCard.tsx tests/components/ContractCard.test.tsx
git commit -m "feat: add recommended badge variant to ContractCard"
```

---

### Task 3: `app/page.tsx` — join corridor data into `getContracts()`

**Files:**
- Modify: `app/page.tsx:18-33`

- [ ] **Step 1: Update the select query**

In `app/page.tsx`, find `getContracts()` and change the `.select(...)` call from:

```ts
    .select(`
      *,
      category:categories(*),
      coverage_tiers(*)
    `)
```

to:

```ts
    .select(`
      *,
      category:categories(*),
      coverage_tiers(*),
      corridor:corridors(*)
    `)
```

This matches the join already used in `app/markets/[slug]/page.tsx:32`. Contracts without a `corridor_id` (e.g. "CDMX Morning Traffic Delay") will get `corridor: null`.

- [ ] **Step 2: Run typecheck to verify no type errors**

Run: `npx tsc --noEmit`
Expected: no new errors (the `ContractWithTiers`/`Contract` types already declare `corridor?: Corridor | null`)

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: join corridor data into contracts query for Urban grouping"
```

---

### Task 4: `ContractSection` — corridor road filter chips

**Files:**
- Modify: `components/contracts/ContractSection.tsx`
- Test: `tests/components/ContractSection.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/components/ContractSection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import ContractSection from '@/components/contracts/ContractSection'
import type { ContractWithTiers, Corridor } from '@/lib/types'

function makeCorridor(overrides: Partial<Corridor> = {}): Corridor {
  return {
    id: 'cor-1',
    slug: 'reforma-am',
    name: 'Reforma → Alameda (Mañana)',
    road: 'Paseo de la Reforma',
    origin_lat: 19.4001,
    origin_lng: -99.1892,
    dest_lat: 19.4354,
    dest_lng: -99.1452,
    window_start: '07:00:00',
    window_end: '10:00:00',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeContract(overrides: Partial<ContractWithTiers>): ContractWithTiers {
  return {
    id: 'id-1',
    slug: 'test-contract',
    title: 'Test contract',
    description: null,
    category_id: 'cat-1',
    category: { id: 'cat-1', name: 'Urban', slug: 'urban', color: '#94a3b8', icon_url: null, display_order: 1 },
    status: 'active',
    trigger_type: 'urban',
    trigger_condition: {},
    trigger_deadline: '2027-01-01T00:00:00Z',
    is_recurring: false,
    location: { lat: 0, lng: 0, city: 'Mexico City', country: 'MX' },
    icon_url: null,
    total_volume_usd: 0,
    total_volume_mxn: 0,
    is_featured: false,
    settled_outcome: null,
    created_by: 'admin',
    created_at: new Date().toISOString(),
    settled_at: null,
    coverage_tiers: [],
    corridor: null,
    ...overrides,
  }
}

describe('ContractSection road chips', () => {
  it('renders an All chip and one chip per distinct corridor road for urban contracts', () => {
    const contracts = [
      makeContract({ id: '1', corridor: makeCorridor({ road: 'Paseo de la Reforma' }) }),
      makeContract({ id: '2', corridor: makeCorridor({ road: 'Paseo de la Reforma', slug: 'reforma-pm', window_start: '17:00:00' }) }),
      makeContract({ id: '3', corridor: makeCorridor({ road: 'Circuito Bicentenario', slug: 'bicentenario-am' }) }),
    ]
    render(<ContractSection categoryName="Urban" categorySlug="urban" contracts={contracts} currency="USD" />)

    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Circuito Bicentenario' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Paseo de la Reforma' })).toBeInTheDocument()
  })

  it('filters contracts to the selected corridor road when a chip is clicked', async () => {
    const contracts = [
      makeContract({ id: '1', title: 'Reforma Morning', corridor: makeCorridor({ road: 'Paseo de la Reforma' }) }),
      makeContract({ id: '2', title: 'Reforma Evening', corridor: makeCorridor({ road: 'Paseo de la Reforma', slug: 'reforma-pm', window_start: '17:00:00' }) }),
      makeContract({ id: '3', title: 'Bicentenario Morning', corridor: makeCorridor({ road: 'Circuito Bicentenario', slug: 'bicentenario-am' }) }),
    ]
    render(<ContractSection categoryName="Urban" categorySlug="urban" contracts={contracts} currency="USD" />)

    await userEvent.click(screen.getByRole('button', { name: 'Circuito Bicentenario' }))

    expect(screen.getByText('Bicentenario Morning')).toBeInTheDocument()
    expect(screen.queryByText('Reforma Morning')).not.toBeInTheDocument()
    expect(screen.queryByText('Reforma Evening')).not.toBeInTheDocument()
  })

  it('keeps a contract with no corridor visible under All but hides it when a road chip is active', async () => {
    const contracts = [
      makeContract({ id: '1', title: 'General Traffic', corridor: null }),
      makeContract({ id: '2', title: 'Reforma Morning', corridor: makeCorridor({ road: 'Paseo de la Reforma' }) }),
    ]
    render(<ContractSection categoryName="Urban" categorySlug="urban" contracts={contracts} currency="USD" />)

    expect(screen.getByText('General Traffic')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Paseo de la Reforma' }))

    expect(screen.queryByText('General Traffic')).not.toBeInTheDocument()
    expect(screen.getByText('Reforma Morning')).toBeInTheDocument()
  })

  it('renders no chip row for non-urban categories', () => {
    const contracts = [
      makeContract({
        id: '1',
        category: { id: 'cat-2', name: 'Nature', slug: 'nature', color: '#34d399', icon_url: null, display_order: 2 },
      }),
    ]
    render(<ContractSection categoryName="Nature" categorySlug="nature" contracts={contracts} currency="USD" />)

    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/components/ContractSection.test.tsx`
Expected: FAIL — `Unable to find role="button" with name "All"` (no chip row yet)

- [ ] **Step 3: Write the implementation**

Replace the full contents of `components/contracts/ContractSection.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import ContractCard from './ContractCard'
import AddContractCard from './AddContractCard'
import { cn } from '@/lib/utils'
import { getUrbanRoads } from '@/lib/corridors'
import type { ContractWithTiers, Currency, CategoryName } from '@/lib/types'

const SECTION_STYLES: Record<string, string> = {
  urban:       'text-category-urban',
  nature:      'text-category-nature',
  experiences: 'text-category-experiences',
  events:      'text-category-events',
}

const SECTION_DESCRIPTIONS: Record<string, string> = {
  urban:       'City disruptions · Infrastructure · Mobility',
  nature:      'Weather · Earthquakes · Temperature extremes',
  experiences: 'Travel · Outdoor activities · Vacations',
  events:      'Concerts · Conferences · Public gatherings',
}

const SECTION_ICONS: Record<string, string> = {
  urban:       '🏙️',
  nature:      '🌿',
  experiences: '🎿',
  events:      '🎤',
}

const CHIP_BASE = 'rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] transition-colors'
const CHIP_ACTIVE = 'border-category-urban/30 bg-category-urban/10 text-category-urban'
const CHIP_INACTIVE = 'border-white/10 text-insu-muted hover:text-insu-text hover:border-white/20'

interface Props {
  categoryName: CategoryName
  categorySlug: string
  contracts: ContractWithTiers[]
  currency: Currency
}

export default function ContractSection({
  categoryName,
  categorySlug,
  contracts,
  currency,
}: Props) {
  const [activeRoad, setActiveRoad] = useState<string | null>(null)

  const roads = categorySlug === 'urban' ? getUrbanRoads(contracts) : []
  const visibleContracts = activeRoad
    ? contracts.filter((c) => c.corridor?.road === activeRoad)
    : contracts

  return (
    <section className="mt-9 first:mt-0">
      <div className="mb-4 flex items-baseline gap-3">
        <h2
          className={cn(
            'font-display text-[28px] tracking-[2px]',
            SECTION_STYLES[categorySlug] ?? ''
          )}
        >
          {SECTION_ICONS[categorySlug]} {categoryName}
        </h2>
        <p className="text-[12px] font-medium tracking-[0.05em] text-insu-muted">
          {SECTION_DESCRIPTIONS[categorySlug]}
        </p>
        <div className="h-px flex-1 bg-white/[0.07]" />
      </div>

      {roads.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveRoad(null)}
            className={cn(CHIP_BASE, activeRoad === null ? CHIP_ACTIVE : CHIP_INACTIVE)}
          >
            All
          </button>
          {roads.map((road) => (
            <button
              key={road}
              onClick={() => setActiveRoad(activeRoad === road ? null : road)}
              className={cn(CHIP_BASE, activeRoad === road ? CHIP_ACTIVE : CHIP_INACTIVE)}
            >
              {road}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-3">
        {visibleContracts.map((contract) => (
          <ContractCard
            key={contract.id}
            contract={contract}
            currency={currency}
            badge={contract.is_featured ? 'trending' : undefined}
          />
        ))}
        <AddContractCard />
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/components/ContractSection.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add components/contracts/ContractSection.tsx tests/components/ContractSection.test.tsx
git commit -m "feat: add corridor road filter chips to Urban section"
```

---

### Task 5: `ContractSection` — time-aware "Recommended" badge

**Files:**
- Modify: `components/contracts/ContractSection.tsx`
- Test: `tests/components/ContractSection.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `tests/components/ContractSection.test.tsx` (same file as Task 4, add `vi` and `afterEach` to the existing `import { describe, it, expect } from 'vitest'` so it reads `import { describe, it, expect, vi, afterEach } from 'vitest'`):

```tsx
describe('ContractSection recommended badge', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a recommended badge on the corridor contract matching the current commute period', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T08:00:00')) // 08:00 -> recommended period is "evening"

    const contracts = [
      makeContract({ id: '1', title: 'Reforma Morning', corridor: makeCorridor({ road: 'Paseo de la Reforma', window_start: '07:00:00' }) }),
      makeContract({ id: '2', title: 'Reforma Evening', corridor: makeCorridor({ road: 'Paseo de la Reforma', slug: 'reforma-pm', window_start: '17:00:00' }) }),
    ]
    render(<ContractSection categoryName="Urban" categorySlug="urban" contracts={contracts} currency="USD" />)

    const eveningCard = screen.getByText('Reforma Evening').closest('article')
    const morningCard = screen.getByText('Reforma Morning').closest('article')
    expect(eveningCard).toHaveTextContent('recommended')
    expect(morningCard).not.toHaveTextContent('recommended')
  })

  it('shows recommended instead of trending when a featured contract also matches the recommended period', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T08:00:00')) // -> "evening" recommended

    const contracts = [
      makeContract({
        id: '1',
        title: 'Reforma Evening',
        is_featured: true,
        corridor: makeCorridor({ road: 'Paseo de la Reforma', slug: 'reforma-pm', window_start: '17:00:00' }),
      }),
    ]
    render(<ContractSection categoryName="Urban" categorySlug="urban" contracts={contracts} currency="USD" />)

    const card = screen.getByText('Reforma Evening').closest('article')
    expect(card).toHaveTextContent('recommended')
    expect(card).not.toHaveTextContent('trending')
  })

  it('keeps the trending badge for a featured contract with no corridor', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-14T08:00:00'))

    const contracts = [
      makeContract({ id: '1', title: 'General Traffic', is_featured: true, corridor: null }),
    ]
    render(<ContractSection categoryName="Urban" categorySlug="urban" contracts={contracts} currency="USD" />)

    const card = screen.getByText('General Traffic').closest('article')
    expect(card).toHaveTextContent('trending')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/components/ContractSection.test.tsx`
Expected: FAIL — the new tests fail because no card has `recommended` text yet (badge logic still only checks `is_featured`)

- [ ] **Step 3: Write the implementation**

In `components/contracts/ContractSection.tsx`:

1. Update the import from `lib/corridors` (currently `import { getUrbanRoads } from '@/lib/corridors'`):

```ts
import { getContractPeriod, getRecommendedPeriod, getUrbanRoads } from '@/lib/corridors'
```

2. Inside the component body, after `const visibleContracts = ...`, add:

```ts
  const recommendedPeriod = getRecommendedPeriod()
```

3. Replace the grid's `.map` body:

```tsx
      <div className="grid grid-cols-4 gap-3">
        {visibleContracts.map((contract) => (
          <ContractCard
            key={contract.id}
            contract={contract}
            currency={currency}
            badge={contract.is_featured ? 'trending' : undefined}
          />
        ))}
        <AddContractCard />
      </div>
```

with:

```tsx
      <div className="grid grid-cols-4 gap-3">
        {visibleContracts.map((contract) => {
          const badge =
            contract.corridor && getContractPeriod(contract.corridor) === recommendedPeriod
              ? 'recommended'
              : contract.is_featured
                ? 'trending'
                : undefined
          return (
            <ContractCard
              key={contract.id}
              contract={contract}
              currency={currency}
              badge={badge}
            />
          )
        })}
        <AddContractCard />
      </div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/components/ContractSection.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add components/contracts/ContractSection.tsx tests/components/ContractSection.test.tsx
git commit -m "feat: add time-aware recommended badge to Urban corridor contracts"
```

---

### Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all existing tests plus the new ones in `tests/lib/corridors.test.ts`, `tests/components/ContractCard.test.tsx`, and `tests/components/ContractSection.test.tsx`

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no errors

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual check in the browser**

Run: `npm run dev`, open the home page, and confirm:
- The Urban section shows an "All" chip plus one chip per corridor road
- Clicking a road chip filters the grid to that corridor's Morning/Evening cards
- One card per corridor pair shows a blue "recommended" badge, consistent with the current time of day
- Other category sections (Nature, Experiences, Events) are unchanged — no chip row
