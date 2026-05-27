# Traffic Oracle — Google Maps Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Waze stub with a real Google Maps Routes API fetcher, add 12 predefined CDMX corridor contracts, and surface live traffic data (pulse bar + map) on the contract detail page.

**Architecture:** A new `corridors` table stores 12 predefined origin/destination pairs. Urban contracts reference a corridor via nullable FK. The poll orchestrator joins corridors, checks each contract's active window before calling Google Maps, and writes real `traffic_index` readings. Two new components on `app/markets/[slug]/page.tsx` show a live pulse bar (server component, data from DB) and a Google Maps embed with traffic layer (client component).

**Tech Stack:** Next.js 16 App Router, Supabase PostgreSQL, Google Maps Routes API v2, Google Maps JavaScript API, `@googlemaps/js-api-loader`, Vitest

---

## File Map

| Action | File |
|--------|------|
| Modify | `lib/types.ts` |
| Modify | `lib/oracle/fetcher.ts` |
| Modify | `lib/oracle/poll.ts` |
| Modify | `app/markets/[slug]/page.tsx` |
| Modify | `vercel.json` |
| Modify | `tests/lib/oracle/fetcher.test.ts` |
| Modify | `tests/lib/oracle/poll.test.ts` |
| Create | `supabase/migrations/20260526000001_add_corridors.sql` |
| Create | `supabase/migrations/20260526000002_seed_corridors.sql` |
| Create | `supabase/migrations/20260526000003_seed_corridor_contracts.sql` |
| Create | `components/markets/TrafficPulseBar.tsx` |
| Create | `components/markets/TrafficPulseBarRefresher.tsx` |
| Create | `components/markets/CorridorMap.tsx` |

---

## Task 1: DB Migration + Types

**Files:**
- Create: `supabase/migrations/20260526000001_add_corridors.sql`
- Modify: `lib/types.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260526000001_add_corridors.sql`:

```sql
-- Add corridors table and wire it to contracts + oracle_readings

CREATE TABLE corridors (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug         text UNIQUE NOT NULL,
  name         text NOT NULL,
  road         text NOT NULL,
  origin_lat   numeric NOT NULL,
  origin_lng   numeric NOT NULL,
  dest_lat     numeric NOT NULL,
  dest_lng     numeric NOT NULL,
  window_start time NOT NULL,
  window_end   time NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Public read — corridor data is not sensitive
ALTER TABLE corridors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Corridors public" ON corridors FOR SELECT USING (true);

-- FK on contracts (nullable — only urban/corridor contracts have one)
ALTER TABLE contracts ADD COLUMN corridor_id uuid REFERENCES corridors(id);

-- Update oracle_readings source enum: add google_maps, remove waze
ALTER TABLE oracle_readings
  DROP CONSTRAINT oracle_readings_source_check;

ALTER TABLE oracle_readings
  ADD CONSTRAINT oracle_readings_source_check
  CHECK (source IN ('openweathermap', 'tomorrow_io', 'google_maps', 'manual'));
```

- [ ] **Step 2: Add `Corridor` type and update related types in `lib/types.ts`**

Add after the `ContractLocation` interface (line 39):

```ts
export interface Corridor {
  id: string
  slug: string
  name: string
  road: string
  origin_lat: number
  origin_lng: number
  dest_lat: number
  dest_lng: number
  window_start: string  // 'HH:MM:SS' from PostgreSQL TIME
  window_end: string
  created_at: string
}
```

Add `corridor?: Corridor | null` to the `Contract` interface after `coverage_tiers?`:

```ts
  coverage_tiers?: CoverageTier[]
  corridor?: Corridor | null
```

Update `OracleReading.source` union (line 121):

```ts
  source: 'openweathermap' | 'tomorrow_io' | 'google_maps' | 'manual'
```

Update `LatestOracleReading.source` (line 130):

```ts
  source: 'openweathermap' | 'tomorrow_io' | 'google_maps' | 'manual'
```

- [ ] **Step 3: Verify TypeScript compiles with no new errors**

Run: `npx tsc --noEmit`
Expected: exits 0, no errors referencing types changed above.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260526000001_add_corridors.sql lib/types.ts
git commit -m "feat: add corridors table and update source enum + types"
```

---

## Task 2: Seed Corridors

**Files:**
- Create: `supabase/migrations/20260526000002_seed_corridors.sql`

- [ ] **Step 1: Write the seed migration**

Create `supabase/migrations/20260526000002_seed_corridors.sql`:

```sql
-- Seed 12 CDMX corridor definitions (6 roads × AM + PM direction)
-- Coordinates are verified entry/exit points for each corridor.
-- AM direction = toward city centre. PM = reversed.

INSERT INTO corridors (slug, name, road, origin_lat, origin_lng, dest_lat, dest_lng, window_start, window_end) VALUES

-- Viaducto Miguel Alemán
('viaducto-am',
 'Viaducto Oriente (Mañana)',
 'Viaducto Miguel Alemán',
 19.3983, -99.1918,   -- origin: Constituyentes end
 19.4147, -99.0790,   -- dest: Eje 3 Oriente / Aeropuerto
 '07:00', '10:00'),

('viaducto-pm',
 'Viaducto Poniente (Tarde)',
 'Viaducto Miguel Alemán',
 19.4147, -99.0790,   -- origin: Eje 3 Oriente / Aeropuerto
 19.3983, -99.1918,   -- dest: Constituyentes end
 '17:00', '20:00'),

