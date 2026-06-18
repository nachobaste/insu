# Gas Price Oracle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `fuel` contract type with a daily CRE gas price oracle (Magna, Premium, Diesel) for CDMX.

**Architecture:** A new `gasFetcher.ts` fetches station-level prices from `api.datos.gob.mx`, filters to CDMX, and returns the median price per fuel type. `poll.ts` gains a `fuel` branch that calls the fetcher and evaluates the trigger using the existing `evaluateTrigger()` helper. The admin `ContractForm` gains fuel-specific fields.

**Tech Stack:** Next.js App Router, Supabase, Vitest, `api.datos.gob.mx` (no API key required)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260617000001_add_fuel_trigger_type.sql` | Create | Add `'fuel'` to `trigger_type` CHECK constraint |
| `lib/types.ts` | Modify | Add `'fuel'` to `TriggerType`; add `'cre_datos_gob'` to `OracleReading.source` |
| `lib/oracle/gasFetcher.ts` | Create | Fetch & median-aggregate CDMX gas prices from datos.gob.mx |
| `tests/lib/oracle/gasFetcher.test.ts` | Create | Unit tests for gasFetcher |
| `lib/oracle/poll.ts` | Modify | Add `'fuel'` to query filter + `defaultFetcher` branch |
| `tests/lib/oracle/poll.test.ts` | Modify | Add fuel contract test case |
| `vercel.json` | Modify | Move oracle-poll cron from midnight to 10am CDMX (16:00 UTC) |
| `components/admin/contracts/ContractForm.tsx` | Modify | Add fuel trigger type + fuel-specific condition fields |

---

## Task 1: Discover the datos.gob.mx API response shape

**Files:** none (research only)

- [ ] **Step 1: Fetch a sample of CDMX station prices**

Run this from your terminal (no API key needed):

```bash
curl -s "https://api.datos.gob.mx/v1/precio.gasolina.publico?pageSize=3&estado=Ciudad%20de%20M%C3%A9xico" | python3 -m json.tool
```

- [ ] **Step 2: Record the exact field names**

From the response, find and write down:
- The field name for the state/city (likely `estado` or `municipio`)
- The field name for Magna price (likely `gasolina_magna`, `precio_gasolina_magna`, or `precio_magna`)
- The field name for Premium price (likely `gasolina_premium` or `precio_gasolina_premium`)
- The field name for Diesel price (likely `diesel` or `precio_diesel`)
- Whether prices are strings or numbers in the JSON

These field names are used in Task 4. The rest of the plan uses `gasolina_magna`, `gasolina_premium`, `diesel` as assumed names — update them in Task 4 if the actual names differ.

- [ ] **Step 3: Note total record count for CDMX**

Check `pagination.total` in the response. This determines the `pageSize` needed to fetch all CDMX stations in one call. Use that number in Task 4 (plan assumes ≤ 1000).

---

## Task 2: DB migration — add `'fuel'` to trigger_type constraint

**Files:**
- Create: `supabase/migrations/20260617000001_add_fuel_trigger_type.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260617000001_add_fuel_trigger_type.sql
ALTER TABLE contracts
  DROP CONSTRAINT contracts_trigger_type_check;

ALTER TABLE contracts
  ADD CONSTRAINT contracts_trigger_type_check
  CHECK (trigger_type IN ('weather', 'urban', 'event', 'manual', 'fuel'));
```

- [ ] **Step 2: Apply to production via Supabase CLI**

```bash
/opt/homebrew/bin/supabase db push
```

Expected: migration applied, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260617000001_add_fuel_trigger_type.sql
git commit -m "feat: add 'fuel' trigger type to contracts constraint"
```

---

## Task 3: Update TypeScript types

**Files:**
- Modify: `lib/types.ts`

- [ ] **Step 1: Add `'fuel'` to TriggerType and `'cre_datos_gob'` to OracleReading source**

In `lib/types.ts`, make these two changes:

```ts
// line 5 — was: export type TriggerType = 'weather' | 'urban' | 'event' | 'manual'
export type TriggerType = 'weather' | 'urban' | 'event' | 'manual' | 'fuel'
```

```ts
// line 136 — was: source: 'openweathermap' | 'tomorrow_io' | 'google_maps' | 'manual'
source: 'openweathermap' | 'tomorrow_io' | 'google_maps' | 'manual' | 'cre_datos_gob'
```

