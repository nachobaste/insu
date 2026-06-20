# SP4: Oracle Integrations + Auto-Payouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up weather/traffic oracle polling every 5 minutes, automatic trigger detection, and Stripe Customer Balance credits issued automatically when a contract trigger fires.

**Architecture:** Follow SP3 pattern — pure logic in `lib/`, thin secret-protected API routes for cron execution. `lib/oracle/` handles external API fetching, trigger evaluation, and poll orchestration. `lib/payout/` handles settlement. Two new Vercel cron jobs (`/api/oracle-poll` every 5 min, `/api/payout-process` every 5 min) drive the loop. Stripe Customer Balance credits (negative balance transactions) are the v1 payout mechanism — no Stripe Connect needed.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (service role key), Stripe SDK, OpenWeatherMap API, Tomorrow.io API, vitest

---

## File Map

```
lib/
  oracle/
    trigger.ts        ← NEW: pure evaluateTrigger(condition, value) → boolean
    fetcher.ts        ← NEW: fetchWeatherReading, fetchTomorrowReading, fetchWazeReading
    poll.ts           ← NEW: pollContracts(db, readingFetcher?) orchestrator
  payout/
    processor.ts      ← NEW: processPayouts(db, stripe) orchestrator
  types.ts            ← MODIFY: add HedgerPosition, ProviderPosition, OracleReading, Payout

app/api/
  reprice/
    route.ts          ← NEW (SP3 remainder): secret-protected POST, calls repriceAll()
  oracle-poll/
    route.ts          ← NEW: secret-protected POST, calls pollContracts()
  payout-process/
    route.ts          ← NEW: secret-protected POST, calls processPayouts()

tests/
  api/
    reprice.test.ts   ← NEW
    oracle-poll.test.ts ← NEW
    payout-process.test.ts ← NEW
  lib/
    oracle/
      trigger.test.ts ← NEW
      fetcher.test.ts ← NEW
      poll.test.ts    ← NEW
    payout/
      processor.test.ts ← NEW

vercel.json           ← MODIFY: add oracle-poll and payout-process cron entries
.env.local.example    ← MODIFY: add OPENWEATHERMAP_API_KEY, TOMORROWIO_API_KEY
```

---

## Task 0: Complete SP3 — Reprice API Route

`vercel.json` already has `/api/reprice` in the cron schedule but the route was never created. Fix that now.

**Files:**
- Create: `tests/api/reprice.test.ts`
- Create: `app/api/reprice/route.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/api/reprice.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/pricing/reprice', () => ({
  repriceAll: vi.fn().mockResolvedValue(4),
}))

async function makeRequest(secret: string) {
  const { POST } = await import('@/app/api/reprice/route')
  return POST(new NextRequest('http://localhost/api/reprice', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  }))
}

describe('POST /api/reprice', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
    vi.resetModules()
  })

  it('returns 401 with wrong secret', async () => {
    const res = await makeRequest('wrong')
    expect(res.status).toBe(401)
  })

  it('returns 200 and repriced count with correct secret', async () => {
    const res = await makeRequest('test-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ repriced: 4 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/api/reprice.test.ts
```

Expected: FAIL with `Cannot find module '@/app/api/reprice/route'`

- [ ] **Step 3: Create the route**

Create `app/api/reprice/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { repriceAll } from '@/lib/pricing/reprice'

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const count = await repriceAll()
  return NextResponse.json({ repriced: count })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/api/reprice.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/reprice/route.ts tests/api/reprice.test.ts
git commit -m "feat: /api/reprice cron route — secret-protected endpoint for repriceAll"
```

---

## Task 1: Types + Environment Variables

Add domain types used by oracle and payout modules to `lib/types.ts`, and document the two new API keys.

**Files:**
- Modify: `lib/types.ts`
- Modify: `.env.local.example`

- [ ] **Step 1: Add types to lib/types.ts**

Append to the end of `lib/types.ts`:

```ts
export interface HedgerPosition {
  id: string
  user_id: string
  contract_id: string
  tier_id: string
  premium_paid_usd: number
  payout_amount_usd: number
  premium_paid_mxn: number
  payout_amount_mxn: number
  currency: string
  payment_provider: string
  payment_intent_id: string | null
  status: string
  purchased_at: string
  expires_at: string
}

export interface ProviderPosition {
  id: string
  user_id: string
  contract_id: string
  tier_id: string
  capital_deposited_usd: number
  capital_deposited_mxn: number
  currency: string
  payment_provider: string
  payment_intent_id: string | null
  expected_return_usd: number
  actual_return_usd: number | null
  expected_return_mxn: number
  actual_return_mxn: number | null
  status: string
  deposited_at: string
  settled_at: string | null
}

export interface OracleReading {
  id: string
  contract_id: string
  source: 'openweathermap' | 'tomorrow_io' | 'waze' | 'manual'
  reading_type: string
  value: Record<string, unknown>
  trigger_met: boolean
  read_at: string
}

export interface Payout {
  id: string
  contract_id: string
  hedger_position_id: string
  amount_usd: number
  amount_mxn: number
  currency: string
  payment_provider: string
  transfer_id: string | null
  status: string
  created_at: string
  completed_at: string | null
}
```

