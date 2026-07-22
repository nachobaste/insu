# TomTom Read-Only Cross-Check Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shadow the live Google traffic oracle with TomTom routing + incident data, recorded to an isolated table, so we can compare sources offline — with zero production behavior change.

**Architecture:** A fully separate path parallel to `lib/oracle/poll.ts` → `/api/oracle-poll`. Pure fetchers in `lib/oracle/tomtomFetcher.ts`, orchestration in `lib/oracle/crosscheck.ts` (dependency-injectable like `pollContracts`), a cron-authed endpoint `/api/tomtom-crosscheck`, and a read-only report script. Writes only to the new `tomtom_crosscheck` table, which nothing in the trigger/pricing/`dailySeries` pipeline reads.

**Tech Stack:** Next.js App Router (route handlers), Supabase (`@supabase/supabase-js`), Vitest, TomTom Routing v1 + Traffic Incidents v5, Node ESM ops script.

**Spec:** `docs/superpowers/specs/2026-07-21-tomtom-crosscheck-spike-design.md`

**Branch:** `spike/tomtom-crosscheck` (already checked out; `TOMTOM_API_KEY` already in `.env.local` + Vercel prod/dev).

---

## File Structure

- **Create** `supabase/migrations/20260721000001_tomtom_crosscheck.sql` — the isolated shadow table.
- **Create** `lib/oracle/tomtomFetcher.ts` — pure TomTom fetch + normalize (route + incidents). No DB.
- **Create** `lib/oracle/crosscheck.ts` — `runTomTomCrossCheck(db, deps)` orchestration.
- **Modify** `lib/oracle/poll.ts` — export the existing `isWithinWindow` helper for reuse (one word: add `export`).
- **Create** `app/api/tomtom-crosscheck/route.ts` — cron-authed thin wrapper.
- **Create** `scripts/tomtom-crosscheck-report.mjs` — read-only analysis ("read the spike").
- **Create** tests: `tests/lib/oracle/tomtomFetcher.test.ts`, `tests/lib/oracle/crosscheck.test.ts`, `tests/api/tomtom-crosscheck.test.ts`.

---

## Task 1: Migration — isolated `tomtom_crosscheck` table

**Files:**
- Create: `supabase/migrations/20260721000001_tomtom_crosscheck.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Read-only shadow table for the TomTom cross-check spike. NOTHING in the live
-- trigger/pricing/dailySeries pipeline reads this table; it only records TomTom
-- routing + incident data alongside a snapshot of the matching Google reading so
-- we can compare sources offline.
-- Spec: docs/superpowers/specs/2026-07-21-tomtom-crosscheck-spike-design.md
CREATE TABLE IF NOT EXISTS tomtom_crosscheck (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corridor_id           uuid REFERENCES corridors(id),
  captured_at           timestamptz NOT NULL DEFAULT now(),
  in_window             boolean,
  tomtom_covered        boolean,
  tt_live_s             integer,
  tt_free_flow_s        integer,
  tt_historic_s         integer,
  tt_delay_s            integer,
  tt_index_vs_historic  numeric,
  tt_index_vs_free_flow numeric,
  tt_incident_count     integer,
  tt_incidents          jsonb,
  tt_max_magnitude      integer,
  google_duration_s     integer,
  google_baseline_s     integer,
  google_traffic_index  numeric,
  google_reading_at     timestamptz,
  raw                   jsonb
);

CREATE INDEX IF NOT EXISTS tomtom_crosscheck_corridor_captured_idx
  ON tomtom_crosscheck (corridor_id, captured_at DESC);
```

- [ ] **Step 2: Verify SQL parses locally (no apply yet)**

Run: `grep -c "CREATE" supabase/migrations/20260721000001_tomtom_crosscheck.sql`
Expected: `2`
(Applying to prod happens in Task 7 via `supabase db push --linked`.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260721000001_tomtom_crosscheck.sql
git commit -m "feat(spike): add isolated tomtom_crosscheck table"
```

---

## Task 2: `fetchTomTomRoute` — normalize TomTom routing summary

**Files:**
- Create: `lib/oracle/tomtomFetcher.ts`
- Test: `tests/lib/oracle/tomtomFetcher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchTomTomRoute } from '@/lib/oracle/tomtomFetcher'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const routeSummary = {
  travelTimeInSeconds: 1712,
  noTrafficTravelTimeInSeconds: 1572,
  historicTrafficTravelTimeInSeconds: 1600,
  trafficDelayInSeconds: 40,
}