```ts
// line 146 (LatestOracleReading) — same source field
source: 'openweathermap' | 'tomorrow_io' | 'google_maps' | 'manual' | 'cre_datos_gob'
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add 'fuel' TriggerType and 'cre_datos_gob' oracle source"
```

---

## Task 4: Implement gasFetcher

**Files:**
- Create: `lib/oracle/gasFetcher.ts`
- Create: `tests/lib/oracle/gasFetcher.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/oracle/gasFetcher.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchGasPrice } from '@/lib/oracle/gasFetcher'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const CDMX_STATIONS = [
  { estado: 'Ciudad de México', gasolina_magna: '26.49', gasolina_premium: '29.20', diesel: '25.80' },
  { estado: 'Ciudad de México', gasolina_magna: '26.50', gasolina_premium: '29.21', diesel: '25.81' },
  { estado: 'Ciudad de México', gasolina_magna: '26.48', gasolina_premium: null,    diesel: '25.79' },
  { estado: 'Jalisco',          gasolina_magna: '99.00', gasolina_premium: '99.00', diesel: '99.00' },
]

function mockResponse(results: typeof CDMX_STATIONS) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ results, pagination: { total: results.length } }),
  })
}

describe('fetchGasPrice', () => {
  beforeEach(() => mockFetch.mockReset())

  it('calls datos.gob.mx with the correct URL', async () => {
    mockResponse(CDMX_STATIONS)
    await fetchGasPrice('magna')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('api.datos.gob.mx'),
    )
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('Ciudad'),
    )
  })

  it('returns median Magna price for CDMX stations only', async () => {
    mockResponse(CDMX_STATIONS)
    const result = await fetchGasPrice('magna')
    // CDMX stations: [26.48, 26.49, 26.50] → median = 26.49
    expect(result.value.price_mxn_per_liter).toBe(26.49)
    expect(result.source).toBe('cre_datos_gob')
    expect(result.reading_type).toBe('fuel')
  })

  it('returns median Premium price, skipping null values', async () => {
    mockResponse(CDMX_STATIONS)
    const result = await fetchGasPrice('premium')
    // CDMX stations with non-null premium: [29.20, 29.21] → median = 29.205
    expect(result.value.price_mxn_per_liter).toBe(29.205)
  })

  it('returns median Diesel price', async () => {
    mockResponse(CDMX_STATIONS)
    const result = await fetchGasPrice('diesel')
    // CDMX diesel: [25.79, 25.80, 25.81] → median = 25.80
    expect(result.value.price_mxn_per_liter).toBe(25.80)
  })

  it('throws when no CDMX stations found for fuel type', async () => {
    mockResponse([{ estado: 'Jalisco', gasolina_magna: '26.00', gasolina_premium: '29.00', diesel: '25.00' }])
    await expect(fetchGasPrice('magna')).rejects.toThrow('No CDMX price data')
  })

  it('throws when fetch returns non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 })
    await expect(fetchGasPrice('magna')).rejects.toThrow('datos.gob.mx error: 503')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/lib/oracle/gasFetcher.test.ts
```

Expected: 6 failures, `Cannot find module '@/lib/oracle/gasFetcher'`

- [ ] **Step 3: Implement gasFetcher**

> **Note:** If Task 1 revealed different field names than `gasolina_magna`, `gasolina_premium`, `diesel` — update the `FUEL_FIELD` map below.

```ts
// lib/oracle/gasFetcher.ts
const BASE = 'https://api.datos.gob.mx/v1/precio.gasolina.publico'

const FUEL_FIELD: Record<'magna' | 'premium' | 'diesel', string> = {
  magna:   'gasolina_magna',
  premium: 'gasolina_premium',
  diesel:  'diesel',
}

type FuelType = 'magna' | 'premium' | 'diesel'

interface StationRecord {
  estado: string
  [key: string]: string | null
}

interface FetchedReading {
  source: 'cre_datos_gob'
  reading_type: 'fuel'
  value: Record<string, unknown>
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

export async function fetchGasPrice(fuelType: FuelType): Promise<FetchedReading> {
  const url = `${BASE}?pageSize=1000&estado=Ciudad%20de%20M%C3%A9xico`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`datos.gob.mx error: ${res.status}`)

  const data = await res.json() as { results: StationRecord[] }
  const field = FUEL_FIELD[fuelType]

  const prices = data.results
    .filter((r) => r.estado === 'Ciudad de México' && r[field] != null)
    .map((r) => parseFloat(r[field] as string))
    .filter((p) => !isNaN(p) && p > 0)

  if (prices.length === 0) throw new Error(`No CDMX price data for ${fuelType}`)

  const price = median(prices)

  return {
    source: 'cre_datos_gob',
    reading_type: 'fuel',
    value: { price_mxn_per_liter: price, fuel_type: fuelType, sample_size: prices.length },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/lib/oracle/gasFetcher.test.ts
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/gasFetcher.ts tests/lib/oracle/gasFetcher.test.ts
git commit -m "feat: CRE gas price fetcher with median aggregation for CDMX"
```