-- Circuito Bicentenario (Circuito Interior)
('bicentenario-am',
 'Bicentenario Sur (Mañana)',
 'Circuito Bicentenario',
 19.4487, -99.1374,   -- origin: Guerrero / Norte arc
 19.3749, -99.1836,   -- dest: Insurgentes Sur / Mixcoac arc
 '07:00', '10:00'),

('bicentenario-pm',
 'Bicentenario Norte (Tarde)',
 'Circuito Bicentenario',
 19.3749, -99.1836,   -- origin: Insurgentes Sur / Mixcoac arc
 19.4487, -99.1374,   -- dest: Guerrero / Norte arc
 '17:00', '20:00'),

-- Periférico Norte
('periferico-norte-am',
 'Periférico Norte → Centro (Mañana)',
 'Periférico Norte',
 19.4726, -99.1758,   -- origin: Cuatro Caminos / Naucalpan
 19.4153, -99.2054,   -- dest: Constituyentes crossing
 '07:00', '10:00'),

('periferico-norte-pm',
 'Periférico Norte → Cuatro Caminos (Tarde)',
 'Periférico Norte',
 19.4153, -99.2054,   -- origin: Constituyentes crossing
 19.4726, -99.1758,   -- dest: Cuatro Caminos / Naucalpan
 '17:00', '20:00'),

-- Periférico Sur
('periferico-sur-am',
 'Periférico Sur → Centro (Mañana)',
 'Periférico Sur',
 19.3030, -99.1507,   -- origin: Estadio Azteca / Tlalpan
 19.3601, -99.1733,   -- dest: Insurgentes Sur crossing
 '07:00', '10:00'),

('periferico-sur-pm',
 'Periférico Sur → Azteca (Tarde)',
 'Periférico Sur',
 19.3601, -99.1733,   -- origin: Insurgentes Sur crossing
 19.3030, -99.1507,   -- dest: Estadio Azteca / Tlalpan
 '17:00', '20:00'),

-- Paseo de la Reforma
('reforma-am',
 'Reforma → Alameda (Mañana)',
 'Paseo de la Reforma',
 19.4001, -99.1892,   -- origin: Observatorio / Chapultepec
 19.4354, -99.1452,   -- dest: Alameda Central / Bellas Artes
 '07:00', '10:00'),

('reforma-pm',
 'Reforma → Observatorio (Tarde)',
 'Paseo de la Reforma',
 19.4354, -99.1452,   -- origin: Alameda Central / Bellas Artes
 19.4001, -99.1892,   -- dest: Observatorio / Chapultepec
 '17:00', '20:00'),

-- Avenida de las Palmas
('palmas-am',
 'Palmas → Reforma (Mañana)',
 'Av. de las Palmas',
 19.4218, -99.2519,   -- origin: Bosques de las Lomas
 19.4199, -99.2138,   -- dest: Fuente de Petróleos
 '07:00', '10:00'),

('palmas-pm',
 'Palmas → Bosques (Tarde)',
 'Av. de las Palmas',
 19.4199, -99.2138,   -- origin: Fuente de Petróleos
 19.4218, -99.2519,   -- dest: Bosques de las Lomas
 '17:00', '20:00');
