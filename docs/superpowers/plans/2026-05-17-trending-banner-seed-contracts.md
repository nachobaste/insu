# Trending Banner + Seed Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the browse page with ~12 new Latin American contracts and add a "Trending Now" featured row above the regular contract sections.

**Architecture:** Two independent tracks. Track A adds contracts to the seed script. Track B (1) extracts a pure `scoreTrending()` utility, (2) builds a `TrendingSection` component, and (3) wires both into `BrowseClient`. No DB migrations needed — trending is computed in the browser from already-loaded data.

**Tech Stack:** Next.js 14 App Router, React, Tailwind CSS, TypeScript, Vitest + React Testing Library, Supabase (seed script only)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `scripts/seed-contracts.ts` | Modify | Add 12 new contracts |
| `lib/trending.ts` | Create | Pure `scoreTrending()` function |
| `tests/lib/trending.test.ts` | Create | Unit tests for the scoring logic |
| `components/contracts/TrendingSection.tsx` | Create | Trending featured row UI |
| `tests/components/TrendingSection.test.tsx` | Create | Render tests for TrendingSection |
| `app/BrowseClient.tsx` | Modify | Wire scoring + render TrendingSection |

---

## Track A — Seed Contracts

### Task 1: Add seed contracts to the seed script

**Files:**
- Modify: `scripts/seed-contracts.ts`

- [ ] **Step 1: Open `scripts/seed-contracts.ts` and locate the `contracts` array** (it ends before the `for` loop that inserts records). Append the following 12 objects inside the array, after the existing 5:

```ts
    // ── Urban ────────────────────────────────────────────────────────────────
    {
      slug: 'cdmx-air-quality-alert',
      title: 'Air quality emergency declared in CDMX?',
      category_id: catMap['urban'],
      trigger_type: 'manual',
      trigger_condition: { type: 'air_quality', index_threshold: 150, source: 'SIMAT' },
      trigger_deadline: '2026-12-31T23:59:59Z',
      location: { lat: 19.4326, lng: -99.1332, city: 'CDMX', country: 'MX' },
      icon_url: null,
      total_volume_usd: 4_200_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 80,  payout_usd: 400,  premium_mxn: 1360,  payout_mxn: 6800,  base_probability: 0.20 },
        { name: 'premium', premium_usd: 450, payout_usd: 1500, premium_mxn: 7650,  payout_mxn: 25500, base_probability: 0.20 },
      ],
    },
    {
      slug: 'sao-paulo-metro-shutdown',
      title: 'São Paulo metro line shutdown during rush hour?',
      category_id: catMap['urban'],
      trigger_type: 'urban',
      trigger_condition: { type: 'transit_disruption', min_duration_hours: 1, network: 'metro_sp' },
      trigger_deadline: '2026-09-30T23:59:59Z',
      location: { lat: -23.5505, lng: -46.6333, city: 'São Paulo', country: 'BR' },
      icon_url: null,
      total_volume_usd: 3_100_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 60,  payout_usd: 300,  premium_mxn: 1020, payout_mxn: 5100,  base_probability: 0.28 },
        { name: 'premium', premium_usd: 350, payout_usd: 1200, premium_mxn: 5950, payout_mxn: 20400, base_probability: 0.28 },
      ],
    },
    {
      slug: 'bogota-water-shortage',
      title: 'Water supply cut in Bogotá lasting 6+ hours?',
      category_id: catMap['urban'],
      trigger_type: 'manual',
      trigger_condition: { type: 'water_outage', min_duration_hours: 6 },
      trigger_deadline: '2026-11-30T23:59:59Z',
      location: { lat: 4.7110, lng: -74.0721, city: 'Bogotá', country: 'CO' },
      icon_url: null,
      total_volume_usd: 2_400_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 70,  payout_usd: 350,  premium_mxn: 1190, payout_mxn: 5950,  base_probability: 0.15 },
        { name: 'premium', premium_usd: 400, payout_usd: 1400, premium_mxn: 6800, payout_mxn: 23800, base_probability: 0.15 },
      ],
    },
    {
      slug: 'buenos-aires-blackout',
      title: 'Major blackout in Buenos Aires lasting 3+ hours?',
      category_id: catMap['urban'],
      trigger_type: 'manual',
      trigger_condition: { type: 'power_outage', min_duration_hours: 3, city: 'Buenos Aires' },
      trigger_deadline: '2027-02-28T23:59:59Z',
      location: { lat: -34.6037, lng: -58.3816, city: 'Buenos Aires', country: 'AR' },
      icon_url: null,
      total_volume_usd: 5_800_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 90,  payout_usd: 450,  premium_mxn: 1530, payout_mxn: 7650,  base_probability: 0.16 },
        { name: 'premium', premium_usd: 500, payout_usd: 1800, premium_mxn: 8500, payout_mxn: 30600, base_probability: 0.16 },
      ],
    },

    // ── Nature ───────────────────────────────────────────────────────────────
    {
      slug: 'popocatepetl-eruption-alert',
      title: 'Popocatépetl eruption alert (Yellow Phase 3) issued?',
      category_id: catMap['nature'],
      trigger_type: 'weather',
      trigger_condition: { type: 'volcanic_alert', volcano: 'Popocatepetl', min_phase: 3 },
      trigger_deadline: '2026-12-31T23:59:59Z',
      location: { lat: 19.0228, lng: -98.6277, city: 'CDMX', country: 'MX' },
      icon_url: null,
      total_volume_usd: 1_900_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 150, payout_usd: 3000, premium_mxn: 2550,  payout_mxn: 51000, base_probability: 0.06 },
        { name: 'premium', premium_usd: 700, payout_usd: 7000, premium_mxn: 11900, payout_mxn: 119000, base_probability: 0.06 },
      ],
    },
    {
      slug: 'caribbean-hurricane-landfall',
      title: 'Category 3+ hurricane landfall on Mexican Caribbean coast?',
      category_id: catMap['nature'],
      trigger_type: 'weather',
      trigger_condition: { type: 'hurricane', min_category: 3, region: 'mexican_caribbean' },
      trigger_deadline: '2026-11-30T23:59:59Z',
      location: { lat: 21.1619, lng: -86.8515, city: 'Cancún', country: 'MX' },
      icon_url: null,
      total_volume_usd: 7_500_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 300,  payout_usd: 6000,  premium_mxn: 5100,  payout_mxn: 102000, base_probability: 0.08 },
        { name: 'premium', premium_usd: 1200, payout_usd: 12000, premium_mxn: 20400, payout_mxn: 204000, base_probability: 0.08 },
      ],
    },
    {
      slug: 'amazon-flood-alert',
      title: 'Amazon River flood alert declared in Manaus?',
      category_id: catMap['nature'],
      trigger_type: 'weather',
      trigger_condition: { type: 'flood_alert', river: 'Amazon', city: 'Manaus' },
      trigger_deadline: '2026-07-31T23:59:59Z',
      location: { lat: -3.1019, lng: -60.0250, city: 'Manaus', country: 'BR' },
      icon_url: null,
      total_volume_usd: 920_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 200, payout_usd: 2000, premium_mxn: 3400,  payout_mxn: 34000, base_probability: 0.30 },
        { name: 'premium', premium_usd: 800, payout_usd: 5000, premium_mxn: 13600, payout_mxn: 85000, base_probability: 0.30 },
      ],
    },
    {
      slug: 'northern-mexico-drought',
      title: 'Drought emergency declared in northern Mexico?',
      category_id: catMap['nature'],
      trigger_type: 'weather',
      trigger_condition: { type: 'drought_emergency', region: 'northern_mexico' },
      trigger_deadline: '2026-10-31T23:59:59Z',
      location: { lat: 25.6866, lng: -100.3161, city: 'Monterrey', country: 'MX' },
      icon_url: null,
      total_volume_usd: 680_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 120, payout_usd: 1200, premium_mxn: 2040,  payout_mxn: 20400, base_probability: 0.22 },
        { name: 'premium', premium_usd: 600, payout_usd: 4000, premium_mxn: 10200, payout_mxn: 68000, base_probability: 0.22 },
      ],
    },

    // ── Experiences ──────────────────────────────────────────────────────────
    {
      slug: 'cancun-beach-closure',
      title: 'Cancún hotel zone beaches closed due to sargassum?',
      category_id: catMap['experiences'],
      trigger_type: 'manual',
      trigger_condition: { type: 'beach_closure', cause: 'sargassum', location: 'cancun_hotel_zone' },
      trigger_deadline: '2026-09-30T23:59:59Z',
      location: { lat: 21.1619, lng: -86.8515, city: 'Cancún', country: 'MX' },
      icon_url: null,
      total_volume_usd: 1_450_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 250,  payout_usd: 1000, premium_mxn: 4250,  payout_mxn: 17000, base_probability: 0.35 },
        { name: 'premium', premium_usd: 1500, payout_usd: 6000, premium_mxn: 25500, payout_mxn: 102000, base_probability: 0.35 },
      ],
    },
    {
      slug: 'carnaval-rio-shortened',
      title: 'Rio Carnaval 2027 shortened or cancelled?',
      category_id: catMap['experiences'],
      trigger_type: 'manual',
      trigger_condition: { type: 'event_disruption', event: 'Rio Carnaval 2027' },
      trigger_deadline: '2027-02-28T23:59:59Z',
      location: { lat: -22.9068, lng: -43.1729, city: 'Rio de Janeiro', country: 'BR' },
      icon_url: null,
      total_volume_usd: 3_800_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 180,  payout_usd: 900,  premium_mxn: 3060,  payout_mxn: 15300, base_probability: 0.05 },
        { name: 'premium', premium_usd: 1000, payout_usd: 3500, premium_mxn: 17000, payout_mxn: 59500, base_probability: 0.05 },
      ],
    },
    {
      slug: 'patagonia-trail-closed',
      title: 'Torres del Paine "W Trek" closed for the season?',
      category_id: catMap['experiences'],
      trigger_type: 'manual',
      trigger_condition: { type: 'trail_closure', trail: 'W Trek', park: 'Torres del Paine' },
      trigger_deadline: '2026-11-30T23:59:59Z',
      location: { lat: -50.9423, lng: -73.4068, city: 'Punta Arenas', country: 'CL' },
      icon_url: null,
      total_volume_usd: 540_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 2000, payout_usd: 8000,  premium_mxn: 34000, payout_mxn: 136000, base_probability: 0.18 },
        { name: 'premium', premium_usd: 5000, payout_usd: 20000, premium_mxn: 85000, payout_mxn: 340000, base_probability: 0.18 },
      ],
    },

    // ── Events ───────────────────────────────────────────────────────────────
    {
      slug: 'karol-g-medellin-cancelled',
      title: 'Karol G concert in Medellín cancelled?',
      category_id: catMap['events'],
      trigger_type: 'manual',
      trigger_condition: { type: 'event_cancellation', event_name: 'Karol G Medellín' },
      trigger_deadline: '2026-10-31T23:59:59Z',
      location: { lat: 6.2442, lng: -75.5812, city: 'Medellín', country: 'CO' },
      icon_url: null,
      total_volume_usd: 2_100_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 150, payout_usd: 900,  premium_mxn: 2550,  payout_mxn: 15300, base_probability: 0.05 },
        { name: 'premium', premium_usd: 800, payout_usd: 3200, premium_mxn: 13600, payout_mxn: 54400, base_probability: 0.05 },
      ],
    },
    {
      slug: 'lollapalooza-bsas-cancelled',
      title: 'Lollapalooza Argentina cancelled or postponed?',
      category_id: catMap['events'],
      trigger_type: 'manual',
      trigger_condition: { type: 'event_cancellation', event_name: 'Lollapalooza Argentina' },
      trigger_deadline: '2027-03-31T23:59:59Z',
      location: { lat: -34.6037, lng: -58.3816, city: 'Buenos Aires', country: 'AR' },
      icon_url: null,
      total_volume_usd: 4_600_000,
      is_featured: false,
      tiers: [
        { name: 'basic',   premium_usd: 300,  payout_usd: 1500, premium_mxn: 5100,  payout_mxn: 25500, base_probability: 0.06 },
        { name: 'premium', premium_usd: 1500, payout_usd: 5000, premium_mxn: 25500, payout_mxn: 85000, base_probability: 0.06 },
      ],
    },
```

