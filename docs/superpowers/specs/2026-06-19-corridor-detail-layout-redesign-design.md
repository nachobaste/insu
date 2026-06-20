# Corridor Detail Page Layout Redesign — Design

**Date:** 2026-06-19
**Status:** Approved (pending spec review)

## Problem

On a traffic-corridor market detail page (`/markets/[slug]`), the layout buries
the product and wastes vertical space:

1. **Evidence leads instead of the product.** The first ~55% of the viewport is
   a centered narrow band (`max-w-4xl`): the Morning/Evening toggle → live-traffic
   pulse bar → map, **stacked vertically**. The contract title doesn't appear
   until the user scrolls past the map.
2. **Pricing is below the fold.** The purchase rail (coverage period, tiers, Buy)
   is a sticky right column, but the whole two-column grid only starts *under* the
   tall traffic band — so on load only the top of the tier list shows and the Buy
   button is cut off ("pricing only half visible").
3. **Mismatched widths + stacked visuals.** The traffic band is `max-w-4xl`
   (896px) centered while the content below is `max-w-[1320px]`; the pulse bar and
   map are stacked when they could sit side by side. Together this is the
   unnecessary page length.

Root cause: the corridor visuals live in a separate centered block *on top of*
the page rather than inside the main purchase grid.

## Goal

One unified two-column layout where the contract title leads, the live-traffic +
map sit side by side, and the purchase rail is fully visible on load — without
changing any purchase/pricing logic and without altering non-corridor contract
pages.

## Non-Goals

- No change to purchase/pricing/oracle logic.
- No change to non-corridor (weather/other) detail pages.
- No change to the instant morning/evening toggle behavior (shipped separately).
- Not a full mobile redesign — only graceful stacking so the page stops
  overflowing at narrow widths (the rest of the app is desktop-oriented).

## Chosen Approach (Approach A)

Collapse the separate centered traffic band into the existing
`max-w-[1320px]` two-column grid that `ContractDetailClient` already owns. The
corridor visuals move into that grid's **left column**; the sticky purchase rail
(right) is unchanged but now starts at the top of the page, so it's fully visible
on load.

Rejected alternatives:
- **B — full-width traffic band on top, grid below:** shorter (side-by-side
  pulse+map) but pricing still sits below the band.
- **C — tabbed evidence panel:** most compact but hides the live data the product
  is selling behind tabs.

## Layout (target)

```
┌───────────────────────────────────────────────┐
│ Header                                         │
├──────────────────────────────┬────────────────┤
│ [Morning] [Evening]          │  COVERAGE PERIOD│
│ URBAN                        │  [1d][7d][30d]  │
│ Reforma → Alameda — Mañana   │  SELECT TIER    │
│ 📍 Mexico City · description │  Basic  $..→$.. │
│                              │  Pro    $..→$.. │
│ ┌ Live traffic ─┬─ Map ────┐ │  [ Buy Protect ]│
│ │ ▮▮▮▯ 0–100    │ [ map  ] │ │  [ Provide Cap ]│
│ └───────────────┴──────────┘ │   (lg:sticky)   │
│ Price history [chart]        │                 │
│ Trigger / Deadline / Location│                 │
└──────────────────────────────┴────────────────┘
```

## Components

### `components/markets/ContractDetailClient.tsx` (modify)

Add two optional left-column content slots; render nothing extra when absent so
non-corridor contracts are unchanged.

- New props: `periodToggle?: React.ReactNode`, `evidence?: React.ReactNode`.
- Render `periodToggle` as the first child of the left column, **above** the
  `URBAN` category tag (wrap in a conditional so it occupies no space when
  undefined).
- Render `evidence` in the left column **between** the description block and
  `<PriceChart>` (conditional).
- The right sticky rail and all purchase state/logic are untouched.
- Make the main grid responsive: `grid-cols-1 lg:grid-cols-[1fr_360px]`; the
  right rail keeps `lg:sticky lg:top-[80px]` (drops sticky when stacked).

### `components/markets/CorridorEvidence.tsx` (new)

Owns the side-by-side live-traffic + map presentation.

