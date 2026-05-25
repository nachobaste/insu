# Security Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all 7 remaining open security findings from the threat model and PCI-DSS assessment, leaving the app compliant for real-payment processing.

**Architecture:** Each task is self-contained. Tasks 1–3 are code changes committed to `develop`. Tasks 4–5 involve installing new packages. Tasks 6–7 are configuration + documentation. Apply both pending migrations (`20260524000001` and `20260524000002`) to the live Supabase database via SQL Editor before merging to `main`.

**Tech Stack:** Next.js 16, React 19, Supabase Auth MFA, @sentry/nextjs, TypeScript 5

---

## Open Findings Reference

| # | Severity | Finding |
|---|----------|---------|
| T1 | 🔴 High | Next.js 14.2.35 has 4 high CVEs — fix requires upgrade to 16.x |
| T2 | 🔴 High | MFA not enforced for admin accounts (PCI Req 8) |
| T3 | 🟡 Medium | Pending position flood — no per-user rate limit |
| T4 | 🟡 Medium | `/admin` routes have no IP allowlist (PCI Req 1) |
| T5 | 🟡 Medium | No runtime error monitoring (PCI Req 11) |
| T6 | 🟢 Low | Log retention undefined — Supabase default 30 days (PCI Req 10) |
| T7 | 🟢 Low | No incident response plan documented (PCI Req 12) |

---

## File Map

| File | Task | Change |
|------|------|--------|
| `package.json` | T1, T5 | Upgrade next→16, react→19, add @sentry/nextjs |
| `next.config.mjs` | T1, T5 | Async headers(), withSentryConfig wrapper |
| `lib/actions/admin.ts` | T2 | Add AAL2 MFA check to assertAdmin() |
| `components/admin/AdminMfaGate.tsx` | T2 | Create — MFA challenge UI for admin layout |
| `app/admin/layout.tsx` | T2 | Catch MFA_REQUIRED, render AdminMfaGate |
| `lib/actions/purchase.ts` | T3 | Add pending position count guard |
| `middleware.ts` | T4 | Add ADMIN_IP_ALLOWLIST check |
| `.env.local.example` | T4 | Add ADMIN_IP_ALLOWLIST and SENTRY_DSN |
| `sentry.client.config.ts` | T5 | Create — Sentry browser config |
| `sentry.server.config.ts` | T5 | Create — Sentry server config |
| `sentry.edge.config.ts` | T5 | Create — Sentry edge config |
| `instrumentation.ts` | T5 | Create — Next.js instrumentation hook |
| `docs/security/log-retention.md` | T6 | Create — log retention policy |
| `docs/security/incident-response.md` | T7 | Create — incident response plan |

---

## Task 1: Upgrade Next.js 14 → 16 (fixes 4 high CVEs)

**Files:**
- Modify: `package.json`
- Modify: `next.config.mjs`
- Modify: `app/admin/layout.tsx` (async params)
- Modify: `app/markets/[slug]/page.tsx` (async params)

Next.js 15+ requires async access to `cookies()`, `headers()`, and route `params`. Next.js 16 requires React 19. The `next.config.mjs` `headers()` function is already async — no change needed there.

- [ ] **Step 1: Create a dedicated upgrade branch**

```bash
git checkout develop
git checkout -b feat/nextjs-16-upgrade
```

- [ ] **Step 2: Upgrade packages**

```bash
npm install next@^16 eslint-config-next@^16 react@^19 react-dom@^19 @types/react@^19 @types/react-dom@^19
```

Expected: package-lock.json updated, no peer dependency errors.

- [ ] **Step 3: Run build to surface breaking changes**

```bash
npm run build 2>&1 | head -60
```

Expected output will list TypeScript errors for any deprecated APIs. Common Next.js 15/16 breaks:
- `params` and `searchParams` in page/layout components are now `Promise<...>` and must be awaited
- `cookies()` and `headers()` from `next/headers` are now async

- [ ] **Step 4: Fix async params in `app/markets/[slug]/page.tsx`**

Read the current file. The page receives `{ params: { slug: string } }`. In Next.js 15+ params is a Promise. Update:

```typescript
// app/markets/[slug]/page.tsx
export default async function ContractPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  // ... rest of page unchanged
}
```

- [ ] **Step 5: Fix async params in `app/admin/contracts/[id]/page.tsx`**

```typescript
// app/admin/contracts/[id]/page.tsx
export default async function AdminContractPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  // ... rest of page unchanged
}
```

