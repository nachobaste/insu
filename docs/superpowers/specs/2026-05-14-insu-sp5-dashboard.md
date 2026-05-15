# SP5: Portfolio Dashboard — Design Spec

**Date:** 2026-05-14
**Status:** Approved for implementation

---

## 1. Goal

Give hedgers and providers a single authenticated page to see all their active positions, history, and payouts — with live updates when a trigger fires and a position flips status.

---

## 2. Route

| Route | Auth | Description |
|---|---|---|
| `/dashboard` | Required | Single page — stats strip + tabbed views |

No sub-routes. Tab state is a `?tab=` URL query param so links deep into a tab work (`/dashboard?tab=positions`). Default tab is `protections`.

---

## 3. Architecture

**Approach: SSR initial load + client Realtime patch** (mirrors the SP1 browse page pattern).

`app/dashboard/page.tsx` is a Server Component. It calls `getDashboardData(userId)` and passes the result as props to `DashboardClient`. `DashboardClient` mounts Supabase Realtime subscriptions that patch in-memory state when rows change — no full refetch.

```
app/
  dashboard/
    page.tsx                ← Server Component — auth check, data fetch, renders DashboardClient

components/
  dashboard/
    DashboardClient.tsx     ← "use client" — tabs, realtime, all interactivity
    StatsStrip.tsx          ← 3 headline numbers derived from positions arrays
    ProtectionsTab.tsx      ← grouped list of hedger position cards
    PositionsTab.tsx        ← list of provider position cards
    PayoutsTab.tsx          ← chronological payout log
    ProtectionCard.tsx      ← rich card: status badge, paid/payout/expiry + time bar
    PositionCard.tsx        ← rich card: capital, yield + %, settlement date + status badge
    PayoutRow.tsx           ← single row: contract, amount, date, status badge

lib/
  actions/
    dashboard.ts            ← NEW: getDashboardData(userId) — three parallel Supabase queries
```

---

## 4. Data Fetching

### `lib/actions/dashboard.ts`

```ts
export interface DashboardData {
  hedgerPositions: HedgerPositionWithContract[]
  providerPositions: ProviderPositionWithContract[]
  payouts: PayoutWithContract[]
}

export async function getDashboardData(userId: string): Promise<DashboardData>
```

Runs three parallel Supabase queries using the server client:

1. **hedger_positions** — `select('*, contract:contracts(id, slug, title, trigger_type), tier:coverage_tiers(name)')` filtered by `user_id` and `status in ('active','paid_out','expired')`
2. **provider_positions** — same join pattern, filtered by `user_id` and `status in ('active','settled')`
3. **payouts** — `select('*, contract:contracts(id, slug, title), hedger_position:hedger_positions!inner(user_id)')` with `.eq('hedger_position.user_id', userId)`, ordered by `created_at desc`. The `!inner` join filters to only payouts belonging to this user without requiring a `user_id` column on the `payouts` table.

All three run in `Promise.all`. Returns typed arrays.

**New types** (add to `lib/types.ts`):

```ts
export interface HedgerPositionWithContract extends HedgerPosition {
  contract: Pick<Contract, 'id' | 'slug' | 'title' | 'trigger_type'>
  tier: Pick<CoverageTier, 'name'>
}

export interface ProviderPositionWithContract extends ProviderPosition {
  contract: Pick<Contract, 'id' | 'slug' | 'title' | 'trigger_type'>
  tier: Pick<CoverageTier, 'name'>
}

export interface PayoutWithContract extends Payout {
  contract: Pick<Contract, 'id' | 'slug' | 'title'>
}
```

### `app/dashboard/page.tsx`

- Reads session with `createClient()` (server); redirects to `/auth/login` if no user
- Calls `getDashboardData(userId)`
- Renders `<Header />` + `<DashboardClient data={data} userId={userId} initialTab={searchParams.tab ?? 'protections'} />`

---

## 5. Realtime Subscriptions

`DashboardClient` subscribes on mount, unsubscribes on unmount:

```ts
supabase
  .channel('dashboard:hedger')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'hedger_positions',
    filter: `user_id=eq.${userId}`,
  }, (payload) => {
    setHedgerPositions(prev =>
      prev.map(p => p.id === payload.new.id ? { ...p, ...payload.new } : p)
    )
  })
  .subscribe()

supabase
  .channel('dashboard:provider')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'provider_positions',
    filter: `user_id=eq.${userId}`,
  }, (payload) => {
    setProviderPositions(prev =>
      prev.map(p => p.id === payload.new.id ? { ...p, ...payload.new } : p)
    )
  })
  .subscribe()
```

When a `hedger_positions` row flips to `paid_out`, the protection card re-renders immediately with the `PAID OUT ✓` badge and green border — no page refresh required.

---

## 6. Stats Strip

Three headline numbers derived client-side from position arrays (no extra query):

| Stat | Derivation | Color |
|---|---|---|
| Active covers | `hedgerPositions.filter(p => p.status === 'active').length` | White |
| Covered up to | `sum(payout_amount_usd)` for active hedger positions | Green `#22c55e` |
| Provider yield | `sum(expected_return_usd)` for active provider positions | Amber `#f5a623` |