describe('fetchTomTomRoute', () => {
  beforeEach(() => mockFetch.mockReset())

  it('calls calculateRoute with origin:dest and computeTravelTimeFor=all', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ routes: [{ summary: routeSummary }] }) })
    await fetchTomTomRoute(19.41, -99.20, 19.47, -99.17, 'k')
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('/routing/1/calculateRoute/19.41,-99.2:19.47,-99.17/json')
    expect(url).toContain('computeTravelTimeFor=all')
    expect(url).toContain('key=k')
  })

  it('normalizes the summary and computes both indices', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ routes: [{ summary: routeSummary }] }) })
    const r = await fetchTomTomRoute(19.41, -99.20, 19.47, -99.17, 'k')
    expect(r.covered).toBe(true)
    expect(r.liveS).toBe(1712)
    expect(r.freeFlowS).toBe(1572)
    expect(r.historicS).toBe(1600)
    expect(r.delayS).toBe(40)
    // trafficIndex(1712, 1600) = round((1712/1600 - 1)*100) = 7
    expect(r.indexVsHistoric).toBe(7)
    // trafficIndex(1712, 1572) = round((1712/1572 - 1)*100) = 9
    expect(r.indexVsFreeFlow).toBe(9)
  })

  it('returns covered=false with null fields when no route present', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ routes: [] }) })
    const r = await fetchTomTomRoute(19.41, -99.20, 19.47, -99.17, 'k')
    expect(r.covered).toBe(false)
    expect(r.liveS).toBeNull()
    expect(r.indexVsHistoric).toBeNull()
  })

  it('throws on non-ok HTTP status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 })
    await expect(fetchTomTomRoute(19.41, -99.20, 19.47, -99.17, 'k')).rejects.toThrow('403')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/oracle/tomtomFetcher.test.ts`
Expected: FAIL — cannot resolve `@/lib/oracle/tomtomFetcher`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/oracle/tomtomFetcher.ts`:

```typescript
import { trafficIndex } from './trafficIndex'

const ROUTING_BASE = 'https://api.tomtom.com/routing/1/calculateRoute'

export interface TomTomRouteReading {
  covered: boolean
  liveS: number | null
  freeFlowS: number | null
  historicS: number | null
  delayS: number | null
  indexVsHistoric: number | null
  indexVsFreeFlow: number | null
  raw: unknown
}

const EMPTY_ROUTE: Omit<TomTomRouteReading, 'raw'> = {
  covered: false, liveS: null, freeFlowS: null, historicS: null,
  delayS: null, indexVsHistoric: null, indexVsFreeFlow: null,
}

/** Normalized "no route" reading — reused by the orchestrator's error path. */
export function emptyRoute(raw: unknown = null): TomTomRouteReading {
  return { ...EMPTY_ROUTE, raw }
}

export async function fetchTomTomRoute(
  originLat: number, originLng: number,
  destLat: number, destLng: number,
  apiKey: string,
): Promise<TomTomRouteReading> {
  const path = `${originLat},${originLng}:${destLat},${destLng}`
  const url = `${ROUTING_BASE}/${path}/json?computeTravelTimeFor=all&key=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`TomTom Routing error: ${res.status}`)
  const data = await res.json()
  const summary = data?.routes?.[0]?.summary as Record<string, number> | undefined
  if (!summary || typeof summary.travelTimeInSeconds !== 'number') return emptyRoute(data)

  const liveS = summary.travelTimeInSeconds
  const freeFlowS = summary.noTrafficTravelTimeInSeconds ?? null
  const historicS = summary.historicTrafficTravelTimeInSeconds ?? null
  return {
    covered: true,
    liveS,
    freeFlowS,
    historicS,
    delayS: summary.trafficDelayInSeconds ?? null,
    indexVsHistoric: historicS ? trafficIndex(liveS, historicS) : null,
    indexVsFreeFlow: freeFlowS ? trafficIndex(liveS, freeFlowS) : null,
    raw: data,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/oracle/tomtomFetcher.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/tomtomFetcher.ts tests/lib/oracle/tomtomFetcher.test.ts
git commit -m "feat(spike): fetchTomTomRoute normalizes routing summary + indices"
```

---

## Task 3: `fetchTomTomIncidents` — count + categorize incidents on a bbox

**Files:**
- Modify: `lib/oracle/tomtomFetcher.ts`
- Test: `tests/lib/oracle/tomtomFetcher.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to the same file)**