- [ ] **Step 6: Fix async searchParams in `app/dashboard/page.tsx`**

```typescript
// app/dashboard/page.tsx  
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  // ... existing isConfigured/notFound check ...
  const { tab } = await searchParams
  const initialTab: Tab = VALID_TABS.includes(tab as Tab) ? (tab as Tab) : 'protections'
  // ... rest unchanged
}
```

- [ ] **Step 7: Run build again and confirm it passes**

```bash
npm run build
```

Expected: `✓ Compiled successfully` with no TypeScript errors.

- [ ] **Step 8: Run test suite**

```bash
npm run test:run
```

Expected: all tests pass (or same failures as before the upgrade — do not regress).

- [ ] **Step 9: Smoke-test key flows locally**

```bash
npm run dev
```

Manually verify:
1. Browse page loads at `http://localhost:3000`
2. A contract detail page loads (e.g. `/markets/some-slug`)
3. Login flow works at `/auth/login`
4. Dashboard loads after login
5. Admin panel loads at `/admin`

- [ ] **Step 10: Verify CVEs are resolved**

```bash
npm audit --audit-level=high
```

Expected: `found 0 vulnerabilities` (or only moderate/low remaining).

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json next.config.mjs app/
git commit -m "chore: upgrade Next.js 14→16, React 18→19 — resolves 4 high CVEs"
```

- [ ] **Step 12: Open PR into develop (do not merge to main yet)**

```bash
gh pr create --base develop --title "chore: upgrade Next.js 14→16" \
  --body "Resolves 4 high CVEs (cache poisoning, request smuggling, DoS). Requires smoke test sign-off before merge."
```

---

## Task 2: Enforce MFA for Admin Users (PCI Req 8)

**Files:**
- Modify: `lib/actions/admin.ts:11-23`
- Create: `components/admin/AdminMfaGate.tsx`
- Modify: `app/admin/layout.tsx`

Supabase Auth supports TOTP MFA. `getAuthenticatorAssuranceLevel()` returns `currentLevel: 'aal1'` (password only) or `'aal2'` (password + TOTP). We throw `MFA_REQUIRED` from `assertAdmin()` so any admin server action surfaces this to the UI, which then prompts the admin to complete a TOTP challenge.

- [ ] **Step 1: Write failing test for assertAdmin MFA check**

```typescript
// tests/lib/actions/admin.test.ts — add inside existing describe block

it('throws MFA_REQUIRED when admin has aal1 session', async () => {
  mockSupabaseClient({
    auth: {
      getUser: () => ({ data: { user: { id: 'admin-1' } } }),
      mfa: {
        getAuthenticatorAssuranceLevel: () => ({
          data: { currentLevel: 'aal1', nextLevel: 'aal2' },
          error: null,
        }),
      },
    },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ single: () => ({
        data: { role: 'admin' }, error: null
      }) }) }),
    }),
  })

  await expect(upsertContract(mockContractInput)).rejects.toThrow('MFA_REQUIRED')
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test:run -- tests/lib/actions/admin.test.ts
```

Expected: FAIL — `assertAdmin` does not throw `MFA_REQUIRED` yet.

- [ ] **Step 3: Update `assertAdmin()` in `lib/actions/admin.ts`**

Replace the existing `assertAdmin` function (lines 11–23):

```typescript
async function assertAdmin() {
  const userClient = createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  // Require AAL2 (TOTP MFA) for all admin operations
  const { data: aalData } = await userClient.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aalData?.currentLevel !== 'aal2') throw new Error('MFA_REQUIRED')

  const supabase = createServiceClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if ((profile as { role: string } | null)?.role !== 'admin') throw new Error('Forbidden')
  return { supabase, userId: user.id }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm run test:run -- tests/lib/actions/admin.test.ts
