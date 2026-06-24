# In-app Notifications + Profile Page — Design

**Date:** 2026-06-24
**Status:** Approved (pre-implementation)

## Goal

Close two gaps in the end-to-end user cycle:

1. **Notifications** — users get notified when their coverage is triggered/paid out, when
   it expires unpaid, when they purchase protection, and (for capital providers) when their
   position settles.
2. **Profile page** — a simple place to edit basic user data and configuration.

Both are deliberately "nothing fancy": in-app only, reusing existing data and code paths.

## Decisions (from brainstorming)

- **Delivery channel:** in-app only. No email, no external service, no new secrets.
  (Realtime/email can be layered on later without reworking the data model.)
- **Notification events:** all four — `coverage_paid`, `coverage_expired`,
  `protection_purchased`, `provider_settled`.
- **Profile scope:** edit display name, set preferred currency, notification preference
  toggles, read-only account info, and change password.
- **Architecture:** Approach A — persisted `notifications` table written inline from the
  server-side flows that already mutate this data.

## 1. Data model (one migration)

New migration file under `supabase/migrations/` (next sequential timestamp).

### Table `notifications`

| column        | type          | notes |
|---------------|---------------|-------|
| `id`          | uuid PK       | `default uuid_generate_v4()` |
| `user_id`     | uuid NOT NULL | `REFERENCES profiles(id) ON DELETE CASCADE` |
| `type`        | text NOT NULL | `CHECK (type IN ('coverage_paid','coverage_expired','protection_purchased','provider_settled'))` |
| `title`       | text NOT NULL | short headline |
| `body`        | text NOT NULL | one-line description |
| `contract_id` | uuid          | nullable, `REFERENCES contracts(id)`; used to deep-link to the market |
| `read_at`     | timestamptz   | NULL = unread |
| `created_at`  | timestamptz NOT NULL | `DEFAULT now()` |

Index: `(user_id, created_at DESC)`.

**RLS:**
- `SELECT` / `UPDATE`: `using (user_id = auth.uid())`.
- `INSERT`: `with check (user_id = auth.uid())` — covers the authenticated purchase-confirmation
  insert. The settlement/expiry crons insert via the service-role client, which bypasses RLS.

### Column on `profiles`

```sql
ALTER TABLE profiles ADD COLUMN notification_prefs jsonb NOT NULL
  DEFAULT '{"coverage_paid":true,"coverage_expired":true,"protection_purchased":true,"provider_settled":true}';
```

Regenerate `lib/supabase/database.types.ts` after the migration.

## 2. Generation helper

`lib/notifications/create.ts`:

```ts
createNotification(db, { userId, type, title, body, contractId? }): Promise<void>
```

- Reads the user's `notification_prefs`; if the flag for `type` is `false`, it no-ops.
- Otherwise inserts one row.
- Pure with respect to its injected `db` (same fake-client style as `lib/payout/processor.ts`)
  so it is unit-testable.

### Wiring into existing flows

| Event                   | Location                                                              | Client       |
|-------------------------|----------------------------------------------------------------------|--------------|
| `protection_purchased`  | `lib/actions/purchase.ts` → `activatePositionByPaymentIntent` (after status→`active`) | authenticated |
| `coverage_paid`         | `lib/payout/processor.ts` → `payoutPosition` and `payoutOnce` (after payout `completed`) | service-role |
| `provider_settled`      | `lib/payout/processor.ts` → `settleProviderPositions`                 | service-role |
| `coverage_expired`      | `lib/payout/processor.ts` → `expireContracts` (per expired hedger position) | service-role |

The processor already selects `profiles.stripe_customer_id`; extend that select to include
`notification_prefs` so there is no extra round-trip per payout. `createNotification` can accept
the already-fetched prefs to avoid re-querying where available, or query when called from a path
that doesn't have them (purchase).

## 3. UI — bell + notifications panel

- **`NotificationBell`** client component, added to `Header.tsx` (desktop nav) and `MobileMenu`.
  Bell icon from `lucide-react` with an unread-count badge.
- The unread count is fetched in the `Header` **server** component on each page load and passed
  to the bell as its initial value. No realtime, no polling.
- Clicking the bell opens a dropdown listing recent notifications: title, body, relative time,
  and an unread dot. Items with a `contract_id` link to `/markets/[slug]`.
- Opening the panel calls `markAllRead`; clicking a single item marks just that one read.

`lib/actions/notifications.ts`:
- `getNotifications()` — recent notifications for the current user.
- `getUnreadCount()` — count where `read_at is null`.
- `markAllRead()` — set `read_at = now()` for the user's unread rows.
- `markRead(id)` — mark a single notification read.

## 4. Profile page — `/profile`

Server component loads the auth user + profile; renders a client form with sections:

- **Account (read-only):** email, role, member-since (`profiles.created_at`).
- **Display name:** text field → `profiles.full_name`.
- **Preferred currency:** USD / MXN toggle → `profiles.preferred_currency`.
- **Notification preferences:** four on/off toggles → `profiles.notification_prefs`.
- **Change password:** new-password field → `supabase.auth.updateUser({ password })`.

`lib/actions/profile.ts`:
- `updateProfile({ full_name?, preferred_currency?, notification_prefs? })` — validates currency
  enum and prefs shape before writing.
- `changePassword(newPassword)` — wraps `supabase.auth.updateUser`.

A "Profile" link is added to the authenticated header nav and the mobile menu.

## 5. Testing

Follows the existing `tests/lib/...` layout with injected fake clients.

- `createNotification`: pref on → inserts; pref off → no-op.
- Processor tests extended: a notification row is written on `coverage_paid`,
  `coverage_expired`, and `provider_settled`.
- `updateProfile`: rejects invalid currency / malformed prefs; writes valid input.

## Scope guardrails (YAGNI — explicitly out)

- No email delivery.
- No realtime / websocket subscriptions.
- No notification grouping or digests.
- No standalone full-page `/notifications` route (the dropdown is sufficient).
- No per-notification deletion (read/unread only).

## Affected files (summary)

- `supabase/migrations/<new>.sql` — table + column + RLS.
- `lib/supabase/database.types.ts` — regenerated.
- `lib/notifications/create.ts` — new helper.
- `lib/actions/notifications.ts` — new server actions.
- `lib/actions/profile.ts` — new server actions.
- `lib/actions/purchase.ts`, `lib/payout/processor.ts` — wire in `createNotification`.
- `components/layout/Header.tsx`, `components/layout/MobileMenu.tsx` — bell + Profile link.
- `components/layout/NotificationBell.tsx` — new client component.
- `app/profile/page.tsx` + profile form component — new page.
- `tests/lib/notifications/`, extended `tests/lib/payout/`, `tests/lib/actions/`.