```typescript
import { fetchTomTomIncidents } from '@/lib/oracle/tomtomFetcher'

describe('fetchTomTomIncidents', () => {
  beforeEach(() => mockFetch.mockReset())

  const bbox = { minLon: -99.2, minLat: 19.41, maxLon: -99.17, maxLat: 19.47 }

  it('sends the bbox and present filter', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ incidents: [] }) })
    await fetchTomTomIncidents(bbox, 'k')
    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain('/traffic/services/5/incidentDetails')
    expect(url).toContain('bbox=-99.2%2C19.41%2C-99.17%2C19.47')
    expect(url).toContain('timeValidityFilter=present')
  })

  it('counts incidents, breaks down by category, and takes max magnitude', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ incidents: [
      { properties: { iconCategory: 6, magnitudeOfDelay: 1 } },
      { properties: { iconCategory: 6, magnitudeOfDelay: 3 } },
      { properties: { iconCategory: 8, magnitudeOfDelay: 4 } },
    ] }) })
    const r = await fetchTomTomIncidents(bbox, 'k')
    expect(r.count).toBe(3)
    expect(r.byCategory).toEqual({ jam: 2, road_closed: 1 })
    expect(r.maxMagnitude).toBe(4)
  })

  it('returns zero-count with empty breakdown when no incidents', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ incidents: [] }) })
    const r = await fetchTomTomIncidents(bbox, 'k')
    expect(r.count).toBe(0)
    expect(r.byCategory).toEqual({})
    expect(r.maxMagnitude).toBeNull()
  })

  it('throws on non-ok HTTP status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429 })
    await expect(fetchTomTomIncidents(bbox, 'k')).rejects.toThrow('429')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/oracle/tomtomFetcher.test.ts`
Expected: FAIL — `fetchTomTomIncidents` is not exported.

- [ ] **Step 3: Write minimal implementation (append to `lib/oracle/tomtomFetcher.ts`)**

```typescript
export interface BBox { minLon: number; minLat: number; maxLon: number; maxLat: number }

export interface TomTomIncidentReading {
  count: number
  byCategory: Record<string, number>
  maxMagnitude: number | null
  raw: unknown
}

const INCIDENTS_BASE = 'https://api.tomtom.com/traffic/services/5/incidentDetails'
const INCIDENT_FIELDS =
  '{incidents{type,properties{iconCategory,magnitudeOfDelay,delay,length,startTime,endTime,roadNumbers}}}'

// iconCategory codes per TomTom Traffic Incidents v5.
const INCIDENT_CATEGORIES: Record<number, string> = {
  0: 'unknown', 1: 'accident', 2: 'fog', 3: 'dangerous_conditions', 4: 'rain',
  5: 'ice', 6: 'jam', 7: 'lane_closed', 8: 'road_closed', 9: 'road_works',
  10: 'wind', 11: 'flooding', 14: 'broken_down_vehicle',
}

export async function fetchTomTomIncidents(bbox: BBox, apiKey: string): Promise<TomTomIncidentReading> {
  const params = new URLSearchParams({
    key: apiKey,
    bbox: `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`,
    fields: INCIDENT_FIELDS,
    language: 'en-GB',
    timeValidityFilter: 'present',
  })
  const res = await fetch(`${INCIDENTS_BASE}?${params.toString()}`)
  if (!res.ok) throw new Error(`TomTom Incidents error: ${res.status}`)
  const data = await res.json()
  const incidents = (data?.incidents ?? []) as Array<{
    properties?: { iconCategory?: number; magnitudeOfDelay?: number }
  }>

  const byCategory: Record<string, number> = {}
  let maxMagnitude: number | null = null
  for (const inc of incidents) {
    const cat = INCIDENT_CATEGORIES[inc.properties?.iconCategory ?? 0] ?? 'unknown'
    byCategory[cat] = (byCategory[cat] ?? 0) + 1
    const mag = inc.properties?.magnitudeOfDelay
    if (typeof mag === 'number') maxMagnitude = maxMagnitude === null ? mag : Math.max(maxMagnitude, mag)
  }
  return { count: incidents.length, byCategory, maxMagnitude, raw: data }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/oracle/tomtomFetcher.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/tomtomFetcher.ts tests/lib/oracle/tomtomFetcher.test.ts
git commit -m "feat(spike): fetchTomTomIncidents counts + categorizes corridor incidents"
```

