# Corridor Instant Period Toggle — Design

**Date:** 2026-06-19
**Status:** Approved (pending spec review)

## Problem

On a traffic-corridor market detail page (`/markets/[slug]`), the morning and
evening protections are a pair. The detail page currently shows a
Morning/Evening toggle (`CorridorPeriodSwitch`) implemented as `<Link>`s: each
period is a separate route, so switching does a full server navigation — the
page reloads, the map re-initializes, and there's a visible delay.

We want toggling between the two periods to be **instant** (no reload), by
loading both contracts up front and swapping client-side.

## Goal

Toggling Morning/Evening on a corridor detail page swaps the entire view
(title, traffic pulse bar, map, pricing, purchase panel, oracle reading)
instantly with no network round-trip, while keeping the URL in sync so refresh
and link-sharing preserve the selected period.

## Non-Goals

- No change to single-contract (non-corridor) detail pages.
- No change to the dashboard `CorridorPairCard` or its toggle.
- Not adding the actual drivable route to the map (separate future work).
- Not changing the oracle/pricing/purchase logic.

## Chosen Approach

**Server preloads both periods; a client wrapper swaps everything.**

The page fetches both contracts' full data bundles up front and hands them to a
single client component that holds the active-period state. Toggling flips
state — instant, zero network. All existing presentational components are
reused. `router.refresh()` continues to update both bundles via props.

Cost: roughly 2× the (small) Supabase reads on initial page load. Acceptable.

Rejected alternatives:
- **Lazy-fetch sibling on first toggle** — lighter initial load but adds a
  client data-fetching path + loading state, and the first toggle has a spinner.
- **Prefetch sibling page via `<Link prefetch>`** — still a navigation/reload,
  which is exactly what we're removing.

## Data Flow

`app/markets/[slug]/page.tsx` (server component) stays the entry point.

1. Fetch the opened contract by slug (as today: contract, category,
   coverage_tiers, pricing_history, corridor).
2. Determine if it has a sibling — an urban corridor contract on the same
   `road` with the opposite period, status in `['active','settled']` (reusing
   the existing sibling lookup added for `CorridorPeriodSwitch`).
3. **Has sibling:** fetch the full bundle for **both** periods and render the
   new `CorridorMarketView` client wrapper.
4. **No sibling** (non-corridor, or a road with only one active period): render
   exactly as today — no wrapper, no toggle, no behavior change.

A **period bundle** is:

```ts
interface PeriodBundle {
  period: CommutePeriod          // 'morning' | 'evening'
  slug: string
  contract: ContractDetailData
  corridor: Corridor
  latestReading: LatestOracleReading | null
  sparklineReadings: OracleReading[]
}
```

The page derives `initialPeriod` on the server from the opened slug's corridor
via `getContractPeriod`, so the server-rendered HTML matches the first client
render (no hydration mismatch).

## Components

### New: `components/markets/CorridorMarketView.tsx` (client)

Props: `{ bundles: PeriodBundle[]; initialPeriod: CommutePeriod; userId: string | null }`
(`bundles` has length 2).

State: `activePeriod`. Renders the active bundle, reproducing the current
layout:

```
<div className="mx-auto max-w-4xl space-y-3 px-4 pb-2 pt-4">
  <CorridorPeriodSwitch active={activePeriod} onSelect={setActivePeriod} options={...} />
  <TrafficPulseBar   ...active />
  <CorridorMap       key={activeSlug} ...active />
  <TrafficPulseBarRefresher />
</div>
<ContractDetailClient key={activeSlug} contract={active.contract} userId={userId} latestReading={active.latestReading} />
```

- `key={activeSlug}` on `CorridorMap` and `ContractDetailClient` so swapping
  cleanly re-initializes them: the map re-centers on the new origin/destination
  coordinates, and the purchase panel/tier/period selections reset for the new
  (different-priced) contract.
- `TrafficPulseBar` (props-only, no `'use client'`) and `TrafficPulseBarRefresher`
  render fine inside the client wrapper; the refresher renders once.
- On toggle: also `window.history.replaceState(null, '', '/markets/${slug}')` —
  App-Router-supported, no reload, no back-button history pollution.

### Changed: `components/markets/CorridorPeriodSwitch.tsx`

Convert from link-based navigation to a **controlled** toggle. New props:
`{ active: CommutePeriod; onSelect: (p: CommutePeriod) => void; options: PeriodOption[] }`.
Renders `<button>`s instead of `<Link>`s; same Morning/Evening + time-window
styling and `aria-current` on the active pill. (No other consumer exists.)

### Changed: `app/markets/[slug]/page.tsx`

Move the urban pulse/map block and `ContractDetailClient` into
`CorridorMarketView` for the has-sibling case only. Single-contract path stays
as-is. The page does the second bundle's fetches (oracle latest reading +
sparkline for the sibling) alongside the existing ones.

## Edge Cases

- **No sibling:** existing single-contract layout, unchanged.
- **Mixed status** (e.g. morning `active`, evening `settled`): both load and
  toggle works; the settled side shows its settled state inside
  `ContractDetailClient` as on its own page.
- **SSR / hydration:** `initialPeriod` derived server-side from the opened slug,
  so first client render matches. Open `…-manana` → Morning first; `…-tarde` →
  Evening first.
- **Oracle auto-refresh:** `router.refresh()` (10 min interval) re-runs the
  server page, re-fetches both bundles, pushes fresh `latestReading`/sparkline
  down as props. The client `activePeriod` state survives the soft refresh.
- **Direct deep-link** to either slug works — both resolve, load both bundles,
  and differ only in which period is active first.

## Testing

- **Unit** (`tests/lib/corridors.test.ts`): existing coverage of
  `getContractPeriod` / `getSiblingPeriod` / `formatWindow` drives bundle
  ordering and initial period. Add a case if a bundle-ordering helper is
  introduced.
- **Component** (`tests/components/CorridorMarketView.test.tsx`, new): with two
  mock bundles, assert (a) the opened period's title renders first, (b) clicking
  the other period swaps to the sibling's title **without** navigation (mock
  `next/navigation`; assert `router.push` is not called and
  `window.history.replaceState` is called with the sibling slug), (c) the
  toggle's active styling follows state.
- **Controlled `CorridorPeriodSwitch`**: clicking a period fires `onSelect` and
  marks the active pill (`aria-current`).
- **Existing tests:** `ContractSection` (dashboard card) is unaffected and stays
  green.
- **Final gate:** `tsc --noEmit` (touched files clean) + `next build`, plus a
  Playwright screenshot confirming instant toggle on the running dev server.

## Files Touched

- `app/markets/[slug]/page.tsx` — fetch both bundles; render wrapper for the
  has-sibling case.
- `components/markets/CorridorMarketView.tsx` — new client wrapper.
- `components/markets/CorridorPeriodSwitch.tsx` — controlled toggle.
- `tests/components/CorridorMarketView.test.tsx` — new.