```

Expected: all tests in that file pass.

- [ ] **Step 5: Create `components/admin/AdminMfaGate.tsx`**

This component is rendered by the admin layout when `MFA_REQUIRED` is thrown. It triggers a Supabase MFA challenge so the admin can verify their TOTP code without leaving the page.

```typescript
// components/admin/AdminMfaGate.tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function AdminMfaGate({ onVerified }: { onVerified: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data: factors } = await supabase.auth.mfa.listFactors()
    const totpFactor = factors?.totp?.[0]
    if (!totpFactor) {
      setError('No MFA factor enrolled. Ask your admin to set up TOTP in account settings.')
      setLoading(false)
      return
    }

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: totpFactor.id,
    })
    if (challengeError || !challenge) {
      setError(challengeError?.message ?? 'Failed to start MFA challenge')
      setLoading(false)
      return
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: totpFactor.id,
      challengeId: challenge.id,
      code,
    })
    if (verifyError) {
      setError('Invalid code — try again')
      setLoading(false)
      return
    }

    onVerified()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-sm">
        <h1 className="text-xl font-semibold mb-2">Admin MFA Required</h1>
        <p className="text-sm text-gray-500 mb-6">
          Enter your authenticator app code to access the admin panel.
        </p>
        <form onSubmit={handleVerify} className="space-y-4">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-full border rounded px-3 py-2 text-center text-lg tracking-widest"
            required
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full bg-black text-white py-2 rounded disabled:opacity-50"
          >
            {loading ? 'Verifying…' : 'Verify'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Read `app/admin/layout.tsx` to understand current structure**

```bash
cat app/admin/layout.tsx
```

- [ ] **Step 7: Update `app/admin/layout.tsx` to catch MFA_REQUIRED**

The layout is a Server Component — it can't catch errors from client interactions. Instead, wrap it to pass an `mfaRequired` flag that the client component handles.

```typescript
// app/admin/layout.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { AdminMfaGate } from '@/components/admin/AdminMfaGate'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Check MFA level server-side — show gate if aal1
  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  const mfaRequired = aalData?.currentLevel !== 'aal2'

  if (mfaRequired) {
    return <AdminMfaGateWrapper />
  }

  return (
    <div className="flex min-h-screen">
      <AdminSidebar />
      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}

// Client component wrapper so onVerified can reload the page after MFA
function AdminMfaGateWrapper() {
  'use client'
  return (
    <AdminMfaGate onVerified={() => window.location.reload()} />
  )
}
```

Wait — a `'use client'` directive cannot appear inside a Server Component body as an inline function. Create a thin wrapper instead:

```typescript
// app/admin/layout.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { AdminMfaGateWrapper } from '@/components/admin/AdminMfaGateWrapper'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aalData?.currentLevel !== 'aal2') {
    return <AdminMfaGateWrapper />
  }

  return (
    <div className="flex min-h-screen">
      <AdminSidebar />
      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}
```

- [ ] **Step 8: Create `components/admin/AdminMfaGateWrapper.tsx`**

```typescript
// components/admin/AdminMfaGateWrapper.tsx
'use client'

import { AdminMfaGate } from './AdminMfaGate'

export function AdminMfaGateWrapper() {
  return <AdminMfaGate onVerified={() => window.location.reload()} />
}
```

- [ ] **Step 9: Manual test — visit `/admin` with an account that has no MFA enrolled**

Expected: MFA gate renders instead of admin panel.

- [ ] **Step 10: Enroll TOTP on your admin account via Supabase Auth dashboard**

Go to Supabase dashboard → Authentication → Users → your admin user → Enable MFA. Use an authenticator app (Google Authenticator, 1Password, etc.).

- [ ] **Step 11: Manual test — visit `/admin` with TOTP enrolled**

Expected: MFA gate prompts for code → after correct code entry, admin panel renders.

- [ ] **Step 12: Commit**

```bash
git add lib/actions/admin.ts components/admin/AdminMfaGate.tsx \
  components/admin/AdminMfaGateWrapper.tsx app/admin/layout.tsx \
  tests/lib/actions/admin.test.ts
git commit -m "security: enforce AAL2 MFA for all admin operations (PCI Req 8)"
```

---

## Task 3: Prevent Pending Position Flood

**Files:**
- Modify: `lib/actions/purchase.ts:11-102`

A user can create unlimited `pending_payment` positions without completing payment. Each position holds a Stripe PaymentIntent, burning Stripe API quota and DB rows. Cap at 5 per user.

- [ ] **Step 1: Write failing test**

```typescript
// tests/lib/actions/purchase.test.ts — add to existing describe block

it('rejects new hedger position when 5 are already pending', async () => {
  mockSupabaseClient({
    auth: { getUser: () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => {
      if (table === 'hedger_positions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ count: 5, error: null }),
            }),
          }),
        }
      }
      // coverage_tiers fallback
      return {
        select: () => ({ eq: () => ({ single: () => ({
          data: { id: 't1', contract_id: 'c1', premium_usd: 10, payout_usd: 100,
                  max_capacity_usd: 10000, current_capacity_usd: 0, premium_mxn: 0,
                  payout_mxn: 0 },
          error: null,
        }) }) }),
      }
    },
  })

  const result = await createHedgerPaymentIntent('tier-1')
  expect(result).toEqual({ error: expect.stringContaining('pending purchases') })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test:run -- tests/lib/actions/purchase.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Add the guard to `createHedgerPaymentIntent` in `lib/actions/purchase.ts`**

After the `if (!user)` check and before the tier fetch (after line 18), insert:

```typescript
  // Prevent pending position flood — cap at 5 incomplete purchases per user
  const { count: pendingCount } = await supabase
    .from('hedger_positions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'pending_payment')
  if ((pendingCount ?? 0) >= 5) {
    return { error: 'You have too many pending purchases. Complete or cancel them before buying again.' }
  }
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm run test:run -- tests/lib/actions/purchase.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/purchase.ts tests/lib/actions/purchase.test.ts
git commit -m "security: cap pending hedger positions at 5 per user to prevent flood DoS"
```

---

## Task 4: Admin Route IP Allowlist (PCI Req 1)

**Files:**
- Modify: `middleware.ts:38-44`
- Modify: `.env.local.example`

When `ADMIN_IP_ALLOWLIST` env var is set (comma-separated IPs), requests to `/admin` from other IPs get a 403. When the var is empty or unset, the feature is disabled (safe default for local dev).

- [ ] **Step 1: Update `middleware.ts`**

Replace the existing protected-route block (lines 38–42):

```typescript
  const { pathname } = request.nextUrl
  const isProtected = pathname.startsWith('/dashboard') || pathname.startsWith('/admin')
  if (isProtected && !user) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  // Optional IP allowlist for admin routes — set ADMIN_IP_ALLOWLIST=ip1,ip2 in env
  if (pathname.startsWith('/admin') && user) {
    const allowlist = (process.env.ADMIN_IP_ALLOWLIST ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)

    if (allowlist.length > 0) {
      const forwarded = request.headers.get('x-forwarded-for')
      const ip = forwarded ? forwarded.split(',')[0].trim()
                           : (request.headers.get('x-real-ip') ?? '')
      if (!allowlist.includes(ip)) {
        return new NextResponse('Access denied', { status: 403 })
      }
    }
  }
```

- [ ] **Step 2: Add the env var to `.env.local.example`**

Append after the existing last line:

```bash
# Optional: comma-separated IPs allowed to access /admin (leave empty to disable)
ADMIN_IP_ALLOWLIST=
```

- [ ] **Step 3: Manual test — set a wrong IP in the env and verify `/admin` returns 403**

Add to `.env.local`: `ADMIN_IP_ALLOWLIST=1.2.3.4` (not your actual IP), then:

```bash
npm run dev
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/admin
```

Expected: `403`

- [ ] **Step 4: Remove the wrong IP and verify admin works**

Set `ADMIN_IP_ALLOWLIST=` (empty), restart dev server, visit `/admin`.

Expected: redirects to login or renders admin (depending on auth state). No 403.

- [ ] **Step 5: Commit**

```bash
git add middleware.ts .env.local.example
git commit -m "security: add optional IP allowlist for /admin routes (PCI Req 1)"
```

---

## Task 5: Sentry Runtime Monitoring (PCI Req 11)

**Files:**
- Modify: `package.json`
- Modify: `next.config.mjs`
- Create: `sentry.client.config.ts`
- Create: `sentry.server.config.ts`
- Create: `sentry.edge.config.ts`
- Create: `instrumentation.ts`
- Modify: `.env.local.example`

- [ ] **Step 1: Install Sentry**

```bash
npm install @sentry/nextjs
```

- [ ] **Step 2: Create `sentry.client.config.ts`**

```typescript
// sentry.client.config.ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  // Don't send events in development unless DSN is explicitly set
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
})
```

- [ ] **Step 3: Create `sentry.server.config.ts`**

```typescript
// sentry.server.config.ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Scrub sensitive fields from payloads before sending
  beforeSend(event) {
    if (event.request?.headers) {
      delete event.request.headers['authorization']
      delete event.request.headers['stripe-signature']
      delete event.request.headers['cookie']
    }
    return event
  },
})
```

- [ ] **Step 4: Create `sentry.edge.config.ts`**

```typescript
// sentry.edge.config.ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
})
```

- [ ] **Step 5: Create `instrumentation.ts`**

```typescript
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}
```

- [ ] **Step 6: Wrap `next.config.mjs` with `withSentryConfig`**

Replace the `export default nextConfig` line at the bottom:

```javascript
// next.config.mjs
import { withSentryConfig } from '@sentry/nextjs'