```

- [ ] **Step 2: Verify coordinate spot-check**

Open each origin/destination pair in Google Maps and confirm it lands on the correct road. The coordinates don't need to be exact intersections — just on the right road near the described endpoint. Adjust any that are off before committing.

To spot-check: `https://www.google.com/maps?q=<lat>,<lng>`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260526000002_seed_corridors.sql
git commit -m "feat: seed 12 CDMX traffic corridors"
```

---

## Task 3: Replace Waze Fetcher with Google Maps Fetcher

**Files:**
- Modify: `lib/oracle/fetcher.ts`
- Modify: `tests/lib/oracle/fetcher.test.ts`

- [ ] **Step 1: Write failing tests for `fetchGoogleMapsReading`**

Replace the `describe('fetchWazeReading', ...)` block at the bottom of `tests/lib/oracle/fetcher.test.ts` with:

```ts
describe('fetchGoogleMapsReading', () => {
  beforeEach(() => mockFetch.mockReset())

  it('calls the Routes API with correct origin and destination', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        routes: [{ duration: '1800s', staticDuration: '1200s' }],
      }),
    })
    await fetchGoogleMapsReading(19.3983, -99.1918, 19.4147, -99.0790, 'test-key')
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes')
    const body = JSON.parse(opts.body as string)
    expect(body.origin.location.latLng.latitude).toBe(19.3983)
    expect(body.destination.location.latLng.latitude).toBe(19.4147)
    expect(body.routingPreference).toBe('TRAFFIC_AWARE')
  })

  it('computes traffic_index from duration / staticDuration', async () => {
    // 1800s actual vs 1200s free-flow → (1800/1200 - 1) * 100 = 50
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        routes: [{ duration: '1800s', staticDuration: '1200s' }],
      }),
    })
    const reading = await fetchGoogleMapsReading(19.3983, -99.1918, 19.4147, -99.0790, 'test-key')
    expect(reading.source).toBe('google_maps')
    expect(reading.reading_type).toBe('traffic')
    expect((reading.value as Record<string, unknown>).traffic_index).toBe(50)
    expect((reading.value as Record<string, unknown>).duration_s).toBe(1800)
    expect((reading.value as Record<string, unknown>).static_duration_s).toBe(1200)
  })

  it('clamps traffic_index to 100 when delay exceeds 100%', async () => {
    // 3600s actual vs 1200s free-flow → (3/1 - 1) * 100 = 200 → clamped to 100
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        routes: [{ duration: '3600s', staticDuration: '1200s' }],
      }),
    })
    const reading = await fetchGoogleMapsReading(19.3983, -99.1918, 19.4147, -99.0790, 'test-key')
    expect((reading.value as Record<string, unknown>).traffic_index).toBe(100)
  })

  it('returns traffic_index 0 when no delay', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        routes: [{ duration: '1200s', staticDuration: '1200s' }],
      }),
    })
    const reading = await fetchGoogleMapsReading(19.3983, -99.1918, 19.4147, -99.0790, 'test-key')
    expect((reading.value as Record<string, unknown>).traffic_index).toBe(0)
  })

  it('throws when Routes API returns non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 })
    await expect(
      fetchGoogleMapsReading(19.3983, -99.1918, 19.4147, -99.0790, 'bad-key'),
    ).rejects.toThrow('Google Maps Routes API error: 403')
  })

  it('throws when response has no routes', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ routes: [] }),
    })
    await expect(
      fetchGoogleMapsReading(19.3983, -99.1918, 19.4147, -99.0790, 'test-key'),
    ).rejects.toThrow('no routes returned')
  })
})
```

Also update the import at the top of the test file — remove `fetchWazeReading`, add `fetchGoogleMapsReading`:

```ts
import { fetchWeatherReading, fetchTomorrowReading, fetchGoogleMapsReading } from '@/lib/oracle/fetcher'
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx vitest run tests/lib/oracle/fetcher.test.ts`
Expected: `fetchGoogleMapsReading` tests FAIL with "fetchGoogleMapsReading is not a function" or similar. The existing `fetchWeatherReading` and `fetchTomorrowReading` tests should still PASS.

- [ ] **Step 3: Implement `fetchGoogleMapsReading` and delete `fetchWazeReading`**

Replace the entire `lib/oracle/fetcher.ts` with:

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

export async function fetchGoogleMapsReading(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  apiKey: string,
): Promise<FetchedReading> {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.duration,routes.staticDuration',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
      destination: { location: { latLng: { latitude: destLat, longitude: destLng } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
    }),
  })

  if (!res.ok) throw new Error(`Google Maps Routes API error: ${res.status}`)

  const data = await res.json()
  const route = (data.routes as Array<{ duration: string; staticDuration: string }>)?.[0]
  if (!route) throw new Error('Google Maps Routes API: no routes returned')

  const durationS = parseInt(route.duration.replace('s', ''), 10)
  const staticDurationS = parseInt(route.staticDuration.replace('s', ''), 10)

  if (!staticDurationS) throw new Error('Google Maps Routes API: zero static duration')

  const rawIndex = ((durationS / staticDurationS) - 1) * 100
  const traffic_index = Math.min(100, Math.max(0, Math.round(rawIndex)))

  return {
    source: 'google_maps',
    reading_type: 'traffic',
    value: { traffic_index, duration_s: durationS, static_duration_s: staticDurationS },
  }
}
```

- [ ] **Step 4: Run all fetcher tests**

