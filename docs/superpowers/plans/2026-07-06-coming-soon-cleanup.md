# Browse Cleanup: Live Products vs Coming Soon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New users browsing Insu (Mexico and International) see only purchasable products with working oracles (traffic, gas, flood, air quality), with curated demo coverages moved to a dimmed Coming Soon rail that offers a notify-me signup.

**Architecture:** An explicit `contracts.launch_stage` column (`'live'` | `'coming_soon'`) drives everything. The browse page becomes a two-zone layout: live products grouped by product type (Traffic / Gas / Flood & Air quality), Coming Soon rail at the bottom. Coming-soon detail pages swap the purchase panel for a notify-me block backed by a `launch_interest` table; flipping a contract live fans out a `product_launched` in-app notification.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS), Vitest + React Testing Library, Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-06-coming-soon-cleanup-design.md`

**Prod inventory context (2026-07-06):** 17 live products (14 traffic corridors, gas-price-magna-cdmx, flood-heavy-rain-cdmx, air-quality-contingencia-cdmx). Coming Soon keepers (10): caribbean-hurricane-landfall, guadalajara-flash-flood, cabo-heatwave, cancun-beach-closure, whistler-snow-20cm, amazon-flood-alert, sao-paulo-metro-shutdown, gas-price-guatemala-q45, bogota-water-shortage, buenos-aires-blackout. Cancel (10 dated/expired): earthquakes-7-june-30, cdmx-marathon-rain, oaxaca-food-festival, bad-bunny-cancelled, karol-g-medellin-cancelled, lollapalooza-bsas-cancelled, monterrey-tech-summit, carnaval-rio-shortened, patagonia-trail-closed, diablos-rojos-vs-tigres-de-quintana-roo-mp99hwh4. (Borderline calls from the spec resolved here: keep cancun-beach-closure for MX breadth, cancel patagonia-trail-closed.)

**Conventions:** run tests with `npx vitest run <path>`; migrations use `gen_random_uuid()` (never `uuid_generate_v4()`); admin writes use `createServiceClient()`; the migration is applied to prod only at deploy time (`supabase db push --linked < /dev/null`), never during development.

---

## File Structure

```
supabase/migrations/20260707000001_launch_stage.sql   (create — column, constraint, launch_interest, curation)
lib/types.ts                                          (modify — LaunchStage, Contract, UpsertContractInput, NotificationType/Prefs)
lib/launch.ts                                         (create — partitionByLaunchStage, groupLiveContracts)
lib/actions/launch-interest.ts                        (create — toggleLaunchInterest server action)
lib/actions/admin.ts                                  (modify — launch_stage in upsert + product_launched fan-out)
app/page.tsx                                          (modify — stats scoped to live, drop categories fetch)
app/BrowseClient.tsx                                  (modify — two-zone layout, drop CategoryTabs)
app/markets/[slug]/page.tsx                           (modify — coming-soon detection + interest preload)
components/contracts/ContractCard.tsx                 (modify — comingSoon variant)
components/contracts/ContractSection.tsx              (modify — title/icon/description props)
components/contracts/ComingSoonSection.tsx            (create — dimmed rail)
components/markets/ComingSoonPanel.tsx                (create — notify-me block)
components/markets/ContractDetailClient.tsx           (modify — comingSoon mode)
components/admin/contracts/ContractForm.tsx           (modify — launch-stage select)
components/profile/ProfileForm.tsx                    (modify — product_launched pref label)
components/layout/CategoryTabs.tsx                    (delete)
tests/lib/launch.test.ts                              (create)
tests/components/ComingSoonSection.test.tsx           (create)
tests/components/ComingSoonPanel.test.tsx             (create)
tests/components/ContractCard.test.tsx                (modify)
tests/components/ContractSection.test.tsx             (modify)
tests/components/ContractDetailClient.test.tsx        (modify)
tests/components/CategoryTabs.test.tsx                (delete)
```

Work on branch `feat/coming-soon-cleanup` off `main`.

---

### Task 1: Migration — `launch_stage`, `launch_interest`, curation

**Files:**
- Create: `supabase/migrations/20260707000001_launch_stage.sql`

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/coming-soon-cleanup
```

- [ ] **Step 2: Write the migration**

