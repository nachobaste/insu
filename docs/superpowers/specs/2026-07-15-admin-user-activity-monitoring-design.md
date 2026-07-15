# Admin User-Activity Monitoring — Design

**Date:** 2026-07-15
**Goal:** An admin page to monitor individual tester journeys during the upcoming Friends & Family (F&F) test, so we can see who signed up, what they did, how engaged they are, and where they get stuck.

## Purpose & scope

F&F is small-N (a handful of testers), so aggregate analytics are noise. The page is optimized for **per-tester journeys with friction flags**, not conversion funnels. It shows every profile (no tester-only filter), identified by **name + email**.

Explicit constraint: there is **no page-view/click tracking**, so the timeline is built from transactional records (signup, purchases, deposits, payouts) plus a new login counter. We cannot show "browsed corridor X" or "opened the buy panel but bailed."

## Approach

Server-rendered admin page that reads all data on load, with manual refresh (re-navigate / browser refresh). No realtime/polling — unnecessary at F&F scale and more moving parts. Revisit with an admin API + polling only if a larger cohort later needs live updates.

Two independent units.

---

## Unit A — Login tracking

Supabase records auth separately from our tables. `auth.admin.listUsers()` exposes `last_sign_in_at` (last login) but **not** a login count, and the login history table (`auth.audit_log_entries`) is not reachable via PostgREST (`Invalid schema: auth`). Since F&F has not started, we track our own counter from day one — accurate and robust, no dependency on Supabase internals.

**Data model** — migration on `profiles`:
- `login_count integer not null default 0`
- `last_login_at timestamptz` (nullable)

**RPC** — `increment_login_count(p_user_id uuid)`, `SECURITY DEFINER`, mirrors the existing `increment_contract_volume` / `increment_tier_capacity` functions. Atomically does `login_count = login_count + 1, last_login_at = now()` for the row. `SECURITY DEFINER` avoids RLS friction. Migration must use `gen_random_uuid()` conventions and set a safe `search_path` (per the repo's `handle_new_user` search-path fix precedent).

**Server action** — `recordLogin()` in `lib/actions/auth.ts` (new): resolves the current authenticated user via the server client, calls the RPC. No-op (silent) if unauthenticated.

**Call sites** (both successful-login entry points, so the count is method-agnostic and counts logins, not page loads):
1. `components/auth/LoginForm.tsx` — after `signInWithPassword` succeeds, before `router.push('/')`.
2. `app/auth/callback/route.ts` — after `exchangeCodeForSession` succeeds (OAuth / magic link).

---

## Unit B — `/admin/activity` page

**Navigation** — add `{ href: '/admin/activity', label: 'Activity', icon: '👥' }` to `components/admin/AdminSidebar.tsx`.

**Route** — `app/admin/activity/page.tsx`, a server component behind the existing admin MFA gate, using the **service client** (`createServiceClient()`) because it reads user-owned tables; a user-scoped client returns empty under RLS (documented repo gotcha).

**Data aggregation** — `getUserActivity()` in `lib/actions/adminActivity.ts` (new). Returns an array of per-tester records:

```
UserActivity {
  userId: string
  name: string | null          // profiles.full_name
  email: string | null         // auth.admin.listUsers()
  createdAt: string            // profiles.created_at (signup)
  loginCount: number
  lastLoginAt: string | null
  buys: HedgerPosition[]        // hedger_positions for this user
  deposits: ProviderPosition[]  // provider_positions for this user
  payouts: Payout[]             // payouts joined via hedger_position_id
  // derived:
  totalPremiumUsd: number
  totalPayoutUsd: number
  status: TesterStatus
}
```

Implementation: fetch all `profiles`, all `hedger_positions`, all `provider_positions`, all `payouts`, and the `auth.admin.listUsers()` map in parallel, then group by `user_id` in memory (fine at F&F scale). Payouts link to a user through `hedger_position_id → hedger_positions.user_id`.

**Status flag** — pure function `deriveTesterStatus(record)` returning one of, in priority order:
- `completed_loop` ✅ — has ≥1 payout received (bought → paid out)
- `abandoned_checkout` ⚠️ — has a `hedger_positions.status = 'pending_payment'` and no active/paid position
- `holding` ⏳ — has ≥1 `status = 'active'` position, no payout yet
- `signed_up_idle` 💤 — profile exists, zero positions and zero deposits
- `active_other` — any other combination (e.g. only a provider deposit)

**UI** — table sorted by most-recent activity (max of last_login_at, latest purchase/deposit/payout time), columns: Name/email · Login count · Last login · Buys · Deposits · Premium paid · Payouts received · Status chip. Each row expands to a reverse-chronological **timeline** merging: signed up, each buy (contract · tier · period · premium · status), each deposit (contract · amount), each payout (amount · trigger day). Currency formatted with the existing `formatCurrency` helper.

---

## Testing

- `deriveTesterStatus` — unit tests covering each status branch and priority ordering (pure function, Vitest, mirrors `tests/lib/pricing` style).
- Activity aggregation grouping — unit test with fixture rows verifying per-user rollups (totals, payout linkage via hedger_position_id).
- `recordLogin` — action test following the existing `lib/actions` test pattern (RPC called with the authenticated user id; no-op when unauthenticated).

## Out of scope

- Page-view / clickstream tracking (no infrastructure for it).
- Realtime/live updates (manual refresh only).
- Tester-only filtering or invitation management (show all profiles).
- Aggregate funnel/conversion analytics.
