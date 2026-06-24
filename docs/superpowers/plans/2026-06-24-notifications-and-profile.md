# In-app Notifications + Profile Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-app notifications for the coverage lifecycle (purchased, paid out, expired, provider-settled) and a simple `/profile` page for editing basic user data and notification preferences.

**Architecture:** A persisted `notifications` table is written by a best-effort `createNotification()` helper called inline from the existing server-side flows that already mutate this data (`purchase.ts`, `processor.ts`). A bell in the header shows an unread count (fetched server-side per page load) and a dropdown that lists recent notifications and marks them read. The `/profile` page reads/writes `profiles` columns via server actions and changes the password through the Supabase browser client.

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions), Supabase (Postgres + Auth + RLS), TypeScript, Tailwind, lucide-react, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-24-notifications-and-profile-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260624000003_notifications.sql` | `notifications` table, RLS, `profiles.notification_prefs` column |
| `lib/types.ts` (modify) | `NotificationType`, `NotificationPrefs`, `Notification` types + `DEFAULT_NOTIFICATION_PREFS` |
| `lib/notifications/create.ts` (create) | best-effort `createNotification()` helper |
| `lib/actions/notifications.ts` (create) | `getNotifications`, `getUnreadCount`, `markAllRead`, `markRead` server actions |
| `lib/actions/profile.ts` (create) | `updateProfile`, server action |
| `lib/actions/purchase.ts` (modify) | emit `protection_purchased` |
| `lib/payout/processor.ts` (modify) | emit `coverage_paid`, `provider_settled`, `coverage_expired` |
| `components/layout/NotificationBell.tsx` (create) | client bell + dropdown |
| `components/layout/Header.tsx` (modify) | fetch unread count, render bell + Profile link |
| `components/layout/MobileMenu.tsx` (modify) | Profile link |
| `app/profile/page.tsx` (create) | profile server component |
| `components/profile/ProfileForm.tsx` (create) | profile client form |
| `tests/lib/notifications/create.test.ts` (create) | helper unit tests |
| `tests/lib/actions/profile.test.ts` (create) | `updateProfile` validation tests |
| `tests/lib/payout/processor.test.ts` (modify) | assert notifications written |

**Key design notes:**
- `createNotification` is **best-effort**: its whole body is wrapped in `try/catch` so a notification failure never breaks a payout/purchase. It looks up the user's `notification_prefs` itself and no-ops if the relevant flag is off.
- Inserts from `processor.ts` use the service-role client (bypasses RLS). The `protection_purchased` insert in `purchase.ts` also uses the service-role client (`createServiceClient()`), which is already in scope there.
- The app uses hand-written types from `lib/types.ts` plus `as`-casts at Supabase call sites (matching existing code like `supabase.from('hedger_positions') as any`). Regenerating `database.types.ts` is optional and not required for this plan.

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260624000003_notifications.sql`

- [ ] **Step 1: Write the migration**

```sql
-- In-app notifications for the coverage lifecycle.

CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type         text NOT NULL
                 CHECK (type IN ('coverage_paid','coverage_expired','protection_purchased','provider_settled')),
  title        text NOT NULL,
  body         text NOT NULL,
  contract_id  uuid REFERENCES contracts(id),
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_created_idx
  ON notifications (user_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own notifications select" ON notifications FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Own notifications update" ON notifications FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "Insert own notifications" ON notifications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Per-user notification preferences. All types on by default.
ALTER TABLE profiles ADD COLUMN notification_prefs jsonb NOT NULL
  DEFAULT '{"coverage_paid":true,"coverage_expired":true,"protection_purchased":true,"provider_settled":true}'::jsonb;
```

- [ ] **Step 2: Apply the migration to the linked Supabase project**

> ⚠️ There is a single Supabase project that is production (`eagmczieznsogsxldedk`). This is a real, outward-facing change — confirm with the user before running it.

