# Fuel Tenor Oracle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Guatemala regular-gasoline oracle and convert both fuel contracts (GT `gas-price-guatemala-q45`, MX `gas-price-magna-cdmx`) into selectable 7/14/30-day tenor products, recalibrated and launched live.

**Architecture:** Fuel joins the existing recurring/tenor pricing path (`priceTenor` + `dailyHazard`). A new AGN-backed fetcher supplies the GT weekly price; the poller dispatches fuel reads by `region`. A per-contract period menu gives fuel a `{7,14,30}` menu while other recurring contracts keep the global `{1,3,7,30}`. Contract/tier config is flipped via a one-off data script, then repriced and launched.

**Tech Stack:** TypeScript, Next.js App Router, Supabase (service-role scripts), Vitest.

**Reference spec:** `docs/superpowers/specs/2026-07-22-fuel-tenor-oracle-design.md`

---

## File Structure

- `lib/pricing/tenors.ts` — add `FUEL_PERIOD_OPTIONS`, `periodMenuForContract()`, optional `menu` arg on `availablePeriods()`.
- `lib/oracle/guatemalaFuelFetcher.ts` — **new**; AGN wp-json fetch + pure parse/pick helpers.
- `lib/oracle/poll.ts` — region dispatch inside the `fuel` branch.
- `lib/pricing/reprice.ts` — recurring sticker uses the contract's min offered tenor.
- `components/markets/PurchasePanel.tsx`, `components/markets/ContractDetailClient.tsx` — pass per-contract menu; default to first menu option.
- `scripts/apply-fuel-tenor.mjs` — **new**; one-off DB config + reprice trigger (dry-run by default).
- Tests: `tests/lib/pricing/tenors.test.ts`, `tests/lib/oracle/guatemalaFuelFetcher.test.ts` (new), `tests/lib/oracle/poll.test.ts`, `tests/lib/pricing/reprice.test.ts`.

Do the tasks in order: Task 1 (menu) and Task 2 (fetcher) are leaf dependencies; Task 3 (poll) needs Task 2; Task 4 (reprice) needs Task 1; Task 5 (UI) needs Task 1; Tasks 6–7 (ops) come last.

---

## Task 1: Per-contract tenor menu

**Files:**
- Modify: `lib/pricing/tenors.ts`
- Test: `tests/lib/pricing/tenors.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/lib/pricing/tenors.test.ts`:

```ts
import { FUEL_PERIOD_OPTIONS, periodMenuForContract } from '@/lib/pricing/tenors'

describe('FUEL_PERIOD_OPTIONS', () => {
  it('is exactly {7, 14, 30} days in order', () => {
    expect(FUEL_PERIOD_OPTIONS.map((o) => o.days)).toEqual([7, 14, 30])
  })
})

describe('periodMenuForContract', () => {
  it('returns the fuel menu for fuel contracts', () => {
    expect(periodMenuForContract({ trigger_type: 'fuel' }).map((o) => o.days)).toEqual([7, 14, 30])
  })
  it('returns the global menu for non-fuel contracts', () => {
    expect(periodMenuForContract({ trigger_type: 'urban' }).map((o) => o.days)).toEqual([1, 3, 7, 30])
  })
})

describe('availablePeriods with a custom menu', () => {
  it('filters the fuel menu by cap at low hazard (all offered)', () => {
    expect(availablePeriods(0.0043, FUEL_PERIOD_OPTIONS).map((o) => o.days)).toEqual([7, 14, 30])
  })
  it('falls back to the first menu option when none fit', () => {
    expect(availablePeriods(0.95, FUEL_PERIOD_OPTIONS).map((o) => o.days)).toEqual([7])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/pricing/tenors.test.ts`
Expected: FAIL — `FUEL_PERIOD_OPTIONS`/`periodMenuForContract` are not exported; `availablePeriods` takes one arg.

- [ ] **Step 3: Implement**

In `lib/pricing/tenors.ts`, after `PERIOD_OPTIONS`, add:

```ts
/** Protection periods offered on fuel contracts (weekly-updating price → no sub-week bets). */
export const FUEL_PERIOD_OPTIONS: readonly PeriodOption[] = [
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
] as const

/** The candidate period menu for a contract: fuel gets {7,14,30}, everything else the global menu. */
export function periodMenuForContract(contract: { trigger_type: string }): readonly PeriodOption[] {
  return contract.trigger_type === 'fuel' ? FUEL_PERIOD_OPTIONS : PERIOD_OPTIONS
}
```

Then change `availablePeriods` to accept an optional menu:

```ts
export function availablePeriods(
  p: number,
  menu: readonly PeriodOption[] = PERIOD_OPTIONS,
): PeriodOption[] {
  const options = menu.filter((o) => tenorAvailable(o.days, p))
  return options.length > 0 ? options : [menu[0]]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/pricing/tenors.test.ts`
Expected: PASS (all, including the pre-existing default-menu tests — the default arg keeps them green).

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/tenors.ts tests/lib/pricing/tenors.test.ts
git commit -m "feat(pricing): per-contract tenor menu; fuel uses {7,14,30}"
```

---

## Task 2: Guatemala fuel fetcher (AGN)

**Files:**
- Create: `lib/oracle/guatemalaFuelFetcher.ts`
- Test: `tests/lib/oracle/guatemalaFuelFetcher.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/oracle/guatemalaFuelFetcher.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchGuatemalaFuelPrice,
  parseRegularPriceGTQ,
  pickFreshPricePost,
} from '@/lib/oracle/guatemalaFuelFetcher'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const nowMs = Date.parse('2026-07-22T12:00:00Z')

function post(overrides: Partial<{ title: string; content: string; date_gmt: string }> = {}) {
  return {
    title: { rendered: overrides.title ?? 'Así quedaron los precios de los combustibles para esta semana' },
    content: { rendered: overrides.content ?? '<p>La gasolina superior se ubicó en Q41.09, la regular en Q40.09 y el diésel en Q42.29 por galón.</p>' },
    date: (overrides.date_gmt ?? '2026-07-21T06:00:00'),
    date_gmt: overrides.date_gmt ?? '2026-07-21T06:00:00',
  }
}

describe('parseRegularPriceGTQ', () => {
  it('extracts the regular price when the number follows "regular"', () => {
    expect(parseRegularPriceGTQ('la regular en Q40.09 y el diésel')).toBeCloseTo(40.09, 2)
  })
  it('extracts the regular price when "quetzales" precedes "regular"', () => {
    expect(parseRegularPriceGTQ('40.09 quetzales para la gasolina regular')).toBeCloseTo(40.09, 2)
  })
  it('strips HTML tags before matching', () => {
    expect(parseRegularPriceGTQ('<p>la <b>regular</b> en Q40.09</p>')).toBeCloseTo(40.09, 2)
  })
  it('returns null when no regular price is present', () => {
    expect(parseRegularPriceGTQ('no fuel prices in this text at all')).toBeNull()
  })
})

describe('pickFreshPricePost', () => {
  it('picks the most recent series post within 14 days', () => {
    const p = pickFreshPricePost([post()], nowMs)
    expect(p).not.toBeNull()
  })
  it('rejects posts older than 14 days', () => {
    const old = post({ date_gmt: '2026-06-01T06:00:00' })
    expect(pickFreshPricePost([old], nowMs)).toBeNull()
  })
  it('rejects posts whose title is not the price series', () => {
    const off = post({ title: 'Presidente analiza el alza de combustibles' })
    expect(pickFreshPricePost([off], nowMs)).toBeNull()
  })
})