---

## 7. Components

### `StatsStrip`

Three cards in a 3-column grid. Numbers in JetBrains Mono. Labels in 9px uppercase. Always visible above the tabs.

### `DashboardClient`

Manages tab state (synced with `?tab=` URL param via `useRouter`/`useSearchParams`). Holds `hedgerPositions`, `providerPositions`, `payouts` in state — initialized from SSR props, patched by Realtime. Renders `StatsStrip` + tab pills + active tab content.

### `ProtectionsTab`

Renders two labelled groups: **Active** and **Expired / Paid out**. Each group is a vertical list of `ProtectionCard`. Empty state: "No active protections yet — [Browse contracts →]" link.

### `ProtectionCard`

```
┌─────────────────────────────────────────────┐
│ Contract title            [STATUS BADGE]    │
│ Tier · Oracle source                        │
│ ─────────────────────────────────────────── │
│  Paid        Payout         Expires         │
│  $45         $500           Jun 15          │
│ ─────────────────────────────────────────── │
│ ████░░░░░░░░░░░░░░░  12 days left of 33     │
└─────────────────────────────────────────────┘
```

- Status badges: `ACTIVE` (green), `PAID OUT ✓` (green, solid border), `EXPIRED` (grey, dimmed card opacity 50%)
- Progress bar: amber `#f5a623`, shows `days_remaining / total_days`. Hidden on expired/paid-out cards.
- Payout column label changes to **Received** when `status = 'paid_out'`
- Card links to `/markets/[slug]` on click

### `PositionsTab`

Vertical list of `PositionCard`. Empty state: "No capital deployed yet — [Browse contracts →]".

### `PositionCard`

```
┌─────────────────────────────────────────────┐
│ Contract title            [STATUS BADGE]    │
│ Tier · deployed capital                     │
│ ─────────────────────────────────────────── │
│  Capital     Yield          Settles         │
│  $1,000      +$48 (4.8%)    Jun 15          │
└─────────────────────────────────────────────┘
```

- Status badges: `ACTIVE` (green), `SETTLED ✓` (green), `LOSS SHARE` (red)
- Yield column: shows `expected_return_usd` + yield % `(expected / capital * 100)%` for active; shows `actual_return_usd` for settled
- Loss share: yield column shows actual returned amount in red, Settles column shows `settled_at` date
- Card links to `/markets/[slug]` on click

### `PayoutsTab`

Chronological list of `PayoutRow`. Most recent first. Empty state: "No payouts yet."

### `PayoutRow`

```
Contract title · date               $AMOUNT  [STATUS]
```

Single horizontal row with border-bottom separator. Status badge: `COMPLETED` (green), `PROCESSING` (amber).

---

## 8. Visual Design

Follows the established design system:

- **Background:** `#080c18`
- **Card background:** `#111827`, border `#1c2333`
- **Payout/active values:** `#22c55e`
- **Yield / progress bar:** `#f5a623`
- **Loss:** `#ef4444`
- **Muted text:** `#8b949e`
- **Fonts:** Bebas Neue (page label) · JetBrains Mono (all numbers) · Outfit (labels, body)

---

## 9. Empty States

| Condition | Message |
|---|---|
| No active hedger positions | "No active protections yet — Browse contracts →" |
| No provider positions | "No capital deployed yet — Browse contracts →" |
| No payouts | "No payouts yet. Payouts appear here when a trigger fires." |
| No positions at all (brand new user) | Stats strip shows 0 / $0 / $0 |

---

## 10. Testing

**One new test file:** `tests/lib/actions/dashboard.test.ts`

Tests use a mocked Supabase client (same pattern as SP2's `purchase.ts` tests):

| Test | Assertion |
|---|---|
| Returns correct shape when all queries succeed | `hedgerPositions`, `providerPositions`, `payouts` arrays present and typed |
| Returns empty arrays when user has no positions | All three arrays `[]`, no error thrown |
| Propagates error when a query fails | Throws (caller redirects to error boundary) |

No component tests. Realtime subscription logic (a state map/patch) is too thin to warrant unit testing. Visual correctness verified by running the dev server.

---

## 11. Spec Coverage

| Design requirement | Implementation |
|---|---|
| Single `/dashboard` route | `app/dashboard/page.tsx` |
| Tab state in URL | `?tab=` query param, synced via `useRouter` |
| Stats strip | `StatsStrip.tsx` — derived from position arrays |
| Protections tab with active + expired groups | `ProtectionsTab.tsx` + `ProtectionCard.tsx` |
| Provider positions tab | `PositionsTab.tsx` + `PositionCard.tsx` |
| Yield % on position cards | Calculated: `(expected_return_usd / capital_deposited_usd) * 100` |
| Payouts tab | `PayoutsTab.tsx` + `PayoutRow.tsx` |
| Realtime updates on status change | Two Supabase channels in `DashboardClient` |
| Auth guard | Server Component redirect to `/auth/login` |
| Empty states | Per-tab messages with browse link |
| Design system consistency | Same tokens, fonts, badge patterns as SP1–SP4 |