Run: `supabase db push --linked < /dev/null`
Expected: output lists `20260624000003_notifications.sql` as applied with no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260624000003_notifications.sql
git commit -m "feat(db): notifications table + profile notification_prefs"
```

---

## Task 2: Notification types

**Files:**
- Modify: `lib/types.ts` (append near the other type exports)

- [ ] **Step 1: Add the types and default prefs**

Append to `lib/types.ts`:

```ts
export type NotificationType =
  | 'coverage_paid'
  | 'coverage_expired'
  | 'protection_purchased'
  | 'provider_settled'

export interface NotificationPrefs {
  coverage_paid: boolean
  coverage_expired: boolean
  protection_purchased: boolean
  provider_settled: boolean
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  coverage_paid: true,
  coverage_expired: true,
  protection_purchased: true,
  provider_settled: true,
}

export interface Notification {
  id: string
  user_id: string
  type: NotificationType
  title: string
  body: string
  contract_id: string | null
  read_at: string | null
  created_at: string
  // Optional joined contract for deep-linking from the bell dropdown
  contract?: { slug: string } | null
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): notification types and default prefs"
```

---

## Task 3: `createNotification` helper (TDD)

**Files:**
- Create: `lib/notifications/create.ts`
- Test: `tests/lib/notifications/create.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from 'vitest'
import { createNotification } from '@/lib/notifications/create'

function makeDb(opts: { prefs?: Record<string, boolean> | null } = {}) {
  const insert = vi.fn().mockResolvedValue({ error: null })
  const profileSingle = vi.fn().mockResolvedValue({
    data: { notification_prefs: opts.prefs ?? { coverage_paid: true, coverage_expired: true, protection_purchased: true, provider_settled: true } },
    error: null,
  })
  const db = {
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ single: profileSingle }) }) }
      }
      if (table === 'notifications') {
        return { insert }
      }
      throw new Error(`unexpected table ${table}`)
    }),
  }
  return { db, insert }
}