---

## Task 4: `runTomTomCrossCheck` — orchestration

**Files:**
- Modify: `lib/oracle/poll.ts` (export `isWithinWindow`)
- Create: `lib/oracle/crosscheck.ts`
- Test: `tests/lib/oracle/crosscheck.test.ts`

- [ ] **Step 1: Export the window helper from `poll.ts`**

In `lib/oracle/poll.ts`, change the line:

```typescript
function isWithinWindow(windowStart: string, windowEnd: string): boolean {
```

to:

```typescript
export function isWithinWindow(windowStart: string, windowEnd: string): boolean {
```

- [ ] **Step 2: Write the failing test**

Create `tests/lib/oracle/crosscheck.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { runTomTomCrossCheck } from '@/lib/oracle/crosscheck'
import type { TomTomRouteReading, TomTomIncidentReading } from '@/lib/oracle/tomtomFetcher'

const coveredRoute: TomTomRouteReading = {
  covered: true, liveS: 1712, freeFlowS: 1572, historicS: 1600,
  delayS: 40, indexVsHistoric: 7, indexVsFreeFlow: 9, raw: { r: 1 },
}
const someIncidents: TomTomIncidentReading = {
  count: 2, byCategory: { jam: 2 }, maxMagnitude: 3, raw: { i: 1 },
}

// Corridor windows: 00:00-23:59 is always "in window"; 00:00-00:00 never is.
function corridor(window_start: string, window_end: string) {
  return {
    id: 'corr-1', slug: 'reforma-am',
    origin_lat: 19.41, origin_lng: -99.20, dest_lat: 19.47, dest_lng: -99.17,
    window_start, window_end, baseline_duration_s: 1600,
  }
}
function urbanContract(corr: ReturnType<typeof corridor> | null) {
  return { id: 'c1', trigger_type: 'urban', status: 'active', settled_outcome: null, corridor: corr }
}

function chainable(value: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'gte', 'order', 'limit']) b[m] = vi.fn().mockReturnValue(b)
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(value).then(res)
  return b
}
function makeDb(opts: { contracts?: unknown[]; googleRows?: unknown[] } = {}) {
  const insertMock = vi.fn().mockResolvedValue({ error: null })
  return {
    from: vi.fn((table: string) => {
      if (table === 'contracts') return chainable({ data: opts.contracts ?? [], error: null })
      if (table === 'oracle_readings') return chainable({ data: opts.googleRows ?? [], error: null })
      if (table === 'tomtom_crosscheck') return { insert: insertMock }
      return {}
    }),
    _insert: insertMock,
  }
}
const deps = (route = coveredRoute, incidents: TomTomIncidentReading | 'throw' = someIncidents) => ({
  fetchRoute: vi.fn().mockResolvedValue(route),
  fetchIncidents: incidents === 'throw'
    ? vi.fn().mockRejectedValue(new Error('incidents down'))
    : vi.fn().mockResolvedValue(incidents),
})

describe('runTomTomCrossCheck', () => {
  it('writes one crosscheck row for an in-window corridor, joining the Google snapshot', async () => {
    const db = makeDb({
      contracts: [urbanContract(corridor('00:00', '23:59'))],
      googleRows: [{ value: { duration_s: 1800, baseline_duration_s: 1600, traffic_index: 12 }, read_at: '2026-07-21T15:00:00Z' }],
    })
    const d = deps()
    const n = await runTomTomCrossCheck(db as never, d)
    expect(n).toBe(1)
    expect(d.fetchRoute).toHaveBeenCalledWith(19.41, -99.20, 19.47, -99.17)
    expect(d.fetchIncidents).toHaveBeenCalledWith({ minLon: -99.20, minLat: 19.41, maxLon: -99.17, maxLat: 19.47 })
    const row = db._insert.mock.calls[0][0]
    expect(row).toMatchObject({
      corridor_id: 'corr-1', tomtom_covered: true, tt_live_s: 1712, tt_historic_s: 1600,
      tt_index_vs_historic: 7, tt_incident_count: 2, tt_max_magnitude: 3,
      google_duration_s: 1800, google_baseline_s: 1600, google_traffic_index: 12,
      google_reading_at: '2026-07-21T15:00:00Z',
    })
    expect(row.tt_incidents).toEqual({ jam: 2 })
  })

  it('skips corridors outside their window', async () => {
    const db = makeDb({ contracts: [urbanContract(corridor('00:00', '00:00'))] })
    const n = await runTomTomCrossCheck(db as never, deps())
    expect(n).toBe(0)
    expect(db._insert).not.toHaveBeenCalled()
  })

  it('skips contracts with no corridor', async () => {
    const db = makeDb({ contracts: [urbanContract(null)] })
    const n = await runTomTomCrossCheck(db as never, deps())
    expect(n).toBe(0)
  })

  it('still records a row (incidents null) when the incidents call fails', async () => {
    const db = makeDb({ contracts: [urbanContract(corridor('00:00', '23:59'))], googleRows: [] })
    const n = await runTomTomCrossCheck(db as never, deps(coveredRoute, 'throw'))
    expect(n).toBe(1)
    const row = db._insert.mock.calls[0][0]
    expect(row.tt_incident_count).toBeNull()
    expect(row.tomtom_covered).toBe(true)
    expect(row.google_duration_s).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/lib/oracle/crosscheck.test.ts`
