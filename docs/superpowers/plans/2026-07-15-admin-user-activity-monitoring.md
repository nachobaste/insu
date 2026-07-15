# Admin User-Activity Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin page (`/admin/activity`) that shows each F&F tester's journey — signup, logins, purchases, deposits, payouts — with a per-tester status flag, plus a self-tracked login counter.

**Architecture:** Server-rendered admin page reading all data on load via the service client. Pure aggregation/status logic lives in a testable module (`lib/admin/activity.ts`); the server action just fetches and delegates. Login counting is a `SECURITY DEFINER` RPC incremented by a `recordLogin()` action called at both auth entry points.

**Tech Stack:** Next.js App Router (server + client components), Supabase (Postgres + auth admin API), Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-15-admin-user-activity-monitoring-design.md`

---

## Context the implementer needs

- **Single Supabase project is production** (`eagmczieznsogsxldedk`); no staging. Migrations applied via `supabase db push --linked < /dev/null`. The new columns are additive and safe.
- **RPC pattern** to mirror (`supabase/migrations/20260524000001_security_fixes.sql`):
  ```sql
  CREATE OR REPLACE FUNCTION increment_tier_capacity(p_tier_id uuid, p_amount numeric)
  RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    UPDATE coverage_tiers SET current_capacity_usd = current_capacity_usd + p_amount WHERE id = p_tier_id;
  $$;
  ```
- **Admin pages that read user-owned tables MUST use `createServiceClient()`** — a user-scoped client returns empty under RLS. Re-verify admin role in the page (defense in depth), copying `app/admin/payouts/page.tsx`.
- **Login is password-based** (`components/auth/LoginForm.tsx` → `supabase.auth.signInWithPassword`, then `router.push('/')`). OAuth/magic-link goes through `app/auth/callback/route.ts` → `exchangeCodeForSession`.
- **Emails are NOT in `profiles`** — fetch via `db.auth.admin.listUsers()` (returns `{ id, email, last_sign_in_at, ... }`).
- **Payouts have no `user_id`** — they link through `hedger_position_id → hedger_positions.user_id`. Resolve in the action's query.
- **Action-test mock pattern** (`tests/lib/actions/profile.test.ts`): `vi.mock('@/lib/supabase/server', ...)` returning an object with `auth.getUser` and `from()` fakes.
- **Relevant columns:** `profiles(id, full_name, role, created_at)`; `hedger_positions(user_id, status, purchased_at, premium_paid_usd, coverage_period_days, contract_id, tier_id)`; `provider_positions(user_id, deposited_at, capital_deposited_usd, contract_id)`; `payouts(hedger_position_id, amount_usd, created_at, trigger_day)`.
- Tests: `npm run test:run`. Typecheck: `npx tsc --noEmit`. Lint: `npm run lint`.

## File Structure

- **Create** `supabase/migrations/20260715000001_login_tracking.sql` — `profiles.login_count`, `profiles.last_login_at`, `increment_login_count` RPC.
- **Modify** `lib/supabase/database.types.ts` — add the two columns to the `profiles` Row/Insert/Update.
- **Create** `lib/admin/activity.ts` — pure types + `deriveTesterStatus` + `buildUserActivity`.
- **Create** `tests/lib/admin/activity.test.ts` — unit tests for the pure logic.
- **Create** `lib/actions/auth.ts` — `recordLogin()` server action.
- **Create** `tests/lib/actions/auth.test.ts` — `recordLogin` test.
- **Modify** `components/auth/LoginForm.tsx` and `app/auth/callback/route.ts` — call `recordLogin()`.
- **Create** `lib/actions/adminActivity.ts` — `getUserActivity()` (fetch + delegate to pure logic).
- **Create** `app/admin/activity/page.tsx` — server component (admin re-check + render).
- **Create** `components/admin/activity/UserActivityTable.tsx` — client table with expandable rows.
- **Modify** `components/admin/AdminSidebar.tsx` — add the `Activity` nav item.

---

### Task 1: Migration — login tracking columns + RPC

**Files:**
- Create: `supabase/migrations/20260715000001_login_tracking.sql`
- Modify: `lib/supabase/database.types.ts` (profiles Row/Insert/Update)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260715000001_login_tracking.sql`:

```sql
-- Self-tracked login counter for F&F engagement monitoring. Supabase's auth
-- audit log is not reachable via PostgREST and listUsers only exposes
-- last_sign_in_at, so we count logins ourselves from an app-level action.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- Atomic increment, mirrors increment_tier_capacity/increment_contract_volume.
-- SECURITY DEFINER so it runs regardless of the caller's RLS on profiles.
CREATE OR REPLACE FUNCTION increment_login_count(p_user_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE profiles
  SET login_count = login_count + 1,
      last_login_at = now()
  WHERE id = p_user_id;
$$;
```

- [ ] **Step 2: Apply the migration to the (production) database**

Run: `supabase db push --linked < /dev/null`
Expected: reports applying `20260715000001_login_tracking`.

- [ ] **Step 3: Verify columns and RPC exist**

Run:
```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env={...process.env};
for(const l of readFileSync(".env.local","utf8").split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&env[m[1]]===undefined)env[m[1]]=m[2].replace(/^["\x27]|["\x27]$/g,"");}
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const {data}=await db.from("profiles").select("id,login_count,last_login_at").limit(1);
console.log("columns ok, sample:", data);
const {error}=await db.rpc("increment_login_count",{p_user_id:"00000000-0000-0000-0000-000000000000"});
console.log("rpc callable:", error? error.message : "yes (no-op on missing id)");
'
```
Expected: prints the columns (login_count defaults to 0) and `rpc callable: yes`.

- [ ] **Step 4: Add the columns to the TypeScript types**

In `lib/supabase/database.types.ts`, find the `profiles:` table block and add to its `Row`, `Insert`, and `Update` shapes (Insert/Update as optional):
- Row: `login_count: number` and `last_login_at: string | null`
- Insert: `login_count?: number` and `last_login_at?: string | null`
- Update: `login_count?: number` and `last_login_at?: string | null`

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260715000001_login_tracking.sql lib/supabase/database.types.ts
git commit -m "feat(db): login_count/last_login_at on profiles + increment_login_count RPC"
```

---

### Task 2: Pure activity logic + tests

**Files:**
- Create: `lib/admin/activity.ts`
- Test: `tests/lib/admin/activity.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/admin/activity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveTesterStatus, buildUserActivity } from '@/lib/admin/activity'
import type { ActivityInputs } from '@/lib/admin/activity'

const base = {
  profiles: [{ id: 'u1', full_name: 'Ada', created_at: '2026-07-01T00:00:00Z', login_count: 3, last_login_at: '2026-07-05T00:00:00Z' }],
  authUsers: [{ id: 'u1', email: 'ada@example.com' }],
  buys: [], deposits: [], payouts: [],
} satisfies ActivityInputs

describe('deriveTesterStatus', () => {
  it('completed_loop when a payout exists (trumps all)', () => {
    expect(deriveTesterStatus({ buys: [{ status: 'active' }], deposits: [], payouts: [{}] })).toBe('completed_loop')
  })
  it('holding when an active buy and no payout', () => {
    expect(deriveTesterStatus({ buys: [{ status: 'active' }], deposits: [], payouts: [] })).toBe('holding')
  })
  it('abandoned_checkout when only a pending_payment buy', () => {
    expect(deriveTesterStatus({ buys: [{ status: 'pending_payment' }], deposits: [], payouts: [] })).toBe('abandoned_checkout')
  })
  it('signed_up_idle with no positions at all', () => {
    expect(deriveTesterStatus({ buys: [], deposits: [], payouts: [] })).toBe('signed_up_idle')
  })
  it('active_other for a provider-only deposit', () => {
    expect(deriveTesterStatus({ buys: [], deposits: [{}], payouts: [] })).toBe('active_other')
  })
})

