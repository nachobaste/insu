# Payouts Tab PnL Summary — Design

**Date:** 2026-07-11
**Status:** Approved

## Goal

Show users how much they have made (or lost) with Insu directly in the Payouts
tab of the My Portfolio page (`/dashboard?tab=payouts`), via a small PnL
summary above the payout list.

## Metric definition (user-approved)

**Net = total payouts received − total spent on protections (all-time).**

- `received` = sum of `amount_usd` over all of the user's payouts
  (both `completed` and `processing` statuses).
- `spent` = sum of `premium_paid_usd` over all of the user's hedger positions
  (statuses `active`, `paid_out`, `expired` — everything the dashboard query
  returns).
- `net = received − spent`. May be negative.
- Positions and payouts on cancelled markets are already excluded by
  `getDashboardData` on both sides, so the two sums stay consistent.
- Provider positions are out of scope: the Payouts tab covers hedger payouts
  only.

## Data flow

No new queries, server actions, or schema changes. `DashboardClient` already
receives `payouts: PayoutWithContract[]` and holds
`hedgerPositions: HedgerPositionWithContract[]` in state. The summary is
computed client-side in the Payouts tab from these props.

Change: `PayoutsTab` gains a `hedgerPositions` prop, passed from
`DashboardClient` (the live realtime-synced state, so the figures update when
positions change).

## UI

A three-figure summary strip at the top of the Payouts tab, styled like the
existing `StatsStrip` cards (rounded-xl bordered cards, `font-mono` numbers,
muted uppercase 11px labels, `formatCurrency`):

| Figure   | Label      | Color                                        |
| -------- | ---------- | -------------------------------------------- |
| received | "Received" | `text-insu-green`                            |
| spent    | "Spent"    | `text-insu-text` (neutral)                   |
| net      | "Net"      | green when ≥ 0, red when negative; signed `+`/`−` prefix |

Rendering rules:

- Strip renders whenever the user has any payouts **or** any spend
  (`received > 0 || spent > 0` — i.e. any positions/payouts exist).
- When the payout list is empty but the strip renders (money spent, no payouts
  yet), the existing "No payouts yet…" message stays below the strip.
- When the user has no positions and no payouts at all, the tab is unchanged
  (empty message only).

### Copy constraints

Regulatory-safe vocabulary only (per project copy rules): no
"insurance", "premium", or "coverage" in user-facing labels. "Spent" refers to
protection prices paid. Field name `premium_paid_usd` is internal and fine.

## Components

- `components/dashboard/PayoutsTab.tsx` — add `hedgerPositions` prop, compute
  the three sums, render the summary strip above the list.
- `components/dashboard/DashboardClient.tsx` — pass `hedgerPositions` to
  `PayoutsTab`.
- No changes to `PayoutRow`, `StatsStrip`, server actions, or types.

## Error handling

Pure arithmetic over already-validated props; no failure modes beyond empty
arrays, which the rendering rules cover. `formatCurrency` handles display.

## Testing

Component tests alongside the existing suite (`tests/components/`):

- Net positive: payouts exceed spend → green net with `+` prefix.
- Net negative: spend exceeds payouts → red net with `−` prefix.
- Processing payouts are included in `received`.
- Spend-but-no-payouts: strip renders with empty-list message below.
- No positions, no payouts: strip absent, empty message unchanged.