Expected: FAIL — cannot resolve `@/lib/oracle/crosscheck`.

- [ ] **Step 4: Write minimal implementation**

Create `lib/oracle/crosscheck.ts`:

```typescript
import { createClient } from '@supabase/supabase-js'
import type { Contract, Corridor } from '@/lib/types'
import { isWithinWindow } from './poll'
import {
  fetchTomTomRoute, fetchTomTomIncidents, emptyRoute,
  type TomTomRouteReading, type TomTomIncidentReading, type BBox,
} from './tomtomFetcher'

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

export interface CrossCheckDeps {
  fetchRoute: (oLat: number, oLng: number, dLat: number, dLng: number) => Promise<TomTomRouteReading>
  fetchIncidents: (bbox: BBox) => Promise<TomTomIncidentReading>
}

function defaultDeps(): CrossCheckDeps {
  const key = process.env.TOMTOM_API_KEY ?? ''
  return {
    fetchRoute: (oLat, oLng, dLat, dLng) => fetchTomTomRoute(oLat, oLng, dLat, dLng, key),
    fetchIncidents: (bbox) => fetchTomTomIncidents(bbox, key),
  }
}

function corridorBBox(c: Corridor): BBox {
  return {
    minLon: Math.min(c.origin_lng, c.dest_lng),
    minLat: Math.min(c.origin_lat, c.dest_lat),
    maxLon: Math.max(c.origin_lng, c.dest_lng),
    maxLat: Math.max(c.origin_lat, c.dest_lat),
  }
}

const GOOGLE_LOOKBACK_MS = 30 * 60 * 1000

export async function runTomTomCrossCheck(
  db: DbClient = getClient(),
  deps: CrossCheckDeps = defaultDeps(),
): Promise<number> {
  const { data: contracts } = await db
    .from('contracts')
    .select('*, corridor:corridors(*)')
    .eq('status', 'active')
    .is('settled_outcome', null)
    .eq('trigger_type', 'urban')
  if (!contracts || contracts.length === 0) return 0

  let count = 0
  for (const contract of contracts as Contract[]) {
    try {
      const corridor = contract.corridor as Corridor | null
      if (!corridor) continue
      if (!isWithinWindow(corridor.window_start, corridor.window_end)) continue

      let route: TomTomRouteReading
      try {
        route = await deps.fetchRoute(corridor.origin_lat, corridor.origin_lng, corridor.dest_lat, corridor.dest_lng)
      } catch {
        route = emptyRoute()
      }

      let incidents: TomTomIncidentReading | null = null
      try {
        incidents = await deps.fetchIncidents(corridorBBox(corridor))
      } catch {
        incidents = null
      }

      const since = new Date(Date.now() - GOOGLE_LOOKBACK_MS).toISOString()
      const { data: gRows } = await db
        .from('oracle_readings')
        .select('value, read_at')
        .eq('contract_id', contract.id)
        .eq('source', 'google_maps')
        .gte('read_at', since)
        .order('read_at', { ascending: false })
        .limit(1)
      const g = (gRows?.[0]?.value ?? null) as Record<string, number> | null
      const gAt = gRows?.[0]?.read_at ?? null

      await db.from('tomtom_crosscheck').insert({
        corridor_id: corridor.id,
        in_window: true,
        tomtom_covered: route.covered,
        tt_live_s: route.liveS,
        tt_free_flow_s: route.freeFlowS,
        tt_historic_s: route.historicS,
        tt_delay_s: route.delayS,
        tt_index_vs_historic: route.indexVsHistoric,
        tt_index_vs_free_flow: route.indexVsFreeFlow,
        tt_incident_count: incidents?.count ?? null,
        tt_incidents: incidents?.byCategory ?? null,
        tt_max_magnitude: incidents?.maxMagnitude ?? null,
        google_duration_s: g?.duration_s ?? null,
        google_baseline_s: g?.baseline_duration_s ?? null,
        google_traffic_index: g?.traffic_index ?? null,
        google_reading_at: gAt,
        raw: { route: route.raw, incidents: incidents?.raw ?? null },
      })
      count++
    } catch {
      console.error(`TomTom cross-check error for contract ${contract.id}`)
    }
  }
  return count
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/oracle/crosscheck.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/oracle/poll.ts lib/oracle/crosscheck.ts tests/lib/oracle/crosscheck.test.ts
git commit -m "feat(spike): runTomTomCrossCheck orchestration (window-gated, Google-snapshot join)"
```