describe('buildUserActivity', () => {
  it('rolls up an idle signed-up user', () => {
    const [a] = buildUserActivity(base)
    expect(a).toMatchObject({ userId: 'u1', name: 'Ada', email: 'ada@example.com', loginCount: 3, status: 'signed_up_idle', totalPremiumUsd: 0, totalPayoutUsd: 0 })
    expect(a.timeline).toHaveLength(1)
    expect(a.timeline[0].kind).toBe('signup')
  })

  it('sums premiums/payouts and builds a reverse-chronological timeline', () => {
    const inputs: ActivityInputs = {
      ...base,
      buys: [{ user_id: 'u1', status: 'active', purchased_at: '2026-07-02T00:00:00Z', premium_paid_usd: 11.5, coverage_period_days: 7, contract_title: 'Heat wave', tier_name: 'basic' }],
      payouts: [{ user_id: 'u1', created_at: '2026-07-04T00:00:00Z', amount_usd: 100, trigger_day: '2026-07-04' }],
    }
    const [a] = buildUserActivity(inputs)
    expect(a.totalPremiumUsd).toBeCloseTo(11.5, 2)
    expect(a.totalPayoutUsd).toBe(100)
    expect(a.status).toBe('completed_loop')
    // reverse chronological: payout (07-04) before buy (07-02) before signup (07-01)
    expect(a.timeline.map((t) => t.kind)).toEqual(['payout', 'buy', 'signup'])
    expect(a.lastActivityAt).toBe('2026-07-05T00:00:00Z') // last_login is latest
  })

  it('groups rows by user and sorts users by most recent activity', () => {
    const inputs: ActivityInputs = {
      profiles: [
        { id: 'u1', full_name: 'Ada', created_at: '2026-07-01T00:00:00Z', login_count: 1, last_login_at: '2026-07-01T00:00:00Z' },
        { id: 'u2', full_name: 'Bea', created_at: '2026-07-02T00:00:00Z', login_count: 1, last_login_at: '2026-07-09T00:00:00Z' },
      ],
      authUsers: [{ id: 'u1', email: 'a@x.com' }, { id: 'u2', email: 'b@x.com' }],
      buys: [], deposits: [], payouts: [],
    }
    const out = buildUserActivity(inputs)
    expect(out.map((u) => u.userId)).toEqual(['u2', 'u1']) // u2 more recent
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- tests/lib/admin/activity.test.ts`
Expected: FAIL — module `@/lib/admin/activity` does not exist.

- [ ] **Step 3: Implement the pure module**

Create `lib/admin/activity.ts`:

```ts
export type TesterStatus =
  | 'completed_loop'
  | 'holding'
  | 'abandoned_checkout'
  | 'signed_up_idle'
  | 'active_other'

export interface ProfileRow {
  id: string
  full_name: string | null
  created_at: string
  login_count: number
  last_login_at: string | null
}
export interface AuthUserRow { id: string; email: string | null }
export interface BuyRow {
  user_id: string
  status: string
  purchased_at: string
  premium_paid_usd: number
  coverage_period_days: number | null
  contract_title: string | null
  tier_name: string | null
}
export interface DepositRow {
  user_id: string
  deposited_at: string
  capital_deposited_usd: number
  contract_title: string | null
}
export interface PayoutRow {
  user_id: string
  created_at: string
  amount_usd: number
  trigger_day: string | null
}

export interface ActivityInputs {
  profiles: ProfileRow[]
  authUsers: AuthUserRow[]
  buys: BuyRow[]
  deposits: DepositRow[]
  payouts: PayoutRow[]
}

export interface TimelineItem {
  at: string
  kind: 'signup' | 'buy' | 'deposit' | 'payout'
  primary: string
  amountUsd?: number
  meta?: string
}

export interface UserActivity {
  userId: string
  name: string | null
  email: string | null
  createdAt: string
  loginCount: number
  lastLoginAt: string | null
  buys: BuyRow[]
  deposits: DepositRow[]
  payouts: PayoutRow[]
  totalPremiumUsd: number
  totalPayoutUsd: number
  status: TesterStatus
  lastActivityAt: string
  timeline: TimelineItem[]
}

/** Most-advanced status wins: paid out > holding > abandoned checkout > idle > other. */
export function deriveTesterStatus(r: {
  buys: { status: string }[]
  deposits: unknown[]
  payouts: unknown[]
}): TesterStatus {
  if (r.payouts.length > 0) return 'completed_loop'
  if (r.buys.some((b) => b.status === 'active')) return 'holding'
  if (r.buys.some((b) => b.status === 'pending_payment')) return 'abandoned_checkout'
  if (r.buys.length === 0 && r.deposits.length === 0) return 'signed_up_idle'
  return 'active_other'
}

function maxIso(...isos: (string | null | undefined)[]): string {
  return isos.filter((x): x is string => !!x).sort().at(-1) ?? ''
}

export function buildUserActivity(inputs: ActivityInputs): UserActivity[] {
  const emailById = new Map(inputs.authUsers.map((u) => [u.id, u.email]))
  const buysById = groupBy(inputs.buys, (b) => b.user_id)
  const depositsById = groupBy(inputs.deposits, (d) => d.user_id)
  const payoutsById = groupBy(inputs.payouts, (p) => p.user_id)

  const out = inputs.profiles.map((p): UserActivity => {
    const buys = buysById.get(p.id) ?? []
    const deposits = depositsById.get(p.id) ?? []
    const payouts = payoutsById.get(p.id) ?? []

    const timeline: TimelineItem[] = [
      { at: p.created_at, kind: 'signup', primary: 'Signed up' },
      ...buys.map((b): TimelineItem => ({
        at: b.purchased_at,
        kind: 'buy',
        primary: b.contract_title ?? 'Protection',
        amountUsd: b.premium_paid_usd,
        meta: [b.tier_name, b.coverage_period_days ? `${b.coverage_period_days}d` : null, b.status]
          .filter(Boolean).join(' · '),
      })),
      ...deposits.map((d): TimelineItem => ({
        at: d.deposited_at,
        kind: 'deposit',
        primary: d.contract_title ?? 'Capital deposit',
        amountUsd: d.capital_deposited_usd,
      })),
      ...payouts.map((pay): TimelineItem => ({
        at: pay.created_at,
        kind: 'payout',
        primary: 'Payout received',
        amountUsd: pay.amount_usd,
        meta: pay.trigger_day ? `trigger ${pay.trigger_day}` : undefined,
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

    return {
      userId: p.id,
      name: p.full_name,
      email: emailById.get(p.id) ?? null,
      createdAt: p.created_at,
      loginCount: p.login_count,
      lastLoginAt: p.last_login_at,
      buys, deposits, payouts,
      totalPremiumUsd: round2(buys.reduce((s, b) => s + b.premium_paid_usd, 0)),
      totalPayoutUsd: round2(payouts.reduce((s, p2) => s + p2.amount_usd, 0)),
      status: deriveTesterStatus({ buys, deposits, payouts }),
      lastActivityAt: maxIso(
        p.last_login_at, p.created_at,
        ...buys.map((b) => b.purchased_at),
        ...deposits.map((d) => d.deposited_at),
        ...payouts.map((p2) => p2.created_at),
      ),
      timeline,
    }
  })

  return out.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0))
}

function groupBy<T>(rows: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const arr = m.get(k)
    if (arr) arr.push(r)
    else m.set(k, [r])
  }
  return m
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- tests/lib/admin/activity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/admin/activity.ts tests/lib/admin/activity.test.ts
git commit -m "feat(admin): pure user-activity aggregation and tester-status logic"
```

---

### Task 3: `recordLogin` server action + test

**Files:**
- Create: `lib/actions/auth.ts`
- Test: `tests/lib/actions/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/actions/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn().mockResolvedValue({ error: null })
const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } })

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser }, rpc })),
}))