// ... existing nextConfig object unchanged ...

export default withSentryConfig(nextConfig, {
  // Suppress Sentry build output noise
  silent: true,
  // Disable source map upload in dev (set SENTRY_AUTH_TOKEN in CI for prod)
  disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  disableClientWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
})
```

- [ ] **Step 7: Add env vars to `.env.local.example`**

```bash
# Sentry — create project at sentry.io and copy DSN here
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
```

- [ ] **Step 8: Create a Sentry project**

1. Go to sentry.io → New Project → Next.js
2. Copy the DSN to your local `.env.local` as `NEXT_PUBLIC_SENTRY_DSN=https://...`
3. Do NOT commit the real DSN — it belongs only in `.env.local` and Vercel env vars

- [ ] **Step 9: Run dev server and verify Sentry initialises without errors**

```bash
npm run dev 2>&1 | grep -i sentry
```

Expected: no errors about missing DSN or module not found.

- [ ] **Step 10: Trigger a test error to confirm events reach Sentry**

In any server action, temporarily add:
```typescript
throw new Error('Sentry test error — remove me')
```
Trigger it via the UI, then check the Sentry dashboard for the event. Remove the test throw.

- [ ] **Step 11: Commit**

```bash
git add sentry.client.config.ts sentry.server.config.ts sentry.edge.config.ts \
  instrumentation.ts next.config.mjs package.json package-lock.json .env.local.example
git commit -m "monitoring: add Sentry runtime error tracking (PCI Req 11)"
```

