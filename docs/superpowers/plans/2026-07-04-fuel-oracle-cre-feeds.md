# Fuel Oracle CRE XML Feeds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dead `api.datos.gob.mx` fuel-price source with the live CRE XML feeds so the `gas-price-magna-cdmx` contract gets real daily readings.

**Architecture:** `lib/oracle/gasFetcher.ts` keeps its public interface (`fetchGasPrice(fuelType) → FetchedReading`) but internally fetches two CRE XML feeds (per-station prices + per-station coordinates), joins them on `place_id`, filters to a CDMX bounding box, and returns the median. No changes to `poll.ts`, trigger evaluation, or the DB — the prod `oracle_readings_source_check` constraint already allows `cre_datos_gob` (migration `20260703000003`).

**Tech Stack:** Next.js API route (Vercel Fluid Compute), TypeScript, Vitest (fetch stubbed via `vi.stubGlobal`), regex XML parsing (no new deps).

**Spec:** `docs/superpowers/specs/2026-07-04-fuel-oracle-source-design.md`

**Branch:** `fix/fuel-oracle-cre-feeds` (already created; spec committed)

---

### Task 1: Rewrite gasFetcher tests against the CRE feeds (failing first)

**Files:**
- Modify: `tests/lib/oracle/gasFetcher.test.ts` (full rewrite)

- [ ] **Step 1: Replace the test file with CRE-feed tests**

Replace the entire contents of `tests/lib/oracle/gasFetcher.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchGasPrice } from '@/lib/oracle/gasFetcher'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

interface Station {
  id: number
  lat: number
  lng: number
  regular?: number
  premium?: number
  diesel?: number
}

// Inside the CDMX bounding box (lat 19.04–19.60, lng −99.37 to −98.93)
const CDMX_COORDS = { lat: 19.4, lng: -99.15 }
// Outside the box (Guadalajara)
const GDL_COORDS = { lat: 20.67, lng: -103.35 }

/** n CDMX stations with regular prices 22.00, 22.01, … (median = 22.00 + (n-1)/2 * 0.01) */
function cdmxStations(n: number): Station[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    ...CDMX_COORDS,
    regular: 22.0 + i * 0.01,
    diesel: 26.0 + i * 0.01,
    ...(i % 2 === 0 ? { premium: 28.0 + i * 0.01 } : {}),
  }))
}

function pricesXml(stations: Station[]): string {
  const places = stations
    .map((s) => {
      const lines = (['regular', 'premium', 'diesel'] as const)
        .filter((f) => s[f] !== undefined)
        .map((f) => `    <gas_price type="${f}">${s[f]!.toFixed(2)}</gas_price>`)
        .join('\n')
      return `  <place place_id="${s.id}">\n${lines}\n  </place>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>\n<places>\n${places}\n</places>`
}

function placesXml(stations: Station[]): string {
  const places = stations
    .map(
      (s) =>
        `  <place place_id="${s.id}">\n    <name>STATION ${s.id}</name>\n    <cre_id>PL/${s.id}/EXP/ES/2015</cre_id>\n    <location>\n      <x>${s.lng}</x>\n      <y>${s.lat}</y>\n    </location>\n  </place>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>\n<places>\n${places}\n</places>`
}

/** Route the two feed URLs to XML bodies. */
function mockFeeds(stations: Station[]) {
  mockFetch.mockImplementation((url: string) => {
    const body = url.includes('/prices') ? pricesXml(stations) : placesXml(stations)
    return Promise.resolve({ ok: true, text: () => Promise.resolve(body) })
  })
}

describe('fetchGasPrice', () => {
  beforeEach(() => mockFetch.mockReset())

  it('fetches both CRE feed URLs', async () => {
    mockFeeds(cdmxStations(60))
    await fetchGasPrice('magna')
    const urls = mockFetch.mock.calls.map((c) => c[0] as string)
    expect(urls.some((u) => u.includes('publicacionexterna.azurewebsites.net/publicaciones/prices'))).toBe(true)
    expect(urls.some((u) => u.includes('publicacionexterna.azurewebsites.net/publicaciones/places'))).toBe(true)
  })

  it('returns the median Magna (regular) price with correct shape', async () => {
    mockFeeds(cdmxStations(61))
    const result = await fetchGasPrice('magna')
    // 61 stations, prices 22.00 … 22.60 → median = 22.30
    expect(result.value.price_mxn_per_liter).toBeCloseTo(22.3, 5)
    expect(result.source).toBe('cre_datos_gob')
    expect(result.reading_type).toBe('fuel')
    expect(result.value.fuel_type).toBe('magna')
    expect(result.value.sample_size).toBe(61)
  })

  it('excludes stations outside the CDMX bounding box', async () => {
    const outlier: Station = { id: 999, ...GDL_COORDS, regular: 99.0 }
    mockFeeds([...cdmxStations(61), outlier])
    const result = await fetchGasPrice('magna')
    expect(result.value.sample_size).toBe(61)
    expect(result.value.price_mxn_per_liter).toBeCloseTo(22.3, 5)
  })

  it('skips stations missing the requested fuel type', async () => {
    // premium exists only on even-index stations: 51 of 101 (still above MIN_SAMPLE)
    mockFeeds(cdmxStations(101))
    const result = await fetchGasPrice('premium')
    expect(result.value.sample_size).toBe(51)
  })

  it('throws when the CDMX sample is below the minimum', async () => {
    mockFeeds(cdmxStations(10))
    await expect(fetchGasPrice('magna')).rejects.toThrow(/sample too small/i)
  })

  it('throws when a feed returns non-ok status', async () => {
    mockFetch.mockImplementation(() => Promise.resolve({ ok: false, status: 503 }))
    await expect(fetchGasPrice('magna')).rejects.toThrow('CRE feed error: 503')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/oracle/gasFetcher.test.ts`

