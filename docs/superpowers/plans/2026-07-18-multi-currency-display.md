# Multi-currency display (USD + contract-local Q/MXN) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users view contract prices in USD or the contract's local currency (Q for Guatemala, MXN for Mexico), driven by a profile display-mode preference, on the browse and market-detail surfaces.

**Architecture:** A small pure `lib/currency/` module resolves a `DisplayMode` (`'USD' | 'LOCAL'`) plus a contract's `location.country` into a `DisplayCurrency`, then converts the authoritative USD amount via config FX constants. Display-only — Stripe still charges USD. The mode is read server-side from `profiles.preferred_currency` and threaded as a prop to price-rendering components.

**Tech Stack:** Next.js App Router (server + client components), TypeScript, Vitest (`@/` alias), Supabase, Tailwind.

**Scope:** Currency engine + profile preference + browse cards + market-detail quote/purchase surfaces. **Deferred to a follow-up plan:** dashboard position/payout rendering (provider capital is USD-native; hedger protections vs provider positions need their own small design). See spec `docs/superpowers/specs/2026-07-18-multi-currency-gtq-design.md`.

---

## File Structure

**New:**
- `lib/currency/config.ts` — types + FX/country constants
- `lib/currency/resolve.ts` — pure resolve/convert/format helpers
- `tests/lib/currency/resolve.test.ts` — unit tests
- `supabase/migrations/20260718000000_currency_display_mode.sql` — data migration

**Modified:**
- `lib/types.ts` — widen `Currency`
- `lib/utils.ts` — `formatCurrency` narrow symbol
- `tests/lib/utils.test.ts` (create if absent) — formatter test
- `lib/actions/profile.ts` — accept `'USD' | 'LOCAL'`
- `tests/lib/actions/profile.test.ts` (create if absent) — validation test
- `lib/supabase/database.types.ts` — comment only (column stays `string`)
- `app/profile/page.tsx`, `components/profile/ProfileForm.tsx` — mode toggle UI
- `app/page.tsx`, `app/BrowseClient.tsx` — read + thread `displayMode`
- `components/contracts/ContractCard.tsx`, `ContractSection.tsx`, `TrendingSection.tsx`, `ComingSoonSection.tsx`, `CorridorPairCard.tsx` — per-contract local price
- `app/markets/[slug]/page.tsx`, `components/markets/ContractDetailClient.tsx`, `components/markets/TierSelector.tsx`, `components/markets/PurchasePanel.tsx` — resolved currency on detail/purchase

---

## Task 1: Currency config + widen `Currency` type

**Files:**
- Create: `lib/currency/config.ts`
- Modify: `lib/types.ts:7`

- [ ] **Step 1: Create the config module**

```ts
// lib/currency/config.ts

/** Currencies we can display a contract's local price in. */
export type LocalCurrency = 'MXN' | 'GTQ'
export type DisplayCurrency = 'USD' | LocalCurrency
/** User preference: universal USD, or each contract's own local currency. */
export type DisplayMode = 'USD' | 'LOCAL'

/** Local units per 1 USD. Code constants (display-only); update as rates drift. */
export const FX_RATES: Record<LocalCurrency, number> = {
  MXN: 17.0,
  GTQ: 7.75,
}

/** ISO-3166 alpha-2 country -> its local currency. Countries absent here show USD. */
export const COUNTRY_CURRENCY: Record<string, LocalCurrency> = {
  MX: 'MXN',
  GT: 'GTQ',
}
```

- [ ] **Step 2: Widen the `Currency` type**

In `lib/types.ts:7`, change:

```ts
export type Currency = 'USD' | 'MXN'
```

to:

```ts
export type Currency = 'USD' | 'MXN' | 'GTQ'
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors introduced; widening a union is safe).

- [ ] **Step 4: Commit**

```bash
git add lib/currency/config.ts lib/types.ts
git commit -m "feat(currency): add currency config module and widen Currency type"
```

---

## Task 2: `formatCurrency` renders GTQ cleanly

`formatCurrency` appends the ISO code (e.g. `$100 USD`). With the default symbol, GTQ renders `GTQ 780`, producing a redundant `GTQ 780 GTQ`. Switch to `narrowSymbol` so GTQ → `Q780` → `Q780 GTQ`.

**Files:**
- Modify: `lib/utils.ts:10-20`
- Test: `tests/lib/utils.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/utils.test.ts
import { describe, it, expect } from 'vitest'
import { formatCurrency } from '@/lib/utils'