import { recordLogin } from '@/lib/actions/auth'

beforeEach(() => {
  rpc.mockClear()
  getUser.mockClear()
  getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
})

describe('recordLogin', () => {
  it('increments the login counter for the authenticated user', async () => {
    await recordLogin()
    expect(rpc).toHaveBeenCalledWith('increment_login_count', { p_user_id: 'u1' })
  })

  it('is a no-op when unauthenticated', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } })
    await recordLogin()
    expect(rpc).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/lib/actions/auth.test.ts`
Expected: FAIL — module `@/lib/actions/auth` does not exist.

- [ ] **Step 3: Implement the action**

Create `lib/actions/auth.ts`:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Increments the current user's login counter (profiles.login_count) and stamps
 * last_login_at. Called at each successful-auth entry point so the count reflects
 * real logins, not page loads. Silent no-op if unauthenticated or on RPC error —
 * login tracking must never block a sign-in.
 */
export async function recordLogin(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.rpc as any)('increment_login_count', { p_user_id: user.id })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- tests/lib/actions/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/auth.ts tests/lib/actions/auth.test.ts
git commit -m "feat(auth): recordLogin action incrementing the login counter"
```

---

### Task 4: Wire `recordLogin` into both auth entry points

**Files:**
- Modify: `components/auth/LoginForm.tsx`
- Modify: `app/auth/callback/route.ts`