Expected: FAIL — the current implementation calls `api.datos.gob.mx` once and reads `.json()`, so every test fails (wrong URL assertions, `res.json is not a function`, or wrong values).

- [ ] **Step 3: Commit the failing tests**

```bash
git add tests/lib/oracle/gasFetcher.test.ts
git commit -m "test: gasFetcher tests target CRE XML feeds (red)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Rewrite gasFetcher.ts against the CRE feeds

**Files:**
- Modify: `lib/oracle/gasFetcher.ts` (full rewrite)

- [ ] **Step 1: Replace the implementation**

Replace the entire contents of `lib/oracle/gasFetcher.ts` with:

```ts
// CRE fuel-price publication feeds. The old api.datos.gob.mx API is dead
// (times out); these XML feeds carry the same underlying CRE data.
const PRICES_URL = 'https://publicacionexterna.azurewebsites.net/publicaciones/prices'
const PLACES_URL = 'https://publicacionexterna.azurewebsites.net/publicaciones/places'

// The feeds have no state field — filter stations by CDMX bounding box.
const CDMX_BBOX = { latMin: 19.04, latMax: 19.6, lngMin: -99.37, lngMax: -98.93 }

// A healthy feed yields ~700 CDMX stations; far fewer means a broken feed
// whose median can't be trusted.
const MIN_SAMPLE = 50

const FETCH_TIMEOUT_MS = 30_000

const FUEL_FIELD: Record<'magna' | 'premium' | 'diesel', string> = {
  magna:   'regular',   // CRE feeds use 'regular' for Magna
  premium: 'premium',
  diesel:  'diesel',
}

type FuelType = 'magna' | 'premium' | 'diesel'

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

async function fetchXml(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`CRE feed error: ${res.status}`)
  return res.text()
}