- [ ] **Step 2: Add env vars to .env.local.example**

Append to `.env.local.example`:

```
OPENWEATHERMAP_API_KEY=your_owm_key_here
TOMORROWIO_API_KEY=your_tio_key_here
```

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts .env.local.example
git commit -m "chore: add HedgerPosition, ProviderPosition, OracleReading, Payout types; oracle env vars"
```

---

## Task 2: Trigger Evaluator (TDD)

Pure function: given a trigger condition and a reading value, return true/false. No I/O.

**Files:**
- Create: `tests/lib/oracle/trigger.test.ts`
- Create: `lib/oracle/trigger.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/oracle/trigger.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { evaluateTrigger } from '@/lib/oracle/trigger'

describe('evaluateTrigger', () => {
  it('returns true when metric gte threshold', () => {
    expect(evaluateTrigger(
      { metric: 'rain_mm', threshold: 10, operator: 'gte' },
      { rain_mm: 15 },
    )).toBe(true)
  })

  it('returns false when metric below gte threshold', () => {
    expect(evaluateTrigger(
      { metric: 'rain_mm', threshold: 10, operator: 'gte' },
      { rain_mm: 5 },
    )).toBe(false)
  })

  it('returns true when metric equals threshold (gte)', () => {
    expect(evaluateTrigger(
      { metric: 'rain_mm', threshold: 10, operator: 'gte' },
      { rain_mm: 10 },
    )).toBe(true)
  })

  it('returns true for lte when metric at or below threshold', () => {
    expect(evaluateTrigger(
      { metric: 'temp_c', threshold: 0, operator: 'lte' },
      { temp_c: -5 },
    )).toBe(true)
  })

  it('returns false for lte when metric above threshold', () => {
    expect(evaluateTrigger(
      { metric: 'temp_c', threshold: 0, operator: 'lte' },
      { temp_c: 5 },
    )).toBe(false)
  })

  it('returns true for gt when strictly above threshold', () => {
    expect(evaluateTrigger(
      { metric: 'traffic_index', threshold: 8, operator: 'gt' },
      { traffic_index: 9 },
    )).toBe(true)
  })

  it('returns false for gt when equal to threshold', () => {
    expect(evaluateTrigger(
      { metric: 'traffic_index', threshold: 8, operator: 'gt' },
      { traffic_index: 8 },
    )).toBe(false)
  })

  it('returns false when metric key is missing from value', () => {
    expect(evaluateTrigger(
      { metric: 'rain_mm', threshold: 10, operator: 'gte' },
      { temp_c: 25 },
    )).toBe(false)
  })

  it('returns false when metric value is not a number', () => {
    expect(evaluateTrigger(
      { metric: 'rain_mm', threshold: 10, operator: 'gte' },
      { rain_mm: 'heavy' },
    )).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/oracle/trigger.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/oracle/trigger'`

- [ ] **Step 3: Implement the evaluator**

Create `lib/oracle/trigger.ts`:

```ts
export interface TriggerCondition {
  metric: string
  threshold: number
  operator: 'gte' | 'lte' | 'gt' | 'lt'
}

export function evaluateTrigger(
  condition: TriggerCondition,
  value: Record<string, unknown>,
): boolean {
  const actual = value[condition.metric]
  if (typeof actual !== 'number') return false
  switch (condition.operator) {
    case 'gte': return actual >= condition.threshold
    case 'lte': return actual <= condition.threshold
    case 'gt':  return actual > condition.threshold
    case 'lt':  return actual < condition.threshold
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/lib/oracle/trigger.test.ts
```

Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/trigger.ts tests/lib/oracle/trigger.test.ts
git commit -m "feat: oracle trigger evaluator — pure evaluateTrigger(condition, value)"
```

---

## Task 3: Oracle Fetchers (TDD)

Thin wrappers over OpenWeatherMap, Tomorrow.io (and a stub for Waze which has no public API). All fetchers return a normalized `FetchedReading` shape.

**Note on Waze:** The Waze Routing API is not available to third parties. The Waze fetcher returns a stub reading with `traffic_index: 0` (trigger_met always false) — urban/traffic contracts rely on admin manual override via `oracle_readings.trigger_met = true`.

**Files:**
- Create: `tests/lib/oracle/fetcher.test.ts`
- Create: `lib/oracle/fetcher.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/oracle/fetcher.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchWeatherReading, fetchTomorrowReading, fetchWazeReading } from '@/lib/oracle/fetcher'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('fetchWeatherReading', () => {
  beforeEach(() => mockFetch.mockReset())

  it('calls OWM current weather endpoint with lat/lng', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ main: { temp: 28.5 }, rain: { '1h': 15.3 } }),
    })
    await fetchWeatherReading(19.4, -99.1, 'test-key')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('lat=19.4'),
    )
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('lon=-99.1'),
    )
  })

  it('returns rain_mm and temp_c from OWM response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ main: { temp: 28.5 }, rain: { '1h': 15.3 } }),
    })
    const reading = await fetchWeatherReading(19.4, -99.1, 'test-key')
    expect(reading.source).toBe('openweathermap')
    expect(reading.reading_type).toBe('weather')
    expect(reading.value).toMatchObject({ rain_mm: 15.3, temp_c: 28.5 })
  })

  it('sets rain_mm = 0 when no rain field in OWM response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ main: { temp: 20 } }),
    })
    const reading = await fetchWeatherReading(19.4, -99.1, 'test-key')
    expect((reading.value as Record<string, unknown>).rain_mm).toBe(0)
  })

  it('throws when OWM returns non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 })
    await expect(fetchWeatherReading(19.4, -99.1, 'bad-key')).rejects.toThrow('OpenWeatherMap')
  })
})