- [ ] **Step 1: Call recordLogin after password sign-in**

In `components/auth/LoginForm.tsx`, add the import at the top with the other imports:

```ts
import { recordLogin } from '@/lib/actions/auth'
```

Then, immediately after the `signInWithPassword` success check (right after the block that returns/handles `error`, before `router.push('/')`), add:

```ts
    await recordLogin()
```

- [ ] **Step 2: Call recordLogin after code exchange**

In `app/auth/callback/route.ts`, add the import:

```ts
import { recordLogin } from '@/lib/actions/auth'
```

Then change the success branch so that after a successful `exchangeCodeForSession` it records the login. Replace:

```ts
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(`${origin}/auth/login?error=auth_callback_failed`)
    }
```

with:

```ts
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(`${origin}/auth/login?error=auth_callback_failed`)
    }
    await recordLogin()
```

- [ ] **Step 3: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npm run test:run`
Expected: no type errors; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/auth/LoginForm.tsx app/auth/callback/route.ts
git commit -m "feat(auth): record a login at password and OAuth/magic-link entry points"
```

---

### Task 5: `getUserActivity` server action

**Files:**
- Create: `lib/actions/adminActivity.ts`

- [ ] **Step 1: Implement the fetch-and-delegate action**

Create `lib/actions/adminActivity.ts`:

```ts
'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { buildUserActivity, type UserActivity, type ActivityInputs } from '@/lib/admin/activity'

/**
 * Aggregates every profile's F&F journey. Uses the service client because it
 * reads user-owned tables (RLS would return empty for an admin). Payouts carry
 * no user_id, so they are joined through hedger_positions.user_id.
 */
export async function getUserActivity(): Promise<UserActivity[]> {
  const db = createServiceClient()

  const [profilesRes, buysRes, depositsRes, payoutsRes, usersRes] = await Promise.all([
    db.from('profiles').select('id, full_name, created_at, login_count, last_login_at'),
    db.from('hedger_positions').select('user_id, status, purchased_at, premium_paid_usd, coverage_period_days, contract:contracts(title), tier:coverage_tiers(name)'),
    db.from('provider_positions').select('user_id, deposited_at, capital_deposited_usd, contract:contracts(title)'),
    db.from('payouts').select('amount_usd, created_at, trigger_day, hedger_position:hedger_positions(user_id)'),
    db.auth.admin.listUsers(),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asArr = (x: any) => (Array.isArray(x) ? x : [])

  const inputs: ActivityInputs = {
    profiles: asArr(profilesRes.data).map((p: Record<string, unknown>) => ({
      id: p.id as string,
      full_name: (p.full_name as string) ?? null,
      created_at: p.created_at as string,
      login_count: (p.login_count as number) ?? 0,
      last_login_at: (p.last_login_at as string) ?? null,
    })),
    authUsers: (usersRes.data?.users ?? []).map((u) => ({ id: u.id, email: u.email ?? null })),
    buys: asArr(buysRes.data).map((b: Record<string, any>) => ({
      user_id: b.user_id,
      status: b.status,
      purchased_at: b.purchased_at,
      premium_paid_usd: Number(b.premium_paid_usd ?? 0),
      coverage_period_days: b.coverage_period_days ?? null,
      contract_title: b.contract?.title ?? null,
      tier_name: b.tier?.name ?? null,
    })),
    deposits: asArr(depositsRes.data).map((d: Record<string, any>) => ({
      user_id: d.user_id,
      deposited_at: d.deposited_at,
      capital_deposited_usd: Number(d.capital_deposited_usd ?? 0),
      contract_title: d.contract?.title ?? null,
    })),
    payouts: asArr(payoutsRes.data)
      .map((p: Record<string, any>) => ({
        user_id: p.hedger_position?.user_id as string | undefined,
        created_at: p.created_at,
        amount_usd: Number(p.amount_usd ?? 0),
        trigger_day: p.trigger_day ?? null,
      }))
      .filter((p): p is { user_id: string; created_at: string; amount_usd: number; trigger_day: string | null } => !!p.user_id),
  }

  return buildUserActivity(inputs)
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify it runs against real data**

Run:
```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env={...process.env};
for(const l of readFileSync(".env.local","utf8").split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&env[m[1]]===undefined)env[m[1]]=m[2].replace(/^["\x27]|["\x27]$/g,"");}
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const [pr,br,dr,yr,ur]=await Promise.all([
  db.from("profiles").select("id, full_name, created_at, login_count, last_login_at"),
  db.from("hedger_positions").select("user_id, status, purchased_at, premium_paid_usd, coverage_period_days, contract:contracts(title), tier:coverage_tiers(name)"),
  db.from("provider_positions").select("user_id, deposited_at, capital_deposited_usd, contract:contracts(title)"),
  db.from("payouts").select("amount_usd, created_at, trigger_day, hedger_position:hedger_positions(user_id)"),
  db.auth.admin.listUsers(),
]);
console.log("profiles",pr.data?.length,"buys",br.data?.length,"deposits",dr.data?.length,"payouts",yr.data?.length,"users",ur.data?.users?.length);
console.log("errors:", [pr.error,br.error,dr.error,yr.error].filter(Boolean).map(e=>e.message));
console.log("sample payout->user:", yr.data?.[0]);
'
```
Expected: prints counts, no errors, and a payout row whose `hedger_position.user_id` is populated (confirms the join for user attribution).

- [ ] **Step 4: Commit**

```bash
git add lib/actions/adminActivity.ts
git commit -m "feat(admin): getUserActivity aggregation action (service client + auth emails)"
```

---

### Task 6: Activity page + client table

**Files:**
- Create: `app/admin/activity/page.tsx`
- Create: `components/admin/activity/UserActivityTable.tsx`

- [ ] **Step 1: Create the client table component**

Create `components/admin/activity/UserActivityTable.tsx`:

```tsx
'use client'

import { Fragment, useState } from 'react'
import { formatCurrency } from '@/lib/utils'
import type { UserActivity, TesterStatus, TimelineItem } from '@/lib/admin/activity'