/** Iterate <place place_id="N">…</place> blocks. */
function* placeBlocks(xml: string): Generator<{ id: string; body: string }> {
  for (const m of xml.matchAll(/<place place_id="(\d+)">([\s\S]*?)<\/place>/g)) {
    yield { id: m[1], body: m[2] }
  }
}

function parseLocations(xml: string): Map<string, { lat: number; lng: number }> {
  const locations = new Map<string, { lat: number; lng: number }>()
  for (const { id, body } of placeBlocks(xml)) {
    const loc = body.match(/<x>(-?[\d.]+)<\/x>\s*<y>(-?[\d.]+)<\/y>/)
    if (!loc) continue
    const lng = parseFloat(loc[1])
    const lat = parseFloat(loc[2])
    if (isNaN(lat) || isNaN(lng)) continue
    locations.set(id, { lat, lng })
  }
  return locations
}

function parsePrices(xml: string, field: string): Map<string, number> {
  const prices = new Map<string, number>()
  const priceRe = new RegExp(`<gas_price type="${field}">([\\d.]+)</gas_price>`)
  for (const { id, body } of placeBlocks(xml)) {
    const m = body.match(priceRe)
    if (!m) continue
    const price = parseFloat(m[1])
    if (isNaN(price) || price <= 0) continue
    prices.set(id, price)
  }
  return prices
}

function inCdmx({ lat, lng }: { lat: number; lng: number }): boolean {
  return lat >= CDMX_BBOX.latMin && lat <= CDMX_BBOX.latMax
    && lng >= CDMX_BBOX.lngMin && lng <= CDMX_BBOX.lngMax
}

export async function fetchGasPrice(fuelType: FuelType): Promise<FetchedReading> {
  const [pricesXmlBody, placesXmlBody] = await Promise.all([
    fetchXml(PRICES_URL),
    fetchXml(PLACES_URL),
  ])

  const locations = parseLocations(placesXmlBody)
  const prices = parsePrices(pricesXmlBody, FUEL_FIELD[fuelType])

  const samples: number[] = []
  for (const [id, price] of prices) {
    const loc = locations.get(id)
    if (loc && inCdmx(loc)) samples.push(price)
  }

  if (samples.length < MIN_SAMPLE) {
    throw new Error(`CDMX sample too small for ${fuelType}: ${samples.length} < ${MIN_SAMPLE}`)
  }

  return {
    source: 'cre_datos_gob',
    reading_type: 'fuel',
    value: {
      price_mxn_per_liter: median(samples),
      fuel_type: fuelType,
      sample_size: samples.length,
    },
  }
}
```

- [ ] **Step 2: Run the gasFetcher tests to verify they pass**

Run: `npx vitest run tests/lib/oracle/gasFetcher.test.ts`

Expected: PASS — 6 tests.

- [ ] **Step 3: Run the full suite, lint, and typecheck**

Run: `npx vitest run && npx tsc --noEmit && npx eslint lib/oracle/gasFetcher.ts tests/lib/oracle/gasFetcher.test.ts`

Expected: full suite green (poll.ts tests inject their own fetcher, so nothing else should be affected); no new tsc or eslint errors in the touched files. Note: a pre-existing tsc error in `tests/lib/payout/processor.test.ts` (~line 367) is known and unrelated — ignore it if it appears.

- [ ] **Step 4: Live smoke test against the real feeds**

Run: `npx tsx -e "import { fetchGasPrice } from './lib/oracle/gasFetcher'; fetchGasPrice('magna').then(r => console.log(JSON.stringify(r)))"`

Expected: a JSON reading with `source: "cre_datos_gob"`, `sample_size` ≈ 700, and `price_mxn_per_liter` ≈ 24 (was 23.99 on 2026-07-04).

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/gasFetcher.ts
git commit -m "fix(oracle): fuel prices from CRE XML feeds (datos.gob.mx is dead)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: PR and merge

**Files:** none (git/GitHub only)

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin fix/fuel-oracle-cre-feeds
gh pr create --title "fix(oracle): fuel prices from CRE XML feeds" --body "$(cat <<'EOF'
## Summary
- api.datos.gob.mx (old fuel source) is dead — times out, so the daily weather,fuel cron reported success with zero fuel readings since launch (only reading was a manual demo value from 2026-06-21)
- gasFetcher now joins the CRE publication feeds (prices + places XML), filters to a CDMX bounding box, and returns the median — same reading shape, no poll/DB changes (source constraint already allows cre_datos_gob)
- guards: 30s fetch timeout, throw if <50 CDMX stations survive the filter

Spec: docs/superpowers/specs/2026-07-04-fuel-oracle-source-design.md

## Test plan
- [x] 6 rewritten unit tests (median, bbox exclusion, missing fuel type, low sample, HTTP error)
- [x] full vitest suite green
- [x] live smoke test: ~700 CDMX stations, median ≈ $24 MXN/L

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 2: Merge**

Note: CI on main is currently red for unrelated reasons (qs dependency-audit advisory + 2 pre-existing lint errors), so the PR's CI may fail on those same checks. Confirm any failures are only those known issues before merging.

```bash
gh pr merge --merge
git checkout main && git pull
```

Expected: merged; local main includes the fix.

---

### Task 4: Deploy to production and verify end-to-end

**Files:** none (ops only). Prod does NOT auto-deploy on merge.

- [ ] **Step 1: Deploy**

From the main checkout:

```bash
vercel --prod --yes
```

Expected: deployment URL printed; aliased to insu-theta.vercel.app.

- [ ] **Step 2: Trigger a fuel poll**

`CRON_SECRET` is in `.env.local`:

```bash
source <(grep '^CRON_SECRET=' .env.local | sed 's/^/export /')
curl -sS -X POST -H "Authorization: Bearer ${CRON_SECRET}" \
  "https://insu-theta.vercel.app/api/oracle-poll?types=fuel"