describe('createNotification', () => {
  it('inserts a notification when the pref for the type is on', async () => {
    const { db, insert } = makeDb()
    await createNotification(db, {
      userId: 'u1', type: 'coverage_paid', title: 'Paid', body: 'You were paid', contractId: 'c1',
    })
    expect(insert).toHaveBeenCalledWith({
      user_id: 'u1', type: 'coverage_paid', title: 'Paid', body: 'You were paid', contract_id: 'c1',
    })
  })

  it('no-ops when the pref for the type is off', async () => {
    const { db, insert } = makeDb({ prefs: { coverage_paid: false } as never })
    await createNotification(db, {
      userId: 'u1', type: 'coverage_paid', title: 'Paid', body: 'b',
    })
    expect(insert).not.toHaveBeenCalled()
  })

  it('defaults contract_id to null when omitted', async () => {
    const { db, insert } = makeDb()
    await createNotification(db, { userId: 'u1', type: 'protection_purchased', title: 't', body: 'b' })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ contract_id: null }),
    )
  })

  it('never throws when the db call fails (best-effort)', async () => {
    const db = { from: vi.fn(() => { throw new Error('db down') }) }
    await expect(
      createNotification(db, { userId: 'u1', type: 'coverage_paid', title: 't', body: 'b' }),
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/notifications/create.test.ts`
Expected: FAIL — cannot find module `@/lib/notifications/create`.

- [ ] **Step 3: Implement the helper**

Create `lib/notifications/create.ts`:

```ts
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs, type NotificationType } from '@/lib/types'

interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

interface CreateNotificationParams {
  userId: string
  type: NotificationType
  title: string
  body: string
  contractId?: string | null
}

/**
 * Best-effort: looks up the user's notification_prefs, no-ops if the relevant
 * flag is off, and never throws — a notification failure must not break the
 * payout/purchase flow that called it.
 */
export async function createNotification(db: DbClient, params: CreateNotificationParams): Promise<void> {
  try {
    const { data } = await db
      .from('profiles')
      .select('notification_prefs')
      .eq('id', params.userId)
      .single()

    const prefs: NotificationPrefs =
      (data as { notification_prefs?: NotificationPrefs } | null)?.notification_prefs
      ?? DEFAULT_NOTIFICATION_PREFS

    if (prefs[params.type] === false) return

    await db.from('notifications').insert({
      user_id: params.userId,
      type: params.type,
      title: params.title,
      body: params.body,
      contract_id: params.contractId ?? null,
    })
  } catch (err) {
    console.error('createNotification failed:', err)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/notifications/create.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/notifications/create.ts tests/lib/notifications/create.test.ts
git commit -m "feat(notifications): best-effort createNotification helper"
```

---

## Task 4: Emit `protection_purchased`

**Files:**
- Modify: `lib/actions/purchase.ts` — inside `activatePositionByPaymentIntent`, hedger branch

- [ ] **Step 1: Add the import**

At the top of `lib/actions/purchase.ts`, add:

```ts
import { createNotification } from '@/lib/notifications/create'
```

- [ ] **Step 2: Emit after a hedger position is activated**

In `activatePositionByPaymentIntent`, the hedger branch already selects `tier_id, premium_paid_usd, contract_id` and increments volume. Add a notification immediately after the `increment_contract_volume` rpc call (still inside the `if (position_type === 'hedger')` block). The service-role `db` is already in scope:

```ts
    await createNotification(db, {
      userId: user.id,
      type: 'protection_purchased',
      title: 'Protection active',
      body: 'Your protection is now active and covering you.',
      contractId: position.contract_id,
    })
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/purchase.ts
git commit -m "feat(notifications): notify on protection activation"
```

---

## Task 5: Emit payout/settlement/expiry notifications (TDD)

**Files:**
- Modify: `lib/payout/processor.ts`
- Modify: `tests/lib/payout/processor.test.ts`

- [ ] **Step 1: Extend the test fake-db to capture notifications and profile prefs**

In `tests/lib/payout/processor.test.ts`, inside `makeDb`'s `from` switch, add handling so `createNotification` works. Add a captured spy and two table branches:

```ts
  // near the other vi.fn() declarations in makeDb:
  const notificationsInsert = vi.fn().mockResolvedValue({ error: null })
  const profileSelectSingle = vi.fn().mockResolvedValue({
    data: { stripe_customer_id: opts.profileStripeId ?? 'cus_existing', notification_prefs: null },
    error: null,
  })
```

In the `from` callback add cases (and have the existing `profiles` case also support `.select(...).eq(...).single()`):

```ts
        if (table === 'notifications') {
          return { insert: notificationsInsert }
        }
```

For `profiles`, return an object that supports BOTH the existing `update().eq()` AND `select().eq().single()`:

```ts
        if (table === 'profiles') {
          return {
            update: vi.fn().mockReturnValue({ eq: profileUpdateEq }),
            select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: profileSelectSingle }) }),
          }
        }
```

Expose the spy on the returned db so tests can assert on it:

```ts
  // where the db object is built, attach:
  ;(db as unknown as { _notificationsInsert: typeof notificationsInsert })._notificationsInsert = notificationsInsert
```

- [ ] **Step 2: Write the failing assertions**

Add these tests to `tests/lib/payout/processor.test.ts`:

```ts
  it('writes a coverage_paid notification when a position pays out', async () => {
    const db = makeDb()
    await processPayouts(db, makeStripe())
    const insert = (db as unknown as { _notificationsInsert: ReturnType<typeof vi.fn> })._notificationsInsert
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'coverage_paid', user_id: 'user-1' }),
    )
  })

  it('writes a coverage_expired notification when a contract expires unpaid', async () => {
    const db = makeDb({ triggeredReadings: [] })
    // expireContracts path: a past-deadline one-time contract with an active position
    // (mirror the existing expireContracts test setup in this file)
    await expireContracts(db)
    const insert = (db as unknown as { _notificationsInsert: ReturnType<typeof vi.fn> })._notificationsInsert
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'coverage_expired' }),
    )
  })
