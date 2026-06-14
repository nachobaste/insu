# Urban Corridor Grouping & Recommendation — Design Spec

**Date:** 2026-06-14
**Status:** Approved

## Summary

The Urban category has grown to 13 contracts: 6 CDMX traffic corridors, each offered as a Morning and an Evening window (12 contracts), plus one standalone "CDMX Morning Traffic Delay" contract with no corridor. As a flat 4-column grid this is hard to scan — a buyer has to hunt through 13 cards to find their route.

This spec adds, to the Urban section only:

1. A **filter chip row** (`All` + one chip per corridor road) so a buyer can jump straight to their route.
2. A time-aware **"Recommended" badge** on whichever of a corridor's Morning/Evening contracts best matches the current time of day, so a buyer who has found their route also gets a hint on which window to buy.

Other categories (Nature, Experiences, Events) and the Trending banner are unchanged.

---

## UX Behavior

### Chip row

- Rendered above the card grid, only for the `urban` category section, only when more than one distinct corridor road is present.
- Chips: `All` (default/active) followed by each distinct `corridor.road` value, **alphabetical** (e.g. "Av. de las Palmas", "Circuito Bicentenario", "Paseo de la Reforma", "Periférico Norte", "Periférico Sur", "Viaducto Miguel Alemán"). Alphabetical ordering keeps the chip order stable regardless of how contracts are sorted for the grid.
- Selecting a road chip filters the grid to only contracts whose `corridor.road` matches. Selecting it again (or selecting "All") returns to the full set.
- `All` shows every Urban contract, including ones without a corridor (e.g. "CDMX Morning Traffic Delay"). A road chip only ever shows contracts tied to that road (always 2, in current data: one Morning + one Evening).
- Filter state is local to the Urban `ContractSection` (`useState`, default `null` = "All"). It resets if the component remounts (e.g. switching away from "All" category tab and back); no persistence needed.

### "Recommended" badge

- Applies only to contracts that have a `corridor` (the 12 paired corridor contracts). The standalone "CDMX Morning Traffic Delay" contract never gets this badge — it has no Morning/Evening sibling to choose between.
- Each corridor contract is classified as `'morning'` or `'evening'` from `corridor.window_start` (hour < 12 → morning, else evening).
- The "recommended period" for the current visit is computed from the local clock: **06:00–20:00 → `'evening'`**, everything outside that range (20:00–06:00) → `'morning'`.
- A contract gets the `recommended` badge when its own period matches the recommended period.
- **Badge precedence:** a card can show only one badge. If a contract both qualifies for `recommended` (time-based) and `trending` (`is_featured`), `recommended` wins — it's the more actionable, personalized signal. `trending`/`new`/`live` badges behave exactly as today otherwise.
- Visually, `recommended` is a new badge variant (blue), parallel to the existing `trending` (amber), `new` (green), `live` (red) variants.

---

## Data Model

No schema changes. `corridors` and the `contracts.corridor_id` FK already exist; `ContractWithTiers`/`Contract` in `lib/types.ts` already declare an optional `corridor?: Corridor | null`.

### `app/page.tsx` — `getContracts()`

Add the corridor join to the existing select, matching the pattern already used in `app/markets/[slug]/page.tsx`:

```ts
.select(`
  *,
  category:categories(*),
  coverage_tiers(*),
  corridor:corridors(*)
`)
```

Contracts without a `corridor_id` (e.g. non-urban contracts, "CDMX Morning Traffic Delay") simply get `corridor: null`.

---

## Architecture

### New: `lib/corridors.ts` (+ `tests/lib/corridors.test.ts`)

Pure helper functions, following the same shape as `lib/trending.ts`:

```ts
import type { ContractWithTiers, Corridor } from './types'

export type CommutePeriod = 'morning' | 'evening'

/** Morning if the corridor's window starts before noon, else evening. */
export function getContractPeriod(corridor: Corridor): CommutePeriod {
  const startHour = Number(corridor.window_start.split(':')[0])
  return startHour < 12 ? 'morning' : 'evening'
}

/** 06:00–20:00 -> evening (afternoon commute coming up); otherwise -> morning. */
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

### Modified: `components/contracts/ContractSection.tsx`

When `categorySlug === 'urban'`:

- `const roads = getUrbanRoads(contracts)`. If `roads.length > 0`, render the chip row (`All` + `roads`), backed by `const [activeRoad, setActiveRoad] = useState<string | null>(null)`.
- Visible contracts: `activeRoad ? contracts.filter(c => c.corridor?.road === activeRoad) : contracts`.
- For each visible contract, compute its badge:
  ```ts
  const recommendedPeriod = getRecommendedPeriod()
  const badge = contract.corridor && getContractPeriod(contract.corridor) === recommendedPeriod
    ? 'recommended'
    : contract.is_featured
      ? 'trending'
      : undefined
  ```
- Chip styling follows the existing pill/tab visual language (small uppercase pills, active state uses the section's category color — `category-urban`).

For non-urban categories, behavior is unchanged: no chips, badge is `is_featured ? 'trending' : undefined` as today.

### Modified: `components/contracts/ContractCard.tsx`

- Extend the `badge` prop union: `'trending' | 'new' | 'live' | 'recommended'`.
- Add a `recommended` entry to `BADGE_STYLES`, using a blue tone distinct from the existing amber/green/red variants (e.g. `bg-blue-400/15 text-blue-400 border border-blue-400/25`).
- No other changes — the badge renders in the same top-right slot as today.

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| Contract has no `corridor` (e.g. "CDMX Morning Traffic Delay") | Shown only under "All"; never gets `recommended`; keeps `trending` if `is_featured`. |
| A road has only one contract (not the case today, but possible if data changes) | Chip filters to that single card; no `recommended` vs `trending` conflict beyond the existing precedence rule. |
| Contract is both time-recommended and `is_featured` | Shows `recommended` (precedence rule above). |
| Visitor's device clock/timezone differs from Mexico City | Recommendation uses the browser's local time as a simple heuristic (consistent with "your current commute window"); not corrected to `America/Mexico_City`. Acceptable simplification for now — see Out of Scope. |
| `activeRoad` set, then contracts reload via realtime hook and that road no longer has any contracts | Filtered grid shows zero cards plus the `AddContractCard`; no special empty state (matches existing behavior elsewhere when a filtered list is empty). |

---

## Testing

### `tests/lib/corridors.test.ts`
- `getContractPeriod`: `window_start` "07:00" → `'morning'`; "17:00" → `'evening'`.
- `getRecommendedPeriod`: 05:59 → `'morning'`; 06:00 → `'evening'`; 19:59 → `'evening'`; 20:00 → `'morning'`; 23:00 → `'morning'`.
- `getUrbanRoads`: dedupes and alphabetizes roads across a mixed contract list; ignores contracts with no corridor.

### `tests/components/ContractSection.test.tsx`
- Urban section with corridor contracts renders one chip per distinct road plus "All", alphabetically ordered.
- Clicking a road chip filters the grid to only that road's contracts; clicking "All" (or the active chip again) restores the full list.
- Contract without a corridor only appears under "All".
- Badge precedence: a contract that is both `is_featured` and time-recommended renders the `recommended` badge, not `trending`.
- Non-urban sections render no chip row, and badge logic is unchanged (`trending` iff `is_featured`).

---

## Out of Scope

- Applying corridor grouping/filtering to any category other than Urban.
- Correcting the "Recommended" time calculation to a fixed timezone (e.g. `America/Mexico_City`) instead of the visitor's local clock.
- Persisting the selected chip across navigation or sessions.
- Changes to the Trending banner (`components/contracts/TrendingSection.tsx`).
- Multi-select chips (e.g. selecting multiple corridors at once).
- A dedicated chip/label for the standalone "CDMX Morning Traffic Delay" contract.
