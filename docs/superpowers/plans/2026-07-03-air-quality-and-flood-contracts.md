# Air Quality & Flood Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two new recurring parametric products — `air_quality` (IMECA-scale pollution index) and `flood` (peak hourly rainfall) — reading point-location oracles into the existing pipeline with no pricing-engine changes.

**Architecture:** Follow the weather-fetcher pattern (point `contract.location` + external API + numeric threshold). Approach C: explicit per-type fetcher branches sharing small pure helpers (`airQualityIndex`, `rainfall`). Air quality ships on OpenWeatherMap first; SEDEMA (official CDMX source) is added later as a spike-gated upgrade because its live API is unverified.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres + RLS), Vitest, GitHub Actions cron, OpenWeatherMap APIs.

---

## Sequencing note vs. spec

The design spec (`docs/superpowers/specs/2026-07-03-air-quality-and-flood-contracts-design.md`) names SEDEMA as the air-quality primary with OWM fallback. This plan implements **OWM-first** (Tasks 1–9), then adds **SEDEMA as primary** in Task 10 after a verification spike. This is the spec's documented contingency and keeps every task placeholder-free. The migration (Task 1) already whitelists the `sedema` source so no schema change is needed in Task 10.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `supabase/migrations/20260703000003_air_quality_flood.sql` | Add trigger types + `sedema` source | 1 |
| `lib/types.ts` (modify) | Extend `TriggerType` + `OracleReading.source` | 2 |
| `lib/oracle/rainfall.ts` (create) | Pure: OWM response → rain mm | 3 |
| `lib/oracle/airQualityIndex.ts` (create) | Pure: concentrations → IMECA index | 4 |
| `lib/oracle/fetcher.ts` (modify) | `fetchFloodReading`, `fetchAirQualityReading` | 5, 6 |
| `lib/oracle/poll.ts` (modify) | Wire branches + `POLLABLE_TRIGGER_TYPES` | 7 |
| `components/admin/contracts/ContractForm.tsx` (modify) | Trigger-type options + threshold field | 8 |
| `.github/workflows/oracle-poll-air.yml` (create) | Hourly daytime air-quality poll | 9 |
| `.github/workflows/oracle-poll-flood.yml` (create) | Hourly flood poll | 9 |
| `lib/oracle/sedema.ts` (create) | SEDEMA client + nearest station (spike-gated) | 10 |

---

### Task 1: Migration — trigger types + sedema source

**Files:**
- Create: `supabase/migrations/20260703000003_air_quality_flood.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add air_quality + flood trigger types and the sedema reading source.
-- Recreates both CHECK constraints with the full known set. Also restores
-- cre_datos_gob to the source check (a latent gap from the fuel work), matching
-- lib/types.ts which already lists it.

ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_trigger_type_check;
ALTER TABLE contracts
  ADD CONSTRAINT contracts_trigger_type_check
  CHECK (trigger_type IN ('weather','urban','event','manual','fuel','air_quality','flood'));

ALTER TABLE oracle_readings DROP CONSTRAINT IF EXISTS oracle_readings_source_check;
ALTER TABLE oracle_readings
  ADD CONSTRAINT oracle_readings_source_check
  CHECK (source IN ('openweathermap','tomorrow_io','google_maps','manual','cre_datos_gob','sedema'));
```

- [ ] **Step 2: Verify the SQL parses locally (optional, if a local db is linked)**

Run: `supabase db lint --linked` (skip if no local db; the file is applied later via `supabase db push`)
Expected: no syntax errors reported for the new file.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260703000003_air_quality_flood.sql
git commit -m "feat(db): add air_quality/flood trigger types and sedema source"
```

---

### Task 2: Extend TypeScript unions

**Files:**
- Modify: `lib/types.ts:5` (`TriggerType`), `lib/types.ts:143` and `lib/types.ts:153` (`source` unions)

- [ ] **Step 1: Extend `TriggerType`**

Change line 5 from:
```ts
export type TriggerType = 'weather' | 'urban' | 'event' | 'manual' | 'fuel'
```
to:
```ts
export type TriggerType = 'weather' | 'urban' | 'event' | 'manual' | 'fuel' | 'air_quality' | 'flood'
```

- [ ] **Step 2: Add `sedema` to both `source` unions**

At lines 143 and 153, change each:
```ts
  source: 'openweathermap' | 'tomorrow_io' | 'google_maps' | 'manual' | 'cre_datos_gob'