```

> Note: reuse whatever `makeStripe()` / setup helper the existing tests in this file use (the file already builds a stripe mock with `customers.create` and `customers.createBalanceTransaction`). For the expiry test, configure `makeDb` the same way the existing `expireContracts` test does so a past-deadline contract with an active hedger position exists.

- [ ] **Step 3: Run to verify the new tests fail**

Run: `npx vitest run tests/lib/payout/processor.test.ts`
Expected: the two new tests FAIL (no notification insert yet); existing tests still PASS.

- [ ] **Step 4: Implement emissions in `processor.ts`**

Add the import at the top:

```ts
import { createNotification } from '@/lib/notifications/create'
```

**4a — `coverage_paid` in `settleContract`:** inside the `for (const position of eligiblePositions)` loop, after `if (amountPaid > 0) { ... }`, emit (use the `contract` in scope):

```ts
    if (amountPaid > 0) {
      paid++
      totalHedgerPayout += amountPaid
      await createNotification(db, {
        userId: position.user_id,
        type: 'coverage_paid',
        title: 'Payout sent',
        body: `Your protection on "${contract.title}" triggered and a payout was sent.`,
        contractId: contract.id,
      })
    }
```

**4b — `coverage_paid` in `settleRecurring`:** inside the `for (const day of days)` loop, after `if (amount > 0) { ... }`, emit:

```ts
      if (amount > 0) {
        paid++
        remaining--
        lastDay = day
        await createNotification(db, {
          userId: pos.user_id,
          type: 'coverage_paid',
          title: 'Payout sent',
          body: `Your protection on "${contract.title}" triggered and a payout was sent.`,
          contractId: contract.id,
        })
      }
```

**4c — `provider_settled` in `settleProviderPositions`:** this helper currently takes `(db, contractId, totalHedgerPayout)`. Change its signature to also accept the contract title and emit per settled position. Update the signature and the call site in `settleContract`.

Change the call in `settleContract`:
```ts
  await settleProviderPositions(db, contract.id, contract.title, totalHedgerPayout)
```

Change the helper signature and body:
```ts
async function settleProviderPositions(
  db: DbClient,
  contractId: string,
  contractTitle: string,
  totalHedgerPayout: number,
): Promise<void> {
  // ... existing fetch of active provider positions ...
  for (const position of positions as ProviderPosition[]) {
    // ... existing lossShare / actualReturn / update ...
    await createNotification(db, {
      userId: position.user_id,
      type: 'provider_settled',
      title: 'Capital settled',
      body: `Your provided capital on "${contractTitle}" has been settled.`,
      contractId,
    })
  }
}
```

**4d — `coverage_expired` in `expireContracts`:** the one-time path currently bulk-updates hedger positions to `expired` without iterating. Before that bulk update, fetch the affected positions so each user can be notified. Replace the hedger-position update block inside the `for (const contract of pastDeadline)` loop with:

```ts
    const { data: expiringPositions } = await db
      .from('hedger_positions')
      .select('id, user_id')
      .eq('contract_id', contract.id)
      .eq('status', 'active')

    await db.from('hedger_positions')
      .update({ status: 'expired' })
      .eq('contract_id', contract.id)
      .eq('status', 'active')

    for (const pos of (expiringPositions ?? []) as Array<{ id: string; user_id: string }>) {
      await createNotification(db, {
        userId: pos.user_id,
        type: 'coverage_expired',
        title: 'Protection expired',
        body: 'Your protection reached its deadline without triggering and has expired.',
        contractId: contract.id,
      })
    }