---

## Task 6: Log Retention Policy (PCI Req 10)

**Files:**
- Create: `docs/security/log-retention.md`

This is a configuration + documentation task. No code changes. PCI requires logs to be retained for at least 12 months (3 months immediately available).

- [ ] **Step 1: Configure Supabase log export**

In the Supabase dashboard:
1. Go to **Settings → Logs** (or **Logs Explorer**)
2. Enable **Log Drains** to forward logs to a persistent store
3. Recommended destinations: Logflare (Supabase's partner, free tier), Datadog, or an S3 bucket

If using Logflare:
- Install the Logflare Supabase integration from the Supabase marketplace
- Logs are retained indefinitely in Logflare

- [ ] **Step 2: Create `docs/security/log-retention.md`**

```markdown
# Log Retention Policy

**Effective:** 2026-05-24  
**Requirement:** PCI-DSS v4.0 Requirement 10.7 — retain audit logs for at least 12 months, with 3 months immediately available.

## Log Sources

| Source | Default Retention | Target Retention | Method |
|--------|------------------|-----------------|--------|
| Supabase Auth logs | 30 days (free tier) | 12 months | Logflare drain |
| Supabase DB logs | 30 days | 12 months | Logflare drain |
| Vercel access logs | 30 days | 12 months | Vercel Log Drains → S3 |
| Stripe events | 30 days (dashboard) | Indefinite | Stripe webhooks → `payouts` table |
| Admin audit log | Indefinite (in DB) | Indefinite | `admin_audit_log` table |

## Setup Instructions

### Supabase → Logflare
1. In Supabase dashboard: **Settings → Log Drains → Add Drain**
2. Select Logflare as destination
3. Copy the Logflare source token to `LOGFLARE_SOURCE_TOKEN` env var
4. Verify logs appear at logflare.app

### Vercel → S3 (production)
1. In Vercel dashboard: **Settings → Log Drains → Add Drain**
2. Select S3 as destination, configure bucket name and IAM credentials
3. Enable log drain for: Function Logs, Edge Logs, Build Logs

## Access & Audit

- Only admin accounts may access Logflare and Vercel log dashboards
- Logs must not be modified or deleted
- Quarterly review: verify logs are present and searchable for the prior 3 months
```

- [ ] **Step 3: Commit**

```bash
git add docs/security/log-retention.md
git commit -m "docs: add log retention policy and setup instructions (PCI Req 10)"
```

---

## Task 7: Incident Response Plan (PCI Req 12)

**Files:**
- Create: `docs/security/incident-response.md`

- [ ] **Step 1: Create `docs/security/incident-response.md`**

```markdown
# Incident Response Plan

**Effective:** 2026-05-24  
**Owner:** Engineering lead  
**Review cadence:** Quarterly, or after any incident

---

## Severity Classification

| Level | Definition | Response SLA |
|-------|-----------|-------------|
| P0 — Critical | Payment data compromised, active breach, service down | 15 min |
| P1 — High | Auth bypass, admin access by unauthorised user, data leak | 1 hour |
| P2 — Medium | Elevated error rate, non-critical service degraded | 4 hours |
| P3 — Low | Security misconfiguration with no active exploitation | 24 hours |

---

## Contacts

| Role | Contact | Escalation |
|------|---------|-----------|
| On-call engineer | Sentry alerts → PagerDuty | Engineering lead |
| Engineering lead | [add contact] | CTO |
| Stripe support | support.stripe.com | dashboard.stripe.com |
| Supabase support | support.supabase.com | status.supabase.com |

---

## Runbook: Payment Data Compromise (P0)

1. **Contain (< 15 min)**
   - Rotate `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Vercel env → redeploy
   - Rotate `SUPABASE_SERVICE_ROLE_KEY` in Vercel env → redeploy
   - Enable Vercel maintenance mode to block new purchases
2. **Assess**
   - Query `admin_audit_log` for unusual actions in the past 48 hours
   - Query Stripe dashboard for unexpected charges or payouts
   - Check Supabase auth logs for unusual login patterns
3. **Notify (< 72 hours if personal data affected — GDPR Art. 33)**
   - Notify affected users by email
   - File breach report with relevant data protection authority
   - If card data potentially exposed: notify Stripe (they notify card brands)
4. **Remediate**
   - Apply the specific fix to the compromised code path
   - Re-audit RLS policies and server actions
   - Deploy fix, lift maintenance mode
5. **Post-incident (within 5 business days)**
   - Write post-mortem: timeline, root cause, impact, remediation, prevention
   - Update threat model and this document

---

## Runbook: Credential Rotation

Rotate all secrets if any credential is suspected compromised:

```bash
# 1. Generate new secrets
openssl rand -base64 32  # for CRON_SECRET

# 2. Update in Vercel dashboard
# Settings → Environment Variables → update each value → Save
# (Stripe and Supabase have their own key rotation flows)

# 3. Trigger redeploy
vercel --prod

# 4. Verify service health
curl -s https://your-domain.com/api/health
```

---

## Runbook: Unauthorised Admin Access (P1)

1. Disable the compromised admin account in Supabase Auth → Users
2. Check `admin_audit_log` for actions taken by that account
3. Reverse any fraudulent contract settlements via `retryPayout` or direct DB correction
4. Audit all positions activated in the past 24 hours
5. Re-enable account only after MFA re-enrollment is confirmed

---

## Credential Inventory

| Secret | Location | Rotation Period | Owner |
|--------|---------|----------------|-------|
| STRIPE_SECRET_KEY | Vercel env | On compromise or 90 days | Stripe dashboard |
| STRIPE_WEBHOOK_SECRET | Vercel env | On compromise | Stripe dashboard |
| SUPABASE_SERVICE_ROLE_KEY | Vercel env | On compromise | Supabase dashboard |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Vercel env | On compromise | Supabase dashboard |
| CRON_SECRET | Vercel env | 90 days | `openssl rand -base64 32` |
| SENTRY_AUTH_TOKEN | Vercel env + CI | On compromise | sentry.io |
```

- [ ] **Step 2: Commit**

```bash
git add docs/security/incident-response.md
git commit -m "docs: add incident response plan and credential rotation runbooks (PCI Req 12)"
```

---

## Final Step: Apply Migrations to Live Database

- [ ] **Run both new migrations in Supabase SQL Editor**

Open Supabase dashboard → SQL Editor → New query. Run each file in order:

1. Paste and run `supabase/migrations/20260524000001_security_fixes.sql`
2. Paste and run `supabase/migrations/20260524000002_security_fixes_2.sql`

Expected: both execute with no errors.

- [ ] **Verify RLS on all tables**

```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;
```

Expected: `rowsecurity = true` for every table.

- [ ] **Verify atomic functions exist**

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' 
AND routine_name IN ('increment_tier_capacity', 'increment_contract_volume');
```

Expected: both rows returned.

- [ ] **Merge `develop` into `main` and push**

```bash
git checkout main
git merge develop --no-ff -m "security: full remediation of threat model and PCI-DSS findings"
git push origin main
```