```

Expected: HTTP 200 with a body indicating 1 contract polled.

- [ ] **Step 3: Verify the reading landed**

```bash
node -e "
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data: c } = await sb.from('contracts').select('id').eq('trigger_type','fuel').single();
  const { data } = await sb.from('oracle_readings').select('read_at, source, value, trigger_met')
    .eq('contract_id', c.id).order('read_at', { ascending: false }).limit(2);
  console.log(JSON.stringify(data, null, 1));
})();
"
```

Expected: newest row has `source: "cre_datos_gob"`, today's timestamp, `price_mxn_per_liter` ≈ 24, `sample_size` ≈ 700, `trigger_met: false` (median is below the $25 threshold).

- [ ] **Step 4: Fire the manual reprice and verify the premium updated**

```bash
gh workflow run reprice.yml
sleep 60
gh run list --workflow=reprice.yml --limit 1
node -e "
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data: c } = await sb.from('contracts').select('id').eq('trigger_type','fuel').single();
  const { data } = await sb.from('pricing_history').select('calculated_at, premium_usd_before, premium_usd_after')
    .eq('contract_id', c.id).order('calculated_at', { ascending: false }).limit(2);
  console.log(JSON.stringify(data, null, 1));
})();
"
```

Expected: reprice run `completed success`; newest `pricing_history` rows for the fuel contract timestamped now. `premium_usd_after` may equal `premium_usd_before` if the new median implies the same premium — the fresh `calculated_at` is the success signal.

- [ ] **Step 5: Update memory**

Edit `/Users/gerardobasterrechea/.claude/projects/-Users-gerardobasterrechea-Documents-GitHub-insu/memory/project_open_bugs.md`: mark bug #4 ✅ fixed 2026-07-04 — gasFetcher rewritten to CRE publication XML feeds (publicacionexterna.azurewebsites.net), constraint gap had already been closed by migration `20260703000003`, verified live reading + reprice in prod. Update the index line in `MEMORY.md` if it still lists the fuel oracle as broken.