```

> The trailing bulk update of stale recurring positions at the end of `expireContracts` stays as-is (no per-row notification — recurring coverage lapsing daily would be noisy; out of scope per spec).

- [ ] **Step 5: Run the full processor test file**

Run: `npx vitest run tests/lib/payout/processor.test.ts`
Expected: all tests PASS, including the two new ones.

- [ ] **Step 6: Commit**

```bash
git add lib/payout/processor.ts tests/lib/payout/processor.test.ts
git commit -m "feat(notifications): emit paid/settled/expired notifications from processor"
```

---

## Task 6: Notification server actions

**Files:**
- Create: `lib/actions/notifications.ts`

- [ ] **Step 1: Implement the actions**

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import type { Notification } from '@/lib/types'

export async function getUnreadCount(): Promise<number> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 0
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null)
  return count ?? 0
}

export async function getNotifications(): Promise<Notification[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data } = await supabase
    .from('notifications')
    .select('*, contract:contracts(slug)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)
  return (data ?? []) as Notification[]
}

export async function markAllRead(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null)
}

export async function markRead(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/actions/notifications.ts
git commit -m "feat(notifications): server actions for read/list/count"
```

---

## Task 7: NotificationBell component

**Files:**
- Create: `components/layout/NotificationBell.tsx`

- [ ] **Step 1: Implement the bell + dropdown**

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { getNotifications, markAllRead } from '@/lib/actions/notifications'
import type { Notification } from '@/lib/types'