Run: `npx vitest run tests/lib/oracle/fetcher.test.ts`
Expected: ALL PASS — no Waze tests (deleted), all Google Maps tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/fetcher.ts tests/lib/oracle/fetcher.test.ts
git commit -m "feat: replace Waze stub with Google Maps Routes API fetcher"
```

---

## Task 4: Update Poll Orchestrator

**Files:**
- Modify: `lib/oracle/poll.ts`
- Modify: `tests/lib/oracle/poll.test.ts`

- [ ] **Step 1: Write failing tests for window guard**

The window guard lives in `pollContracts` (not `defaultFetcher`), so tests use fake timers to control "now" and verify whether the mock fetcher is called at all.

Add these two tests to the `describe('pollContracts', ...)` block in `tests/lib/oracle/poll.test.ts`. Add them before the closing `})`:

```ts
  it('skips urban contract when outside its corridor window', async () => {
    // 2026-05-26T20:00:00Z = 14:00 Mexico City (UTC-6) → outside 07:00–10:00 window
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T20:00:00.000Z'))

    const urbanContract: Contract = {
      ...mockContract,
      id: 'u1',
      trigger_type: 'urban',
      corridor: {
        id: 'cor1', slug: 'viaducto-am', name: 'Viaducto AM', road: 'Viaducto',
        origin_lat: 19.3983, origin_lng: -99.1918,
        dest_lat: 19.4147, dest_lng: -99.0790,
        window_start: '07:00:00', window_end: '10:00:00', created_at: '',
      },
    }
    const db = makeDb({ contracts: [urbanContract] })
    const mockFetcher = vi.fn()

    const count = await pollContracts(db as never, mockFetcher)
    expect(count).toBe(0)
    expect(mockFetcher).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('polls urban contract when inside its corridor window', async () => {
    // 2026-05-26T14:00:00Z = 08:00 Mexico City (UTC-6) → inside 07:00–10:00 window
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T14:00:00.000Z'))

    const urbanContract: Contract = {
      ...mockContract,
      id: 'u2',
      trigger_type: 'urban',
      trigger_condition: { metric: 'traffic_index', threshold: 50, operator: 'gt' },
      corridor: {
        id: 'cor2', slug: 'viaducto-am', name: 'Viaducto AM', road: 'Viaducto',
        origin_lat: 19.3983, origin_lng: -99.1918,
        dest_lat: 19.4147, dest_lng: -99.0790,
        window_start: '07:00:00', window_end: '10:00:00', created_at: '',
      },
    }
    const db = makeDb({ contracts: [urbanContract] })
    const mockFetcher = vi.fn().mockResolvedValue([{
      source: 'google_maps',
      reading_type: 'traffic',
      value: { traffic_index: 60, duration_s: 1800, static_duration_s: 1200 },
    }])

    const count = await pollContracts(db as never, mockFetcher)
    expect(count).toBe(1)
    expect(mockFetcher).toHaveBeenCalledWith(
      expect.objectContaining({ trigger_type: 'urban' }),
    )
    expect(db._insert.mock.calls[0][0]).toMatchObject({
      source: 'google_maps',
      trigger_met: true,
    })

    vi.useRealTimers()
  })
```

- [ ] **Step 2: Run tests to confirm the new ones fail**

Run: `npx vitest run tests/lib/oracle/poll.test.ts`
Expected: the two new tests FAIL (window guard not implemented yet). Existing tests PASS.

- [ ] **Step 3: Implement the window guard and updated fetcher in `lib/oracle/poll.ts`**

The window guard lives in `pollContracts` (not `defaultFetcher`) so it is exercised even when tests inject a mock fetcher. `defaultFetcher` only deals with API calls.

Replace the entire file:

```ts
import { createClient } from '@supabase/supabase-js'
import { evaluateTrigger, type TriggerCondition } from './trigger'
import { fetchWeatherReading, fetchTomorrowReading, fetchGoogleMapsReading } from './fetcher'
import type { Contract, Corridor } from '@/lib/types'

interface FetchedReading {
  source: string
  reading_type: string
  value: Record<string, unknown>
}

type ReadingFetcher = (contract: Contract) => Promise<FetchedReading[]>

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

function isWithinWindow(windowStart: string, windowEnd: string): boolean {
  // Mexico City abolished DST in 2023 — permanently UTC-6.
  const mexicoCityTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())

  const [nowH, nowM] = mexicoCityTime.split(':').map(Number)
  const nowMinutes = nowH * 60 + nowM
  const [startH, startM] = windowStart.substring(0, 5).split(':').map(Number)
  const [endH, endM] = windowEnd.substring(0, 5).split(':').map(Number)
  return nowMinutes >= startH * 60 + startM && nowMinutes < endH * 60 + endM
}

async function defaultFetcher(contract: Contract): Promise<FetchedReading[]> {
  if (contract.trigger_type === 'weather') {
    const readings: FetchedReading[] = []
    const { lat, lng } = contract.location

    const owmKey = process.env.OPENWEATHERMAP_API_KEY ?? ''
    if (owmKey) {
      try {
        readings.push(await fetchWeatherReading(lat, lng, owmKey))
      } catch (err) {
        console.error(`OpenWeatherMap fetch error for contract ${contract.id}:`, err)
      }
    }

    const tioKey = process.env.TOMORROW_IO_API_KEY ?? ''
    if (tioKey) {
      try {
        readings.push(await fetchTomorrowReading(lat, lng, tioKey))
      } catch (err) {
        console.error(`Tomorrow.io fetch error for contract ${contract.id}:`, err)
      }
    }

    return readings
  }

  if (contract.trigger_type === 'urban') {
    const corridor = contract.corridor as Corridor | null
    if (!corridor) return []

    const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? ''
    if (!apiKey) return []

    try {
      return [await fetchGoogleMapsReading(
        corridor.origin_lat, corridor.origin_lng,
        corridor.dest_lat, corridor.dest_lng,
        apiKey,
      )]
    } catch (err) {
      console.error(`Google Maps fetch error for contract ${contract.id}:`, err)
      return []
    }
  }

  return []
}

export async function pollContracts(
  db: DbClient = getClient(),
  readingFetcher: ReadingFetcher = defaultFetcher,
): Promise<number> {
  const { data: contracts } = await db
    .from('contracts')
    .select('*, corridor:corridors(*)')
    .eq('status', 'active')
    .is('settled_outcome', null)
    .in('trigger_type', ['weather', 'urban'])

  if (!contracts || contracts.length === 0) return 0

  let count = 0
  for (const contract of contracts as Contract[]) {
    try {
      // Urban contracts: skip if no corridor or outside the active window
      if (contract.trigger_type === 'urban') {
        const corridor = contract.corridor as Corridor | null
        if (!corridor) continue
        if (!isWithinWindow(corridor.window_start, corridor.window_end)) continue
      }

      const readings = await readingFetcher(contract)
      if (!readings || readings.length === 0) continue

      const condition = contract.trigger_condition as unknown as TriggerCondition

      for (const reading of readings) {
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
      }
      count++
    } catch {
      console.error(`Oracle poll error for contract ${contract.id}`)
    }
  }
  return count
}
```

- [ ] **Step 4: Run all poll tests**

Run: `npx vitest run tests/lib/oracle/poll.test.ts`
Expected: ALL 8 tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/oracle/poll.ts tests/lib/oracle/poll.test.ts
git commit -m "feat: add corridor window guard and Google Maps fetcher to poll orchestrator"
```

---

## Task 5: Seed 12 Corridor Contracts

**Files:**
- Create: `supabase/migrations/20260526000003_seed_corridor_contracts.sql`

- [ ] **Step 1: Write the seed migration**

Create `supabase/migrations/20260526000003_seed_corridor_contracts.sql`:

```sql
-- Seed 12 urban contracts referencing CDMX corridors.
-- Threshold > 50 means travel time is 50%+ worse than free-flow.
-- Intentionally set low for early product validation — hedgers should experience payouts.

DO $$
DECLARE
  admin_id uuid := '58bbb04f-333c-4ffd-92c3-89f994586e23';
  urban_cat uuid;

  -- corridor ids resolved by slug
  cor_viaducto_am        uuid;
  cor_viaducto_pm        uuid;
  cor_bicentenario_am    uuid;
  cor_bicentenario_pm    uuid;
  cor_periferico_n_am    uuid;
  cor_periferico_n_pm    uuid;
  cor_periferico_s_am    uuid;
  cor_periferico_s_pm    uuid;
  cor_reforma_am         uuid;
  cor_reforma_pm         uuid;
  cor_palmas_am          uuid;
  cor_palmas_pm          uuid;

  -- contract ids (deterministic UUIDs for idempotency)
  c_viaducto_am       uuid := 'bbbbbbbb-0001-0000-0000-000000000001';
  c_viaducto_pm       uuid := 'bbbbbbbb-0001-0000-0000-000000000002';
  c_bicentenario_am   uuid := 'bbbbbbbb-0002-0000-0000-000000000001';
  c_bicentenario_pm   uuid := 'bbbbbbbb-0002-0000-0000-000000000002';
  c_periferico_n_am   uuid := 'bbbbbbbb-0003-0000-0000-000000000001';
  c_periferico_n_pm   uuid := 'bbbbbbbb-0003-0000-0000-000000000002';
  c_periferico_s_am   uuid := 'bbbbbbbb-0004-0000-0000-000000000001';
  c_periferico_s_pm   uuid := 'bbbbbbbb-0004-0000-0000-000000000002';
  c_reforma_am        uuid := 'bbbbbbbb-0005-0000-0000-000000000001';
  c_reforma_pm        uuid := 'bbbbbbbb-0005-0000-0000-000000000002';
  c_palmas_am         uuid := 'bbbbbbbb-0006-0000-0000-000000000001';
  c_palmas_pm         uuid := 'bbbbbbbb-0006-0000-0000-000000000002';

BEGIN
  SELECT id INTO urban_cat FROM categories WHERE slug = 'urban';

  SELECT id INTO cor_viaducto_am     FROM corridors WHERE slug = 'viaducto-am';
  SELECT id INTO cor_viaducto_pm     FROM corridors WHERE slug = 'viaducto-pm';
  SELECT id INTO cor_bicentenario_am FROM corridors WHERE slug = 'bicentenario-am';
  SELECT id INTO cor_bicentenario_pm FROM corridors WHERE slug = 'bicentenario-pm';
  SELECT id INTO cor_periferico_n_am FROM corridors WHERE slug = 'periferico-norte-am';
  SELECT id INTO cor_periferico_n_pm FROM corridors WHERE slug = 'periferico-norte-pm';
  SELECT id INTO cor_periferico_s_am FROM corridors WHERE slug = 'periferico-sur-am';
  SELECT id INTO cor_periferico_s_pm FROM corridors WHERE slug = 'periferico-sur-pm';
  SELECT id INTO cor_reforma_am      FROM corridors WHERE slug = 'reforma-am';
  SELECT id INTO cor_reforma_pm      FROM corridors WHERE slug = 'reforma-pm';
  SELECT id INTO cor_palmas_am       FROM corridors WHERE slug = 'palmas-am';
  SELECT id INTO cor_palmas_pm       FROM corridors WHERE slug = 'palmas-pm';

  INSERT INTO contracts (
    id, slug, title, description, category_id, status,
    trigger_type, trigger_condition, trigger_deadline,
    location, corridor_id, total_volume_usd, total_volume_mxn,
    is_featured, created_by
  ) VALUES

  (c_viaducto_am, 'viaducto-oriente-manana',
   'Viaducto Oriente — Protección Mañana',
   'Cobertura para el trayecto Constituyentes → Aeropuerto por el Viaducto Miguel Alemán durante la mañana. Paga si el tiempo de traslado supera 50% del normal.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than normal"}',
   '2026-12-31 10:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.3983,"lng":-99.1918}',
   cor_viaducto_am, 0, 0, true, admin_id),

  (c_viaducto_pm, 'viaducto-poniente-tarde',
   'Viaducto Poniente — Protección Tarde',
   'Cobertura para el trayecto Aeropuerto → Constituyentes por el Viaducto Miguel Alemán durante la tarde. Paga si el tiempo de traslado supera 50% del normal.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than normal"}',
   '2026-12-31 20:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.4147,"lng":-99.0790}',
   cor_viaducto_pm, 0, 0, false, admin_id),

  (c_bicentenario_am, 'bicentenario-sur-manana',
   'Bicentenario Sur — Protección Mañana',
   'Cobertura del Circuito Bicentenario en dirección sur durante la mañana.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than normal"}',
   '2026-12-31 10:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.4487,"lng":-99.1374}',
   cor_bicentenario_am, 0, 0, false, admin_id),

  (c_bicentenario_pm, 'bicentenario-norte-tarde',
   'Bicentenario Norte — Protección Tarde',
   'Cobertura del Circuito Bicentenario en dirección norte durante la tarde.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than normal"}',
   '2026-12-31 20:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.3749,"lng":-99.1836}',
   cor_bicentenario_pm, 0, 0, false, admin_id),

  (c_periferico_n_am, 'periferico-norte-centro-manana',
   'Periférico Norte → Centro — Protección Mañana',
   'Cobertura de Cuatro Caminos hacia Constituyentes por Periférico Norte durante la mañana.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than normal"}',
   '2026-12-31 10:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.4726,"lng":-99.1758}',
   cor_periferico_n_am, 0, 0, false, admin_id),

  (c_periferico_n_pm, 'periferico-norte-cuatro-caminos-tarde',
   'Periférico Norte → Cuatro Caminos — Protección Tarde',
   'Cobertura de Constituyentes hacia Cuatro Caminos por Periférico Norte durante la tarde.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than normal"}',
   '2026-12-31 20:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.4153,"lng":-99.2054}',
   cor_periferico_n_pm, 0, 0, false, admin_id),

  (c_periferico_s_am, 'periferico-sur-centro-manana',
   'Periférico Sur → Centro — Protección Mañana',
   'Cobertura del Estadio Azteca hacia Insurgentes Sur por Periférico Sur durante la mañana.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than normal"}',
   '2026-12-31 10:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.3030,"lng":-99.1507}',
   cor_periferico_s_am, 0, 0, false, admin_id),

  (c_periferico_s_pm, 'periferico-sur-azteca-tarde',
   'Periférico Sur → Azteca — Protección Tarde',
   'Cobertura de Insurgentes Sur hacia Estadio Azteca por Periférico Sur durante la tarde.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than normal"}',
   '2026-12-31 20:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.3601,"lng":-99.1733}',
   cor_periferico_s_pm, 0, 0, false, admin_id),

  (c_reforma_am, 'reforma-alameda-manana',
   'Reforma → Alameda — Protección Mañana',
   'Cobertura del Paseo de la Reforma de Observatorio hacia Alameda Central durante la mañana.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than normal"}',
   '2026-12-31 10:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.4001,"lng":-99.1892}',
   cor_reforma_am, 0, 0, true, admin_id),

  (c_reforma_pm, 'reforma-observatorio-tarde',
   'Reforma → Observatorio — Protección Tarde',
   'Cobertura del Paseo de la Reforma de Alameda Central hacia Observatorio durante la tarde.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than normal"}',
   '2026-12-31 20:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.4354,"lng":-99.1452}',
   cor_reforma_pm, 0, 0, false, admin_id),

  (c_palmas_am, 'palmas-reforma-manana',
   'Palmas → Reforma — Protección Mañana',
   'Cobertura de Av. de las Palmas de Bosques de las Lomas hacia Fuente de Petróleos durante la mañana.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than normal"}',
   '2026-12-31 10:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.4218,"lng":-99.2519}',
   cor_palmas_am, 0, 0, false, admin_id),

  (c_palmas_pm, 'palmas-bosques-tarde',
   'Palmas → Bosques — Protección Tarde',
   'Cobertura de Av. de las Palmas de Fuente de Petróleos hacia Bosques de las Lomas durante la tarde.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than normal"}',
   '2026-12-31 20:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.4199,"lng":-99.2138}',
   cor_palmas_pm, 0, 0, false, admin_id);

  -- Coverage tiers for all 12 contracts
  INSERT INTO coverage_tiers (contract_id, name, premium_usd, payout_usd, premium_mxn, payout_mxn, max_capacity_usd, base_probability)
  SELECT id, 'basic',   29,  500,  493, 8500,  50000, 0.35 FROM contracts WHERE id IN (c_viaducto_am, c_viaducto_pm, c_bicentenario_am, c_bicentenario_pm, c_periferico_n_am, c_periferico_n_pm, c_periferico_s_am, c_periferico_s_pm, c_reforma_am, c_reforma_pm, c_palmas_am, c_palmas_pm)
  UNION ALL
  SELECT id, 'premium', 89, 2000, 1513, 34000, 50000, 0.35 FROM contracts WHERE id IN (c_viaducto_am, c_viaducto_pm, c_bicentenario_am, c_bicentenario_pm, c_periferico_n_am, c_periferico_n_pm, c_periferico_s_am, c_periferico_s_pm, c_reforma_am, c_reforma_pm, c_palmas_am, c_palmas_pm);

END $$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260526000003_seed_corridor_contracts.sql
git commit -m "feat: seed 12 CDMX corridor urban contracts"
```

---

## Task 6: Update Cron Schedule

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Update the oracle-poll cron**

In `vercel.json`, change the `oracle-poll` schedule from `"0 0 * * *"` to `"*/10 * * * *"`:

```json
{
  "crons": [
    {
      "path": "/api/reprice",
      "schedule": "0 0 * * *"
    },
    {
      "path": "/api/oracle-poll",
      "schedule": "*/10 * * * *"
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
git commit -m "chore: set oracle-poll cron to every 10 minutes"
```

---

## Task 7: Install Google Maps JS Loader

- [ ] **Step 1: Install the package**

Run: `npm install @googlemaps/js-api-loader`
Run: `npm install --save-dev @types/google.maps`

Expected: both install without errors. `package.json` is updated.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @googlemaps/js-api-loader dependency"
```

---

## Task 8: TrafficPulseBar Components

**Files:**
- Create: `components/markets/TrafficPulseBar.tsx`
- Create: `components/markets/TrafficPulseBarRefresher.tsx`

- [ ] **Step 1: Create `components/markets/TrafficPulseBar.tsx`**

```tsx
import { cn } from '@/lib/utils'
import type { OracleReading } from '@/lib/types'

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function nextWindowLabel(windowStart: string): string {
  return `Next window opens at ${windowStart.substring(0, 5)}`
}

function isCurrentlyInWindow(windowStart: string, windowEnd: string): boolean {
  const now = new Date()
  const mexicoCityTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
  const [nowH, nowM] = mexicoCityTime.split(':').map(Number)
  const nowMinutes = nowH * 60 + nowM
  const [startH, startM] = windowStart.substring(0, 5).split(':').map(Number)
  const [endH, endM] = windowEnd.substring(0, 5).split(':').map(Number)
  return nowMinutes >= startH * 60 + startM && nowMinutes < endH * 60 + endM
}

export function TrafficPulseBar({
  readings,
  threshold,
  windowStart,
  windowEnd,
  triggerDescription,
}: {
  readings: OracleReading[]
  threshold: number
  windowStart: string
  windowEnd: string
  triggerDescription: string
}) {
  const latest = readings[0] ?? null
  const currentIndex = latest
    ? Number((latest.value as Record<string, unknown>).traffic_index ?? 0)
    : null
  const inWindow = isCurrentlyInWindow(windowStart, windowEnd)
  const isTriggered = currentIndex !== null && currentIndex > threshold

  const barColor =
    currentIndex === null ? 'bg-white/10'
    : currentIndex > threshold ? 'bg-red-500'
    : currentIndex > threshold * 0.6 ? 'bg-yellow-400'
    : 'bg-emerald-400'

  const sparkValues = readings
    .slice(0, 6)
    .reverse()
    .map((r) => Number((r.value as Record<string, unknown>).traffic_index ?? 0))

  const sparkMax = Math.max(...sparkValues, threshold, 1)

  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-insu-muted">Tráfico en vivo</p>
          <p className="mt-0.5 text-[12px] text-insu-dim">{triggerDescription}</p>
        </div>
        <div className="flex items-center gap-2">
          {isTriggered && (
            <span className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-red-400">
              ⚡ TRIGGER ACTIVE
            </span>
          )}
          {latest && (
            <span className="text-[10px] text-insu-muted">{timeAgo(latest.read_at)}</span>
          )}
        </div>
      </div>

      {/* Pulse bar */}
      <div className="relative mb-3 h-3 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-700', barColor,
            !inWindow && 'opacity-30')}
          style={{ width: currentIndex !== null ? `${currentIndex}%` : '0%' }}
        />
        {/* Threshold marker */}
        <div
          className="absolute inset-y-0 w-px bg-white/40"
          style={{ left: `${threshold}%` }}
        />
      </div>

      <div className="mb-3 flex items-center justify-between text-[10px]">
        <span className="text-insu-muted">0</span>
        <span className={cn('font-semibold tabular-nums', isTriggered ? 'text-red-400' : 'text-insu-text')}>
          {currentIndex !== null
            ? inWindow ? `${currentIndex} / 100` : `${currentIndex} (fuera de ventana)`
            : '—'}
        </span>
        <span className="text-insu-muted">100</span>
      </div>

      {/* Sparkline */}
      {sparkValues.length > 0 && (
        <div className="relative flex h-8 items-end gap-0.5">
          {/* Threshold dashed line */}
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-insu-accent/40"
            style={{ bottom: `${(threshold / sparkMax) * 100}%` }}
          />
          {sparkValues.map((val, i) => {
            const heightPct = sparkMax > 0 ? Math.max(4, (val / sparkMax) * 100) : 4
            const triggered = val > threshold
            return (
              <div
                key={i}
                className={cn(
                  'flex-1 rounded-sm transition-all',
                  triggered ? 'bg-red-500/60' : 'bg-insu-accent/30',
                )}
                style={{ height: `${heightPct}%` }}
              />
            )
          })}
        </div>
      )}

      {!inWindow && (
        <p className="mt-2 text-center text-[10px] text-insu-muted">
          {nextWindowLabel(windowStart)}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `components/markets/TrafficPulseBarRefresher.tsx`**

```tsx
'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function TrafficPulseBarRefresher() {
  const router = useRouter()

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 10 * 60 * 1000)
    return () => clearInterval(id)
  }, [router])

  return null
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add components/markets/TrafficPulseBar.tsx components/markets/TrafficPulseBarRefresher.tsx
git commit -m "feat: add TrafficPulseBar and auto-refresh client component"
```

---

## Task 9: CorridorMap Component

**Files:**
- Create: `components/markets/CorridorMap.tsx`

- [ ] **Step 1: Create `components/markets/CorridorMap.tsx`**

```tsx
'use client'

import { useEffect, useRef } from 'react'
import { Loader } from '@googlemaps/js-api-loader'

const DARK_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2d2d44' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#373769' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3c3c6e' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e1626' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]

export function CorridorMap({
  originLat,
  originLng,
  destLat,
  destLng,
  corridorName,
}: {
  originLat: number
  originLng: number
  destLat: number
  destLng: number
  corridorName: string
}) {
  const mapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
    if (!apiKey || !mapRef.current) return

    const loader = new Loader({ apiKey, version: 'weekly' })

    loader.load().then((google) => {
      if (!mapRef.current) return

      const midLat = (originLat + destLat) / 2
      const midLng = (originLng + destLng) / 2

      const map = new google.maps.Map(mapRef.current, {
        center: { lat: midLat, lng: midLng },
        zoom: 12,
        gestureHandling: 'none',
        zoomControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: false,
        styles: DARK_STYLE,
      })

      new google.maps.TrafficLayer().setMap(map)

      new google.maps.Polyline({
        path: [
          { lat: originLat, lng: originLng },
          { lat: destLat, lng: destLng },
        ],
        geodesic: true,
        strokeColor: '#818cf8',
        strokeOpacity: 0.9,
        strokeWeight: 4,
        map,
      })

      new google.maps.Marker({
        position: { lat: originLat, lng: originLng },
        map,
        title: 'Origen',
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: '#818cf8',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      })

      new google.maps.Marker({
        position: { lat: destLat, lng: destLng },
        map,
        title: 'Destino',
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: '#f43f5e',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      })
    })
  }, [originLat, originLng, destLat, destLng])

  const mapsUrl = `https://www.google.com/maps/dir/${originLat},${originLng}/${destLat},${destLng}`

  return (
    <div className="overflow-hidden rounded-lg border border-white/[0.07]">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2">
        <p className="text-[11px] text-insu-muted">
          <span className="mr-1">📍</span>{corridorName} — tráfico en tiempo real
        </p>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-insu-accent hover:underline"
        >
          Abrir en Google Maps ↗
        </a>
      </div>
      <div ref={mapRef} className="h-48 w-full" />
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add components/markets/CorridorMap.tsx
git commit -m "feat: add CorridorMap client component with Google Maps traffic layer"
```

---

## Task 10: Wire Up Contract Detail Page

**Files:**
- Modify: `app/markets/[slug]/page.tsx`

- [ ] **Step 1: Update `app/markets/[slug]/page.tsx`**

Replace the entire file:

```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import ContractDetailClient from '@/components/markets/ContractDetailClient'
import { TrafficPulseBar } from '@/components/markets/TrafficPulseBar'
import { TrafficPulseBarRefresher } from '@/components/markets/TrafficPulseBarRefresher'
import { CorridorMap } from '@/components/markets/CorridorMap'
import type { ContractDetailData, LatestOracleReading, OracleReading, Corridor } from '@/lib/types'

export default async function MarketPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const isConfigured = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  if (!isConfigured) notFound()

  const supabase = await createClient()

  const [contractResult, userResult] = await Promise.all([
    supabase
      .from('contracts')
      .select(`
        *,
        category:categories(*),
        coverage_tiers(*),
        pricing_history(id, tier_id, premium_usd_after, calculated_at),
        corridor:corridors(*)
      `)
      .eq('slug', slug)
      .in('status', ['active', 'settled'])
      .single(),
    supabase.auth.getUser(),
  ])

  const contractData = contractResult.data
  if (contractResult.error || !contractData) notFound()

  const contract = contractData as unknown as ContractDetailData
  const userId = userResult.data.user?.id ?? null

  const [latestReadingResult, sparklineResult] = await Promise.all([
    supabase
      .from('oracle_readings')
      .select('value, read_at, source, trigger_met')
      .eq('contract_id', contract.id)
      .order('read_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    contract.trigger_type === 'urban'
      ? supabase
          .from('oracle_readings')
          .select('*')
          .eq('contract_id', contract.id)
          .order('read_at', { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null, error: null }),
  ])

  if (latestReadingResult.error) {
    console.error('[MarketPage] oracle fetch failed:', latestReadingResult.error.message)
  }

  const latestReading = latestReadingResult.data as LatestOracleReading | null
  const sparklineReadings = (sparklineResult.data ?? []) as OracleReading[]
  const corridor = contract.corridor as Corridor | null

  const triggerCondition = contract.trigger_condition as Record<string, unknown>

  return (
    <>
      <Header />
      {contract.trigger_type === 'urban' && corridor && (
        <div className="mx-auto max-w-4xl space-y-3 px-4 pb-2 pt-4">
          <TrafficPulseBar
            readings={sparklineReadings}
            threshold={Number(triggerCondition.threshold ?? 50)}
            windowStart={corridor.window_start}
            windowEnd={corridor.window_end}
            triggerDescription={String(triggerCondition.description ?? '')}
          />
          <CorridorMap
            originLat={corridor.origin_lat}
            originLng={corridor.origin_lng}
            destLat={corridor.dest_lat}
            destLng={corridor.dest_lng}
            corridorName={corridor.name}
          />
          <TrafficPulseBarRefresher />
        </div>
      )}
      <ContractDetailClient contract={contract} userId={userId} latestReading={latestReading} />
    </>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests PASS.

- [ ] **Step 4: Commit**

```bash
git add app/markets/[slug]/page.tsx
git commit -m "feat: render TrafficPulseBar and CorridorMap on corridor contract detail page"
```

---

## Environment Variables

Add these to `.env.local` for local development and to Vercel project settings for production:

```
# Server-only — Google Maps Routes API (oracle polling)
GOOGLE_MAPS_API_KEY=your_server_side_key_here

# Client-exposed — Google Maps JavaScript API (map embed)
# Restrict this key to HTTP referrers: your-domain.com/* and localhost:3000/*
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_client_side_key_here
```

Both keys live in the same Google Cloud project. Create them at console.cloud.google.com → APIs & Services → Credentials. Enable "Routes API" for the server key and "Maps JavaScript API" for the client key. Set HTTP referrer restrictions on the client key.

---

## Applying DB Migrations

After committing all tasks, apply migrations in order to your Supabase instance:

```bash
npx supabase db push
```

Or apply manually via the Supabase SQL editor in this order:
1. `20260526000001_add_corridors.sql`
2. `20260526000002_seed_corridors.sql`
3. `20260526000003_seed_corridor_contracts.sql`