```sql
-- Launch-stage cleanup: separate purchasable products (working oracle + live
-- pricing) from Coming Soon teasers, and cancel expired demo contracts.
-- See docs/superpowers/specs/2026-07-06-coming-soon-cleanup-design.md.

-- 1) Explicit launch stage. Default 'live' so existing purchase/payout flows
--    and future oracle-backed contracts are unaffected unless curated.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS launch_stage text NOT NULL DEFAULT 'live'
  CHECK (launch_stage IN ('live','coming_soon'));

-- 2) Allow the new notification type used when a product flips live.
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('coverage_paid','coverage_expired','protection_purchased',
                  'provider_settled','product_launched'));

-- 3) Notify-me interest for coming-soon products. Owner-scoped RLS; the
--    launch fan-out reads it with the service client.
CREATE TABLE launch_interest (
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, contract_id)
);

ALTER TABLE launch_interest ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own interest select" ON launch_interest FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Own interest insert" ON launch_interest FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own interest delete" ON launch_interest FOR DELETE
  USING (auth.uid() = user_id);

-- 4) Curation. Guard: never cancel a contract someone actively holds.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM hedger_positions hp
  JOIN contracts c ON c.id = hp.contract_id
  WHERE hp.status = 'active'
    AND c.slug IN (
      'earthquakes-7-june-30','cdmx-marathon-rain','oaxaca-food-festival',
      'bad-bunny-cancelled','karol-g-medellin-cancelled','lollapalooza-bsas-cancelled',
      'monterrey-tech-summit','carnaval-rio-shortened','patagonia-trail-closed',
      'diablos-rojos-vs-tigres-de-quintana-roo-mp99hwh4');
  IF n > 0 THEN
    RAISE EXCEPTION 'Refusing to cancel demo contracts: % active position(s) exist', n;
  END IF;
END $$;

-- Evergreen teasers stay browsable as Coming Soon.
UPDATE contracts SET launch_stage = 'coming_soon'
WHERE slug IN (
  'caribbean-hurricane-landfall','guadalajara-flash-flood','cabo-heatwave',
  'cancun-beach-closure','whistler-snow-20cm','amazon-flood-alert',
  'sao-paulo-metro-shutdown','gas-price-guatemala-q45',
  'bogota-water-shortage','buenos-aires-blackout');

-- Dated/expired demos disappear from browse (still visible in admin).
UPDATE contracts SET status = 'cancelled'
WHERE slug IN (
  'earthquakes-7-june-30','cdmx-marathon-rain','oaxaca-food-festival',
  'bad-bunny-cancelled','karol-g-medellin-cancelled','lollapalooza-bsas-cancelled',
  'monterrey-tech-summit','carnaval-rio-shortened','patagonia-trail-closed',
  'diablos-rojos-vs-tigres-de-quintana-roo-mp99hwh4')
  AND status NOT IN ('settled','cancelled');
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260707000001_launch_stage.sql
git commit -m "feat(db): launch_stage column, launch_interest table, demo curation"
```

---

### Task 2: Types + profile pref label

**Files:**
- Modify: `lib/types.ts:58-81` (Contract), `lib/types.ts:197-221` (UpsertContractInput), `lib/types.ts:223-241` (notification types)
- Modify: `components/profile/ProfileForm.tsx` (PREF_LABELS map, near line 97)

- [ ] **Step 1: Add `LaunchStage` and extend `Contract`**

In `lib/types.ts`, directly above `export interface Contract`:

```ts
export type LaunchStage = 'live' | 'coming_soon'
```

Inside `Contract`, after `is_featured: boolean`:

```ts
  launch_stage: LaunchStage
```

- [ ] **Step 2: Extend `UpsertContractInput`**

After `is_featured: boolean` in `UpsertContractInput`:

```ts
  launch_stage: LaunchStage
```

- [ ] **Step 3: Extend notification types**

```ts
export type NotificationType =
  | 'coverage_paid'
  | 'coverage_expired'
  | 'protection_purchased'
  | 'provider_settled'
  | 'product_launched'

export interface NotificationPrefs {
  coverage_paid: boolean
  coverage_expired: boolean
  protection_purchased: boolean
  provider_settled: boolean
  product_launched: boolean
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  coverage_paid: true,
  coverage_expired: true,
  protection_purchased: true,
  provider_settled: true,
  product_launched: true,
}
```

(No profiles migration needed: `createNotification` treats a missing pref key as opted-in — `prefs[type] === false` only blocks explicit false.)

- [ ] **Step 4: Add the profile toggle label**

In `components/profile/ProfileForm.tsx`, find the `PREF_LABELS` map (it feeds the `Object.keys(PREF_LABELS)` loop near line 97) and add:

```ts
  product_launched: 'Launch of products I asked about',
```

- [ ] **Step 5: Type-check and run the existing suites for the touched files**

```bash
npx tsc --noEmit && npx vitest run tests/components/ProfileForm.test.tsx --passWithNoTests
```

Expected: no type errors; profile tests pass (or none exist).

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts components/profile/ProfileForm.tsx
git commit -m "feat(types): launch_stage + product_launched notification type"
```

---

### Task 3: `lib/launch.ts` — partition + product grouping

**Files:**
- Create: `lib/launch.ts`
- Test: `tests/lib/launch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { partitionByLaunchStage, groupLiveContracts } from '@/lib/launch'
import type { ContractWithTiers } from '@/lib/types'

function makeContract(overrides: Record<string, unknown>): ContractWithTiers {
  return {
    id: crypto.randomUUID(),
    slug: 's',
    title: 't',
    trigger_type: 'urban',
    launch_stage: 'live',
    location: { city: 'Mexico City', country: 'MX' },
    corridor: null,
    coverage_tiers: [],
    category: { id: '1', slug: 'urban', name: 'Urban', color: '#fff', display_order: 1, icon_url: null },
    ...overrides,
  } as unknown as ContractWithTiers
}

describe('partitionByLaunchStage', () => {
  it('splits live vs coming_soon, defaulting missing stage to live', () => {
    const live = makeContract({})
    const soon = makeContract({ launch_stage: 'coming_soon' })
    const legacy = makeContract({ launch_stage: undefined })
    const result = partitionByLaunchStage([live, soon, legacy])
    expect(result.live).toEqual([live, legacy])
    expect(result.comingSoon).toEqual([soon])
  })
})