interface Props {
  initialUnread: number
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function NotificationBell({ initialUnread }: Props) {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(initialUnread)
  const [items, setItems] = useState<Notification[] | null>(null)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next) {
      const list = await getNotifications()
      setItems(list)
      if (unread > 0) {
        setUnread(0)
        await markAllRead()
      }
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.07] text-insu-dim transition-colors hover:text-insu-text"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-insu-accent px-1 text-[10px] font-bold text-bg">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 top-[calc(100%+10px)] z-50 max-h-[70vh] w-80 overflow-y-auto rounded-xl border border-white/[0.08] bg-bg-card p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
            {items === null ? (
              <p className="px-3 py-6 text-center text-[13px] text-insu-muted">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-insu-muted">No notifications yet.</p>
            ) : (
              items.map((n) => {
                const inner = (
                  <div className="flex flex-col gap-0.5 rounded-md px-3 py-2.5 transition-colors hover:bg-white/[0.06]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold text-insu-text">{n.title}</span>
                      <span className="flex-shrink-0 text-[11px] text-insu-muted">{timeAgo(n.created_at)}</span>
                    </div>
                    <span className="text-[12px] text-insu-dim">{n.body}</span>
                  </div>
                )
                return n.contract?.slug ? (
                  <Link key={n.id} href={`/markets/${n.contract.slug}`} onClick={() => setOpen(false)}>
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id}>{inner}</div>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add components/layout/NotificationBell.tsx
git commit -m "feat(notifications): NotificationBell client component"
```

---

## Task 8: Wire the bell + Profile link into the header

**Files:**
- Modify: `components/layout/Header.tsx`
- Modify: `components/layout/MobileMenu.tsx`

- [ ] **Step 1: Fetch the unread count in Header**

In `components/layout/Header.tsx`, add the import:

```ts
import NotificationBell from './NotificationBell'
import { getUnreadCount } from '@/lib/actions/notifications'
```

Inside the `try` block, after `isAdmin` is computed (still inside `if (userId)`), fetch the count:

```ts
      unread = await getUnreadCount()
```

And declare `let unread = 0` near the top alongside `let userId` / `let isAdmin`.

- [ ] **Step 2: Render the bell (visible on all sizes when logged in)**

In the JSX, immediately before the desktop auth `<div className="hidden items-center gap-3 sm:flex">`, add a bell that shows for logged-in users on every breakpoint:

```tsx
      {userId && (
        <div className="flex-shrink-0">
          <NotificationBell initialUnread={unread} />
        </div>
      )}
```

- [ ] **Step 3: Add a Profile link to the desktop nav**

In the logged-in desktop block (the `userId ? (...)` branch with Admin/Portfolio/Logout), add a Profile link before `<LogoutButton />`:

```tsx
            <Link
              href="/profile"
              className="rounded-lg border border-white/[0.07] px-3 py-1.5 sm:px-4 text-[13px] font-semibold text-insu-dim transition-colors hover:border-white/15 hover:text-insu-text"
            >
              Profile
            </Link>
```

- [ ] **Step 4: Add a Profile link to the mobile menu**

In `components/layout/MobileMenu.tsx`, in the logged-in branch, add a Profile link after the Portfolio link:

```tsx
                <Link href="/profile" onClick={close} className={itemCls}>
                  Profile
                </Link>
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add components/layout/Header.tsx components/layout/MobileMenu.tsx
git commit -m "feat(notifications): bell + profile link in header and mobile menu"
```

---

## Task 9: Profile server action (TDD)

**Files:**
- Create: `lib/actions/profile.ts`
- Test: `tests/lib/actions/profile.test.ts`

The password change is done client-side via the Supabase browser client (mirroring `LoginForm`), so only `updateProfile` is a server action. `updateProfile` validates input before writing.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const updateEq = vi.fn().mockResolvedValue({ error: null })
const update = vi.fn().mockReturnValue({ eq: updateEq })
const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } })

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
    from: vi.fn(() => ({ update })),
  })),
}))

import { updateProfile } from '@/lib/actions/profile'

beforeEach(() => {
  update.mockClear()
  updateEq.mockClear()
})

describe('updateProfile', () => {
  it('writes valid fields', async () => {
    const res = await updateProfile({
      full_name: 'Ada',
      preferred_currency: 'MXN',
      notification_prefs: { coverage_paid: true, coverage_expired: false, protection_purchased: true, provider_settled: true },
    })
    expect(res).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      full_name: 'Ada',
      preferred_currency: 'MXN',
    }))
  })

  it('rejects an invalid currency', async () => {
    const res = await updateProfile({ preferred_currency: 'EUR' as never })
    expect(res).toEqual({ error: 'Invalid currency' })
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects malformed notification_prefs', async () => {
    const res = await updateProfile({ notification_prefs: { coverage_paid: 'yes' } as never })
    expect(res).toEqual({ error: 'Invalid notification preferences' })
    expect(update).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/lib/actions/profile.test.ts`
Expected: FAIL — cannot find module `@/lib/actions/profile`.

- [ ] **Step 3: Implement the action**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '@/lib/types'

interface UpdateProfileInput {
  full_name?: string
  preferred_currency?: 'USD' | 'MXN'
  notification_prefs?: NotificationPrefs
}

function validPrefs(p: unknown): p is NotificationPrefs {
  if (typeof p !== 'object' || p === null) return false
  return Object.keys(DEFAULT_NOTIFICATION_PREFS).every(
    (k) => typeof (p as Record<string, unknown>)[k] === 'boolean',
  )
}

export async function updateProfile(
  input: UpdateProfileInput,
): Promise<{ ok: true } | { error: string }> {
  if (input.preferred_currency && !['USD', 'MXN'].includes(input.preferred_currency)) {
    return { error: 'Invalid currency' }
  }
  if (input.notification_prefs !== undefined && !validPrefs(input.notification_prefs)) {
    return { error: 'Invalid notification preferences' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const patch: Record<string, unknown> = {}
  if (input.full_name !== undefined) patch.full_name = input.full_name.trim()
  if (input.preferred_currency !== undefined) patch.preferred_currency = input.preferred_currency
  if (input.notification_prefs !== undefined) patch.notification_prefs = input.notification_prefs

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('profiles') as any).update(patch).eq('id', user.id)
  if (error) return { error: error.message }

  revalidatePath('/profile')
  return { ok: true }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/lib/actions/profile.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/actions/profile.ts tests/lib/actions/profile.test.ts
git commit -m "feat(profile): updateProfile server action with validation"
```

---

## Task 10: Profile page + form

**Files:**
- Create: `app/profile/page.tsx`
- Create: `components/profile/ProfileForm.tsx`

- [ ] **Step 1: Create the page (server component)**

`app/profile/page.tsx`:

```tsx
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import ProfileForm from '@/components/profile/ProfileForm'
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '@/lib/types'

export default async function ProfilePage() {
  const isConfigured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  if (!isConfigured) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, preferred_currency, notification_prefs, created_at')
    .eq('id', user.id)
    .single()

  const p = (profile ?? {}) as {
    full_name: string | null
    role: string
    preferred_currency: 'USD' | 'MXN'
    notification_prefs: NotificationPrefs | null
    created_at: string
  }

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-8">
        <h1 className="mb-8 font-display text-[32px] tracking-[2px] text-insu-text">Profile</h1>
        <ProfileForm
          email={user.email ?? ''}
          role={p.role ?? 'hedger'}
          createdAt={p.created_at}
          fullName={p.full_name ?? ''}
          preferredCurrency={p.preferred_currency ?? 'USD'}
          notificationPrefs={p.notification_prefs ?? DEFAULT_NOTIFICATION_PREFS}
        />
      </main>
    </>
  )
}
```

- [ ] **Step 2: Create the form (client component)**

`components/profile/ProfileForm.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { updateProfile } from '@/lib/actions/profile'
import type { NotificationPrefs } from '@/lib/types'

interface Props {
  email: string
  role: string
  createdAt: string
  fullName: string
  preferredCurrency: 'USD' | 'MXN'
  notificationPrefs: NotificationPrefs
}

const PREF_LABELS: Record<keyof NotificationPrefs, string> = {
  coverage_paid: 'Coverage triggered / paid out',
  coverage_expired: 'Coverage expired (no payout)',
  protection_purchased: 'Protection purchased',
  provider_settled: 'Provider position settled',
}

const fieldCls =
  'w-full rounded-lg border border-white/[0.07] bg-bg-card px-4 py-2.5 text-[14px] text-insu-text outline-none transition-colors focus:border-insu-accent/40'
const labelCls = 'mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-insu-muted'
const cardCls = 'rounded-xl border border-white/[0.07] bg-bg-card/40 p-5'

export default function ProfileForm(props: Props) {
  const [fullName, setFullName] = useState(props.fullName)
  const [currency, setCurrency] = useState<'USD' | 'MXN'>(props.preferredCurrency)
  const [prefs, setPrefs] = useState<NotificationPrefs>(props.notificationPrefs)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMsg, setProfileMsg] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [savingPw, setSavingPw] = useState(false)
  const [pwMsg, setPwMsg] = useState<string | null>(null)

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSavingProfile(true)
    setProfileMsg(null)
    const res = await updateProfile({ full_name: fullName, preferred_currency: currency, notification_prefs: prefs })
    setProfileMsg('error' in res ? res.error : 'Saved.')
    setSavingProfile(false)
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault()
    setSavingPw(true)
    setPwMsg(null)
    const supabase = createClient()
    if (!supabase) {
      setPwMsg('Supabase is not configured.')
      setSavingPw(false)
      return
    }
    const { error } = await supabase.auth.updateUser({ password })
    setPwMsg(error ? error.message : 'Password updated.')
    if (!error) setPassword('')
    setSavingPw(false)
  }

  return (
    <div className="space-y-6">
      {/* Account (read-only) */}
      <section className={cardCls}>
        <h2 className="mb-4 text-[15px] font-semibold text-insu-text">Account</h2>
        <dl className="space-y-2 text-[13px]">
          <div className="flex justify-between"><dt className="text-insu-muted">Email</dt><dd className="text-insu-text">{props.email}</dd></div>
          <div className="flex justify-between"><dt className="text-insu-muted">Role</dt><dd className="text-insu-text capitalize">{props.role}</dd></div>
          <div className="flex justify-between"><dt className="text-insu-muted">Member since</dt><dd className="text-insu-text">{new Date(props.createdAt).toLocaleDateString()}</dd></div>
        </dl>
      </section>

      {/* Editable settings */}
      <form onSubmit={saveProfile} className={cardCls + ' space-y-5'}>
        <h2 className="text-[15px] font-semibold text-insu-text">Settings</h2>

        <div>
          <label htmlFor="full-name" className={labelCls}>Display name</label>
          <input id="full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={fieldCls} />
        </div>

        <div>
          <label htmlFor="currency" className={labelCls}>Preferred currency</label>
          <select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value as 'USD' | 'MXN')} className={fieldCls}>
            <option value="USD">USD</option>
            <option value="MXN">MXN</option>
          </select>
        </div>

        <div>
          <span className={labelCls}>Notifications</span>
          <div className="space-y-2">
            {(Object.keys(PREF_LABELS) as Array<keyof NotificationPrefs>).map((key) => (
              <label key={key} className="flex cursor-pointer items-center gap-2.5 text-[13px] text-insu-dim">
                <input
                  type="checkbox"
                  checked={prefs[key]}
                  onChange={(e) => setPrefs((p) => ({ ...p, [key]: e.target.checked }))}
                  className="h-4 w-4 accent-insu-accent"
                />
                {PREF_LABELS[key]}
              </label>
            ))}
          </div>
        </div>

        {profileMsg && <p role="status" className="text-[13px] text-insu-dim">{profileMsg}</p>}

        <button type="submit" disabled={savingProfile} className="rounded-lg bg-insu-accent px-5 py-2.5 text-[14px] font-bold text-bg transition-all hover:bg-[#f7b84a] disabled:opacity-50">
          {savingProfile ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      {/* Change password */}
      <form onSubmit={savePassword} className={cardCls + ' space-y-4'}>
        <h2 className="text-[15px] font-semibold text-insu-text">Change password</h2>
        <div>
          <label htmlFor="new-password" className={labelCls}>New password</label>
          <input id="new-password" type="password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} className={fieldCls} />
        </div>
        {pwMsg && <p role="status" className="text-[13px] text-insu-dim">{pwMsg}</p>}
        <button type="submit" disabled={savingPw} className="rounded-lg border border-white/[0.07] px-5 py-2.5 text-[14px] font-semibold text-insu-text transition-colors hover:border-white/15 disabled:opacity-50">
          {savingPw ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/profile/page.tsx components/profile/ProfileForm.tsx
git commit -m "feat(profile): /profile page with settings and password change"
```

---

## Task 11: Full verification

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: all tests pass.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Manual smoke test (dev server)**

Run: `npm run dev`, then as a logged-in user:
- Buy protection → a "Protection active" notification appears in the bell with a badge.
- Open the bell → list renders, badge clears, items deep-link to their market.
- Visit `/profile` → edit name/currency/notification toggles → Save → reload shows persisted values.
- Change password → success message; log out and back in with the new password.
- Toggle a notification type off → trigger that event → confirm no notification is created.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "chore: notifications + profile cleanup"
```

---

## Self-review notes

- **Spec coverage:** table + RLS + prefs column (T1), types (T2), helper (T3), all four events — purchased (T4), paid/provider_settled/expired (T5), bell + actions (T6–T8), profile with all five capabilities incl. password (T9–T10). All spec sections map to a task.
- **Out of scope (per spec):** no email, no realtime, no `/notifications` route, no per-notification delete, no notifications for daily recurring lapses.
- **Type consistency:** `NotificationType`, `NotificationPrefs`, `Notification`, `DEFAULT_NOTIFICATION_PREFS`, `createNotification(db, {...})`, and action names (`getUnreadCount`, `getNotifications`, `markAllRead`, `markRead`, `updateProfile`) are used identically across tasks.