- Props: `{ corridor: Corridor; readings: OracleReading[]; triggerCondition: Record<string, unknown> }`.
- Layout: `grid gap-3 lg:grid-cols-[1fr_1.3fr]` (pulse bar ~43% / map ~57% on
  desktop; stacked below `lg`).
- Left cell: `<TrafficPulseBar readings threshold windowStart windowEnd triggerDescription />`
  computing `threshold = Number(triggerCondition.threshold ?? 50)` and
  `triggerDescription = String(triggerCondition.description ?? '')` (same as the
  page does today).
- Right cell: `<CorridorMap originLat originLng destLat destLng corridorName />`.
- Height: `CorridorMap` currently hardcodes its inner height (`h-48`/192px). Keep
  that as-is; the pulse-bar cell sits alongside at its natural height. Exact
  height matching is a nice-to-have, not required — if pursued, add an optional
  `heightClass`/`className` prop to `CorridorMap` rather than overriding from
  outside. Default: leave `CorridorMap` unchanged.
- Renders `<TrafficPulseBarRefresher />` once at the end.

### `components/markets/CorridorMarketView.tsx` (modify)

Remove the `mx-auto max-w-4xl` block. Render a single `ContractDetailClient` with
the corridor slots, keeping the `key={active.slug}` remount on it:

```tsx
<ContractDetailClient
  key={active.slug}
  contract={active.contract}
  userId={userId}
  latestReading={active.latestReading}
  periodToggle={
    <CorridorPeriodSwitch active={activePeriod} options={options} onSelect={handleSelect} />
  }
  evidence={
    <CorridorEvidence
      corridor={active.corridor}
      readings={active.sparklineReadings}
      triggerCondition={active.contract.trigger_condition}
    />
  }
/>
```

### `app/markets/[slug]/page.tsx` (modify)

- **Paired branch:** unchanged (delegates to `CorridorMarketView`).
- **Single branch:** remove the `mx-auto max-w-4xl` traffic block; instead, for
  urban+corridor contracts, pass `evidence={<CorridorEvidence corridor={corridor}
  readings={sparklineReadings} triggerCondition={contract.trigger_condition} />}`
  to `ContractDetailClient` (no `periodToggle`). Non-urban contracts pass neither
  prop.

### `CorridorMap.tsx` / `TrafficPulseBar.tsx`

Unchanged. (Optionally `CorridorMap` could gain a height prop for exact cell
alignment, but the default plan leaves both untouched.)

## Responsive

Purely additive `lg:` prefixes; desktop rendering matches the design:
- Main grid: `grid-cols-1 lg:grid-cols-[1fr_360px]`.
- Evidence row: `grid-cols-1 lg:grid-cols-[1fr_1.3fr]`.
- Right rail: `lg:sticky lg:top-[80px]`.

## Testing

- **`CorridorMarketView.test.tsx`** (existing): still asserts title swap +
  `replaceState`. It mocks `ContractDetailClient`; after the refactor the wrapper
  passes `periodToggle`/`evidence` props — update the mock only if needed so the
  swap assertion still passes.
- **`ContractDetailClient.test.tsx`** (new or extended): assert that
  `periodToggle` and `evidence` nodes render when passed, and do **not** render
  when omitted (guards the non-corridor path).
- **`CorridorPeriodSwitch` / `corridors` unit tests:** unaffected, stay green.
- **Visual gate (Playwright)** at 1440×900 and 1280×800:
  - The contract `h1` title **and** the "Buy Protection" button are both visible
    without scrolling (core fix).
  - Total page height is shorter than the current ~1206px.
  - Capture before/after screenshots.
- **Final gate:** `tsc --noEmit` clean on touched files; `vitest run tests/components tests/lib/corridors.test.ts` green; `npx next build` succeeds.

## Files Touched

- `components/markets/ContractDetailClient.tsx` — add `periodToggle`/`evidence`
  slots; responsive grid.
- `components/markets/CorridorEvidence.tsx` — new side-by-side pulse+map.
- `components/markets/CorridorMarketView.tsx` — render via slots; remove top block.
- `app/markets/[slug]/page.tsx` — single-corridor path uses `evidence` slot;
  remove top block.
- `tests/components/ContractDetailClient.test.tsx` — slot rendering test
  (new/extended).