---

## Task 5: API route `/api/tomtom-crosscheck`

**Files:**
- Create: `app/api/tomtom-crosscheck/route.ts`
- Test: `tests/api/tomtom-crosscheck.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/api/tomtom-crosscheck.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/oracle/crosscheck', () => ({
  runTomTomCrossCheck: vi.fn().mockResolvedValue(5),
}))

async function makeRequest(secret: string) {
  vi.resetModules()
  const { POST } = await import('@/app/api/tomtom-crosscheck/route')
  return POST(new NextRequest('http://localhost/api/tomtom-crosscheck', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  }))
}

describe('POST /api/tomtom-crosscheck', () => {
  beforeEach(() => { process.env.CRON_SECRET = 'test-secret' })

  it('returns 401 with wrong secret', async () => {
    const res = await makeRequest('wrong')
    expect(res.status).toBe(401)
  })

  it('returns captured count with correct secret', async () => {
    const res = await makeRequest('test-secret')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ captured: 5 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/tomtom-crosscheck.test.ts`
Expected: FAIL — cannot resolve `@/app/api/tomtom-crosscheck/route`.

- [ ] **Step 3: Write minimal implementation**

Create `app/api/tomtom-crosscheck/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { validateCronRequest } from '@/lib/auth/cronAuth'
import { runTomTomCrossCheck } from '@/lib/oracle/crosscheck'

// Read-only shadow of the traffic oracle. Writes ONLY to tomtom_crosscheck;
// never touches oracle_readings, triggers, or pricing.
export const maxDuration = 300

async function handle(req: NextRequest) {
  const authError = validateCronRequest(req)
  if (authError) return authError
  const captured = await runTomTomCrossCheck()
  return NextResponse.json({ captured })
}

export const GET = handle
export const POST = handle
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/tomtom-crosscheck.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/tomtom-crosscheck/route.ts tests/api/tomtom-crosscheck.test.ts
git commit -m "feat(spike): cron-authed /api/tomtom-crosscheck endpoint"
```