describe('fetchGuatemalaFuelPrice', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(nowMs)
  })

  function mockAgn(posts: unknown[]) {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(posts) })
  }

  it('returns the regular price with the correct reading shape', async () => {
    mockAgn([post()])
    const r = await fetchGuatemalaFuelPrice('regular')
    expect(r.source).toBe('agn_mem')
    expect(r.reading_type).toBe('fuel')
    expect(r.value.gas_price_quetzales).toBeCloseTo(40.09, 2)
    expect(r.value.fuel_type).toBe('regular')
    expect(r.value.reference_week).toBe('2026-07-21')
  })

  it('throws when there is no fresh price post', async () => {
    mockAgn([post({ date_gmt: '2026-06-01T06:00:00' })])
    await expect(fetchGuatemalaFuelPrice('regular')).rejects.toThrow(/no fresh/i)
  })

  it('throws when the price cannot be parsed', async () => {
    mockAgn([post({ content: '<p>Sin precios esta semana.</p>' })])
    await expect(fetchGuatemalaFuelPrice('regular')).rejects.toThrow(/parse/i)
  })

  it('throws when the parsed price is out of plausible bounds', async () => {
    mockAgn([post({ content: '<p>la regular en Q5.00 por galón.</p>' })])
    await expect(fetchGuatemalaFuelPrice('regular')).rejects.toThrow(/out of bounds/i)
  })

  it('throws on a non-ok AGN response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 })
    await expect(fetchGuatemalaFuelPrice('regular')).rejects.toThrow('AGN feed error: 503')
  })

  it('rejects unsupported fuel types', async () => {
    await expect(fetchGuatemalaFuelPrice('superior')).rejects.toThrow(/only supports 'regular'/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/oracle/guatemalaFuelFetcher.test.ts`
Expected: FAIL — module `@/lib/oracle/guatemalaFuelFetcher` does not exist.

- [ ] **Step 3: Implement the fetcher**

Create `lib/oracle/guatemalaFuelFetcher.ts`:

```ts
// Guatemala has no per-station feed; MEM sets one weekly reference price per
// department (GTQ/gallon). AGN (state news agency) republishes that table weekly
// in its open WordPress REST API. We parse the regular-gasoline figure from the
// prose, with a freshness window + plausibility bounds, and THROW on any failure
// so the poller skips the write rather than storing a bad price. No fallback source.
const AGN_URL =
  'https://agn.gt/wp-json/wp/v2/posts?search=precios%20combustibles&per_page=5&orderby=date'

const FRESH_DAYS = 14
const FETCH_TIMEOUT_MS = 30_000
const BOUNDS = { min: 20, max: 80 } // GTQ per US gallon

type FuelType = 'regular' | 'superior' | 'diesel'

export interface AgnPost {
  title: { rendered: string }
  content: { rendered: string }
  date_gmt: string
}

interface FetchedReading {
  source: 'agn_mem'
  reading_type: 'fuel'
  value: {
    gas_price_quetzales: number
    fuel_type: 'regular'
    reference_week: string
  }
}

/** Pull the regular-gasoline GTQ/gallon figure out of the AGN prose, or null. */
export function parseRegularPriceGTQ(html: string): number | null {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
  const patterns = [
    /regular[^0-9]{0,30}Q?\s*(\d{2}(?:\.\d{1,2})?)/i,          // "regular en Q40.09"
    /Q?\s*(\d{2}(?:\.\d{1,2})?)\s*(?:quetzales?|q)\b[^.]{0,30}regular/i, // "40.09 quetzales ... regular"
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const v = parseFloat(m[1])
      if (!isNaN(v)) return v
    }
  }
  return null
}

/** Most recent AGN post that is the weekly price series AND within the freshness window. */
export function pickFreshPricePost(posts: AgnPost[], nowMs: number): AgnPost | null {
  const maxAgeMs = FRESH_DAYS * 86_400_000
  for (const p of posts) {
    const title = (p.title?.rendered ?? '').toLowerCase()
    const isSeries = title.includes('combustible') || title.includes('precios')
    const publishedMs = Date.parse(`${p.date_gmt}Z`)
    const fresh = Number.isFinite(publishedMs) && nowMs - publishedMs <= maxAgeMs
    if (isSeries && fresh) return p
  }
  return null
}

export async function fetchGuatemalaFuelPrice(fuelType: FuelType): Promise<FetchedReading> {
  if (fuelType !== 'regular') {
    throw new Error(`GT fuel oracle only supports 'regular', got '${fuelType}'`)
  }
  const res = await fetch(AGN_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`AGN feed error: ${res.status}`)

  const posts = (await res.json()) as AgnPost[]
  const post = pickFreshPricePost(posts, Date.now())
  if (!post) throw new Error('AGN: no fresh fuel-price post within 14 days')

  const price = parseRegularPriceGTQ(post.content.rendered)
  if (price === null) throw new Error('AGN: could not parse regular price')
  if (price < BOUNDS.min || price > BOUNDS.max) {
    throw new Error(`AGN: regular price ${price} out of bounds [${BOUNDS.min}, ${BOUNDS.max}]`)
  }

  return {
    source: 'agn_mem',
    reading_type: 'fuel',
    value: {
      gas_price_quetzales: price,
      fuel_type: 'regular',
      reference_week: post.date_gmt.slice(0, 10),
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/oracle/guatemalaFuelFetcher.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/guatemalaFuelFetcher.ts tests/lib/oracle/guatemalaFuelFetcher.test.ts
git commit -m "feat(oracle): Guatemala regular-gas fetcher via AGN (fail-safe)"
```

---

## Task 3: Poll dispatch by region

**Files:**
- Modify: `lib/oracle/poll.ts:89-104` (the `fuel` branch)
- Test: `tests/lib/oracle/poll.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the top of `tests/lib/oracle/poll.test.ts` (below the existing imports) a mock of both fetcher modules, then a dispatch test. Place the `vi.mock` calls at module top (they hoist):

```ts
vi.mock('@/lib/oracle/gasFetcher', () => ({
  fetchGasPrice: vi.fn().mockResolvedValue({
    source: 'cre_datos_gob', reading_type: 'fuel',
    value: { price_mxn_per_liter: 24, fuel_type: 'magna', sample_size: 700 },
  }),
}))
vi.mock('@/lib/oracle/guatemalaFuelFetcher', () => ({
  fetchGuatemalaFuelPrice: vi.fn().mockResolvedValue({
    source: 'agn_mem', reading_type: 'fuel',
    value: { gas_price_quetzales: 40.09, fuel_type: 'regular', reference_week: '2026-07-21' },
  }),
}))
```

Then add this test inside the `describe('pollContracts', …)` block:

```ts
it('routes a guatemala fuel contract to the AGN fetcher, not the CRE fetcher', async () => {
  const { fetchGasPrice } = await import('@/lib/oracle/gasFetcher')
  const { fetchGuatemalaFuelPrice } = await import('@/lib/oracle/guatemalaFuelFetcher')
  const gtContract: Contract = {
    ...mockContract,
    id: 'gt1',
    trigger_type: 'fuel',
    is_recurring: true,
    trigger_condition: {
      metric: 'gas_price_quetzales', operator: 'gte', threshold: 45,
      region: 'guatemala', fuel_type: 'regular',
    } as never,
  }
  const db = makeDb({ contracts: [gtContract] })
  // No readingFetcher passed → exercises the real defaultFetcher dispatch.
  await pollContracts(db as never)
  expect(fetchGuatemalaFuelPrice).toHaveBeenCalledWith('regular')
  expect(fetchGasPrice).not.toHaveBeenCalled()
  expect(db._insert).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/oracle/poll.test.ts -t "routes a guatemala fuel"`
Expected: FAIL — current fuel branch calls `fetchGasPrice` (CRE) for every fuel contract, so `fetchGuatemalaFuelPrice` is never called.

- [ ] **Step 3: Implement the dispatch**

In `lib/oracle/poll.ts`, add the import near the existing `fetchGasPrice` import:

```ts
import { fetchGuatemalaFuelPrice } from './guatemalaFuelFetcher'
```

Replace the whole `if (contract.trigger_type === 'fuel') { … }` block (currently lines ~89-104) with:

```ts
  if (contract.trigger_type === 'fuel') {
    const condition = contract.trigger_condition as unknown as {
      fuel_type: 'magna' | 'premium' | 'diesel' | 'regular'
      region?: string
    }
    try {
      if (condition.region === 'guatemala') {
        return [await fetchGuatemalaFuelPrice(condition.fuel_type as 'regular')]
      }
      const VALID_FUEL_TYPES = ['magna', 'premium', 'diesel'] as const
      if (!VALID_FUEL_TYPES.includes(condition.fuel_type as never)) {
        console.error(`Invalid fuel_type "${condition.fuel_type}" for contract ${contract.id}`)
        return []
      }
      return [await fetchGasPrice(condition.fuel_type as 'magna' | 'premium' | 'diesel')]
    } catch (err) {
      console.error(`Fuel fetch error for contract ${contract.id}:`, err)
      return []
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/oracle/poll.test.ts`
Expected: PASS (new dispatch test plus the existing fuel test at "polls fuel contracts using the readingFetcher", which injects its own `readingFetcher` and is unaffected by the module mocks).

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/poll.ts tests/lib/oracle/poll.test.ts
git commit -m "feat(oracle): dispatch fuel reads by region (guatemala -> AGN)"
```

---

## Task 4: Recurring sticker uses the min offered tenor

**Files:**
- Modify: `lib/pricing/reprice.ts:54-66` (the `is_recurring` branch of `applyReprice`)
- Test: `tests/lib/pricing/reprice.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/lib/pricing/reprice.test.ts`, add a fuel recurring fixture and test. After the existing `recurringContract` definition (~line 238), add:

```ts
const fuelRecurringContract = {
  ...recurringContract,
  id: 'c-fuel',
  trigger_type: 'fuel',
  trigger_condition: { metric: 'gas_price_quetzales', threshold: 45, operator: 'gte', region: 'guatemala', fuel_type: 'regular' },
  coverage_tiers: [{ ...recurringTier, id: 'tier-fuel', base_probability: 0.0043 }],
}

function makeFuelRecurringDb() {
  const updateEq = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn().mockReturnValue({ eq: updateEq })
  const insert = vi.fn().mockResolvedValue({ error: null })
  const db = {
    from: vi.fn((table: string) => {
      if (table === 'contracts') {
        const single = vi.fn().mockResolvedValue({ data: fuelRecurringContract, error: null })
        const eq = vi.fn().mockReturnValue(
          Object.assign(Promise.resolve({ data: [fuelRecurringContract], error: null }), { single }),
        )
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      if (table === 'coverage_tiers') {
        const single = vi.fn().mockResolvedValue({ data: fuelRecurringContract.coverage_tiers[0], error: null })
        const eq = vi.fn().mockReturnValue({ single })
        return { select: vi.fn().mockReturnValue({ eq }), update }
      }
      if (table === 'pricing_history') return { insert }
      if (table === 'oracle_readings') {
        const limit = vi.fn().mockResolvedValue({ data: [], error: null })
        const order = vi.fn().mockReturnValue({ limit })
        const eq = vi.fn().mockReturnValue({ order })
        return { select: vi.fn().mockReturnValue({ eq }) }
      }
      return {}
    }),
    _update: update, _updateEq: updateEq, _insert: insert,
  }
  return db as MockDb
}

describe('fuel recurring: sticker uses the 7-day min tenor', () => {
  it('prices the sticker at tenorDays=7 (not 1)', async () => {
    const db = makeFuelRecurringDb()
    await repriceTier('tier-fuel', db)
    const pricingInputs = db._update.mock.calls[0][0].pricing_inputs
    expect(pricingInputs.tenorDays).toBe(7)

    const p = dailyHazard(0.0043, null, fuelRecurringContract.trigger_condition as never)
    const cap = capacityFactor(0, 100000)
    const expected = priceTenor(fuelRecurringContract.coverage_tiers[0].payout_usd, 7, p, 1, { capacityFactor: cap }).premiumUsd
    expect(db._update.mock.calls[0][0].premium_usd).toBeCloseTo(expected, 5)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lib/pricing/reprice.test.ts -t "sticker uses the 7-day"`
Expected: FAIL — sticker is priced at `tenorDays=1` (hardcoded), so `pricing_inputs.tenorDays` is 1, not 7.

- [ ] **Step 3: Implement**

In `lib/pricing/reprice.ts`, add the import:

```ts
import { periodMenuForContract } from '@/lib/pricing/tenors'
```

In the `is_recurring` branch of `applyReprice`, replace the `priceTenor(tier.payout_usd, 1, p, …)` call so the tenor comes from the contract's min offered period:

```ts
  if (contract.is_recurring) {
    const condition = contract.trigger_condition as never
    const p = dailyHazard(tier.base_probability, reading, condition)
    const cap = capacityFactor(tier.current_capacity_usd, tier.max_capacity_usd)
    const stickerTenor = periodMenuForContract(contract)[0].days
    const r = priceTenor(tier.payout_usd, stickerTenor, p, tier.max_payouts, { capacityFactor: cap })
    premiumUsd = r.premiumUsd
    // Record the multiplier actually used: recurring pricing floors it at 1.0.
    inputs = { ...r.inputs, oracleMultiplier: recurringOracleMultiplier(reading, condition) }
  } else {
```

For non-fuel recurring contracts `periodMenuForContract` returns the global menu whose first option is `1 day`, so `stickerTenor` stays `1` — existing behavior is preserved.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/pricing/reprice.test.ts`
Expected: PASS (new fuel test asserts `tenorDays=7`; all existing weather-recurring tests still assert `tenorDays=1` and stay green).

- [ ] **Step 5: Commit**

```bash
git add lib/pricing/reprice.ts tests/lib/pricing/reprice.test.ts
git commit -m "feat(pricing): recurring sticker uses contract's min tenor (fuel=7d)"
```

---

## Task 5: Wire the per-contract menu into the purchase UI

**Files:**
- Modify: `components/markets/PurchasePanel.tsx:40`, `:49-52`, `:70`
- Modify: `components/markets/ContractDetailClient.tsx:44`, `:60`
- Verify: `npx tsc --noEmit` and `npx next lint`

No unit test — these are client components without an RTL harness in this repo; verify via typecheck/lint and the post-deploy manual check in Task 7.

- [ ] **Step 1: Update `PurchasePanel.tsx`**

Add to the imports (join the existing `@/lib/pricing/tenors` import):

```ts
import { availablePeriods, periodMenuForContract } from '@/lib/pricing/tenors'
```

Change the initial period state (line 40) from:

```ts
  const [selectedPeriodDays, setSelectedPeriodDays] = useState<number | null>(initialPeriodDays ?? (isRecurring ? 1 : null))
```

to:

```ts
  const [selectedPeriodDays, setSelectedPeriodDays] = useState<number | null>(
    initialPeriodDays ?? (isRecurring ? periodMenuForContract(contract)[0].days : null),
  )
```

Change the sync effect (lines 49-52) from:

```ts
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedPeriodDays(initialPeriodDays ?? null)
  }, [initialPeriodDays])
```

to:

```ts
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedPeriodDays(initialPeriodDays ?? (isRecurring ? periodMenuForContract(contract)[0].days : null))
  }, [initialPeriodDays, isRecurring, contract])
```

Change the periodOptions line (line 70) from:

```ts
  const periodOptions = availablePeriods(hazard)
```

to:

```ts
  const periodOptions = availablePeriods(hazard, periodMenuForContract(contract))
```

- [ ] **Step 2: Update `ContractDetailClient.tsx`**

Change the import to add `periodMenuForContract`:

```ts
import { availablePeriods, periodMenuForContract } from '@/lib/pricing/tenors'
```

Change the initial period state (line 44) from:

```ts
  const [selectedPeriodDays, setSelectedPeriodDays] = useState<number | null>(isRecurring ? 1 : null)
```

to:

```ts
  const [selectedPeriodDays, setSelectedPeriodDays] = useState<number | null>(
    isRecurring ? periodMenuForContract(contract)[0].days : null,
  )
```

Change the periodOptions line (line 60) from:

```ts
  const periodOptions = availablePeriods(hazard)
```

to:

```ts
  const periodOptions = availablePeriods(hazard, periodMenuForContract(contract))
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: no errors introduced by these files.

- [ ] **Step 4: Run the full test suite (guard against regressions)**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/markets/PurchasePanel.tsx components/markets/ContractDetailClient.tsx
git commit -m "feat(markets): fuel contracts offer {7,14,30}-day menu, default 7d"
```

---

## Task 6: Data script — convert + recalibrate both fuel contracts

**Files:**
- Create: `scripts/apply-fuel-tenor.mjs`

The script mutates prod config, so it is **dry-run by default** and only writes with `--apply`. It reads `.env.local` like `.oracle-check.mjs`.

- [ ] **Step 1: Write the script**

Create `scripts/apply-fuel-tenor.mjs`:

```js
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const APPLY = process.argv.includes('--apply')

// Desired end-state per contract.
const PLAN = {
  'gas-price-guatemala-q45': {
    contract: {
      trigger_type: 'fuel',
      is_recurring: true,
      launch_stage: 'live',
      trigger_condition: {
        metric: 'gas_price_quetzales', operator: 'gte', threshold: 45,
        region: 'guatemala', fuel_type: 'regular',
      },
    },
    base_probability: 0.0043,
  },
  'gas-price-magna-cdmx': {
    contract: { is_recurring: true }, // trigger_type/condition already correct
    base_probability: 0.0020,
  },
}

for (const [slug, spec] of Object.entries(PLAN)) {
  const { data: c, error } = await sb.from('contracts').select('id, trigger_type, is_recurring, launch_stage, trigger_condition').eq('slug', slug).single()
  if (error || !c) { console.error(`SKIP ${slug}: ${error?.message ?? 'not found'}`); continue }

  console.log(`\n=== ${slug} (${c.id}) ===`)
  console.log('  contract:', JSON.stringify(spec.contract))
  console.log(`  base_probability -> ${spec.base_probability} (both tiers)`)

  if (APPLY) {
    const { error: e1 } = await sb.from('contracts').update(spec.contract).eq('id', c.id)
    if (e1) { console.error(`  contract update failed: ${e1.message}`); continue }
    const { error: e2 } = await sb.from('coverage_tiers').update({ base_probability: spec.base_probability }).eq('contract_id', c.id)
    if (e2) { console.error(`  tier update failed: ${e2.message}`); continue }
    console.log('  APPLIED')
  }
}

console.log(APPLY ? '\nDone. Now run a reprice (see Task 7).' : '\nDry run — re-run with --apply to write.')
```

- [ ] **Step 2: Dry-run to confirm the plan**

Run: `node scripts/apply-fuel-tenor.mjs`
Expected: prints both contracts with their intended `contract` patch and `base_probability`, ending with "Dry run". No writes.

- [ ] **Step 3: Commit the script (do NOT apply yet)**

```bash
git add scripts/apply-fuel-tenor.mjs
git commit -m "chore(scripts): one-off fuel tenor conversion + recalibration"
```

---

## Task 7: Deploy, apply, verify, launch

This task runs against prod. Do it as one contiguous session so stickers and readings line up. **Merge the branch and deploy the code first** — the data flip references `is_recurring`/region behavior that only the new code handles correctly.

- [ ] **Step 1: Merge and deploy**

Open a PR from `feat/fuel-tenor-oracle`, get it merged, then from a `main` checkout deploy once:

Run: `vercel --prod --yes`
Expected: one successful production deploy (see the single-prod-deploy note — deploy exactly once).

- [ ] **Step 2: Dry-run the live AGN fetch**

Confirm today's AGN parse is sane before flipping config. From the repo root:

Run:
```bash
node --input-type=module -e "
import('./lib/oracle/guatemalaFuelFetcher.ts').catch(async () => {
  const { fetchGuatemalaFuelPrice } = await import('./lib/oracle/guatemalaFuelFetcher.js');
  console.log(await fetchGuatemalaFuelPrice('regular'));
});
"
```
If the TS import path is awkward in the runtime, instead call the function from a quick `tsx` runner:
Run: `npx tsx -e "import('@/lib/oracle/guatemalaFuelFetcher').then(m => m.fetchGuatemalaFuelPrice('regular')).then(console.log)"`
Expected: an object with `value.gas_price_quetzales` ≈ **40–42** (week of Jul 20 ≈ Q40.09) and `reference_week` a recent date. If it throws, stop and inspect AGN wording before proceeding.

- [ ] **Step 3: Apply the data changes**

Run: `node scripts/apply-fuel-tenor.mjs --apply`
Expected: both contracts print "APPLIED".

- [ ] **Step 4: Reprice so stickers reflect the new model**

Trigger the reprice cron endpoint (per the calibration note, `--apply` scripts do not reprice on their own):

Run: `curl -X POST "$(grep NEXT_PUBLIC_SITE_URL .env.local | cut -d= -f2 | tr -d '\"')/api/reprice" -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2 | tr -d '\"')"`
Expected: a success JSON with a repriced-tier count ≥ 4.

- [ ] **Step 5: Poll once so the first GT reading lands**

Trigger the oracle poll endpoint the same way (find the poll route; it is the cron-authed oracle endpoint used by cron-job.org):

Run: `curl -X POST "$(grep NEXT_PUBLIC_SITE_URL .env.local | cut -d= -f2 | tr -d '\"')/api/oracle-poll" -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2 | tr -d '\"')"`
Expected: success; a new `agn_mem` reading is written for `gas-price-guatemala-q45`.

- [ ] **Step 6: Verify end-to-end**

Run: `node .oracle-check.mjs`
Expected:
- `gas-price-guatemala-q45` appears with `src=agn_mem`, `type=fuel`, a recent reading, `trig=0` (Q40 < Q45).
- Both fuel contracts show repriced tiers: Basic stickers ≈ **$5** (7-day floor), GT Pro ≈ **$6.9**, MX Pro ≈ **$5**.
- No "oracle-fed contracts with NO readings" regression.

- [ ] **Step 7: Manual UI smoke check**

On prod, open each fuel contract detail page and confirm the period selector shows **7 / 14 / 30 days** (no 1/3-day), 7-day is preselected, and quotes rise with tenor. Confirm GT shows `live` (visible in the market grid, not "coming soon").

- [ ] **Step 8: Update project memory**

Update the memory notes to reflect the shipped state: `project_guatemala_fuel_oracle_research.md` (AGN oracle now implemented), `project_gas_payouts.md` (both contracts now recurring 7/14/30 tenor, daily-hazard p GT 0.0043 / MX 0.0020, GT live), and add a pointer in `MEMORY.md`.

---

## Self-Review Notes

- **Spec coverage:** fetcher (T2), poll dispatch (T3), per-contract menu (T1), sticker min-tenor (T4), UI wiring (T5), data/recalibration/launch (T6–T7), TDD throughout, known-limitation and launch posture honored (no sub-threshold multiplier change; live immediately). All spec sections map to a task.
- **Naming consistency:** `FUEL_PERIOD_OPTIONS`, `periodMenuForContract`, `availablePeriods(p, menu)`, `parseRegularPriceGTQ`, `pickFreshPricePost`, `fetchGuatemalaFuelPrice`, reading `source:'agn_mem'` with `value.gas_price_quetzales` — used identically across tasks and matching the existing `trigger_condition.metric`.
- **Guardrails:** fetcher throws on stale/unparseable/out-of-bounds → poller's existing try/catch skips the write; no fallback source, matching the approved design.
</content>