```
to:
```ts
  source: 'openweathermap' | 'tomorrow_io' | 'google_maps' | 'manual' | 'cre_datos_gob' | 'sedema'
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors from these files).

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat(types): add air_quality/flood trigger types and sedema source"
```

---

### Task 3: `rainfall.ts` pure helper (TDD)

**Files:**
- Create: `lib/oracle/rainfall.ts`
- Test: `tests/lib/oracle/rainfall.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { rainfallFromOwm } from '@/lib/oracle/rainfall'

describe('rainfallFromOwm', () => {
  it('extracts 1h and 3h rain from an OWM current-weather payload', () => {
    const out = rainfallFromOwm({ rain: { '1h': 34.2, '3h': 51.0 } })
    expect(out).toEqual({ rain_1h_mm: 34.2, rain_3h_mm: 51.0 })
  })

  it('treats a missing rain field as zero', () => {
    expect(rainfallFromOwm({})).toEqual({ rain_1h_mm: 0, rain_3h_mm: 0 })
  })

  it('treats a partial rain field (only 1h) with 3h defaulting to zero', () => {
    expect(rainfallFromOwm({ rain: { '1h': 12 } })).toEqual({ rain_1h_mm: 12, rain_3h_mm: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/oracle/rainfall.test.ts`
Expected: FAIL — cannot find module `@/lib/oracle/rainfall`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/oracle/rainfall.ts
interface OwmRainPayload {
  rain?: { '1h'?: number; '3h'?: number }
}

export interface RainfallMetric {
  rain_1h_mm: number
  rain_3h_mm: number
}

/** Peak-intensity rainfall from an OWM current-weather payload. Absent → 0. */
export function rainfallFromOwm(data: OwmRainPayload): RainfallMetric {
  return {
    rain_1h_mm: data.rain?.['1h'] ?? 0,
    rain_3h_mm: data.rain?.['3h'] ?? 0,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/oracle/rainfall.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/rainfall.ts tests/lib/oracle/rainfall.test.ts
git commit -m "feat(oracle): rainfall parser for flood readings"
```

---

### Task 4: `airQualityIndex.ts` pure helper (TDD)

**Files:**
- Create: `lib/oracle/airQualityIndex.ts`
- Test: `tests/lib/oracle/airQualityIndex.test.ts`

Converts pollutant concentrations (µg/m³) to the Mexican IMECA index using
piecewise-linear interpolation over official breakpoints, then takes the **max
sub-index** across O₃ and PM2.5 (the pollutants that drive CDMX contingencia).
The interpolation logic is what the tests pin down; the breakpoint constants are
domain data to verify against NOM-172-SEMARNAT-2019 (see Step 5).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { imecaFromConcentrations, interpolateImeca, PM25_BREAKPOINTS } from '@/lib/oracle/airQualityIndex'

describe('interpolateImeca', () => {
  it('returns the low index bound at the low concentration bound', () => {
    // PM2.5 first segment: 0.0–12.0 µg/m³ maps to IMECA 0–50
    expect(interpolateImeca(0, PM25_BREAKPOINTS)).toBe(0)
  })

  it('interpolates linearly at a segment midpoint', () => {
    // midpoint of 0.0–12.0 µg/m³ (=6.0) → midpoint of IMECA 0–50 (=25)
    expect(interpolateImeca(6.0, PM25_BREAKPOINTS)).toBe(25)
  })

  it('clamps concentrations above the top breakpoint to the max index', () => {
    expect(interpolateImeca(100000, PM25_BREAKPOINTS)).toBe(500)
  })
})

describe('imecaFromConcentrations', () => {
  it('takes the max sub-index across O3 and PM2.5', () => {
    // Clean PM2.5, ozone-heavy → ozone drives the index above PM2.5's
    const out = imecaFromConcentrations({ pm25: 6.0, o3_ugm3: 300 })
    expect(out.aqi_imeca).toBeGreaterThan(interpolateImeca(6.0, PM25_BREAKPOINTS))
    expect(out.pm25).toBe(6.0)
    expect(out.o3).toBe(300)
  })

  it('handles a missing pollutant by ignoring it', () => {
    const out = imecaFromConcentrations({ pm25: 6.0 })
    expect(out.aqi_imeca).toBe(25)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/oracle/airQualityIndex.test.ts`
Expected: FAIL — cannot find module `@/lib/oracle/airQualityIndex`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/oracle/airQualityIndex.ts
//
// IMECA (Índice Metropolitano de la Calidad del Aire) via piecewise-linear
// interpolation. Breakpoints are [concentration_low, concentration_high,
// index_low, index_high]. VERIFY the constants against NOM-172-SEMARNAT-2019
// before production seeding (Step 5) — the interpolation logic is source-agnostic.

export type Breakpoint = readonly [number, number, number, number]

// PM2.5 breakpoints in µg/m³ (24h), IMECA 0–500.
export const PM25_BREAKPOINTS: readonly Breakpoint[] = [
  [0.0, 12.0, 0, 50],
  [12.1, 45.0, 51, 100],
  [45.1, 97.4, 101, 150],
  [97.5, 150.4, 151, 200],
  [150.5, 250.4, 201, 300],
  [250.5, 500.4, 301, 500],
]

// O3 breakpoints in ppb (1h), IMECA 0–500.
export const O3_PPB_BREAKPOINTS: readonly Breakpoint[] = [
  [0, 51, 0, 50],
  [52, 95, 51, 100],
  [96, 154, 101, 150],
  [155, 204, 151, 200],
  [205, 404, 201, 300],
  [405, 604, 301, 500],
]

// OWM reports O3 in µg/m³; IMECA O3 uses ppb. At 25°C / 1 atm: ppb = µg/m³ × 24.45 / MW(48).
const O3_UGM3_TO_PPB = 24.45 / 48

export function interpolateImeca(concentration: number, table: readonly Breakpoint[]): number {
  const top = table[table.length - 1]
  if (concentration >= top[1]) return top[3]
  for (const [cLow, cHigh, iLow, iHigh] of table) {
    if (concentration <= cHigh) {
      const span = cHigh - cLow
      if (span <= 0) return iLow
      const ratio = Math.max(0, (concentration - cLow) / span)
      return Math.round(iLow + ratio * (iHigh - iLow))
    }
  }
  return top[3]
}

export interface ImecaInput {
  pm25?: number      // µg/m³
  o3_ugm3?: number   // µg/m³
}

export interface ImecaResult {
  aqi_imeca: number
  pm25: number | null
  o3: number | null
}

/** Max sub-index across available pollutants. Missing pollutants are ignored. */
export function imecaFromConcentrations(input: ImecaInput): ImecaResult {
  const subIndices: number[] = []
  if (typeof input.pm25 === 'number') subIndices.push(interpolateImeca(input.pm25, PM25_BREAKPOINTS))
  if (typeof input.o3_ugm3 === 'number') {
    subIndices.push(interpolateImeca(input.o3_ugm3 * O3_UGM3_TO_PPB, O3_PPB_BREAKPOINTS))
  }
  return {
    aqi_imeca: subIndices.length ? Math.max(...subIndices) : 0,
    pm25: input.pm25 ?? null,
    o3: input.o3_ugm3 ?? null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/oracle/airQualityIndex.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify breakpoint constants against the official NOM**

Open NOM-172-SEMARNAT-2019 (air quality index) and confirm `PM25_BREAKPOINTS`
and `O3_PPB_BREAKPOINTS` match the published segments. Correct any constant that
differs; the tests assert interpolation math, not the constants, so they stay
green. Note the verification result in the commit message.

- [ ] **Step 6: Commit**

```bash
git add lib/oracle/airQualityIndex.ts tests/lib/oracle/airQualityIndex.test.ts
git commit -m "feat(oracle): IMECA air-quality index normalizer"
```

---

### Task 5: `fetchFloodReading` (TDD)

**Files:**
- Modify: `lib/oracle/fetcher.ts` (add export near `fetchWeatherReading`)
- Test: `tests/lib/oracle/fetcher.test.ts` (add `describe` block)

- [ ] **Step 1: Write the failing test**

```ts
// add to tests/lib/oracle/fetcher.test.ts
import { fetchFloodReading } from '@/lib/oracle/fetcher'

describe('fetchFloodReading', () => {
  beforeEach(() => mockFetch.mockReset())

  it('returns peak hourly rainfall from OWM', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ rain: { '1h': 34.2, '3h': 51.0 } }),
    })
    const reading = await fetchFloodReading(19.4, -99.1, 'test-key')
    expect(reading.source).toBe('openweathermap')
    expect(reading.reading_type).toBe('flood')
    expect(reading.value).toMatchObject({ rain_1h_mm: 34.2, rain_3h_mm: 51.0 })
  })

  it('reports zero rain when OWM omits the rain field', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
    const reading = await fetchFloodReading(19.4, -99.1, 'test-key')
    expect(reading.value).toMatchObject({ rain_1h_mm: 0, rain_3h_mm: 0 })
  })

  it('throws on a non-ok OWM response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(fetchFloodReading(19.4, -99.1, 'k')).rejects.toThrow('OpenWeatherMap error: 500')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/oracle/fetcher.test.ts -t fetchFloodReading`
Expected: FAIL — `fetchFloodReading` is not exported.

- [ ] **Step 3: Add the implementation to `lib/oracle/fetcher.ts`**

Add the import at the top (after the `trafficIndex` import):
```ts
import { rainfallFromOwm } from './rainfall'
```
Add the exported function (below `fetchWeatherReading`):
```ts
export async function fetchFloodReading(
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
    reading_type: 'flood',
    value: { ...rainfallFromOwm(data) },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/oracle/fetcher.test.ts -t fetchFloodReading`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/fetcher.ts tests/lib/oracle/fetcher.test.ts
git commit -m "feat(oracle): flood reading fetcher (OWM peak rainfall)"
```

---

### Task 6: `fetchAirQualityReading` (TDD, OWM source)

**Files:**
- Modify: `lib/oracle/fetcher.ts`
- Test: `tests/lib/oracle/fetcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to tests/lib/oracle/fetcher.test.ts
import { fetchAirQualityReading } from '@/lib/oracle/fetcher'

describe('fetchAirQualityReading', () => {
  beforeEach(() => mockFetch.mockReset())

  it('calls the OWM air_pollution endpoint and returns an IMECA index', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ list: [{ components: { pm2_5: 6.0, o3: 20 } }] }),
    })
    const reading = await fetchAirQualityReading(19.4, -99.1, 'test-key')
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('air_pollution'))
    expect(reading.source).toBe('openweathermap')
    expect(reading.reading_type).toBe('air_quality')
    expect(typeof reading.value.aqi_imeca).toBe('number')
    expect(reading.value.pm25).toBe(6.0)
  })

  it('throws on a non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 })
    await expect(fetchAirQualityReading(19.4, -99.1, 'k')).rejects.toThrow('OpenWeatherMap error: 401')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/oracle/fetcher.test.ts -t fetchAirQualityReading`
Expected: FAIL — `fetchAirQualityReading` is not exported.

- [ ] **Step 3: Add the implementation to `lib/oracle/fetcher.ts`**

Add the import at the top:
```ts
import { imecaFromConcentrations } from './airQualityIndex'
```
Add the exported function:
```ts
export async function fetchAirQualityReading(
  lat: number,
  lng: number,
  apiKey: string,
): Promise<FetchedReading> {
  const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lng}&appid=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OpenWeatherMap error: ${res.status}`)
  const data = await res.json()
  const c = (data.list?.[0]?.components ?? {}) as { pm2_5?: number; o3?: number }
  const index = imecaFromConcentrations({ pm25: c.pm2_5, o3_ugm3: c.o3 })
  return {
    source: 'openweathermap',
    reading_type: 'air_quality',
    value: { ...index, source_detail: 'owm' },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/oracle/fetcher.test.ts -t fetchAirQualityReading`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/fetcher.ts tests/lib/oracle/fetcher.test.ts
git commit -m "feat(oracle): air-quality reading fetcher (OWM -> IMECA)"
```

---

### Task 7: Wire branches into the poller (TDD)

**Files:**
- Modify: `lib/oracle/poll.ts` (`defaultFetcher`, `POLLABLE_TRIGGER_TYPES`)
- Test: `tests/lib/oracle/poll.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to tests/lib/oracle/poll.test.ts
import { POLLABLE_TRIGGER_TYPES } from '@/lib/oracle/poll'

describe('POLLABLE_TRIGGER_TYPES', () => {
  it('includes air_quality and flood', () => {
    expect(POLLABLE_TRIGGER_TYPES).toContain('air_quality')
    expect(POLLABLE_TRIGGER_TYPES).toContain('flood')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/oracle/poll.test.ts -t POLLABLE_TRIGGER_TYPES`
Expected: FAIL — array does not contain the new values.

- [ ] **Step 3: Update `lib/oracle/poll.ts`**

Add the imports (with the other fetcher imports at the top of the file):
```ts
import { fetchAirQualityReading, fetchFloodReading } from './fetcher'
```
Add two branches inside `defaultFetcher`, before the final `return []`:
```ts
  if (contract.trigger_type === 'air_quality') {
    const apiKey = process.env.OPENWEATHERMAP_API_KEY ?? ''
    if (!apiKey) return []
    const { lat, lng } = contract.location
    try {
      return [await fetchAirQualityReading(lat, lng, apiKey)]
    } catch (err) {
      console.error(`Air-quality fetch error for contract ${contract.id}:`, err)
      return []
    }
  }

  if (contract.trigger_type === 'flood') {
    const apiKey = process.env.OPENWEATHERMAP_API_KEY ?? ''
    if (!apiKey) return []
    const { lat, lng } = contract.location
    try {
      return [await fetchFloodReading(lat, lng, apiKey)]
    } catch (err) {
      console.error(`Flood fetch error for contract ${contract.id}:`, err)
      return []
    }
  }
```
Update the constant:
```ts
export const POLLABLE_TRIGGER_TYPES = ['weather', 'urban', 'fuel', 'air_quality', 'flood'] as const
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/oracle/poll.test.ts`
Expected: PASS (existing suite + new test).

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/poll.ts tests/lib/oracle/poll.test.ts
git commit -m "feat(oracle): poll air_quality and flood contracts"
```

---

### Task 8: Admin ContractForm — trigger types + threshold (TDD)

**Files:**
- Modify: `components/admin/contracts/ContractForm.tsx`
- Test: `tests/components/ContractForm.test.tsx`

The form already has a generic metric/comparator/threshold editor (lines ~305–325).
For `air_quality`/`flood` we default the metric + operator per type and expose the
threshold input. Change is in `buildTriggerCondition` and the trigger-type `<select>`.

- [ ] **Step 1: Write the failing test**

```ts
// add to tests/components/ContractForm.test.tsx
import { buildTriggerCondition } from '@/components/admin/contracts/ContractForm'

describe('buildTriggerCondition (air_quality / flood)', () => {
  it('builds an aqi_imeca gte condition for air_quality', () => {
    const c = buildTriggerCondition('air_quality', {
      metric: '', comparator: '>', threshold: '150', unit: '', description: '', fuel_type: '',
    })
    expect(c).toMatchObject({ metric: 'aqi_imeca', operator: 'gte', threshold: 150 })
  })

  it('builds a rain_1h_mm gte condition for flood', () => {
    const c = buildTriggerCondition('flood', {
      metric: '', comparator: '>', threshold: '30', unit: '', description: '', fuel_type: '',
    })
    expect(c).toMatchObject({ metric: 'rain_1h_mm', operator: 'gte', threshold: 30 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/ContractForm.test.tsx -t buildTriggerCondition`
Expected: FAIL — either `buildTriggerCondition` is not exported, or it doesn't handle the new types.

- [ ] **Step 3: Export and extend `buildTriggerCondition`**

In `components/admin/contracts/ContractForm.tsx`, ensure `buildTriggerCondition`
is `export`ed, and add these branches at the top of its body (before the existing
weather/fuel logic):
```ts
  if (type === 'air_quality') {
    return { metric: 'aqi_imeca', operator: 'gte', threshold: Number(state.threshold) }
  }
  if (type === 'flood') {
    return { metric: 'rain_1h_mm', operator: 'gte', threshold: Number(state.threshold) }
  }
```

- [ ] **Step 4: Add the two options to the trigger-type `<select>`**

In the `<select ... value={triggerType} onChange={handleTypeChange}>` block (~line 286), add:
```tsx
            <option value="air_quality">Air quality (IMECA)</option>
            <option value="flood">Flood (rainfall)</option>
```

- [ ] **Step 5: Show the threshold input for the new types**

Locate the conditional that renders the generic metric/comparator/threshold editor
(the block guarded for weather-style types). Extend its guard so it also renders
when `triggerType === 'air_quality' || triggerType === 'flood'`, and set the
threshold input placeholder to `"e.g. 150 (IMECA) or 30 (mm)"`. For these two
types the metric/comparator selects may be hidden (metric+operator are fixed);
render only the threshold input when `triggerType === 'air_quality' || triggerType === 'flood'`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/components/ContractForm.test.tsx`
Expected: PASS (existing + 2 new).

- [ ] **Step 7: Commit**

```bash
git add components/admin/contracts/ContractForm.tsx tests/components/ContractForm.test.tsx
git commit -m "feat(admin): air_quality and flood contract creation"
```

---

### Task 9: GitHub Actions poll schedules

**Files:**
- Create: `.github/workflows/oracle-poll-air.yml`
- Create: `.github/workflows/oracle-poll-flood.yml`

- [ ] **Step 1: Write the air-quality workflow**

```yaml
name: Oracle Poll (air quality)

# Hourly during CDMX daytime when ozone/PM peak. MX is permanently UTC-6.
# MX 08:00–21:00 -> UTC 14:00–03:00 (next day).
on:
  schedule:
    - cron: '0 14-23,0-3 * * *'
  workflow_dispatch: {}

jobs:
  poll:
    runs-on: ubuntu-latest
    steps:
      - name: Poll /api/oracle-poll?types=air_quality
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          code=$(curl -sS -o /tmp/body -w '%{http_code}' \
            -X POST -H "Authorization: Bearer ${CRON_SECRET}" \
            "https://insu-theta.vercel.app/api/oracle-poll?types=air_quality")
          echo "HTTP ${code}"; cat /tmp/body; echo
          test "${code}" = "200"
```

- [ ] **Step 2: Write the flood workflow**

```yaml
name: Oracle Poll (flood)

# Hourly year-round — storms are not schedulable.
on:
  schedule:
    - cron: '0 * * * *'
  workflow_dispatch: {}

jobs:
  poll:
    runs-on: ubuntu-latest
    steps:
      - name: Poll /api/oracle-poll?types=flood
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          code=$(curl -sS -o /tmp/body -w '%{http_code}' \
            -X POST -H "Authorization: Bearer ${CRON_SECRET}" \
            "https://insu-theta.vercel.app/api/oracle-poll?types=flood")
          echo "HTTP ${code}"; cat /tmp/body; echo
          test "${code}" = "200"
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/oracle-poll-air.yml .github/workflows/oracle-poll-flood.yml
git commit -m "ci: hourly air-quality and flood oracle polls"
```

---

### Task 10: SEDEMA primary source (spike-gated upgrade)

**Files:**
- Create: `lib/oracle/sedema.ts`
- Modify: `lib/oracle/fetcher.ts` (`fetchAirQualityReading` tries SEDEMA first)
- Test: `tests/lib/oracle/sedema.test.ts`

> Do this task only after the spike (Step 1) confirms a live SEDEMA endpoint. If
> the spike fails, stop — air quality remains on OWM (Task 6), which is fully
> functional, and this task is deferred.

- [ ] **Step 1: Spike — verify a live SEDEMA/SIMAT endpoint**

Investigate the CDMX air-quality open-data feed (e.g. `aire.cdmx.gob.mx`). Using
curl, find an endpoint that returns current per-station pollutant concentrations
(PM2.5, O₃) with station coordinates. Record: the URL, the JSON shape, the field
names, and the concentration units. If no reliable endpoint exists, mark this task
deferred and stop.

- [ ] **Step 2: Write the failing test (pure nearest-station helper)**

```ts
import { describe, it, expect } from 'vitest'
import { nearestStation } from '@/lib/oracle/sedema'

describe('nearestStation', () => {
  const stations = [
    { id: 'MER', lat: 19.42, lng: -99.12 },
    { id: 'XAL', lat: 19.53, lng: -99.08 },
  ]
  it('returns the closest station to a point', () => {
    expect(nearestStation(19.43, -99.13, stations)?.id).toBe('MER')
  })
  it('returns null for an empty station list', () => {
    expect(nearestStation(19.43, -99.13, [])).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/lib/oracle/sedema.test.ts`
Expected: FAIL — cannot find module `@/lib/oracle/sedema`.

- [ ] **Step 4: Implement the pure helper and the client**

```ts
// lib/oracle/sedema.ts
export interface Station { id: string; lat: number; lng: number }

/** Euclidean nearest station (fine at city scale). Null if list empty. */
export function nearestStation(lat: number, lng: number, stations: Station[]): Station | null {
  let best: Station | null = null
  let bestD = Infinity
  for (const s of stations) {
    const d = (s.lat - lat) ** 2 + (s.lng - lng) ** 2
    if (d < bestD) { bestD = d; best = s }
  }
  return best
}
```
Then add, using the exact endpoint/shape recorded in Step 1, a
`fetchSedemaConcentrations(lat, lng): Promise<{ pm25?: number; o3_ugm3?: number; station: string } | null>`
that fetches the feed, maps rows to `Station[]`, picks `nearestStation`, and returns
its concentrations converted to µg/m³. Return `null` on any error so the caller can
fall back. (Implement the parse against the Step-1 shape; keep the HTTP + mapping
under ~30 lines.)

- [ ] **Step 5: Run the helper test**

Run: `npx vitest run tests/lib/oracle/sedema.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Make `fetchAirQualityReading` try SEDEMA first**

In `lib/oracle/fetcher.ts`, add `import { fetchSedemaConcentrations } from './sedema'`
and change the body of `fetchAirQualityReading` to try SEDEMA before OWM:
```ts
  const sedema = await fetchSedemaConcentrations(lat, lng).catch(() => null)
  if (sedema) {
    const index = imecaFromConcentrations({ pm25: sedema.pm25, o3_ugm3: sedema.o3_ugm3 })
    return {
      source: 'sedema',
      reading_type: 'air_quality',
      value: { ...index, station: sedema.station, source_detail: 'sedema' },
    }
  }
  // …existing OWM path stays as the fallback…
```
(Adjust `fetchAirQualityReading` to accept `lat, lng, apiKey` as before; SEDEMA
needs no key.)

- [ ] **Step 7: Add a fetcher test for the fallback**

```ts
// add to tests/lib/oracle/fetcher.test.ts — with fetchSedemaConcentrations mocked
// via vi.mock('@/lib/oracle/sedema', ...). Assert: when SEDEMA returns null,
// source is 'openweathermap'; when it returns data, source is 'sedema'.
```

- [ ] **Step 8: Run the full oracle suite**

Run: `npx vitest run tests/lib/oracle/`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/oracle/sedema.ts lib/oracle/fetcher.ts tests/lib/oracle/sedema.test.ts tests/lib/oracle/fetcher.test.ts
git commit -m "feat(oracle): SEDEMA as primary air-quality source with OWM fallback"
```

---

### Task 11: Full verification & apply

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Apply the migration to the linked DB**

Run: `supabase db push --linked < /dev/null`
Expected: `20260703000003_air_quality_flood.sql` applied.

- [ ] **Step 4: Seed initial CDMX contracts (via admin UI after deploy)**

Create one `air_quality` and one `flood` contract through the admin panel: set
CDMX lat/lng, thresholds (150 IMECA / 30 mm), Basic/Pro tiers, and a starting
`base_probability` per tier. Confirm a manual `workflow_dispatch` of each new poll
writes an `oracle_readings` row with the expected `value` shape.

---

## Self-review notes

- **Spec coverage:** trigger types (T1/T2), IMECA normalizer (T4), rainfall (T3), fetchers (T5/T6), poll wiring (T7), scheduling (T9), migration incl. `sedema` source (T1), admin threshold field (T8), SEDEMA primary (T10), testing throughout, calibration/seeding (T11). Basis-risk and threshold-calibration risks are carried from the spec into T4/T11 notes.
- **Deviation:** OWM-first, SEDEMA-second (documented above) — the spec's contingency, chosen to keep tasks placeholder-free.
- **Type consistency:** `FetchedReading` (`source`/`reading_type`/`value`), metric keys `aqi_imeca` / `rain_1h_mm`, and `imecaFromConcentrations` input `{ pm25, o3_ugm3 }` are used identically across tasks.