---

## Task 6: Report script `scripts/tomtom-crosscheck-report.mjs`

**Files:**
- Create: `scripts/tomtom-crosscheck-report.mjs`

This is an ops script (like `.oracle-check.mjs`) — verified by running against real data, not unit-tested.

- [ ] **Step 1: Write the report script**

```javascript
// scripts/tomtom-crosscheck-report.mjs
// Read-only summary of the TomTom cross-check spike. Loads .env.local, reads the
// tomtom_crosscheck table, and reports per-corridor coverage, Google-vs-TomTom
// index agreement, live-vs-historic spread, and incident hit-rate.
//   node scripts/tomtom-crosscheck-report.mjs [days]   (default 7)
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = { ...process.env }
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* rely on process.env */ }

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing Supabase creds. Aborting.'); process.exit(2) }

const days = Number(process.argv[2] ?? 7)
const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
const db = createClient(url, key, { auth: { persistSession: false } })

const { data: corridors } = await db.from('corridors').select('id, slug')
const slugById = new Map((corridors ?? []).map((c) => [c.id, c.slug]))

const PAGE = 1000
const rows = []
for (let from = 0; ; from += PAGE) {
  const { data, error } = await db
    .from('tomtom_crosscheck')
    .select('*')
    .gte('captured_at', since)
    .order('captured_at', { ascending: true })
    .range(from, from + PAGE - 1)
  if (error) throw error
  if (!data || data.length === 0) break
  rows.push(...data)
  if (data.length < PAGE) break
}

console.log(`=== TOMTOM CROSS-CHECK (last ${days}d) ===  rows: ${rows.length}  now: ${new Date().toISOString()}`)
if (rows.length === 0) { console.log('no rows captured yet'); process.exit(0) }

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (s.length === 0) return null
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const byCorridor = new Map()
for (const r of rows) {
  const slug = slugById.get(r.corridor_id) ?? r.corridor_id
  if (!byCorridor.has(slug)) byCorridor.set(slug, [])
  byCorridor.get(slug).push(r)
}

console.log('\n  corridor                     n   ttCov%  incident%  medTTidxHist  medGoogleIdx  medAbsDiff  medDelayS')
console.log('  ' + '-'.repeat(104))
for (const [slug, rs] of [...byCorridor.entries()].sort()) {
  const n = rs.length
  const cov = rs.filter((r) => r.tomtom_covered).length / n
  const inc = rs.filter((r) => (r.tt_incident_count ?? 0) > 0).length / n
  const medTT = median(rs.map((r) => Number(r.tt_index_vs_historic)))
  const paired = rs.filter((r) => r.google_traffic_index != null && r.tt_index_vs_historic != null)
  const medG = median(paired.map((r) => Number(r.google_traffic_index)))
  const medDiff = median(paired.map((r) => Math.abs(Number(r.google_traffic_index) - Number(r.tt_index_vs_historic))))
  const medDelay = median(rs.map((r) => Number(r.tt_delay_s)))
  const f = (x, d = 2) => (x == null ? '  n/a' : x.toFixed(d))
  console.log(`  ${slug.slice(0, 26).padEnd(26)} ${String(n).padStart(4)}  ${(cov * 100).toFixed(0).padStart(5)}  ${(inc * 100).toFixed(0).padStart(8)}  ${f(medTT).padStart(11)}  ${f(medG).padStart(11)}  ${f(medDiff).padStart(9)}  ${f(medDelay, 0).padStart(8)}`)
}

// GT vs CDMX coverage roll-up — the key thin-coverage question.
for (const [label, pred] of [['CDMX', (s) => !s.startsWith('gt-')], ['GT', (s) => s.startsWith('gt-')]]) {
  const rs = rows.filter((r) => pred(slugById.get(r.corridor_id) ?? ''))
  if (rs.length === 0) continue
  const cov = rs.filter((r) => r.tomtom_covered).length / rs.length
  const diff = rs.filter((r) => r.tomtom_covered && r.tt_live_s != null && r.tt_historic_s != null && r.tt_live_s !== r.tt_historic_s).length / rs.length
  console.log(`\n  ${label}: n=${rs.length}  tomtom_covered=${(cov * 100).toFixed(0)}%  live≠historic=${(diff * 100).toFixed(0)}% (traffic differentiation present)`)
}
```