---

## Task 5: Update poll.ts to handle fuel contracts

**Files:**
- Modify: `lib/oracle/poll.ts`
- Modify: `tests/lib/oracle/poll.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to the existing `describe('pollContracts')` block in `tests/lib/oracle/poll.test.ts`:

```ts
it('polls fuel contracts using the readingFetcher', async () => {
  const fuelContract: Contract = {
    ...mockContract,
    id: 'f1',
    trigger_type: 'fuel',
    trigger_condition: {
      metric: 'price_mxn_per_liter',
      operator: 'gt',
      threshold: 25.0,
      fuel_type: 'magna',
      region: 'cdmx',
    },
  }
  const db = makeDb({ contracts: [fuelContract] })
  const mockFetcher = vi.fn().mockResolvedValue([{
    source: 'cre_datos_gob',
    reading_type: 'fuel',
    value: { price_mxn_per_liter: 26.49, fuel_type: 'magna', sample_size: 120 },
  }])
  const count = await pollContracts(db as never, mockFetcher)
  expect(count).toBe(1)
  expect(db._insert.mock.calls[0][0]).toMatchObject({
    contract_id: 'f1',
    source: 'cre_datos_gob',
    trigger_met: true, // 26.49 > 25.0
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/lib/oracle/poll.test.ts
```

Expected: new test fails — `fuel` contract returns 0 count because it's filtered out of the query.

- [ ] **Step 3: Update poll.ts**

Make two changes in `lib/oracle/poll.ts`:

**Change 1** — add `'fuel'` import and to the query filter (line 99):
```ts
// was:
.in('trigger_type', ['weather', 'urban'])
// becomes:
.in('trigger_type', ['weather', 'urban', 'fuel'])
```

**Change 2** — add `fetchGasPrice` import at top of file:
```ts
import { fetchWeatherReading, fetchTomorrowReading, fetchGoogleMapsReading } from './fetcher'
import { fetchGasPrice } from './gasFetcher'
```

**Change 3** — add fuel branch inside `defaultFetcher`, after the `urban` block (before `return []`):

```ts
  if (contract.trigger_type === 'fuel') {
    const condition = contract.trigger_condition as unknown as {
      fuel_type: 'magna' | 'premium' | 'diesel'
    }
    try {
      return [await fetchGasPrice(condition.fuel_type)]
    } catch (err) {
      console.error(`CRE fetch error for contract ${contract.id}:`, err)
      return []
    }
  }
```

- [ ] **Step 4: Run all oracle tests**

```bash
npx vitest run tests/lib/oracle/
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/poll.ts tests/lib/oracle/poll.test.ts
git commit -m "feat: poll fuel contracts using CRE gas price fetcher"
```

---

## Task 6: Update cron schedule

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Change oracle-poll to 10am CDMX (16:00 UTC)**

```json
{
  "crons": [
    {
      "path": "/api/reprice",
      "schedule": "0 0 * * *"
    },
    {
      "path": "/api/oracle-poll",
      "schedule": "0 16 * * *"
    },
    {
      "path": "/api/payout-process",
      "schedule": "0 0 * * *"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "fix: run oracle-poll at 10am CDMX (16:00 UTC) after CRE publishes prices"
```

---

## Task 7: ContractForm — fuel trigger type UI

**Files:**
- Modify: `components/admin/contracts/ContractForm.tsx`

- [ ] **Step 1: Add FUEL_TYPES constant after URBAN_METRICS (line 10)**

```ts
const FUEL_TYPES = ['magna', 'premium', 'diesel'] as const
```

- [ ] **Step 2: Add `fuel_type` to condState shape**

Find the `parseTriggerCondition` return type and all `condState` initializations. Add `fuel_type: string` to every object that sets `condState`. There are three places:

1. Default in `parseTriggerCondition` fallback (line ~53): add `fuel_type: ''`
2. Reset on trigger type change (line ~99): add `fuel_type: 'magna'`
3. Initial `parseTriggerCondition` for weather/urban (line ~43): add `fuel_type: ''`

- [ ] **Step 3: Update `buildTriggerCondition` to handle `'fuel'`**

Add after the `event` branch (line ~31):

```ts
  if (type === 'fuel') {
    return {
      metric: 'price_mxn_per_liter',
      operator: SYMBOL_TO_OPERATOR[state.comparator] ?? 'gt',
      threshold: Number(state.threshold),
      fuel_type: state.fuel_type,
      region: 'cdmx',
    }
  }
```

- [ ] **Step 4: Update `parseTriggerCondition` to handle `'fuel'`**

Add after the `event` branch (line ~51):

```ts
  if (type === 'fuel') {
    const operator = String(condition.operator ?? 'gt')
    return {
      metric: 'price_mxn_per_liter',
      comparator: OPERATOR_TO_SYMBOL[operator] ?? '>',
      threshold: String(condition.threshold ?? ''),
      unit: '',
      description: '',
      fuel_type: String(condition.fuel_type ?? 'magna'),
    }
  }
```

- [ ] **Step 5: Add `'fuel'` to the trigger type dropdown**

Find the dropdown options list (line ~205):

```tsx
// was:
{['weather', 'urban', 'event', 'manual'].map((t) => (
// becomes:
{['weather', 'urban', 'fuel', 'event', 'manual'].map((t) => (
```

- [ ] **Step 6: Add fuel condition fields to the form**

After the existing `{(triggerType === 'weather' || triggerType === 'urban') && (...)}` block, add:

```tsx
{triggerType === 'fuel' && (
  <div className="space-y-3">
    <div>
      <label className={labelCls}>Fuel Type</label>
      <select
        className={selectCls}
        value={condState.fuel_type}
        onChange={(e) => setCondState((s) => ({ ...s, fuel_type: e.target.value }))}
      >
        {FUEL_TYPES.map((f) => (
          <option key={f} value={f}>{f.charAt(0).toUpperCase() + f.slice(1)}</option>
        ))}
      </select>
    </div>
    <div>
      <label className={labelCls}>Comparator</label>
      <select
        className={selectCls}
        value={condState.comparator}
        onChange={(e) => setCondState((s) => ({ ...s, comparator: e.target.value }))}
      >
        {['>', '>=', '<', '<='].map((op) => (
          <option key={op} value={op}>{op}</option>
        ))}
      </select>
    </div>
    <div>
      <label className={labelCls}>Threshold (MXN/liter)</label>
      <input
        className={inputCls}
        type="number"
        step="0.01"
        placeholder="e.g. 26.50"
        value={condState.threshold}
        onChange={(e) => setCondState((s) => ({ ...s, threshold: e.target.value }))}
      />
    </div>
    <p className="text-xs text-insu-dim">Region: CDMX (fixed)</p>
  </div>
)}
```

- [ ] **Step 7: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Run full test suite**

```bash
npx vitest run
```

Expected: all passing.

- [ ] **Step 9: Commit**

```bash
git add components/admin/contracts/ContractForm.tsx
git commit -m "feat: fuel trigger type in ContractForm admin UI"
```

---

## Task 8: Deploy and verify

- [ ] **Step 1: Deploy to production**

```bash
vercel --prod --yes
```

- [ ] **Step 2: Create a test fuel contract via admin panel**

Go to `https://insu-theta.vercel.app/admin/contracts/new` and create:
- Trigger type: `fuel`
- Fuel type: `magna`
- Comparator: `>`
- Threshold: `0` (so trigger always fires — good for testing)
- Status: `active`

- [ ] **Step 3: Manually trigger the oracle poll**

```bash
curl -X POST https://insu-theta.vercel.app/api/oracle-poll \
  -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2)"
```

Expected: `{"readings": 1}` (or more if other contracts are active)

- [ ] **Step 4: Verify reading in Supabase**

```bash
SUPABASE_SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env.local | cut -d= -f2-)
SUPABASE_URL=$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2-)
curl -s "${SUPABASE_URL}/rest/v1/oracle_readings?source=eq.cre_datos_gob&order=read_at.desc&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"
```

Expected: one row with `source: "cre_datos_gob"`, `value.price_mxn_per_liter` set, `trigger_met: true`.