describe('fetchTomorrowReading', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns rain_mm and temp_c from Tomorrow.io response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        data: {
          timelines: [{
            intervals: [{
              values: { precipitationIntensity: 5.2, temperature: 28.5 },
            }],
          }],
        },
      }),
    })
    const reading = await fetchTomorrowReading(19.4, -99.1, 'test-key')
    expect(reading.source).toBe('tomorrow_io')
    expect(reading.reading_type).toBe('weather')
    expect(reading.value).toMatchObject({ rain_mm: 5.2, temp_c: 28.5 })
  })

  it('throws when Tomorrow.io returns non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 })
    await expect(fetchTomorrowReading(19.4, -99.1, 'bad-key')).rejects.toThrow('Tomorrow.io')
  })
})

describe('fetchWazeReading', () => {
  it('returns a stub reading with traffic_index 0', () => {
    const reading = fetchWazeReading(19.4, -99.1)
    expect(reading.source).toBe('waze')
    expect(reading.reading_type).toBe('traffic')
    expect((reading.value as Record<string, unknown>).traffic_index).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/oracle/fetcher.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/oracle/fetcher'`

- [ ] **Step 3: Implement the fetchers**

Create `lib/oracle/fetcher.ts`:

```ts
import type { OracleReading } from '@/lib/types'

type FetchedReading = Pick<OracleReading, 'source' | 'reading_type' | 'value'>

export async function fetchWeatherReading(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<FetchedReading> {
  const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}&units=metric`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OpenWeatherMap error: ${res.status}`)
  const data = await res.json()
  return {
    source: 'openweathermap',
    reading_type: 'weather',
    value: {
      rain_mm: (data.rain?.['1h'] as number) ?? 0,
      temp_c: data.main?.temp as number,
      raw: data,
    },
  }
}

export async function fetchTomorrowReading(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<FetchedReading> {
  const url = `https://api.tomorrow.io/v4/timelines?location=${lat},${lng}&fields=precipitationIntensity,temperature&timesteps=1h&apikey=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Tomorrow.io error: ${res.status}`)
  const data = await res.json()
  const values = data?.data?.timelines?.[0]?.intervals?.[0]?.values ?? {}
  return {
    source: 'tomorrow_io',
    reading_type: 'weather',
    value: {
      rain_mm: (values.precipitationIntensity as number) ?? 0,
      temp_c: (values.temperature as number) ?? 0,
      raw: data,
    },
  }
}

export function fetchWazeReading(lat: number, lng: number): FetchedReading {
  // Waze has no public API. Returns stub — urban contracts use admin manual override.
  void lat; void lng
  return {
    source: 'waze',
    reading_type: 'traffic',
    value: { traffic_index: 0 },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/lib/oracle/fetcher.test.ts
```

Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/fetcher.ts tests/lib/oracle/fetcher.test.ts
git commit -m "feat: oracle fetchers — OpenWeatherMap, Tomorrow.io, Waze stub"
```

---

## Task 4: Oracle Poll Orchestrator (TDD)

Loads active unsettled contracts, calls the appropriate fetcher per trigger_type, writes `oracle_readings` rows with trigger_met evaluated. Manual/event contracts are skipped — they use admin override.

**Files:**
- Create: `tests/lib/oracle/poll.test.ts`
- Create: `lib/oracle/poll.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/oracle/poll.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { pollContracts } from '@/lib/oracle/poll'
import type { Contract } from '@/lib/types'

const mockContract: Contract = {
  id: 'c1',
  slug: 'rain-cdmx',
  title: 'Rain CDMX',
  description: null,
  category_id: 'cat-1',
  status: 'active',
  trigger_type: 'weather',
  trigger_condition: { metric: 'rain_mm', threshold: 10, operator: 'gte' },
  trigger_deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  location: { lat: 19.4, lng: -99.1, city: 'CDMX', country: 'MX' },
  icon_url: null,
  total_volume_usd: 0,
  total_volume_mxn: 0,
  is_featured: false,
  settled_outcome: null,
  created_by: 'admin',
  created_at: new Date().toISOString(),
  settled_at: null,
}

// Makes a chainable Supabase-style query builder that resolves to `value`
function chainable(value: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is']) {
    b[m] = vi.fn().mockReturnValue(b)
  }
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(value).then(res)
  return b
}

function makeDb(opts: {
  contracts?: Contract[]
  insertError?: boolean
} = {}) {
  const contracts = opts.contracts ?? [mockContract]
  const insertMock = vi.fn().mockResolvedValue({
    error: opts.insertError ? new Error('insert failed') : null,
  })

  return {
    from: vi.fn((table: string) => {
      if (table === 'contracts') return chainable({ data: contracts, error: null })
      if (table === 'oracle_readings') return { insert: insertMock }
      return {}
    }),
    _insert: insertMock,
  }
}

describe('pollContracts', () => {
  it('writes one oracle_readings row per contract', async () => {
    const db = makeDb()
    const mockFetcher = vi.fn().mockResolvedValue({
      source: 'openweathermap',
      reading_type: 'weather',
      value: { rain_mm: 5, temp_c: 20 },
    })
    const count = await pollContracts(db as never, mockFetcher)
    expect(count).toBe(1)
    expect(db._insert).toHaveBeenCalledTimes(1)
    expect(db._insert.mock.calls[0][0]).toMatchObject({
      contract_id: 'c1',
      source: 'openweathermap',
      trigger_met: false,
    })
  })

  it('sets trigger_met = true when condition is met', async () => {
    const db = makeDb()
    const mockFetcher = vi.fn().mockResolvedValue({
      source: 'openweathermap',
      reading_type: 'weather',
      value: { rain_mm: 15, temp_c: 20 }, // 15 >= 10
    })
    await pollContracts(db as never, mockFetcher)
    expect(db._insert.mock.calls[0][0].trigger_met).toBe(true)
  })

  it('skips contracts when fetcher returns null', async () => {
    const db = makeDb()
    const count = await pollContracts(db as never, vi.fn().mockResolvedValue(null))
    expect(count).toBe(0)
    expect(db._insert).not.toHaveBeenCalled()
  })

  it('returns 0 and skips fetching when no active contracts', async () => {
    const db = makeDb({ contracts: [] })
    const mockFetcher = vi.fn()
    const count = await pollContracts(db as never, mockFetcher)
    expect(count).toBe(0)
    expect(mockFetcher).not.toHaveBeenCalled()
  })

  it('continues polling remaining contracts when one fetcher throws', async () => {
    const twoContracts = [mockContract, { ...mockContract, id: 'c2' }]
    const db = makeDb({ contracts: twoContracts as Contract[] })
    const mockFetcher = vi.fn()
      .mockRejectedValueOnce(new Error('API timeout'))
      .mockResolvedValueOnce({
        source: 'openweathermap',
        reading_type: 'weather',
        value: { rain_mm: 5, temp_c: 20 },
      })
    const count = await pollContracts(db as never, mockFetcher)
    expect(count).toBe(1)
    expect(db._insert).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/oracle/poll.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/oracle/poll'`

- [ ] **Step 3: Implement the poll orchestrator**

Create `lib/oracle/poll.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import { evaluateTrigger, type TriggerCondition } from './trigger'
import { fetchWeatherReading, fetchWazeReading } from './fetcher'
import type { Contract } from '@/lib/types'

interface FetchedReading {
  source: string
  reading_type: string
  value: Record<string, unknown>
}

type ReadingFetcher = (contract: Contract) => Promise<FetchedReading | null>

interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

function getClient(): DbClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  )
}

async function defaultFetcher(contract: Contract): Promise<FetchedReading | null> {
  const { lat, lng } = contract.location
  const owmKey = process.env.OPENWEATHERMAP_API_KEY ?? ''

  if (contract.trigger_type === 'weather') {
    return fetchWeatherReading(lat, lng, owmKey)
  }
  if (contract.trigger_type === 'urban') {
    return fetchWazeReading(lat, lng)
  }
  return null
}

export async function pollContracts(
  db: DbClient = getClient(),
  readingFetcher: ReadingFetcher = defaultFetcher,
): Promise<number> {
  const { data: contracts } = await db
    .from('contracts')
    .select('*')
    .eq('status', 'active')
    .is('settled_outcome', null)
    .in('trigger_type', ['weather', 'urban'])

  if (!contracts || contracts.length === 0) return 0

  let count = 0
  for (const contract of contracts as Contract[]) {
    try {
      const reading = await readingFetcher(contract)
      if (!reading) continue

      const condition = contract.trigger_condition as unknown as TriggerCondition
      const trigger_met = condition.metric
        ? evaluateTrigger(condition, reading.value)
        : false

      await db.from('oracle_readings').insert({
        contract_id: contract.id,
        source: reading.source,
        reading_type: reading.reading_type,
        value: reading.value,
        trigger_met,
      })
      count++
    } catch {
      // Log and continue — one failed fetch should not block others
      console.error(`Oracle poll error for contract ${contract.id}`)
    }
  }
  return count
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/lib/oracle/poll.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/poll.ts lib/oracle/trigger.ts lib/oracle/fetcher.ts tests/lib/oracle/poll.test.ts
git commit -m "feat: oracle poll orchestrator — fetch readings, evaluate triggers, write oracle_readings"
```

---

## Task 5: Payout Processor (TDD)

When `oracle_readings.trigger_met = true` exists for a contract that hasn't settled yet:
1. Mark contract `settled_outcome = true`, `status = 'settled'`
2. For each active hedger position: create a `payouts` row, credit Stripe Customer Balance (negative balance transaction = credit), mark position `paid_out`
3. For each active provider position: calculate loss share, write `actual_return_usd`, mark `settled`

Stripe Customer Balance credit = `stripe.customers.createBalanceTransaction(customerId, { amount: -cents, currency: 'usd' })`. Negative amount credits the customer. They can spend it on future purchases or withdraw (v2).

**Files:**
- Create: `tests/lib/payout/processor.test.ts`
- Create: `lib/payout/processor.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/lib/payout/processor.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { processPayouts } from '@/lib/payout/processor'
import type { Contract, HedgerPosition, ProviderPosition } from '@/lib/types'

const mockContract: Contract = {
  id: 'c1',
  slug: 'rain-cdmx',
  title: 'Rain CDMX',
  description: null,
  category_id: 'cat-1',
  status: 'active',
  trigger_type: 'weather',
  trigger_condition: {},
  trigger_deadline: new Date(Date.now() + 86400000).toISOString(),
  location: { lat: 19.4, lng: -99.1, city: 'CDMX', country: 'MX' },
  icon_url: null,
  total_volume_usd: 0,
  total_volume_mxn: 0,
  is_featured: false,
  settled_outcome: null,
  created_by: 'admin',
  created_at: new Date().toISOString(),
  settled_at: null,
}

const mockHedgerPosition: HedgerPosition = {
  id: 'pos-1',
  user_id: 'user-1',
  contract_id: 'c1',
  tier_id: 'tier-1',
  premium_paid_usd: 50,
  payout_amount_usd: 500,
  premium_paid_mxn: 850,
  payout_amount_mxn: 8500,
  currency: 'USD',
  payment_provider: 'stripe',
  payment_intent_id: 'pi_test',
  status: 'active',
  purchased_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 86400000).toISOString(),
}

const mockProviderPosition: ProviderPosition = {
  id: 'pp-1',
  user_id: 'provider-1',
  contract_id: 'c1',
  tier_id: 'tier-1',
  capital_deposited_usd: 10000,
  capital_deposited_mxn: 0,
  currency: 'USD',
  payment_provider: 'stripe',
  payment_intent_id: 'pi_prov',
  expected_return_usd: 500,
  actual_return_usd: null,
  expected_return_mxn: 0,
  actual_return_mxn: null,
  status: 'active',
  deposited_at: new Date().toISOString(),
  settled_at: null,
}

function makeChainable(value: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is']) {
    b[m] = vi.fn().mockReturnValue(b)
  }
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(value).then(res)
  b.single = vi.fn().mockResolvedValue(value)
  return b
}

function makeDb(opts: {
  triggeredReadings?: Array<{ contract_id: string }>
  contracts?: Contract[]
  hedgerPositions?: HedgerPosition[]
  providerPositions?: ProviderPosition[]
  profileStripeId?: string | null
} = {}) {
  const triggeredReadings = opts.triggeredReadings ?? [{ contract_id: 'c1' }]
  const contracts = opts.contracts ?? [mockContract]
  const hedgerPositions = opts.hedgerPositions ?? [mockHedgerPosition]
  const providerPositions = opts.providerPositions ?? [mockProviderPosition]
  const profileStripeId = opts.profileStripeId !== undefined ? opts.profileStripeId : 'cus_test123'

  const contractUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const hedgerUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const providerUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const profileUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const payoutsUpdateEq = vi.fn().mockResolvedValue({ error: null })

  const payoutsInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'payout-1' }, error: null }),
    }),
  })

  return {
    from: vi.fn((table: string) => {
      if (table === 'oracle_readings') {
        return makeChainable({ data: triggeredReadings, error: null })
      }
      if (table === 'contracts') {
        return {
          ...makeChainable({ data: contracts, error: null }),
          update: vi.fn().mockReturnValue({ eq: contractUpdateEq }),
        }
      }
      if (table === 'hedger_positions') {
        return {
          ...makeChainable({ data: hedgerPositions, error: null }),
          update: vi.fn().mockReturnValue({ eq: hedgerUpdateEq }),
        }
      }
      if (table === 'provider_positions') {
        return {
          ...makeChainable({ data: providerPositions, error: null }),
          update: vi.fn().mockReturnValue({ eq: providerUpdateEq }),
        }
      }
      if (table === 'profiles') {
        return {
          ...makeChainable({ data: { stripe_customer_id: profileStripeId }, error: null }),
          update: vi.fn().mockReturnValue({ eq: profileUpdateEq }),
        }
      }
      if (table === 'payouts') {
        return {
          insert: payoutsInsert,
          update: vi.fn().mockReturnValue({ eq: payoutsUpdateEq }),
        }
      }
      return {}
    }),
    _contractUpdateEq: contractUpdateEq,
    _hedgerUpdateEq: hedgerUpdateEq,
    _providerUpdateEq: providerUpdateEq,
    _profileUpdateEq: profileUpdateEq,
    _payoutsInsert: payoutsInsert,
    _payoutsUpdateEq: payoutsUpdateEq,
  }
}

function makeStripe(opts: { newCustomerId?: string } = {}) {
  return {
    customers: {
      create: vi.fn().mockResolvedValue({ id: opts.newCustomerId ?? 'cus_new' }),
      createBalanceTransaction: vi.fn().mockResolvedValue({ id: 'txn_123' }),
    },
  }
}

describe('processPayouts', () => {
  it('returns 0 when no triggered readings exist', async () => {
    const db = makeDb({ triggeredReadings: [] })
    const stripe = makeStripe()
    const count = await processPayouts(db as never, stripe as never)
    expect(count).toBe(0)
    expect(stripe.customers.createBalanceTransaction).not.toHaveBeenCalled()
  })

  it('returns 0 when all triggered contracts are already settled', async () => {
    const db = makeDb({ contracts: [] }) // no unsettled contracts
    const stripe = makeStripe()
    const count = await processPayouts(db as never, stripe as never)
    expect(count).toBe(0)
  })

  it('marks the contract settled', async () => {
    const db = makeDb()
    await processPayouts(db as never, makeStripe() as never)
    expect(db._contractUpdateEq).toHaveBeenCalledWith('id', 'c1')
  })

  it('credits Stripe Customer Balance with negative cents', async () => {
    const db = makeDb()
    const stripe = makeStripe()
    await processPayouts(db as never, stripe as never)
    // payout_amount_usd = 500 → -50000 cents
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
      'cus_test123',
      { amount: -50000, currency: 'usd' },
    )
  })

  it('marks hedger position as paid_out', async () => {
    const db = makeDb()
    await processPayouts(db as never, makeStripe() as never)
    expect(db._hedgerUpdateEq).toHaveBeenCalledWith('id', 'pos-1')
  })

  it('creates payouts row with processing status then updates to completed', async () => {
    const db = makeDb()
    await processPayouts(db as never, makeStripe() as never)
    const insertArg = db._payoutsInsert.mock.calls[0][0]
    expect(insertArg.status).toBe('processing')
    expect(insertArg.amount_usd).toBe(500)
    expect(db._payoutsUpdateEq).toHaveBeenCalledWith('id', 'payout-1')
  })

  it('creates a Stripe customer when profile has no stripe_customer_id', async () => {
    const db = makeDb({ profileStripeId: null })
    const stripe = makeStripe({ newCustomerId: 'cus_brand_new' })
    await processPayouts(db as never, stripe as never)
    expect(stripe.customers.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { user_id: 'user-1' } }),
    )
    expect(stripe.customers.createBalanceTransaction).toHaveBeenCalledWith(
      'cus_brand_new',
      expect.objectContaining({ amount: -50000 }),
    )
    expect(db._profileUpdateEq).toHaveBeenCalledWith('id', 'user-1')
  })

  it('settles provider positions with correct loss share', async () => {
    const db = makeDb()
    await processPayouts(db as never, makeStripe() as never)
    // totalHedgerPayout = 500, totalProviderCapital = 10000
    // lossShare = (10000/10000) * 500 = 500
    // actualReturn = 10000 - 500 = 9500
    expect(db._providerUpdateEq).toHaveBeenCalledWith('id', 'pp-1')
  })

  it('returns the number of hedger positions paid out', async () => {
    const twoPositions = [
      mockHedgerPosition,
      { ...mockHedgerPosition, id: 'pos-2' },
    ]
    const db = makeDb({ hedgerPositions: twoPositions as HedgerPosition[] })
    const count = await processPayouts(db as never, makeStripe() as never)
    expect(count).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/payout/processor.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/payout/processor'`

- [ ] **Step 3: Implement the payout processor**

Create `lib/payout/processor.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import type { Contract, HedgerPosition, ProviderPosition } from '@/lib/types'

interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
}

interface StripeClient {
  customers: {
    create: (params: { metadata: Record<string, string> }) => Promise<{ id: string }>
    createBalanceTransaction: (
      customerId: string,
      params: { amount: number; currency: string },
    ) => Promise<{ id: string }>
  }
}

function getClient(): DbClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  )
}

export async function processPayouts(
  db: DbClient = getClient(),
  stripe: StripeClient,
): Promise<number> {
  const { data: triggeredReadings } = await db
    .from('oracle_readings')
    .select('contract_id')
    .eq('trigger_met', true)

  if (!triggeredReadings || triggeredReadings.length === 0) return 0

  const contractIds = [...new Set((triggeredReadings as Array<{ contract_id: string }>)
    .map(r => r.contract_id))]

  const { data: contracts } = await db
    .from('contracts')
    .select('*')
    .in('id', contractIds)
    .eq('status', 'active')
    .is('settled_outcome', null)

  if (!contracts || contracts.length === 0) return 0

  let total = 0
  for (const contract of contracts as Contract[]) {
    total += await settleContract(db, stripe, contract)
  }
  return total
}

async function settleContract(
  db: DbClient,
  stripe: StripeClient,
  contract: Contract,
): Promise<number> {
  await db.from('contracts')
    .update({ settled_outcome: true, status: 'settled', settled_at: new Date().toISOString() })
    .eq('id', contract.id)

  const { data: positions } = await db
    .from('hedger_positions')
    .select('*')
    .eq('contract_id', contract.id)
    .eq('status', 'active')

  if (!positions) return 0

  let paid = 0
  for (const position of positions as HedgerPosition[]) {
    await payoutPosition(db, stripe, contract.id, position)
    paid++
  }

  const totalHedgerPayout = (positions as HedgerPosition[])
    .reduce((sum, p) => sum + p.payout_amount_usd, 0)
  await settleProviderPositions(db, contract.id, totalHedgerPayout)

  return paid
}

async function payoutPosition(
  db: DbClient,
  stripe: StripeClient,
  contractId: string,
  position: HedgerPosition,
): Promise<void> {
  const { data: profile } = await db
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', position.user_id)
    .single()

  let customerId = (profile as { stripe_customer_id: string | null } | null)?.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({ metadata: { user_id: position.user_id } })
    customerId = customer.id
    await db.from('profiles').update({ stripe_customer_id: customerId }).eq('id', position.user_id)
  }

  const { data: payout } = await db.from('payouts')
    .insert({
      contract_id: contractId,
      hedger_position_id: position.id,
      amount_usd: position.payout_amount_usd,
      amount_mxn: position.payout_amount_mxn,
      currency: position.currency,
      payment_provider: 'stripe',
      status: 'processing',
    })
    .select('id')
    .single()

  if (!payout) return

  const txn = await stripe.customers.createBalanceTransaction(customerId, {
    amount: -Math.round(position.payout_amount_usd * 100),
    currency: 'usd',
  })

  await db.from('payouts')
    .update({ status: 'completed', transfer_id: txn.id, completed_at: new Date().toISOString() })
    .eq('id', (payout as { id: string }).id)

  await db.from('hedger_positions').update({ status: 'paid_out' }).eq('id', position.id)
}

async function settleProviderPositions(
  db: DbClient,
  contractId: string,
  totalHedgerPayout: number,
): Promise<void> {
  const { data: positions } = await db
    .from('provider_positions')
    .select('*')
    .eq('contract_id', contractId)
    .eq('status', 'active')

  if (!positions || positions.length === 0) return

  const totalProviderCapital = (positions as ProviderPosition[])
    .reduce((sum, p) => sum + p.capital_deposited_usd, 0)

  for (const position of positions as ProviderPosition[]) {
    const lossShare = totalProviderCapital > 0
      ? (position.capital_deposited_usd / totalProviderCapital) * totalHedgerPayout
      : 0
    const actualReturn = Math.round(Math.max(0, position.capital_deposited_usd - lossShare) * 100) / 100

    await db.from('provider_positions')
      .update({ status: 'settled', actual_return_usd: actualReturn, settled_at: new Date().toISOString() })
      .eq('id', position.id)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/lib/payout/processor.test.ts
```

Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/payout/processor.ts tests/lib/payout/processor.test.ts
git commit -m "feat: payout processor — settle contracts, Stripe Customer Balance credits, provider loss share"
```

---

## Task 6: Oracle-Poll Cron Route (TDD)

Secret-protected POST endpoint that Vercel cron calls every 5 minutes.

**Files:**
- Create: `tests/api/oracle-poll.test.ts`
- Create: `app/api/oracle-poll/route.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/api/oracle-poll.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/oracle/poll', () => ({
  pollContracts: vi.fn().mockResolvedValue(3),
}))

async function makeRequest(secret: string) {
  vi.resetModules()
  const { POST } = await import('@/app/api/oracle-poll/route')
  return POST(new NextRequest('http://localhost/api/oracle-poll', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  }))
}

describe('POST /api/oracle-poll', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
  })

  it('returns 401 with wrong secret', async () => {
    const res = await makeRequest('wrong')
    expect(res.status).toBe(401)
  })

  it('returns readings count with correct secret', async () => {
    const res = await makeRequest('test-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ readings: 3 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/api/oracle-poll.test.ts
```

Expected: FAIL with `Cannot find module '@/app/api/oracle-poll/route'`

- [ ] **Step 3: Create the route**

Create `app/api/oracle-poll/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { pollContracts } from '@/lib/oracle/poll'

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const count = await pollContracts()
  return NextResponse.json({ readings: count })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/api/oracle-poll.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/oracle-poll/route.ts tests/api/oracle-poll.test.ts
git commit -m "feat: /api/oracle-poll cron route — secret-protected endpoint for oracle polling"
```

---

## Task 7: Payout-Process Cron Route (TDD)

Secret-protected POST endpoint that Vercel cron calls every 5 minutes.

**Files:**
- Create: `tests/api/payout-process.test.ts`
- Create: `app/api/payout-process/route.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/api/payout-process.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/payout/processor', () => ({
  processPayouts: vi.fn().mockResolvedValue(2),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue({}),
}))
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}))