- [ ] **Step 2: Run type/lint check across the new code**

Run: `npx vitest run tests/lib/oracle/tomtomFetcher.test.ts tests/lib/oracle/crosscheck.test.ts tests/api/tomtom-crosscheck.test.ts`
Expected: PASS (all).

- [ ] **Step 3: Commit**

```bash
git add scripts/tomtom-crosscheck-report.mjs
git commit -m "feat(spike): tomtom-crosscheck-report ops script"
```

---

## Task 7: Rollout runbook (apply, smoke-test, schedule)

**Files:** none (operational). `TOMTOM_API_KEY` is already set in `.env.local` + Vercel prod/dev.

- [ ] **Step 1: Full test + typecheck gate before deploy**

Run: `npm run test:run && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 2: Apply the migration to prod**

Run: `supabase db push --linked < /dev/null`
Expected: `20260721000001_tomtom_crosscheck.sql` applied; verify with
`supabase migration list --linked` (new migration shows as applied) or check the
table exists.

- [ ] **Step 3: Deploy**

Run: `vercel --prod --yes`
(Single prod deploy — do NOT double-deploy; stale-chunk gotcha.)

- [ ] **Step 4: Smoke-test the endpoint against prod**

Run (substitute the real secret):
```bash
curl -s -X POST https://insu-theta.vercel.app/api/tomtom-crosscheck \
  -H "Authorization: Bearer $CRON_SECRET"
```
Expected: `{"captured":N}` where N = number of corridors currently in-window
(may be 0 outside AM/PM windows — re-run during a commute window to see rows).

- [ ] **Step 5: Verify rows landed (and nothing leaked to oracle_readings)**

Run: `node scripts/tomtom-crosscheck-report.mjs 1`
Expected: a table with ≥1 row per in-window corridor. Separately confirm the live
oracle is untouched: `node .oracle-check.mjs` still shows only `google_maps`
traffic readings (no `tomtom` source), and pricing/tiers unchanged.

- [ ] **Step 6: Create the cron-job.org job**

Add a new cron-job.org job (parallel to the traffic poll) hitting
`POST https://insu-theta.vercel.app/api/tomtom-crosscheck` with header
`Authorization: Bearer <CRON_SECRET>`, every 15 min. (Window-gating is handled
server-side, so firing 24/7 is fine — off-window cycles simply capture 0 rows.)
Note the job id in memory for later teardown.

- [ ] **Step 7: Let it run ~1 week, then analyze**

Run: `node scripts/tomtom-crosscheck-report.mjs 7`
Review: GT coverage %, live≠historic differentiation, Google-vs-TomTom index
agreement, incident hit-rate. Feed into the improvement #1–#4 decision.

---

## Self-Review Notes

- **Spec coverage:** table (Task 1), route+incidents fetchers (Tasks 2–3), window-gated orchestration with Google snapshot + coverage-gap rows (Task 4), cron-authed endpoint (Task 5), report with CDMX/GT roll-up (Task 6), rollout incl. migration/cron/verification (Task 7). All spec sections mapped.
- **Isolation guarantee:** only writes are to `tomtom_crosscheck`; Task 7 Step 5 explicitly verifies `oracle_readings`/pricing untouched.
- **Type consistency:** `TomTomRouteReading` / `TomTomIncidentReading` / `BBox` defined in Task 2–3 and consumed unchanged in Task 4; `emptyRoute()` reused on the error path; `runTomTomCrossCheck(db, deps)` signature matches the route caller (defaults) and the test (injected).
- **No live API in unit tests:** all fetch calls stubbed (Tasks 2–3) or injected (Task 4).