- [ ] **Step 2: Run the seed script**

```bash
npx ts-node scripts/seed-contracts.ts
```

Expected output: lines like `✓ Inserted: cdmx-air-quality-alert` for each new contract (the script already has this logging pattern). If a slug already exists it will error — that's fine, fix the duplicate slug.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-contracts.ts
git commit -m "seed: add 12 Latin America contracts across all categories"
```

---

## Track B — Trending Banner

### Task 2: Create the `scoreTrending` utility with tests

**Files:**
- Create: `lib/trending.ts`
- Create: `tests/lib/trending.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/trending.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { scoreTrending } from '@/lib/trending'
import type { ContractWithTiers } from '@/lib/types'

function makeContract(overrides: Partial<ContractWithTiers>): ContractWithTiers {
  return {
    id: 'id-1',
    slug: 'test-contract',
    title: 'Test',
    description: null,
    category_id: 'cat-1',
    category: { id: 'cat-1', name: 'Urban', slug: 'urban', color: '#94a3b8', icon_url: null, display_order: 1 },
    status: 'active',
    trigger_type: 'manual',
    trigger_condition: {},
    trigger_deadline: '2027-01-01T00:00:00Z',
    location: { lat: 0, lng: 0, city: 'Test', country: 'MX' },
    icon_url: null,
    total_volume_usd: 1_000_000,
    total_volume_mxn: 0,
    is_featured: false,
    settled_outcome: null,
    created_by: 'admin',
    created_at: new Date().toISOString(),
    settled_at: null,
    coverage_tiers: [],
    ...overrides,
  }
}