describe('formatCurrency', () => {
  it('formats USD with symbol and ISO code', () => {
    expect(formatCurrency(100, 'USD')).toBe('$100 USD')
  })

  it('formats GTQ with the quetzal narrow symbol, not a redundant code', () => {
    const out = formatCurrency(780, 'GTQ')
    expect(out).toContain('Q780')
    expect(out.endsWith('GTQ')).toBe(true)
    expect(out).not.toContain('GTQ 780')
  })

  it('formats MXN with ISO code', () => {
    expect(formatCurrency(1700, 'MXN').endsWith('MXN')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/utils.test.ts`
Expected: FAIL on the GTQ case (`GTQ 780 GTQ`).

- [ ] **Step 3: Add `currencyDisplay: 'narrowSymbol'`**

In `lib/utils.ts`, update the `Intl.NumberFormat` options:

```ts
export function formatCurrency(amount: number, currency: Currency = 'USD'): string {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
  // Append the ISO code so the currency is unambiguous (e.g. "$1,234 USD"),
  // important in MX where a bare "$" can read as pesos.
  return `${formatted} ${currency}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/utils.ts tests/lib/utils.test.ts
git commit -m "feat(currency): render GTQ with narrow symbol in formatCurrency"
```

---

## Task 3: Currency resolve/convert helpers

**Files:**
- Create: `lib/currency/resolve.ts`
- Test: `tests/lib/currency/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/currency/resolve.test.ts
import { describe, it, expect } from 'vitest'
import {
  localCurrencyForCountry,
  resolveDisplayCurrency,
  convertFromUsd,
  displayPrice,
} from '@/lib/currency/resolve'

describe('localCurrencyForCountry', () => {
  it('maps configured countries', () => {
    expect(localCurrencyForCountry('GT')).toBe('GTQ')
    expect(localCurrencyForCountry('MX')).toBe('MXN')
  })
  it('normalizes the legacy "Mexico" value', () => {
    expect(localCurrencyForCountry('Mexico')).toBe('MXN')
  })
  it('returns null for missing or unconfigured countries', () => {
    expect(localCurrencyForCountry(null)).toBeNull()
    expect(localCurrencyForCountry(undefined)).toBeNull()
    expect(localCurrencyForCountry('BR')).toBeNull()
  })
})

describe('resolveDisplayCurrency', () => {
  it('USD mode always returns USD', () => {
    expect(resolveDisplayCurrency('USD', 'GT')).toBe('USD')
  })
  it('LOCAL mode returns the country currency', () => {
    expect(resolveDisplayCurrency('LOCAL', 'GT')).toBe('GTQ')
    expect(resolveDisplayCurrency('LOCAL', 'MX')).toBe('MXN')
  })
  it('LOCAL mode falls back to USD for unconfigured countries', () => {
    expect(resolveDisplayCurrency('LOCAL', 'BR')).toBe('USD')
    expect(resolveDisplayCurrency('LOCAL', null)).toBe('USD')
  })
})

describe('convertFromUsd', () => {
  it('returns the same amount for USD', () => {
    expect(convertFromUsd(100, 'USD')).toBe(100)
  })
  it('converts and rounds to whole units', () => {
    expect(convertFromUsd(100, 'MXN')).toBe(1700)
    expect(convertFromUsd(28.76, 'GTQ')).toBe(223) // 28.76 * 7.75 = 222.89 -> 223
  })
})

describe('displayPrice', () => {
  it('formats a GT contract price in quetzales under LOCAL mode', () => {
    const r = displayPrice(28.76, 'LOCAL', 'GT')
    expect(r.currency).toBe('GTQ')
    expect(r.amount).toBe(223)
    expect(r.formatted).toContain('Q223')
  })
  it('formats in USD under USD mode', () => {
    const r = displayPrice(28.76, 'USD', 'GT')
    expect(r.currency).toBe('USD')
    expect(r.amount).toBe(28.76)
    expect(r.formatted).toBe('$29 USD')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/currency/resolve.test.ts`
Expected: FAIL with "Cannot find module '@/lib/currency/resolve'".

- [ ] **Step 3: Implement the helpers**

```ts
// lib/currency/resolve.ts
import { formatCurrency } from '@/lib/utils'
import {
  COUNTRY_CURRENCY,
  FX_RATES,
  type DisplayCurrency,
  type DisplayMode,
  type LocalCurrency,
} from './config'

/** Country code (or legacy "Mexico") -> local currency, or null if unconfigured. */
export function localCurrencyForCountry(country?: string | null): LocalCurrency | null {
  if (!country) return null
  const raw = country.trim()
  const code = raw.toLowerCase() === 'mexico' ? 'MX' : raw.toUpperCase()
  return COUNTRY_CURRENCY[code] ?? null
}

/** Given the user's mode and a contract's country, pick the display currency. */
export function resolveDisplayCurrency(
  mode: DisplayMode,
  country?: string | null,
): DisplayCurrency {
  if (mode === 'USD') return 'USD'
  return localCurrencyForCountry(country) ?? 'USD'
}

/** Convert an authoritative USD amount into the target display currency. */
export function convertFromUsd(amountUsd: number, currency: DisplayCurrency): number {
  if (currency === 'USD') return amountUsd
  return Math.round(amountUsd * FX_RATES[currency])
}

/** One-call helper for render sites: resolve currency, convert, and format. */
export function displayPrice(
  amountUsd: number,
  mode: DisplayMode,
  country?: string | null,
): { amount: number; currency: DisplayCurrency; formatted: string } {
  const currency = resolveDisplayCurrency(mode, country)
  const amount = convertFromUsd(amountUsd, currency)
  return { amount, currency, formatted: formatCurrency(amount, currency) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/currency/resolve.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/currency/resolve.ts tests/lib/currency/resolve.test.ts
git commit -m "feat(currency): add resolve/convert/displayPrice helpers with tests"
```

---

## Task 4: Profile action accepts the display mode

**Files:**
- Modify: `lib/actions/profile.ts:9`, `lib/actions/profile.ts:23`
- Test: `tests/lib/actions/profile.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/actions/profile.test.ts
import { describe, it, expect, vi } from 'vitest'

// The action calls createClient(); we only exercise the pure validation branch,
// which returns before touching Supabase for an invalid currency.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { updateProfile } from '@/lib/actions/profile'

describe('updateProfile currency validation', () => {
  it('rejects the legacy MXN value', async () => {
    const res = await updateProfile({ preferred_currency: 'MXN' as never })
    expect(res).toEqual({ error: 'Invalid currency' })
  })
  it('rejects an arbitrary currency', async () => {
    const res = await updateProfile({ preferred_currency: 'GTQ' as never })
    expect(res).toEqual({ error: 'Invalid currency' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/actions/profile.test.ts`
Expected: FAIL — currently `'MXN'` passes validation, so no `{ error }` is returned before `createClient()` (undefined mock) is hit.

- [ ] **Step 3: Update the type and validation**

In `lib/actions/profile.ts`, change line 9:

```ts
  preferred_currency?: 'USD' | 'LOCAL'
```

and line 23:

```ts
  if (input.preferred_currency && !['USD', 'LOCAL'].includes(input.preferred_currency)) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/actions/profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/profile.ts tests/lib/actions/profile.test.ts
git commit -m "feat(currency): profile action stores USD|LOCAL display mode"
```

---

## Task 5: Data migration + profile preference UI

**Files:**
- Create: `supabase/migrations/20260718000000_currency_display_mode.sql`
- Modify: `app/profile/page.tsx:26`, `app/profile/page.tsx:41`
- Modify: `components/profile/ProfileForm.tsx:13`, `:32`, `:87-93`
- Modify: `lib/supabase/database.types.ts` (comment only)

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260718000000_currency_display_mode.sql
-- Repurpose profiles.preferred_currency from a fiat code to a display MODE.
-- Old values: 'USD' | 'MXN'. New values: 'USD' | 'LOCAL' (contract's local currency).
update profiles set preferred_currency = 'LOCAL' where preferred_currency = 'MXN';
```

- [ ] **Step 2: Update the profile server page**

In `app/profile/page.tsx`, change the `p` type (line 26):

```ts
    preferred_currency: 'USD' | 'LOCAL'
```

and the prop passed to `ProfileForm` (line 41) — coerce any stale value to a valid mode:

```tsx
          preferredCurrency={p.preferred_currency === 'LOCAL' ? 'LOCAL' : 'USD'}
```

- [ ] **Step 3: Update `ProfileForm`**

In `components/profile/ProfileForm.tsx`, change the prop type (line 13):

```ts
  preferredCurrency: 'USD' | 'LOCAL'
```

the state (line 32):

```ts
  const [currency, setCurrency] = useState<'USD' | 'LOCAL'>(props.preferredCurrency)
```

and the select block (lines 87-93):

```tsx
        <div>
          <label htmlFor="currency" className={labelCls}>Show prices in</label>
          <select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value as 'USD' | 'LOCAL')} className={fieldCls}>
            <option value="USD">US Dollars (USD)</option>
            <option value="LOCAL">Local currency</option>
          </select>
        </div>
```

- [ ] **Step 4: Add a clarifying comment in `database.types.ts`**

Find the `profiles` row `preferred_currency: string` entry (around `lib/supabase/database.types.ts:639`) and add a comment on the line above it:

```ts
          // 'USD' | 'LOCAL' display mode (see lib/currency/config.ts)
          preferred_currency: string
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Apply the migration to the (single, prod) Supabase DB**

Run: `supabase db push --linked < /dev/null`
Expected: applies `20260718000000_currency_display_mode.sql`; existing `MXN` preferences become `LOCAL`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260718000000_currency_display_mode.sql app/profile/page.tsx components/profile/ProfileForm.tsx lib/supabase/database.types.ts
git commit -m "feat(currency): migrate preferred_currency to USD|LOCAL display mode + profile UI"
```

---

## Task 6: Thread `displayMode` into the browse page

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/BrowseClient.tsx:17-25`, `:27`, `:77`, `:87`, `:98`, `:102`

- [ ] **Step 1: Read the user's mode in `app/page.tsx` and pass it down**

At the top of `app/page.tsx`, add a helper and use it in `BrowsePage`. Add this function below `getPlatformStats`:

```ts
async function getDisplayMode(): Promise<'USD' | 'LOCAL'> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'USD'
  const { data } = await supabase
    .from('profiles')
    .select('preferred_currency')
    .eq('id', user.id)
    .single()
  return data?.preferred_currency === 'LOCAL' ? 'LOCAL' : 'USD'
}
```

In `BrowsePage`, change the not-configured shell render to pass the default:

```tsx
        <BrowseClient
          initialContracts={[]}
          stats={{ totalVolumeUsd: 0, activeContracts: 0, protectionsSold: 0, avgPayoutMinutes: 4.2 }}
          displayMode="USD"
        />
```

and the main render to resolve and pass it:

```tsx
  const [contracts, stats, displayMode] = await Promise.all([
    getContracts(),
    getPlatformStats(),
    getDisplayMode(),
  ])

  return (
    <>
      <Header />
      <BrowseClient
        initialContracts={contracts}
        stats={stats}
        displayMode={displayMode}
      />
    </>
  )
```

- [ ] **Step 2: Accept and forward the prop in `BrowseClient`**

In `app/BrowseClient.tsx`, add the import and prop. Change the import line 15 area to include the type:

```ts
import type { ContractWithTiers } from '@/lib/types'
import type { DisplayMode } from '@/lib/currency/config'
```

Extend `Props` (lines 17-25) with:

```ts
  displayMode: DisplayMode
```

Change the signature (line 27):

```ts
export default function BrowseClient({ initialContracts, stats, displayMode }: Props) {
```

Replace all four `currency="USD"` occurrences (lines 77, 87, 98, 102) with `displayMode={displayMode}`:
- Line 77 (`<ContractCard ... />` in search results)
- Line 87 (`<TrendingSection ... />`)
- Line 98 (`<ContractSection ... />`)
- Line 102 (`<ComingSoonSection ... />`)

- [ ] **Step 3: Typecheck (expected to fail on children — that's Task 7)**

Run: `npx tsc --noEmit`
Expected: FAIL — `ContractCard`/`TrendingSection`/`ContractSection`/`ComingSoonSection` still expect a `currency` prop. This is resolved in Task 7. Do NOT commit yet; proceed to Task 7 and commit them together.

---

## Task 7: Per-contract local price in card components

Each component swaps its `currency: Currency` prop for `displayMode: DisplayMode` and computes each contract's price with `displayPrice(usd, mode, contract.location?.country)`.

**Files:**
- Modify: `components/contracts/ContractCard.tsx:6`, `:29`, `:46`, `:118`, `:121`
- Modify: `components/contracts/ContractSection.tsx:9`, `:43`, `:52`, `:134`, `:142`, `:154`
- Modify: `components/contracts/TrendingSection.tsx:5`, `:18-21`, `:23`, `:43`, `:46`
- Modify: `components/contracts/ComingSoonSection.tsx:4`, `:6-9`, `:12`, `:26`
- Modify: `components/contracts/CorridorPairCard.tsx:8`, `:15-19`, `:28`, `:151`, `:154`

- [ ] **Step 1: `ContractCard`**

Change the utils import (line 5) to drop the now-unused `formatCurrency`:

```ts
import { cn, formatVolume, countryFlag } from '@/lib/utils'
```

Change the type import (line 6):

```ts
import type { ContractWithTiers, CoverageLevel } from '@/lib/types'
import type { DisplayMode } from '@/lib/currency/config'
import { displayPrice } from '@/lib/currency/resolve'
```

Change the `Props.currency` field (line 29) to:

```ts
  displayMode: DisplayMode
```

Change the signature (line 46) to destructure `displayMode`:

```ts
export default function ContractCard({ contract, displayMode, badge, comingSoon }: Props) {
```

Replace the two price spans (lines 118 and 121):

```tsx
                {displayPrice(tier.premium_usd, displayMode, contract.location?.country).formatted}
                <span className="mx-1 font-normal text-insu-muted">/</span>
                <span className="text-insu-green">
                  {displayPrice(tier.payout_usd, displayMode, contract.location?.country).formatted}
                </span>
```

- [ ] **Step 2: `ContractSection`**

Change import (line 9):

```ts
import type { ContractWithTiers } from '@/lib/types'
import type { DisplayMode } from '@/lib/currency/config'
```

Change `Props.currency` (line 43) to `displayMode: DisplayMode`; change the destructure (line 52) from `currency,` to `displayMode,`; and change the three child props (lines 134, 142, 154) from `currency={currency}` to `displayMode={displayMode}`.

- [ ] **Step 3: `TrendingSection`**

Change import (line 5):

```ts
import { cn, countryFlag } from '@/lib/utils'
import type { ContractWithTiers } from '@/lib/types'
import type { DisplayMode } from '@/lib/currency/config'
import { displayPrice } from '@/lib/currency/resolve'
```

Change `Props.currency` (line 20) to `displayMode: DisplayMode`; change the signature (line 23) to `{ contracts, displayMode }`.

Simplify the cheapest-tier sort (line 43) to always sort by USD (order is currency-independent since conversion is linear):

```ts
            (a.premium_usd - b.premium_usd)
```

Replace the price render (line 46):

```tsx
            ? displayPrice(cheapestTier.premium_usd, displayMode, contract.location?.country).formatted
```

- [ ] **Step 4: `ComingSoonSection`**

Change import (line 4):

```ts
import type { ContractWithTiers } from '@/lib/types'
import type { DisplayMode } from '@/lib/currency/config'
```

Change `Props.currency` (line 8) to `displayMode: DisplayMode`; change the signature (line 12) to `{ contracts, displayMode }`; change the forwarded prop (line 26) from `currency={currency}` to `displayMode={displayMode}`.

- [ ] **Step 5: `CorridorPairCard`**

Change the utils import (line 6) to drop the now-unused `formatCurrency`, and add the currency imports:

```ts
import { cn, formatVolume, countryFlag } from '@/lib/utils'
import type { ContractWithTiers, CoverageLevel } from '@/lib/types'
import type { DisplayMode } from '@/lib/currency/config'
import { displayPrice } from '@/lib/currency/resolve'
```

Change `Props.currency` (line 18) to `displayMode: DisplayMode`; change the signature (line 28) to `{ morning, evening, displayMode }`.

Replace the two price renders (lines 151 and 154):

```tsx
              {displayPrice(tier.premium_usd, displayMode, active.location?.country).formatted}
```

and

```tsx
                {displayPrice(tier.payout_usd, displayMode, active.location?.country).formatted}
```

(Keep surrounding markup; only the `formatCurrency(...)` expressions change.)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (Task 6 + Task 7 together resolve all `currency`→`displayMode` prop mismatches on the browse tree).

- [ ] **Step 7: Run the full test suite**

Run: `npm run test:run`
Expected: PASS.

- [ ] **Step 8: Commit (Tasks 6 + 7 together)**

```bash
git add app/page.tsx app/BrowseClient.tsx components/contracts/ContractCard.tsx components/contracts/ContractSection.tsx components/contracts/TrendingSection.tsx components/contracts/ComingSoonSection.tsx components/contracts/CorridorPairCard.tsx
git commit -m "feat(currency): show contract-local prices on browse via display mode"
```

---

## Task 8: Resolved currency on the market-detail + purchase surfaces

The detail page renders a single contract, so the server page resolves the mode and the client resolves one `DisplayCurrency` from `contract.location.country`, passed to `TierSelector` and `PurchasePanel`. Both show the local price plus a small `≈ $USD` hint (the actual charge is USD).

**Files:**
- Modify: `app/markets/[slug]/page.tsx` (read mode, pass to client)
- Modify: `components/markets/ContractDetailClient.tsx:20` (Props), the component body (resolve currency), `:178-185` and `:208-217` (pass prop)
- Modify: `components/markets/TierSelector.tsx:1-14`, `:26`, `:71-82`
- Modify: `components/markets/PurchasePanel.tsx` (Props + `:203`, `:256-259`)

- [ ] **Step 1: Read the mode in the detail server page**

In `app/markets/[slug]/page.tsx`, after the existing `const supabase = await createClient()` is used to load the contract, resolve the display mode and pass it into `ContractDetailClient`. Add near the other data fetches:

```ts
  const { data: { user } } = await supabase.auth.getUser()
  let displayMode: 'USD' | 'LOCAL' = 'USD'
  if (user) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('preferred_currency')
      .eq('id', user.id)
      .single()
    displayMode = prof?.preferred_currency === 'LOCAL' ? 'LOCAL' : 'USD'
  }
```

Then add `displayMode={displayMode}` to the `<ContractDetailClient ... />` render props (line ~169).

- [ ] **Step 2: `ContractDetailClient` — accept mode, resolve currency, pass down**

Add imports:

```ts
import type { DisplayMode } from '@/lib/currency/config'
import { resolveDisplayCurrency } from '@/lib/currency/resolve'
```

Add `displayMode: DisplayMode` to `Props` (line 20 block) and destructure it in the component signature. Immediately after the signature, resolve once:

```ts
  const displayCurrency = resolveDisplayCurrency(displayMode, contract.location?.country)
```

Pass `currency={displayCurrency}` to `<TierSelector ... />` (lines 178-185) and `<PurchasePanel ... />` (lines 208-217).

- [ ] **Step 3: `TierSelector` — render in the resolved currency with a USD hint**

Add imports (line 3-4):

```ts
import { cn, formatCurrency } from '@/lib/utils'
import { convertFromUsd } from '@/lib/currency/resolve'
import type { CoverageTier, CoverageLevel } from '@/lib/types'
import type { DisplayCurrency } from '@/lib/currency/config'
```

Add to `Props` (lines 6-14):

```ts
  currency?: DisplayCurrency
```

Change the signature (line 26) to destructure with a default:

```ts
export default function TierSelector({ tiers, selectedTierId, onSelect, mode = 'buy', priceByTier, lockedReasonByTier, currency = 'USD' }: Props) {
```

Replace the `mode === 'buy'` price block (lines 71-82) with:

```tsx
            {mode === 'buy' ? (
              <div className="mt-1 flex flex-wrap items-center gap-1 font-mono text-[13px]">
                <span className="text-insu-text">{formatCurrency(convertFromUsd(displayPremium, currency), currency)}</span>
                <span className="text-insu-muted">price →</span>
                <span className="text-insu-green">{formatCurrency(convertFromUsd(tier.payout_usd, currency), currency)}</span>
                <span className="text-insu-muted">{tier.max_payouts > 1 ? 'payout/event' : 'payout'}</span>
                {currency !== 'USD' && (
                  <span className="text-insu-muted">≈ {formatCurrency(displayPremium, 'USD')}</span>
                )}
              </div>
            ) : (
              <p className="mt-1 font-mono text-[13px] text-insu-muted">
                {formatCurrency(remaining, 'USD')} capacity remaining
              </p>
            )}
```

(Provide mode keeps USD — providers deposit USD capital.)

- [ ] **Step 4: `PurchasePanel` — resolved currency + USD hint**

Add imports:

```ts
import { convertFromUsd } from '@/lib/currency/resolve'
import type { DisplayCurrency } from '@/lib/currency/config'
```

Add `currency?: DisplayCurrency` to `Props` (line 19 block) and destructure with a default in the signature (line 30):

```ts
export default function PurchasePanel({ contract, userId, open, initialMode, initialPeriodDays, initialTierId, latestReading, onClose, currency = 'USD' }: Props) {
```

Update the confirmation payout line (line 203) to show local + USD hint:

```tsx
                  <span className="font-semibold text-insu-green">
                    {formatCurrency(convertFromUsd(selectedTier.payout_usd, currency), currency)}
                    {currency !== 'USD' && ` (≈ $${selectedTier.payout_usd.toLocaleString()} USD)`}
                  </span>
```

Update the period `fromPrice` (lines 256-259):

```tsx
                          const fromUsd = quoteForDays(days)[basicTier.id]
                          const fromPrice = formatCurrency(convertFromUsd(fromUsd, currency), currency)
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Run the full test suite**

Run: `npm run test:run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "app/markets/[slug]/page.tsx" components/markets/ContractDetailClient.tsx components/markets/TierSelector.tsx components/markets/PurchasePanel.tsx
git commit -m "feat(currency): show contract-local prices on market detail + purchase panel"
```

---

## Task 9: Full verification

- [ ] **Step 1: Typecheck, lint, tests**

Run: `npx tsc --noEmit && npm run lint && npm run test:run`
Expected: all PASS.

- [ ] **Step 2: Manual smoke (dev server)**

Run: `npm run dev`, then:
- Profile → set "Show prices in" to **Local currency**, save.
- Browse a **Guatemala** contract card (e.g. `gt-cesa-zona10-manana`) → premium/payout render as `Q…`.
- Browse a **Mexico** contract → renders as `$… MXN` (narrow symbol).
- Open a GT contract detail → `TierSelector` shows `Q…` with a `≈ $USD` hint.
- Switch profile back to **US Dollars** → everything renders `$… USD`.
- Log out / anonymous browse → prices default to USD.

Expected: matches the above; no console errors.

- [ ] **Step 3: Final commit (if any lint/format fixups)**

```bash
git add -A
git commit -m "chore(currency): verification fixups" || echo "nothing to commit"
```

---

## Notes for the implementer

- **Charge is always USD** (`lib/actions/purchase.ts:129`). This feature never changes what Stripe collects; the `≈ $USD` hints exist so buyers see the real charge.
- **FX constants** live only in `lib/currency/config.ts`. Changing a rate updates every surface.
- **Deferred:** dashboard (`DashboardClient`, `PositionCard`, `PayoutsTab`, `PayoutRow`) still renders USD. Provider capital is USD-native; hedger protections could show local currency in a follow-up plan using the same `displayPrice`/`convertFromUsd` helpers (recompute from `*_usd`).
- **Deploy:** manual, once — `vercel --prod --yes` from a `main` checkout after merge (per project convention).