async function makeRequest(secret: string) {
  vi.resetModules()
  const { POST } = await import('@/app/api/payout-process/route')
  return POST(new NextRequest('http://localhost/api/payout-process', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  }))
}

describe('POST /api/payout-process', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
    process.env.STRIPE_SECRET_KEY = 'sk_test_key'
  })

  it('returns 401 with wrong secret', async () => {
    const res = await makeRequest('wrong')
    expect(res.status).toBe(401)
  })

  it('returns paid count with correct secret', async () => {
    const res = await makeRequest('test-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ paid: 2 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/api/payout-process.test.ts
```

Expected: FAIL with `Cannot find module '@/app/api/payout-process/route'`

- [ ] **Step 3: Create the route**

Create `app/api/payout-process/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import { processPayouts } from '@/lib/payout/processor'

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  const count = await processPayouts(db, stripe)
  return NextResponse.json({ paid: count })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/api/payout-process.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/payout-process/route.ts tests/api/payout-process.test.ts
git commit -m "feat: /api/payout-process cron route — secret-protected endpoint for payout processing"
```

---

## Task 8: Update Vercel Cron Config

Add the two new 5-minute cron schedules to `vercel.json`.

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Update vercel.json**

Replace the contents of `vercel.json` with:

```json
{
  "crons": [
    {
      "path": "/api/reprice",
      "schedule": "0 */6 * * *"
    },
    {
      "path": "/api/oracle-poll",
      "schedule": "*/5 * * * *"
    },
    {
      "path": "/api/payout-process",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

- [ ] **Step 2: Run full test suite to confirm no regressions**

```bash
npx vitest run
```

Expected: All tests pass (no new failures)

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "chore: add oracle-poll and payout-process to Vercel cron schedule (every 5 min)"
```

---

## Self-Review

### Spec Coverage

| Spec requirement | Task |
|---|---|
| OpenWeatherMap polling | Task 3 (fetcher), Task 4 (poll orchestrator) |
| Tomorrow.io polling | Task 3 (fetcher) — uses OWM as primary; T.io available as alternate fetcher |
| Waze traffic polling | Task 3 (stub — no public API; admin override handles real cases) |
| Trigger detection vs `trigger_condition` | Task 2 (evaluateTrigger), Task 4 (poll.ts wires condition → reading) |
| Write `oracle_readings` rows | Task 4 |
| Mark `contracts.settled_outcome = true` | Task 5 |
| Create `payouts` rows per hedger position | Task 5 |
| Stripe Customer Balance credit | Task 5 |
| Mark `hedger_positions.status = 'paid_out'` | Task 5 |
| Settle `provider_positions` with loss share | Task 5 |
| Cron every 5 min | Tasks 6, 7, 8 |
| Secret-protected routes | Tasks 0, 6, 7 |
| SP3 reprice route (open SP3 task) | Task 0 |

### Gaps / Notes

- **Tomorrow.io as primary:** The `defaultFetcher` uses OWM as primary for weather contracts. To use Tomorrow.io as a secondary/fallback, add that logic to `defaultFetcher` in `lib/oracle/poll.ts` after Task 3 is shipped — it's a one-line change but adds an extra API key requirement, so OWM-only ships first.
- **Waze stub:** Urban/traffic contracts will never auto-trigger via oracle — they rely on admin manually setting `oracle_readings.trigger_met = true`. This is correct per spec ("Power/urban outage: Manual override (admin)").
- **Conekta payouts:** Only Stripe Customer Balance credits are implemented (v1 spec). Conekta payout logic is deferred to a later sprint — positions with `payment_provider = 'conekta'` are processed but the balance credit step is Stripe-only for now.