const STATUS_LABEL: Record<TesterStatus, string> = {
  completed_loop: '✅ Completed loop',
  holding: '⏳ Holding',
  abandoned_checkout: '⚠️ Abandoned checkout',
  signed_up_idle: '💤 Idle',
  active_other: '· Active',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function TimelineRow({ item }: { item: TimelineItem }) {
  return (
    <div className="flex items-baseline gap-3 py-1 text-[13px]">
      <span className="w-28 flex-shrink-0 text-insu-dim">{fmtDate(item.at)}</span>
      <span className="text-insu-text">{item.primary}</span>
      {item.amountUsd != null && <span className="font-mono text-insu-green">{formatCurrency(item.amountUsd, 'USD')}</span>}
      {item.meta && <span className="text-insu-muted">{item.meta}</span>}
    </div>
  )
}

export function UserActivityTable({ users }: { users: UserActivity[] }) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (users.length === 0) {
    return <p className="text-[13px] text-insu-muted">No users yet.</p>
  }

  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.07]">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-white/[0.03] text-[11px] uppercase tracking-wider text-insu-muted">
          <tr>
            <th className="px-3 py-2">Tester</th>
            <th className="px-3 py-2">Logins</th>
            <th className="px-3 py-2">Last login</th>
            <th className="px-3 py-2">Buys</th>
            <th className="px-3 py-2">Deposits</th>
            <th className="px-3 py-2">Premium</th>
            <th className="px-3 py-2">Payouts</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <Fragment key={u.userId}>
              <tr
                onClick={() => setOpenId((prev) => (prev === u.userId ? null : u.userId))}
                className="cursor-pointer border-t border-white/[0.05] hover:bg-white/[0.03]"
              >
                <td className="px-3 py-2">
                  <div className="font-medium text-insu-text">{u.name || '(no name)'}</div>
                  <div className="text-[11px] text-insu-dim">{u.email ?? '—'}</div>
                </td>
                <td className="px-3 py-2 font-mono">{u.loginCount}</td>
                <td className="px-3 py-2 text-insu-muted">{fmtDate(u.lastLoginAt)}</td>
                <td className="px-3 py-2 font-mono">{u.buys.length}</td>
                <td className="px-3 py-2 font-mono">{u.deposits.length}</td>
                <td className="px-3 py-2 font-mono">{formatCurrency(u.totalPremiumUsd, 'USD')}</td>
                <td className="px-3 py-2 font-mono text-insu-green">{formatCurrency(u.totalPayoutUsd, 'USD')}</td>
                <td className="px-3 py-2 whitespace-nowrap">{STATUS_LABEL[u.status]}</td>
              </tr>
              {openId === u.userId && (
                <tr className="border-t border-white/[0.05] bg-white/[0.02]">
                  <td colSpan={8} className="px-4 py-3">
                    {u.timeline.map((item, i) => (
                      <TimelineRow key={i} item={item} />
                    ))}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Create the page (admin re-check + render)**

Create `app/admin/activity/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserActivity } from '@/lib/actions/adminActivity'
import { UserActivityTable } from '@/components/admin/activity/UserActivityTable'

export default async function AdminActivityPage() {
  // The admin layout enforces admin + AAL2 MFA, but getUserActivity reads via the
  // service client (bypasses RLS), so re-verify admin here (defense in depth).
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) redirect('/auth/login')
  const { data: profile } = await userClient.from('profiles').select('role').eq('id', user.id).single()
  if ((profile as { role: string } | null)?.role !== 'admin') redirect('/')

  const users = await getUserActivity()

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-insu-text">User activity</h1>
      <p className="mb-4 text-[13px] text-insu-muted">
        {users.length} user{users.length === 1 ? '' : 's'} · click a row for the full timeline
      </p>
      <UserActivityTable users={users} />
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/admin/activity/page.tsx components/admin/activity/UserActivityTable.tsx
git commit -m "feat(admin): user-activity page with expandable per-tester timeline"
```

---

### Task 7: Sidebar navigation entry

**Files:**
- Modify: `components/admin/AdminSidebar.tsx`

- [ ] **Step 1: Add the nav item**

In `components/admin/AdminSidebar.tsx`, add to the `NAV` array (after the `payouts` entry):

```ts
  { href: '/admin/activity', label: 'Activity', icon: '👥' },
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/admin/AdminSidebar.tsx
git commit -m "feat(admin): add Activity to the admin sidebar"
```

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `npm run test:run`
Expected: all tests pass, including `tests/lib/admin/activity.test.ts` and `tests/lib/actions/auth.test.ts`.

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual smoke — login counter**

Run `npm run dev`, log out and back in with a test account, then re-query:
```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env={...process.env};
for(const l of readFileSync(".env.local","utf8").split("\n")){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m&&env[m[1]]===undefined)env[m[1]]=m[2].replace(/^["\x27]|["\x27]$/g,"");}
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const {data}=await db.from("profiles").select("full_name, login_count, last_login_at").order("last_login_at",{ascending:false});
console.log(data);
'
```
Expected: the account you logged in with shows an incremented `login_count` and a fresh `last_login_at`.

- [ ] **Step 4: Manual smoke — the page**

Visit `/admin/activity` while signed in as an admin.
Expected: a table of users with login counts and status chips; clicking a row expands the reverse-chronological timeline (signup, buys, deposits, payouts). Non-admins are redirected.

---

## Deployment note

Prod does NOT auto-deploy on merge. The migration was already applied to the (single, production) database in Task 1, so after merge just run `vercel --prod --yes` from a `main` checkout. No cron or reprice involved.

## Out of scope (per spec)

Page-view/clickstream tracking, realtime/live updates, tester-only filtering, and aggregate funnel analytics.
```