describe('scoreTrending', () => {
  it('returns top 4 contracts by score', () => {
    const contracts = [
      makeContract({ id: '1', total_volume_usd: 1_000_000 }),
      makeContract({ id: '2', total_volume_usd: 9_000_000 }),
      makeContract({ id: '3', total_volume_usd: 5_000_000 }),
      makeContract({ id: '4', total_volume_usd: 3_000_000 }),
      makeContract({ id: '5', total_volume_usd: 500_000 }),
    ]
    const result = scoreTrending(contracts)
    expect(result).toHaveLength(4)
    expect(result[0].id).toBe('2')
    expect(result[1].id).toBe('3')
  })

  it('applies 0.5 recency weight to contracts older than 60 days', () => {
    const old = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString()
    const recent = new Date().toISOString()
    const contracts = [
      makeContract({ id: 'old',    total_volume_usd: 10_000_000, created_at: old }),
      makeContract({ id: 'recent', total_volume_usd: 6_000_000,  created_at: recent }),
    ]
    // old score = 10_000_000 * 0.5 = 5_000_000
    // recent score = 6_000_000 * 1.0 = 6_000_000  → recent wins
    const result = scoreTrending(contracts)
    expect(result[0].id).toBe('recent')
  })

  it('returns fewer than 4 if the input has fewer than 4 contracts', () => {
    const contracts = [
      makeContract({ id: '1' }),
      makeContract({ id: '2' }),
    ]
    expect(scoreTrending(contracts)).toHaveLength(2)
  })

  it('returns empty array for empty input', () => {
    expect(scoreTrending([])).toHaveLength(0)
  })

  it('does not mutate the original array', () => {
    const contracts = [
      makeContract({ id: '1', total_volume_usd: 5_000_000 }),
      makeContract({ id: '2', total_volume_usd: 9_000_000 }),
    ]
    const original = [...contracts]
    scoreTrending(contracts)
    expect(contracts[0].id).toBe(original[0].id)
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run tests/lib/trending.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/trending'`

- [ ] **Step 3: Create `lib/trending.ts`**

```ts
import type { ContractWithTiers } from './types'

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000

export function scoreTrending(contracts: ContractWithTiers[], limit = 4): ContractWithTiers[] {
  const now = Date.now()
  return [...contracts]
    .map((c) => {
      const age = now - new Date(c.created_at).getTime()
      const recencyWeight = age <= SIXTY_DAYS_MS ? 1.0 : 0.5
      return { contract: c, score: c.total_volume_usd * recencyWeight }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ contract }) => contract)
}
```

- [ ] **Step 4: Run to confirm tests pass**

```bash
npx vitest run tests/lib/trending.test.ts
```

Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/trending.ts tests/lib/trending.test.ts
git commit -m "feat: add scoreTrending utility with recency-weighted volume scoring"
```

---

### Task 3: Build the `TrendingSection` component with tests

**Files:**
- Create: `components/contracts/TrendingSection.tsx`
- Create: `tests/components/TrendingSection.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `tests/components/TrendingSection.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import TrendingSection from '@/components/contracts/TrendingSection'
import type { ContractWithTiers } from '@/lib/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

function makeContract(overrides: Partial<ContractWithTiers>): ContractWithTiers {
  return {
    id: 'id-1',
    slug: 'test-slug',
    title: 'Test contract title',
    description: null,
    category_id: 'cat-1',
    category: { id: 'cat-1', name: 'Urban', slug: 'urban', color: '#94a3b8', icon_url: null, display_order: 1 },
    status: 'active',
    trigger_type: 'manual',
    trigger_condition: {},
    trigger_deadline: '2027-01-01T00:00:00Z',
    location: { lat: 0, lng: 0, city: 'CDMX', country: 'MX' },
    icon_url: null,
    total_volume_usd: 1_000_000,
    total_volume_mxn: 0,
    is_featured: false,
    settled_outcome: null,
    created_by: 'admin',
    created_at: new Date().toISOString(),
    settled_at: null,
    coverage_tiers: [
      {
        id: 'tier-1',
        contract_id: 'id-1',
        name: 'basic',
        premium_usd: 100,
        payout_usd: 500,
        premium_mxn: 1700,
        payout_mxn: 8500,
        max_capacity_usd: 100000,
        current_capacity_usd: 50000,
        base_probability: 0.18,
        last_priced_at: null,
        pricing_inputs: null,
      },
    ],
    ...overrides,
  }
}

describe('TrendingSection', () => {
  it('renders the section heading', () => {
    render(<TrendingSection contracts={[makeContract({})]} currency="USD" />)
    expect(screen.getByText('Trending Now')).toBeInTheDocument()
  })

  it('renders a card for each contract', () => {
    const contracts = [
      makeContract({ id: '1', title: 'Contract Alpha' }),
      makeContract({ id: '2', title: 'Contract Beta' }),
    ]
    render(<TrendingSection contracts={contracts} currency="USD" />)
    expect(screen.getByText('Contract Alpha')).toBeInTheDocument()
    expect(screen.getByText('Contract Beta')).toBeInTheDocument()
  })

  it('renders the cheapest tier premium as the "from" price in USD', () => {
    render(<TrendingSection contracts={[makeContract({})]} currency="USD" />)
    expect(screen.getByText('$100')).toBeInTheDocument()
  })

  it('renders nothing when contracts array is empty', () => {
    const { container } = render(<TrendingSection contracts={[]} currency="USD" />)
    expect(container.firstChild).toBeNull()
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run tests/components/TrendingSection.test.tsx
```

Expected: FAIL — `Cannot find module '@/components/contracts/TrendingSection'`

- [ ] **Step 3: Create `components/contracts/TrendingSection.tsx`**

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { cn, formatCurrency } from '@/lib/utils'
import type { ContractWithTiers, Currency } from '@/lib/types'

const CATEGORY_STYLES: Record<string, { border: string; icon: string; text: string; pill: string }> = {
  urban:       { border: 'border-category-urban',       icon: 'bg-category-urban/10',       text: 'text-category-urban',       pill: 'bg-category-urban/10 text-category-urban' },
  nature:      { border: 'border-category-nature',      icon: 'bg-category-nature/10',      text: 'text-category-nature',      pill: 'bg-category-nature/10 text-category-nature' },
  experiences: { border: 'border-category-experiences', icon: 'bg-category-experiences/10', text: 'text-category-experiences', pill: 'bg-category-experiences/10 text-category-experiences' },
  events:      { border: 'border-category-events',      icon: 'bg-category-events/10',      text: 'text-category-events',      pill: 'bg-category-events/10 text-category-events' },
}

const CATEGORY_ICONS: Record<string, string> = {
  urban: '🏙️', nature: '🌿', experiences: '🎿', events: '🎤',
}

interface Props {
  contracts: ContractWithTiers[]
  currency: Currency
}

export default function TrendingSection({ contracts, currency }: Props) {
  const router = useRouter()

  if (contracts.length === 0) return null

  return (
    <section className="mb-8">
      <div className="mb-4 flex items-center gap-2.5">
        <span aria-hidden="true">🔥</span>
        <h2 className="text-[13px] font-bold tracking-[0.01em] text-insu-text">Trending Now</h2>
        <span className="animate-pulse rounded px-[7px] py-[3px] text-[9px] font-bold uppercase tracking-[0.08em] bg-insu-accent/15 text-insu-accent border border-insu-accent/25">
          Live
        </span>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {contracts.map((contract) => {
          const slug = contract.category?.slug ?? 'urban'
          const styles = CATEGORY_STYLES[slug] ?? CATEGORY_STYLES.urban
          const cheapestTier = [...contract.coverage_tiers].sort((a, b) =>
            (currency === 'USD' ? a.premium_usd - b.premium_usd : a.premium_mxn - b.premium_mxn)
          )[0]
          const fromPrice = cheapestTier
            ? formatCurrency(currency === 'USD' ? cheapestTier.premium_usd : cheapestTier.premium_mxn, currency)
            : '—'

          return (
            <article
              key={contract.id}
              onClick={() => router.push(`/markets/${contract.slug}`)}
              className={cn(
                'relative cursor-pointer overflow-hidden rounded-card border bg-bg-card p-[14px]',
                'transition-all duration-200 hover:-translate-y-0.5 hover:bg-bg-card-hover',
                'before:absolute before:inset-x-0 before:top-0 before:h-[2px]',
                styles.border,
              )}
            >
              <div
                className={cn(
                  'mb-3 flex h-[32px] w-[32px] items-center justify-center rounded-[8px] text-base',
                  styles.icon,
                )}
              >
                <span aria-hidden="true">{CATEGORY_ICONS[slug] ?? '◆'}</span>
              </div>

              <p className="mb-2.5 text-[11px] font-semibold leading-[1.4] text-insu-text">
                {contract.title}
              </p>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[8px] font-semibold uppercase tracking-[0.06em] text-insu-muted">from</p>
                  <p className={cn('text-[12px] font-bold', styles.text)}>{fromPrice}</p>
                </div>
                <span className={cn('rounded px-[6px] py-[2px] text-[8px] font-bold uppercase tracking-[0.06em]', styles.pill)}>
                  {contract.category?.name ?? slug}
                </span>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Run to confirm tests pass**

```bash
npx vitest run tests/components/TrendingSection.test.tsx
```

Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add components/contracts/TrendingSection.tsx tests/components/TrendingSection.test.tsx
git commit -m "feat: add TrendingSection component"
```

---

### Task 4: Wire TrendingSection into BrowseClient

**Files:**
- Modify: `app/BrowseClient.tsx`

- [ ] **Step 1: Add the import and scoring call**

In `app/BrowseClient.tsx`, add these two imports at the top of the file (after the existing imports):

```ts
import TrendingSection from '@/components/contracts/TrendingSection'
import { scoreTrending } from '@/lib/trending'
```

- [ ] **Step 2: Compute trending contracts inside the component**

Inside `BrowseClient`, after the line `const contracts = useRealtimeContracts(initialContracts)`, add:

```ts
const trendingContracts = scoreTrending(contracts)
```

- [ ] **Step 3: Render TrendingSection between StatsBar and the category map**

Replace the `<main>` block contents so `TrendingSection` sits between `StatsBar` and the category sections:

```tsx
<main className="mx-auto max-w-[1320px] px-8 py-7">
  <StatsBar stats={stats} />

  {trendingContracts.length >= 2 && (
    <TrendingSection contracts={trendingContracts} currency="USD" />
  )}

  {visibleCategories.map((cat) => {
    const catContracts = contracts.filter(
      (c) => c.category?.slug === cat.slug
    )
    if (catContracts.length === 0) return null
    return (
      <ContractSection
        key={cat.id}
        categoryName={cat.name}
        categorySlug={cat.slug}
        contracts={catContracts}
        currency="USD"
      />
    )
  })}
</main>
```

> **Note:** `BrowseClient` hardcodes `currency="USD"` throughout — no currency prop exists. Use the literal string for both `TrendingSection` and `ContractSection`.

- [ ] **Step 4: Run the full test suite**

```bash
npx vitest run --passWithNoTests
```

Expected: all existing tests PASS, no regressions

- [ ] **Step 5: Verify visually**

```bash
npm run dev
```

Open `http://localhost:3000`. Confirm:
- StatsBar renders unchanged at the top
- "🔥 Trending Now" row appears below StatsBar with 4 cards
- Category sections (Urban, Nature, Experiences, Events) appear below as before
- Clicking a trending card navigates to `/markets/[slug]`

- [ ] **Step 6: Commit**

```bash
git add app/BrowseClient.tsx
git commit -m "feat: wire TrendingSection into browse page with volume+recency scoring"
```