describe('groupLiveContracts', () => {
  it('groups traffic per city (Mexico City first), then gas, then flood/air', () => {
    const cdmx = makeContract({ trigger_type: 'urban', corridor: { id: 'c1', road: 'Reforma' } })
    const guate = makeContract({
      trigger_type: 'urban',
      corridor: { id: 'c2', road: 'CA-1' },
      location: { city: 'Guatemala City', country: 'GT' },
    })
    const gas = makeContract({ trigger_type: 'fuel', corridor: null })
    const flood = makeContract({ trigger_type: 'flood', corridor: null })
    const air = makeContract({ trigger_type: 'air_quality', corridor: null })

    const groups = groupLiveContracts([guate, gas, flood, air, cdmx])
    expect(groups.map((g) => g.key)).toEqual([
      'traffic-Mexico City', 'traffic-Guatemala City', 'gas', 'air-flood',
    ])
    expect(groups[0].contracts).toEqual([cdmx])
    expect(groups[1].contracts).toEqual([guate])
    expect(groups[2].contracts).toEqual([gas])
    expect(groups[3].contracts).toEqual([flood, air])
  })

  it('puts unmatched live contracts in a trailing group instead of dropping them', () => {
    const other = makeContract({ trigger_type: 'weather', corridor: null })
    const groups = groupLiveContracts([other])
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('more')
    expect(groups[0].contracts).toEqual([other])
  })

  it('omits empty groups', () => {
    expect(groupLiveContracts([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run tests/lib/launch.test.ts`
Expected: FAIL — `Cannot find module '@/lib/launch'` (or equivalent).

- [ ] **Step 3: Implement `lib/launch.ts`**

```ts
import type { ContractWithTiers } from './types'

/** One browse-page section of live products. `categorySlug` reuses the
 *  existing category color styling in ContractSection. */
export interface ProductGroup {
  key: string
  title: string
  categorySlug: string
  icon: string
  description: string
  contracts: ContractWithTiers[]
}

/** Missing/unknown stage counts as live so pre-migration rows keep working. */
export function partitionByLaunchStage<T extends { launch_stage?: string }>(
  contracts: T[],
): { live: T[]; comingSoon: T[] } {
  const live: T[] = []
  const comingSoon: T[] = []
  for (const c of contracts) {
    if (c.launch_stage === 'coming_soon') comingSoon.push(c)
    else live.push(c)
  }
  return { live, comingSoon }
}

/** Order live products the way a new user should read them:
 *  traffic per city (home market first), then gas, then flood & air. */
export function groupLiveContracts(live: ContractWithTiers[]): ProductGroup[] {
  const groups: ProductGroup[] = []

  const traffic = live.filter((c) => c.trigger_type === 'urban' && c.corridor)
  const cities = [...new Set(traffic.map((c) => c.location?.city ?? 'Other'))].sort(
    (a, b) => (a === 'Mexico City' ? -1 : b === 'Mexico City' ? 1 : a.localeCompare(b)),
  )
  for (const city of cities) {
    groups.push({
      key: `traffic-${city}`,
      title: `Traffic protection — ${city}`,
      categorySlug: 'urban',
      icon: '🚗',
      description: 'Rush-hour delay coverage · Pays when your trip runs far over typical',
      contracts: traffic.filter((c) => (c.location?.city ?? 'Other') === city),
    })
  }

  const gas = live.filter((c) => c.trigger_type === 'fuel')
  if (gas.length > 0) {
    groups.push({
      key: 'gas',
      title: 'Gas prices',
      categorySlug: 'experiences',
      icon: '⛽',
      description: 'Pump-price protection · Pays when fuel spikes',
      contracts: gas,
    })
  }

  const airFlood = live.filter(
    (c) => c.trigger_type === 'flood' || c.trigger_type === 'air_quality',
  )
  if (airFlood.length > 0) {
    groups.push({
      key: 'air-flood',
      title: 'Flood & Air quality',
      categorySlug: 'nature',
      icon: '🌧️',
      description: 'Heavy rain · Air-quality contingency',
      contracts: airFlood,
    })
  }

  const placed = new Set(groups.flatMap((g) => g.contracts.map((c) => c.id)))
  const rest = live.filter((c) => !placed.has(c.id))
  if (rest.length > 0) {
    groups.push({
      key: 'more',
      title: 'More coverage',
      categorySlug: 'urban',
      icon: '🛡️',
      description: 'Other live products',
      contracts: rest,
    })
  }

  return groups
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/launch.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/launch.ts tests/lib/launch.test.ts
git commit -m "feat(lib): launch-stage partition and live product grouping"
```

---

### Task 4: ContractCard `comingSoon` variant

**Files:**
- Modify: `components/contracts/ContractCard.tsx`
- Test: `tests/components/ContractCard.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to the existing describe block in `tests/components/ContractCard.test.tsx`, reusing that file's existing contract fixture (add `launch_stage: 'coming_soon'` via spread):

```tsx
it('renders the coming-soon variant: badge, no prices, Notify me CTA', () => {
  render(<ContractCard contract={contract} currency="USD" comingSoon />)
  expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
  expect(screen.getByText(/pricing available at launch/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /notify me/i })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /buy now/i })).not.toBeInTheDocument()
})

it('does not show coming-soon UI on live cards', () => {
  render(<ContractCard contract={contract} currency="USD" />)
  expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /buy now/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify the first new test fails**

Run: `npx vitest run tests/components/ContractCard.test.tsx`
Expected: FAIL — no "coming soon" badge rendered.

- [ ] **Step 3: Implement the variant**

In `components/contracts/ContractCard.tsx`:

Add to `Props`:

```ts
  /** Dimmed teaser: badge, no prices, Notify me CTA. Card still opens the detail page. */
  comingSoon?: boolean
```

Add a badge style entry:

```ts
const COMING_SOON_BADGE = 'bg-amber-400/10 text-amber-300 border border-amber-400/25'
```

Update the component signature to `({ contract, currency, badge, comingSoon }: Props)` and:

1. Root `<article>` className — add `comingSoon && 'opacity-60 saturate-[.85] hover:opacity-100'` to the `cn(...)` call.
2. Badge block — render the coming-soon badge instead of the regular one:

```tsx
{comingSoon ? (
  <span className={cn('absolute right-3.5 top-3.5 rounded px-[7px] py-[3px] text-[10px] font-bold uppercase tracking-[0.1em]', COMING_SOON_BADGE)}>
    coming soon
  </span>
) : badge ? (
  <span className={cn('absolute right-3.5 top-3.5 rounded px-[7px] py-[3px] text-[10px] font-bold uppercase tracking-[0.1em]', BADGE_STYLES[badge])}>
    {badge}
  </span>
) : null}
```

3. Price rows — wrap the existing `<div className="mb-3.5 space-y-0">…</div>` block:

```tsx
{comingSoon ? (
  <p className="mb-3.5 py-1.5 text-[12px] text-insu-muted">Pricing available at launch</p>
) : (
  <div className="mb-3.5 space-y-0">{/* existing tiers.map(...) unchanged */}</div>
)}
```

4. Footer — swap the volume row + Buy button when coming soon:

```tsx
{comingSoon ? (
  <div className="flex items-center justify-end">
    <button
      onClick={(e) => { e.stopPropagation(); router.push(`/markets/${contract.slug}`) }}
      className="rounded-lg border border-white/15 px-3.5 py-1.5 text-[13px] font-bold text-insu-text transition-all hover:border-amber-400/40 hover:text-amber-300"
    >
      Notify me
    </button>
  </div>
) : (
  <div className="flex items-center justify-between">{/* existing volume + Buy now unchanged */}</div>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ContractCard.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/contracts/ContractCard.tsx tests/components/ContractCard.test.tsx
git commit -m "feat(ui): coming-soon variant for ContractCard"
```

---

### Task 5: ContractSection accepts title/icon/description

**Files:**
- Modify: `components/contracts/ContractSection.tsx`
- Test: `tests/components/ContractSection.test.tsx`

The browse page will reuse this component for product groups ("Traffic protection — Mexico City") instead of DB categories, so the header becomes caller-controlled with fallbacks to the existing per-slug maps.

- [ ] **Step 1: Update the test**

In `tests/components/ContractSection.test.tsx`, replace every `categoryName={...}` prop with `title={...}` (same values), and add:

```tsx
it('renders caller-provided icon and description over the slug defaults', () => {
  render(
    <ContractSection
      title="Traffic protection — Mexico City"
      categorySlug="urban"
      icon="🚗"
      description="Rush-hour delay coverage"
      contracts={[]}
      currency="USD"
    />,
  )
  expect(screen.getByText(/🚗 Traffic protection — Mexico City/)).toBeInTheDocument()
  expect(screen.getByText('Rush-hour delay coverage')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/ContractSection.test.tsx`
Expected: FAIL — unknown `title` prop / missing text.

- [ ] **Step 3: Implement**

In `components/contracts/ContractSection.tsx` change `Props` and the header:

```ts
interface Props {
  title: string
  categorySlug: string
  /** Falls back to the per-slug SECTION_ICONS / SECTION_DESCRIPTIONS maps. */
  icon?: string
  description?: string
  contracts: ContractWithTiers[]
  currency: Currency
}
```

Signature: `export default function ContractSection({ title, categorySlug, icon, description, contracts, currency }: Props)`.

Header JSX:

```tsx
<h2 className={cn('font-display text-[28px] tracking-[2px]', SECTION_STYLES[categorySlug] ?? '')}>
  {icon ?? SECTION_ICONS[categorySlug]} {title}
</h2>
<p className="text-[13px] font-medium tracking-[0.05em] text-insu-muted">
  {description ?? SECTION_DESCRIPTIONS[categorySlug]}
</p>
```

Remove the now-unused `CategoryName` import if nothing else uses it.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/components/ContractSection.test.tsx`
Expected: PASS. (BrowseClient still passes `categoryName` — it breaks compilation until Task 7; that's fine on this branch, but run `npx vitest run tests/components` to confirm no other component test regressed.)

- [ ] **Step 5: Commit**

```bash
git add components/contracts/ContractSection.tsx tests/components/ContractSection.test.tsx
git commit -m "refactor(ui): ContractSection takes title/icon/description"
```

---

### Task 6: ComingSoonSection rail

**Files:**
- Create: `components/contracts/ComingSoonSection.tsx`
- Test: `tests/components/ComingSoonSection.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ComingSoonSection from '@/components/contracts/ComingSoonSection'
import type { ContractWithTiers } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

function makeContract(title: string): ContractWithTiers {
  return {
    id: crypto.randomUUID(),
    slug: title.toLowerCase().replace(/\s/g, '-'),
    title,
    trigger_type: 'manual',
    launch_stage: 'coming_soon',
    location: { city: 'Bogotá', country: 'CO' },
    icon_url: null,
    total_volume_usd: 0,
    is_featured: false,
    coverage_tiers: [],
    category: { id: '1', slug: 'urban', name: 'Urban', color: '#fff', display_order: 1, icon_url: null },
  } as unknown as ContractWithTiers
}

describe('ComingSoonSection', () => {
  it('renders heading and one coming-soon card per contract', () => {
    render(
      <ComingSoonSection
        contracts={[makeContract('Water shortage'), makeContract('Blackout')]}
        currency="USD"
      />,
    )
    expect(screen.getByRole('heading', { name: /coming soon/i })).toBeInTheDocument()
    expect(screen.getByText('Water shortage')).toBeInTheDocument()
    expect(screen.getByText('Blackout')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /notify me/i })).toHaveLength(2)
  })

  it('renders nothing when the list is empty', () => {
    const { container } = render(<ComingSoonSection contracts={[]} currency="USD" />)
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/ComingSoonSection.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
'use client'

import ContractCard from './ContractCard'
import type { ContractWithTiers, Currency } from '@/lib/types'

interface Props {
  contracts: ContractWithTiers[]
  currency: Currency
}

/** Dimmed rail of not-yet-live coverage at the bottom of the browse page. */
export default function ComingSoonSection({ contracts, currency }: Props) {
  if (contracts.length === 0) return null

  return (
    <section className="mt-12">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="font-display text-[22px] tracking-[2px] text-insu-muted">🔜 Coming soon</h2>
        <p className="text-[13px] font-medium tracking-[0.05em] text-insu-muted">
          Coverage we&apos;re building — tap a card to get notified at launch
        </p>
        <div className="h-px flex-1 bg-white/[0.05]" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {contracts.map((contract) => (
          <ContractCard key={contract.id} contract={contract} currency={currency} comingSoon />
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ComingSoonSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/contracts/ComingSoonSection.tsx tests/components/ComingSoonSection.test.tsx
git commit -m "feat(ui): ComingSoonSection rail"
```

---

### Task 7: Browse page rework (two zones) + stats scoping + CategoryTabs removal

**Files:**
- Modify: `app/BrowseClient.tsx` (full rewrite below)
- Modify: `app/page.tsx`
- Delete: `components/layout/CategoryTabs.tsx`, `tests/components/CategoryTabs.test.tsx`

- [ ] **Step 1: Rewrite `app/BrowseClient.tsx`**

```tsx
'use client'

import { useState, useMemo } from 'react'
import StatsBar from '@/components/contracts/StatsBar'
import ContractSection from '@/components/contracts/ContractSection'
import ContractCard from '@/components/contracts/ContractCard'
import ComingSoonSection from '@/components/contracts/ComingSoonSection'
import TrendingSection from '@/components/contracts/TrendingSection'
import RegionToggle from '@/components/contracts/RegionToggle'
import { useRealtimeContracts } from '@/hooks/useRealtimeContracts'
import { scoreTrending } from '@/lib/trending'
import { filterByRegion, type Region } from '@/lib/region'
import { partitionByLaunchStage, groupLiveContracts } from '@/lib/launch'
import { useSearch } from '@/lib/search-context'
import type { ContractWithTiers } from '@/lib/types'

interface Props {
  initialContracts: ContractWithTiers[]
  stats: {
    totalVolumeUsd: number
    activeContracts: number
    protectionsSold: number
    avgPayoutMinutes: number
  }
}

export default function BrowseClient({ initialContracts, stats }: Props) {
  const [region, setRegion] = useState<Region>('MX')
  const allContracts = useRealtimeContracts(initialContracts)
  // Scope everything below (trending, sections, search) to the selected
  // region. Mexico is the demo focus; International is one click away.
  const contracts = useMemo(() => filterByRegion(allContracts, region), [allContracts, region])
  const { live, comingSoon } = useMemo(() => partitionByLaunchStage(contracts), [contracts])
  const groups = useMemo(() => groupLiveContracts(live), [live])
  const trendingContracts = useMemo(() => scoreTrending(live), [live])
  const { query } = useSearch()

  const normalizedQuery = query.trim().toLowerCase()
  const isSearching = normalizedQuery.length > 0

  const searchResults = useMemo(() => {
    if (!isSearching) return []
    return contracts.filter((c) =>
      c.title.toLowerCase().includes(normalizedQuery) ||
      (c.description ?? '').toLowerCase().includes(normalizedQuery) ||
      (c.location?.city ?? '').toLowerCase().includes(normalizedQuery) ||
      (c.location?.country ?? '').toLowerCase().includes(normalizedQuery) ||
      (c.category?.name ?? '').toLowerCase().includes(normalizedQuery)
    )
  }, [contracts, normalizedQuery, isSearching])

  return (
    <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-6 sm:py-7 lg:px-8">
      <div className="mb-5">
        <RegionToggle region={region} onSelect={setRegion} />
      </div>

      <StatsBar stats={stats} />

      {isSearching ? (
        <>
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-insu-muted">
            {searchResults.length === 0
              ? `No results for "${query}"`
              : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'} for "${query}"`}
          </p>
          {searchResults.length === 0 ? (
            <p className="py-16 text-center text-[13px] text-insu-dim">
              Try searching for a city, event, or risk type.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {searchResults.map((contract) => (
                <ContractCard
                  key={contract.id}
                  contract={contract}
                  currency="USD"
                  comingSoon={contract.launch_stage === 'coming_soon'}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {trendingContracts.length >= 2 && (
            <TrendingSection contracts={trendingContracts} currency="USD" />
          )}

          {groups.map((group) => (
            <ContractSection
              key={group.key}
              title={group.title}
              categorySlug={group.categorySlug}
              icon={group.icon}
              description={group.description}
              contracts={group.contracts}
              currency="USD"
            />
          ))}

          <ComingSoonSection contracts={comingSoon} currency="USD" />
        </>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Update `app/page.tsx`**

- Delete `getCategories()`, `FALLBACK_CATEGORIES`, the `Category` import, and the `categories` prop (both call sites).
- Scope stats to live products in `getPlatformStats()`:

```ts
async function getPlatformStats() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('contracts')
    .select('total_volume_usd')
    .eq('status', 'active')
    .eq('launch_stage', 'live')

  const totalVolumeUsd = (data as Array<{ total_volume_usd: number | null }> ?? []).reduce(
    (sum, c) => sum + (c.total_volume_usd ?? 0),
    0
  )

  const { count: activeContracts } = await supabase
    .from('contracts')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
    .eq('launch_stage', 'live')

  const { count: protectionsSold } = await supabase
    .from('hedger_positions')
    .select('*', { count: 'exact', head: true })
    .in('status', ['active', 'paid_out', 'expired'])

  return {
    totalVolumeUsd,
    activeContracts: activeContracts ?? 0,
    protectionsSold: protectionsSold ?? 0,
    avgPayoutMinutes: 4.2,
  }
}
```

`getContracts()` is unchanged — it still fetches all active contracts (both stages); the client partitions.

- [ ] **Step 3: Delete CategoryTabs**

```bash
git rm components/layout/CategoryTabs.tsx tests/components/CategoryTabs.test.tsx
```

(Verify first that `grep -rn "CategoryTabs" app components --include="*.tsx"` shows no remaining importer.)

- [ ] **Step 4: Type-check and run the component suite**

```bash
npx tsc --noEmit && npx vitest run tests/components tests/lib
```

Expected: PASS. Fix any test that still constructs BrowseClient props with `categories`.

- [ ] **Step 5: Commit**

```bash
git add -A app/BrowseClient.tsx app/page.tsx components/layout tests/components
git commit -m "feat(browse): two-zone layout — live product groups + Coming Soon rail"
```

---

### Task 8: `launch_interest` server action + ComingSoonPanel

**Files:**
- Create: `lib/actions/launch-interest.ts`
- Create: `components/markets/ComingSoonPanel.tsx`
- Test: `tests/components/ComingSoonPanel.test.tsx`

- [ ] **Step 1: Write the server action**

```ts
'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Toggle the signed-in user's notify-me interest for a coming-soon contract.
 * Returns the new state. Uses the user-scoped client so RLS owns the rows.
 */
export async function toggleLaunchInterest(contractId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: existing } = await supabase
    .from('launch_interest')
    .select('contract_id')
    .eq('contract_id', contractId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('launch_interest')
      .delete()
      .eq('contract_id', contractId)
      .eq('user_id', user.id)
    return false
  }

  const { error } = await supabase
    .from('launch_interest')
    .insert({ contract_id: contractId, user_id: user.id })
  if (error) throw new Error(`Could not save interest: ${error.message}`)
  return true
}
```

- [ ] **Step 2: Write the failing panel test**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ComingSoonPanel from '@/components/markets/ComingSoonPanel'

const toggleMock = vi.fn()
vi.mock('@/lib/actions/launch-interest', () => ({
  toggleLaunchInterest: (...args: unknown[]) => toggleMock(...args),
}))

describe('ComingSoonPanel', () => {
  it('signed out: shows sign-in link, no notify button', () => {
    render(<ComingSoonPanel contractId="c1" userId={null} initiallyInterested={false} />)
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/auth/login')
    expect(screen.queryByRole('button', { name: /notify me/i })).not.toBeInTheDocument()
  })

  it('signed in: toggles interest via the server action', async () => {
    toggleMock.mockResolvedValueOnce(true)
    render(<ComingSoonPanel contractId="c1" userId="u1" initiallyInterested={false} />)
    await userEvent.click(screen.getByRole('button', { name: /notify me at launch/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /we'll notify you/i })).toBeInTheDocument(),
    )
    expect(toggleMock).toHaveBeenCalledWith('c1')
  })

  it('starts in the interested state when preloaded', () => {
    render(<ComingSoonPanel contractId="c1" userId="u1" initiallyInterested />)
    expect(screen.getByRole('button', { name: /we'll notify you/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/components/ComingSoonPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the panel**

```tsx
'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { toggleLaunchInterest } from '@/lib/actions/launch-interest'

interface Props {
  contractId: string
  userId: string | null
  initiallyInterested: boolean
}

/** Replaces the purchase panel on coming-soon markets. */
export default function ComingSoonPanel({ contractId, userId, initiallyInterested }: Props) {
  const [interested, setInterested] = useState(initiallyInterested)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  return (
    <div className="rounded-card border border-amber-400/20 bg-amber-400/[0.04] p-5">
      <span className="rounded border border-amber-400/25 bg-amber-400/10 px-[7px] py-[3px] text-[10px] font-bold uppercase tracking-[0.1em] text-amber-300">
        Coming soon
      </span>
      <p className="mt-3 text-[14px] font-semibold text-insu-text">
        This coverage isn&apos;t live yet
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-insu-muted">
        We&apos;re still wiring up the data source and pricing for this product.
        Leave your interest and we&apos;ll notify you the moment it launches.
      </p>

      {userId ? (
        <button
          onClick={() => {
            setError(null)
            startTransition(async () => {
              try {
                setInterested(await toggleLaunchInterest(contractId))
              } catch {
                setError('Something went wrong — try again.')
              }
            })
          }}
          disabled={isPending}
          className={cn(
            'mt-4 w-full rounded-lg py-3 text-[14px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50',
            interested
              ? 'border border-insu-green/30 bg-insu-green/10 text-insu-green'
              : 'bg-insu-accent text-bg hover:bg-[#f7b84a]',
          )}
        >
          {interested ? "✓ We'll notify you" : 'Notify me at launch'}
        </button>
      ) : (
        <Link
          href="/auth/login"
          className="mt-4 block w-full rounded-lg bg-insu-accent py-3 text-center text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a]"
        >
          Sign in to get notified
        </Link>
      )}
      {error && <p className="mt-2 text-[12px] text-red-400">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/components/ComingSoonPanel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/launch-interest.ts components/markets/ComingSoonPanel.tsx tests/components/ComingSoonPanel.test.tsx
git commit -m "feat(markets): launch-interest action + ComingSoonPanel"
```

---

### Task 9: Coming-soon mode on the market detail page

**Files:**
- Modify: `components/markets/ContractDetailClient.tsx`
- Modify: `app/markets/[slug]/page.tsx` (single-contract path, after line ~125)
- Test: `tests/components/ContractDetailClient.test.tsx`

- [ ] **Step 1: Add the failing test**

In `tests/components/ContractDetailClient.test.tsx`, reusing the file's existing contract fixture and render helper:

```tsx
it('coming soon: shows the notify panel and hides purchase controls', () => {
  render(
    <ContractDetailClient
      contract={contract}
      userId="u1"
      latestReading={null}
      comingSoon
      initiallyInterested={false}
    />,
  )
  expect(screen.getByText(/this coverage isn't live yet/i)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /buy protection/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /provide capital/i })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/components/ContractDetailClient.test.tsx`
Expected: FAIL — unknown props / Buy Protection still rendered.

- [ ] **Step 3: Implement in `ContractDetailClient.tsx`**

Add to imports: `import ComingSoonPanel from './ComingSoonPanel'`.

Add to `Props`:

```ts
  /** Coming-soon market: replace all purchase UI with the notify-me panel. */
  comingSoon?: boolean
  initiallyInterested?: boolean
```

Update the signature to include `comingSoon, initiallyInterested`.

In the right column, wrap the entire purchase stack (period selector, "Select tier" label, `TierSelector`, and the Buy/Provide button group — everything currently inside the sticky `<div className="space-y-4 lg:sticky lg:top-[80px]">`):

```tsx
<div className="space-y-4 lg:sticky lg:top-[80px]">
  {comingSoon ? (
    <ComingSoonPanel
      contractId={contract.id}
      userId={userId}
      initiallyInterested={initiallyInterested ?? false}
    />
  ) : (
    <>
      {/* existing period selector, tier selector, and buttons — unchanged */}
    </>
  )}
</div>
```

And guard the slide-over at the bottom:

```tsx
{!comingSoon && (
  <PurchasePanel
    contract={contract}
    userId={userId}
    open={panelOpen}
    initialMode={panelMode}
    initialPeriodDays={selectedPeriodDays}
    initialTierId={selectedTierId}
    latestReading={latestReading}
    onClose={() => setPanelOpen(false)}
  />
)}
```

- [ ] **Step 4: Wire the market page**

In `app/markets/[slug]/page.tsx`, in the single-contract path (after the corridor-pair early return), before the final render:

```ts
const comingSoon = contract.launch_stage === 'coming_soon'

let initiallyInterested = false
if (comingSoon && userId) {
  const { data: interest } = await supabase
    .from('launch_interest')
    .select('contract_id')
    .eq('contract_id', contract.id)
    .eq('user_id', userId)
    .maybeSingle()
  initiallyInterested = !!interest
}
```

and pass both to the final `<ContractDetailClient … comingSoon={comingSoon} initiallyInterested={initiallyInterested} />`. (All corridor contracts are live, so the corridor-pair path needs no change.)

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/components/ContractDetailClient.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/markets/ContractDetailClient.tsx app/markets/[slug]/page.tsx tests/components/ContractDetailClient.test.tsx
git commit -m "feat(markets): coming-soon mode replaces purchase panel with notify-me"
```

---

### Task 10: Admin — launch-stage field + launch fan-out

**Files:**
- Modify: `components/admin/contracts/ContractForm.tsx`
- Modify: `lib/actions/admin.ts:33-120` (`upsertContract`)

- [ ] **Step 1: Add the form field**

In `components/admin/contracts/ContractForm.tsx`, next to the `isFeatured` state (line ~112):

```ts
const [launchStage, setLaunchStage] = useState<LaunchStage>(contract?.launch_stage ?? 'live')
```

(import `LaunchStage` from `@/lib/types`). Add a select near the is-featured control, following the form's existing field markup conventions:

```tsx
<label className="block text-[12px] font-semibold text-insu-muted">
  Launch stage
  <select
    value={launchStage}
    onChange={(e) => setLaunchStage(e.target.value as LaunchStage)}
    className="mt-1 w-full rounded-lg border border-white/10 bg-bg-card px-3 py-2 text-[13px] text-insu-text"
  >
    <option value="live">Live (purchasable)</option>
    <option value="coming_soon">Coming soon (notify-me only)</option>
  </select>
</label>
```

and include `launch_stage: launchStage,` in the upsert payload next to `is_featured: isFeatured,` (line ~191).

- [ ] **Step 2: Extend `upsertContract` in `lib/actions/admin.ts`**

Add `import { createNotification } from '@/lib/notifications/create'` at the top.

Add to `contractFields`:

```ts
    launch_stage: input.launch_stage,
```

In the `if (input.id)` update branch, read the previous stage **before** the update:

```ts
    const { data: prevRow } = await supabase
      .from('contracts')
      .select('launch_stage')
      .eq('id', input.id)
      .single()
```

then after the contract + tier updates, fan out on a coming_soon → live flip:

```ts
    // Product launch: tell everyone who asked to be notified. Service client
    // reads launch_interest (RLS is owner-scoped); createNotification is
    // best-effort and per-user prefs-aware.
    const wasComingSoon = (prevRow as { launch_stage?: string } | null)?.launch_stage === 'coming_soon'
    if (wasComingSoon && input.launch_stage === 'live') {
      const { data: interested } = await supabase
        .from('launch_interest')
        .select('user_id')
        .eq('contract_id', input.id)
      for (const row of (interested ?? []) as Array<{ user_id: string }>) {
        await createNotification(supabase, {
          userId: row.user_id,
          type: 'product_launched',
          title: `${input.title} is now live`,
          body: 'Coverage you asked about is now available to buy on Insu.',
          contractId: input.id,
        })
      }
    }
```

- [ ] **Step 3: Type-check + run admin form tests**

```bash
npx tsc --noEmit && npx vitest run tests/components/ContractForm.test.tsx
```

Expected: PASS. If the ContractForm test snapshots the payload, add `launch_stage: 'live'` to its expectation.

- [ ] **Step 4: Commit**

```bash
git add components/admin/contracts/ContractForm.tsx lib/actions/admin.ts tests/components/ContractForm.test.tsx
git commit -m "feat(admin): launch-stage control + product_launched fan-out on flip"
```

---

### Task 11: Full verification + PR

- [ ] **Step 1: Full test suite, lint, build**

```bash
npm run test:run && npm run lint && npm run build
```

Expected: all pass. Fix any straggler (most likely: tests still passing `categories` to BrowseClient, or `CategoryName` type usages).

- [ ] **Step 2: Manual smoke against dev**

```bash
npm run dev
```

Verify (uses prod Supabase, which does NOT yet have the migration — so everything shows as live; the two-zone grouping should still render, with an empty Coming Soon rail):
- `/` shows Traffic (Mexico City), Gas, Flood & Air sections; no category tabs.
- Region toggle → International shows Guatemala City traffic.
- A live market page still purchases normally.

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feat/coming-soon-cleanup
gh pr create --title "feat: browse cleanup — live products vs Coming Soon" --body "Implements docs/superpowers/specs/2026-07-06-coming-soon-cleanup-design.md: launch_stage column + curation migration, two-zone browse (product groups + Coming Soon rail), notify-me on coming-soon markets, admin launch-stage control with product_launched fan-out.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

### Task 12: Deploy (after PR review/merge — requires user go-ahead)

- [ ] **Step 1: Merge PR, pull main**
- [ ] **Step 2: Apply migration to prod:** `supabase db push --linked < /dev/null` (single Supabase project = prod). If it raises `Refusing to cancel demo contracts`, someone holds an active position on a to-be-cancelled slug — stop and re-curate that slug instead of forcing.
- [ ] **Step 3: Deploy app:** `vercel --prod --yes` from the main checkout (prod does not auto-deploy).
- [ ] **Step 4: Prod smoke:**
  - `/` (MX): 3 product sections + Coming Soon rail with 4 cards (hurricane, GDL flash flood, Cabo heatwave, Cancún beach).
  - International: Guatemala City traffic + 6 coming-soon cards.
  - `curl -s https://insu-theta.vercel.app/markets/bogota-water-shortage | grep -io "coming soon" | head -1` returns a match; the same page shows no Buy Protection button.
  - A live market (e.g. `/markets/gas-price-magna-cdmx`) still shows Buy Protection.
  - Signed in: notify-me toggle persists across reload.

---

## Self-Review Notes

- **Spec coverage:** launch_stage column + backfill (T1), curation with position guard (T1), two-zone browse both regions (T7), product grouping (T3), trending/stats live-only (T7), coming-soon cards without prices (T4, T6), detail page notify-me + sign-in CTA (T8, T9), launch_interest with RLS (T1, T8), product_launched notification on flip (T2, T10), admin control (T10), search badging (T7). Testing section of spec: unit (T3–T9), migration checks (T12 smoke), e2e-style prod smoke (T12).
- **Known judgment call baked in:** cancún kept, patagonia cancelled (10 coming-soon products; spec allowed 8–10 at implementation discretion).
- **Type consistency check:** `ProductGroup.categorySlug` (T3) matches `ContractSection.categorySlug` (T5) and BrowseClient usage (T7); `comingSoon`/`initiallyInterested` prop names match between T8 panel, T9 client, and market page; `launch_stage` string literals `'live' | 'coming_soon'` used consistently in SQL, types, and UI.
