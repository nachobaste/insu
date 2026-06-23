# Traffic Trigger Rebaseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make corridor traffic protections insure *extraordinary* traffic by measuring travel time against each corridor's **typical in-window duration**, instead of Google's free-flow `staticDuration`, so the premium stops converging on (and exceeding) the payout.

**Architecture:** Three phases. **Phase 1** (deployable immediately, behavior-preserving) extracts the traffic-index formula into a tested pure module and lets the oracle compute the index against a per-corridor `baseline_duration_s`, falling back to free-flow when no baseline exists yet. **Phase 2** builds an operator script that computes those baselines from accumulated `oracle_readings` history. **Phase 3** builds a script that recalibrates each tier's `base_probability` from the same history under the new baseline. Phases 2–3 are *built now but run later* — they need ~2–4 weeks of in-window readings to produce trustworthy numbers (calibration is currently blocked on thin history).

**Tech Stack:** Next.js 16 / TypeScript, Supabase (Postgres + service-role client), Vitest, Google Routes API (`computeRoutes`), Node `.mjs` operator scripts.

**Critical expectation:** Deploying **Phase 1 alone does NOT fix the premium-vs-payout symptom.** Phase 1 only changes the *plumbing* (and is a no-op until a `baseline_duration_s` is set). The symptom resolves only after Phase 2 + Phase 3 are run against real history and the tiers are repriced (see the Go-Live Runbook at the end).

---

## Background (root cause)

`lib/oracle/fetcher.ts:85` computes `traffic_index = ((durationS / staticDurationS) - 1) * 100`, where `staticDuration` is Google's **free-flow** duration. All 12 corridors share the trigger `traffic_index > 50` and `base_probability = 0.35`/day. "50% slower than free-flow" is ordinary CDMX rush hour, so the trigger fires almost daily → over a 30-day tenor a payout is ~certain → `premium = payout x E[payouts] x loading x capacity` lands at or above the payout (e.g. Basic: $526 premium vs $500 single payout = guaranteed buyer loss). The pricing math is correct; the insured event is mis-specified. Comparing to a *typical rush-hour* baseline turns the trigger into "extraordinary traffic" — a genuinely rare event. See memory `project_trigger_calibration`.

## File Structure

- **Create** `lib/oracle/trafficIndex.ts` — pure `trafficIndex(durationS, baselineS)` formula + `TRAFFIC_INDEX_MAX`. Single source of truth for the metric. (Phase 1)
- **Create** `tests/lib/oracle/trafficIndex.test.ts` — unit tests for the formula. (Phase 1)
- **Modify** `lib/oracle/fetcher.ts` — `fetchGoogleMapsReading` takes an optional `baselineDurationS`, uses the shared formula, records `baseline_duration_s` in the reading value. (Phase 1)
- **Modify** `tests/lib/oracle/fetcher.test.ts` — cover baseline vs fallback paths. (Phase 1)
- **Modify** `lib/oracle/poll.ts` — pass `corridor.baseline_duration_s` into the fetcher. (Phase 1)
- **Modify** `lib/types.ts` — add `baseline_duration_s: number | null` to `Corridor`. (Phase 1)
- **Create** `supabase/migrations/20260623000001_corridor_baseline.sql` — add nullable `corridors.baseline_duration_s`. (Phase 1)
- **Create** `scripts/compute-corridor-baselines.mjs` — derive per-corridor typical weekday in-window duration from history; dry-run / `--apply`. (Phase 2)
- **Create** `scripts/recalibrate-base-probability.mjs` — recompute breach frequency from `duration_s` + baseline under the new threshold; write `coverage_tiers.base_probability`; dry-run / `--apply`. (Phase 3)
- **Create** `supabase/migrations/20260623000002_trigger_description_rebaseline.sql` — update the human-readable trigger description copy (threshold unchanged). (Phase 1, optional copy task)

**Operator-script convention:** Phases 2 & 3 are self-contained `.mjs` scripts mirroring the existing `scripts/tune-base-probability.mjs` (env loading, dry-run default, `--apply`, confidence by sample count). Per repo convention that script has no unit test; these are verified by **reviewing dry-run output**, not vitest. The behavior-critical, reused math (`trafficIndex`) lives in the tested TS module and is the canonical formula the scripts mirror inline.

---

## Phase 1 — Mechanism (deploy now, behavior-preserving)

### Task 1: Shared traffic-index formula

**Files:**
- Create: `lib/oracle/trafficIndex.ts`
- Test: `tests/lib/oracle/trafficIndex.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/oracle/trafficIndex.test.ts
import { describe, it, expect } from 'vitest'
import { trafficIndex, TRAFFIC_INDEX_MAX } from '@/lib/oracle/trafficIndex'

describe('trafficIndex', () => {
  it('returns percent slower than the baseline', () => {
    expect(trafficIndex(1500, 1000)).toBe(50) // 50% slower
  })

  it('returns 0 when equal to baseline', () => {
    expect(trafficIndex(1000, 1000)).toBe(0)
  })

  it('clamps faster-than-baseline trips to 0', () => {
    expect(trafficIndex(800, 1000)).toBe(0) // -20% -> 0
  })

  it('clamps extreme slowdowns to TRAFFIC_INDEX_MAX', () => {
    expect(trafficIndex(3000, 1000)).toBe(TRAFFIC_INDEX_MAX) // 200% -> 100
  })

  it('rounds to the nearest integer', () => {
    expect(trafficIndex(1333, 1000)).toBe(33) // 33.3 -> 33
  })

  it('returns 0 for a zero or missing baseline (guard)', () => {
    expect(trafficIndex(1500, 0)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/oracle/trafficIndex.test.ts`
Expected: FAIL — `Cannot find module '@/lib/oracle/trafficIndex'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/oracle/trafficIndex.ts

/** Hard cap on the traffic index (percent slower than baseline). Prevents a
 *  single spike from dominating the oracle multiplier downstream. */
export const TRAFFIC_INDEX_MAX = 100

/**
 * Traffic index = how much slower the live trip is than `baselineS`, as a
 * clamped, rounded percentage in [0, TRAFFIC_INDEX_MAX].
 *
 * `baselineS` is the corridor's typical in-window duration. Callers pass Google's
 * free-flow `staticDuration` as a fallback until a typical baseline exists, which
 * reproduces the historical behavior exactly.
 */
export function trafficIndex(durationS: number, baselineS: number): number {
  if (!baselineS || baselineS <= 0) return 0
  const raw = ((durationS / baselineS) - 1) * 100
  return Math.min(TRAFFIC_INDEX_MAX, Math.max(0, Math.round(raw)))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/oracle/trafficIndex.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/trafficIndex.ts tests/lib/oracle/trafficIndex.test.ts
git commit -m "feat(oracle): extract shared trafficIndex formula"
```

---

### Task 2: Fetcher computes index against a baseline (with free-flow fallback)

**Files:**
- Modify: `lib/oracle/fetcher.ts:46-93`
- Test: `tests/lib/oracle/fetcher.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/lib/oracle/fetcher.test.ts` (inside the existing `describe('fetchGoogleMapsReading', …)` block — or create it if absent). These assert: (a) with a baseline, the index is computed against it; (b) without a baseline, it falls back to `staticDuration` exactly as before.

```ts
import { fetchGoogleMapsReading } from '@/lib/oracle/fetcher'

function mockRoute(durationS: number, staticS: number) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ routes: [{ duration: `${durationS}s`, staticDuration: `${staticS}s` }] }),
  })
}

describe('fetchGoogleMapsReading baseline', () => {
  beforeEach(() => mockFetch.mockReset())

  it('computes traffic_index against the provided baseline', async () => {
    mockRoute(1500, 600) // typical baseline 1000 -> 50% slower than typical
    const r = await fetchGoogleMapsReading(0, 0, 0, 0, 'k', 1000)
    expect((r.value as Record<string, number>).traffic_index).toBe(50)
    expect((r.value as Record<string, number>).baseline_duration_s).toBe(1000)
  })

  it('falls back to free-flow staticDuration when baseline is null', async () => {
    mockRoute(1500, 1000) // 50% slower than free-flow (legacy behavior)
    const r = await fetchGoogleMapsReading(0, 0, 0, 0, 'k', null)
    expect((r.value as Record<string, number>).traffic_index).toBe(50)
    expect((r.value as Record<string, number>).baseline_duration_s).toBe(1000) // == staticDuration
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/oracle/fetcher.test.ts -t baseline`
Expected: FAIL — `fetchGoogleMapsReading` ignores the extra argument; `baseline_duration_s` is `undefined`.

- [ ] **Step 3: Implement the change**

In `lib/oracle/fetcher.ts`, add the import at the top:

```ts
import { trafficIndex } from './trafficIndex'
```

Replace the signature and body of `fetchGoogleMapsReading` (lines 46-93). New signature adds a trailing optional param; the computation uses the shared formula:

```ts
export async function fetchGoogleMapsReading(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  apiKey: string,
  baselineDurationS: number | null = null,
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

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Google Maps Routes API error: ${res.status} ${body}`.trim())
  }

  const data = await res.json()
  const route = (data.routes as Array<{ duration: string; staticDuration: string }>)?.[0]
  if (!route) throw new Error('Google Maps Routes API: no routes returned')

  const durationS = parseInt(route.duration.replace('s', ''), 10)
  const staticDurationS = parseInt(route.staticDuration.replace('s', ''), 10)
  if (!staticDurationS) throw new Error('Google Maps Routes API: zero static duration')

  // Measure against the corridor's TYPICAL in-window duration so we trigger on
  // extraordinary traffic, not predictable rush hour. Fall back to free-flow
  // (legacy behavior) until a baseline has been computed from history.
  const baselineS = baselineDurationS && baselineDurationS > 0 ? baselineDurationS : staticDurationS
  const traffic_index = trafficIndex(durationS, baselineS)

  return {
    source: 'google_maps',
    reading_type: 'traffic',
    value: { traffic_index, duration_s: durationS, static_duration_s: staticDurationS, baseline_duration_s: baselineS },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/oracle/fetcher.test.ts`
Expected: PASS — new baseline tests pass and all pre-existing `fetchGoogleMapsReading` tests still pass (the default `null` arg preserves legacy behavior).

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/fetcher.ts tests/lib/oracle/fetcher.test.ts
git commit -m "feat(oracle): measure traffic_index against corridor baseline with free-flow fallback"
```

---

### Task 3: Add `baseline_duration_s` to the Corridor type and DB

**Files:**
- Modify: `lib/types.ts` (the `Corridor` interface, around line 42-53)
- Create: `supabase/migrations/20260623000001_corridor_baseline.sql`

- [ ] **Step 1: Add the migration**

```sql
-- supabase/migrations/20260623000001_corridor_baseline.sql
-- Typical in-window trip duration per corridor, computed from oracle history.
-- NULL means "no baseline yet" -> the oracle falls back to Google free-flow.
ALTER TABLE corridors ADD COLUMN IF NOT EXISTS baseline_duration_s integer;

COMMENT ON COLUMN corridors.baseline_duration_s IS
  'Typical in-window trip duration (seconds) from oracle history; NULL = fall back to Google free-flow staticDuration.';
```

- [ ] **Step 2: Add the field to the Corridor type**

In `lib/types.ts`, inside the `Corridor` interface, add after `window_end`:

```ts
  baseline_duration_s: number | null
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: No NEW errors referencing `Corridor` or `baseline_duration_s`. (A pre-existing unrelated error in `tests/lib/payout/processor.test.ts` may remain — ignore it.)

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts supabase/migrations/20260623000001_corridor_baseline.sql
git commit -m "feat(corridors): add baseline_duration_s column and type"
```

---

### Task 4: Poll passes the corridor baseline into the fetcher

**Files:**
- Modify: `lib/oracle/poll.ts:76-81`
- Test: `tests/lib/oracle/poll.test.ts`

- [ ] **Step 1: Write/adjust the failing test**

In `tests/lib/oracle/poll.test.ts`, add a test that the urban branch forwards the corridor baseline. If the file already stubs `fetchGoogleMapsReading`, assert on its call args; otherwise add a focused test using a fake `readingFetcher` is NOT enough here (the wiring lives in `defaultFetcher`), so spy on the fetcher module:

```ts
import * as fetcher from '@/lib/oracle/fetcher'
// ...
it('passes the corridor baseline_duration_s to the Google fetcher', async () => {
  const spy = vi.spyOn(fetcher, 'fetchGoogleMapsReading').mockResolvedValue({
    source: 'google_maps', reading_type: 'traffic', value: { traffic_index: 0 },
  })
  // Build a db stub returning one active urban contract whose corridor is
  // in-window and has baseline_duration_s = 1234, then call pollContracts with
  // the default fetcher. (Reuse the existing poll.test db-stub helper.)
  // ...invoke pollContracts(dbStub)...
  expect(spy).toHaveBeenCalledWith(
    expect.anything(), expect.anything(), expect.anything(), expect.anything(),
    expect.any(String), 1234,
  )
  spy.mockRestore()
})
```

> Note: match the existing `poll.test.ts` db-stub + window-mock helpers (the suite already constructs in-window corridors). If `isWithinWindow` is time-sensitive in tests, reuse the existing approach that suite uses to force an in-window time.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/oracle/poll.test.ts -t baseline`
Expected: FAIL — fetcher called with only 5 args (no baseline).

- [ ] **Step 3: Implement the change**

In `lib/oracle/poll.ts`, update the urban branch of `defaultFetcher` (lines 76-81):

```ts
    try {
      return [await fetchGoogleMapsReading(
        corridor.origin_lat, corridor.origin_lng,
        corridor.dest_lat, corridor.dest_lng,
        apiKey,
        corridor.baseline_duration_s,
      )]
    } catch (err) {
      console.error(`Google Maps fetch error for contract ${contract.id}:`, err)
      return []
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/oracle/poll.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/poll.ts tests/lib/oracle/poll.test.ts
git commit -m "feat(oracle): forward corridor baseline_duration_s through poll"
```

---

### Task 5: Update trigger description copy (threshold unchanged)

**Files:**
- Create: `supabase/migrations/20260623000002_trigger_description_rebaseline.sql`
- Modify: `supabase/migrations/20260526000003_seed_corridor_contracts.sql` (seed copy only, for fresh DBs)

> Rationale: the stored description "Travel time at least 50% worse than normal" now means "vs a typical rush hour." Update the copy so the UI is truthful. The numeric `threshold` (50), `metric`, and `operator` are unchanged.

- [ ] **Step 1: Add the data migration**

```sql
-- supabase/migrations/20260623000002_trigger_description_rebaseline.sql
-- The traffic baseline changed from free-flow to typical rush hour; fix the copy.
UPDATE contracts
SET trigger_condition = jsonb_set(
      trigger_condition,
      '{description}',
      '"Travel time at least 50% worse than a typical rush hour"'
    )
WHERE trigger_type = 'urban'
  AND trigger_condition->>'description' = 'Travel time at least 50% worse than normal';
```

- [ ] **Step 2: Update the seed copy for fresh databases**

In `supabase/migrations/20260526000003_seed_corridor_contracts.sql`, replace every occurrence of `Travel time at least 50% worse than normal` with `Travel time at least 50% worse than a typical rush hour`.

Run: `grep -c "50% worse than normal" supabase/migrations/20260526000003_seed_corridor_contracts.sql`
Expected: `0`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260623000002_trigger_description_rebaseline.sql supabase/migrations/20260526000003_seed_corridor_contracts.sql
git commit -m "chore(copy): describe traffic trigger relative to typical rush hour"
```

---

### Task 6: Verify, apply migration to staging, deploy

- [ ] **Step 1: Full suite + lint + typecheck**

Run: `npx vitest run && npx eslint lib/oracle/trafficIndex.ts lib/oracle/fetcher.ts lib/oracle/poll.ts`
Expected: all tests pass; lint clean.

- [ ] **Step 2: Apply the schema migration to staging**

Apply `20260623000001_corridor_baseline.sql` and `20260623000002_trigger_description_rebaseline.sql` to the staging DB (`eagmczieznsogsxldedk`) via your normal migration path (Supabase SQL editor or CLI). Confirm:

Run (SQL): `select column_name from information_schema.columns where table_name='corridors' and column_name='baseline_duration_s';`
Expected: one row.

- [ ] **Step 3: Deploy (project flow)**

```bash
git checkout main && git merge --ff-only <feature-branch> && git push origin main
vercel --prod --yes
```

Expected: `readyState: READY`, aliased to `insu-theta.vercel.app`. Because every `baseline_duration_s` is still `NULL`, the oracle keeps using free-flow — **behavior is unchanged in production.** This is intentional: Phase 1 is the safe substrate.

---

## Phase 2 — Compute per-corridor baselines (build now, run when data is ready)

### Task 7: Baseline computation script

**Files:**
- Create: `scripts/compute-corridor-baselines.mjs`

> Mirrors `scripts/tune-base-probability.mjs`. Computes each corridor's **median weekday** in-window `duration_s` from `oracle_readings` (the poller only writes in-window readings, so no extra time filtering is needed). Dry-run by default; `--apply` writes `corridors.baseline_duration_s`. Gated by sample count.

- [ ] **Step 1: Write the script**

```js
// scripts/compute-corridor-baselines.mjs
// Read-only analysis: per corridor, median WEEKDAY in-window trip duration from
// oracle_readings.value.duration_s. Pass --apply to UPDATE corridors.baseline_duration_s.
// Canonical metric formula lives in lib/oracle/trafficIndex.ts; this script only
// needs the median of duration_s, so no index math here.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = { ...process.env }
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no .env.local — rely on process.env */ }
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Aborting.')
  process.exit(2)
}

const APPLY = process.argv.includes('--apply')
const MIN_READINGS = 20      // need a reasonable sample before trusting a median
const MIN_WEEKDAYS = 5       // spread across at least 5 distinct weekdays
const db = createClient(url, key, { auth: { persistSession: false } })

function median(nums) {
  if (nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}
const isWeekday = (d) => { const g = d.getUTCDay(); return g >= 1 && g <= 5 }

// Corridors and the contract(s) that reference them.
const { data: corridors, error: cErr } = await db
  .from('corridors').select('id, slug, name')
if (cErr) throw cErr
const { data: contracts, error: ctErr } = await db
  .from('contracts').select('id, corridor_id').eq('trigger_type', 'urban')
if (ctErr) throw ctErr
const contractsByCorridor = new Map()
for (const c of contracts ?? []) {
  if (!c.corridor_id) continue
  const arr = contractsByCorridor.get(c.corridor_id) ?? []
  arr.push(c.id); contractsByCorridor.set(c.corridor_id, arr)
}

const PAGE = 1000
async function durations(contractIds) {
  const out = [] // { durationS, day, weekday }
  for (const cid of contractIds) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('oracle_readings')
        .select('read_at, value')
        .eq('contract_id', cid)
        .order('read_at', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      for (const r of data) {
        const dur = Number(r.value?.duration_s)
        if (!Number.isFinite(dur) || dur <= 0) continue
        const d = new Date(r.read_at)
        out.push({ durationS: dur, day: d.toISOString().slice(0, 10), weekday: isWeekday(d) })
      }
      if (data.length < PAGE) break
    }
  }
  return out
}

const rows = []
for (const corr of corridors ?? []) {
  const ids = contractsByCorridor.get(corr.id) ?? []
  const all = ids.length ? await durations(ids) : []
  const weekday = all.filter((r) => r.weekday)
  const distinctWeekdays = new Set(weekday.map((r) => r.day)).size
  const med = median(weekday.map((r) => r.durationS))
  rows.push({ slug: corr.slug, name: corr.name, id: corr.id, n: weekday.length, distinctWeekdays, median: med })
}

rows.sort((a, b) => b.n - a.n)
console.log('\n  corridor                                  n(wd)  days   median_s   confidence')
console.log('  ' + '-'.repeat(74))
for (const r of rows) {
  const conf = r.n >= MIN_READINGS && r.distinctWeekdays >= MIN_WEEKDAYS ? 'ok' : r.n > 0 ? 'low' : 'NONE'
  const name = (r.name ?? r.slug).slice(0, 38).padEnd(38)
  const med = r.median === null ? '   n/a' : String(r.median).padStart(8)
  console.log(`  ${name} ${String(r.n).padStart(5)} ${String(r.distinctWeekdays).padStart(5)}   ${med}    ${conf}`)
}
console.log('')

if (APPLY) {
  let updated = 0, skipped = 0
  for (const r of rows) {
    if (r.median === null || r.n < MIN_READINGS || r.distinctWeekdays < MIN_WEEKDAYS) { skipped++; continue }
    const { error } = await db.from('corridors').update({ baseline_duration_s: r.median }).eq('id', r.id)
    if (error) { console.error(`  FAIL ${r.slug}: ${error.message}`); continue }
    updated++
    console.log(`  applied baseline_duration_s=${r.median} -> ${r.slug}`)
  }
  console.log(`\n  Done. Updated ${updated}; skipped ${skipped} (insufficient history -> kept free-flow fallback).`)
} else {
  console.log(`  (dry run — re-run with --apply to write; needs >=${MIN_READINGS} weekday readings across >=${MIN_WEEKDAYS} days)\n`)
}
```

- [ ] **Step 2: Smoke-run the dry-run against staging**

Run: `node scripts/compute-corridor-baselines.mjs`
Expected: a table prints without error. With thin history, most corridors show `confidence = low` or `NONE` and nothing would be written. **This is the verification** (operator-script convention — no vitest).

- [ ] **Step 3: Commit**

```bash
git add scripts/compute-corridor-baselines.mjs
git commit -m "feat(scripts): compute per-corridor typical-duration baselines"
```

---

## Phase 3 — Recalibrate base_probability under the new baseline (build now, run when data is ready)

### Task 8: Recalibration script

**Files:**
- Create: `scripts/recalibrate-base-probability.mjs`

> Recomputes, per urban contract that HAS a `baseline_duration_s`, the daily breach frequency = (distinct days with `trafficIndex(duration_s, baseline) > threshold`) / (distinct days with any reading), then writes `coverage_tiers.base_probability`. It recomputes the index from `duration_s` + baseline rather than trusting the stored `trigger_met` (which mixes pre/post-rebaseline values). Supersedes `tune-base-probability.mjs` for urban corridors. Dry-run / `--apply`, gated by ≥7 days.

- [ ] **Step 1: Write the script**

```js
// scripts/recalibrate-base-probability.mjs
// Per urban contract WITH a corridor baseline_duration_s: recompute daily breach
// frequency under the NEW baseline and write coverage_tiers.base_probability.
// Mirrors the canonical formula in lib/oracle/trafficIndex.ts (inlined below).
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

const APPLY = process.argv.includes('--apply')
const P_MIN = 0.0005, P_MAX = 0.95, MIN_DAYS = 7
const TRAFFIC_INDEX_MAX = 100 // keep in sync with lib/oracle/trafficIndex.ts
const db = createClient(url, key, { auth: { persistSession: false } })

// Canonical traffic-index formula (mirror of lib/oracle/trafficIndex.ts).
function trafficIndex(durationS, baselineS) {
  if (!baselineS || baselineS <= 0) return 0
  const raw = ((durationS / baselineS) - 1) * 100
  return Math.min(TRAFFIC_INDEX_MAX, Math.max(0, Math.round(raw)))
}

const { data: contracts, error: cErr } = await db
  .from('contracts')
  .select('id, title, corridor_id, trigger_condition, corridor:corridors(baseline_duration_s)')
  .eq('trigger_type', 'urban')
if (cErr) throw cErr

const PAGE = 1000
async function breachStats(contractId, baselineS, threshold) {
  const allDays = new Set(), breachDays = new Set()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('oracle_readings').select('read_at, value')
      .eq('contract_id', contractId)
      .order('read_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const r of data) {
      const dur = Number(r.value?.duration_s)
      if (!Number.isFinite(dur) || dur <= 0) continue
      const day = new Date(r.read_at).toISOString().slice(0, 10)
      allDays.add(day)
      if (trafficIndex(dur, baselineS) > threshold) breachDays.add(day)
    }
    if (data.length < PAGE) break
  }
  return { totalDays: allDays.size, breachDays: breachDays.size }
}

const rows = []
for (const c of contracts ?? []) {
  const baselineS = c.corridor?.baseline_duration_s ?? null
  const threshold = Number(c.trigger_condition?.threshold)
  if (!baselineS || !Number.isFinite(threshold)) {
    rows.push({ id: c.id, title: c.title, totalDays: 0, breachDays: 0, raw: null, tuned: null, note: 'no baseline' })
    continue
  }
  const { totalDays, breachDays } = await breachStats(c.id, baselineS, threshold)
  const raw = totalDays > 0 ? breachDays / totalDays : null
  const tuned = raw === null ? null : Math.min(P_MAX, Math.max(P_MIN, raw))
  rows.push({ id: c.id, title: c.title, totalDays, breachDays, raw, tuned, note: '' })
}

rows.sort((a, b) => b.totalDays - a.totalDays)
console.log('\n  contract                                  days  breach   raw      -> tuned p   confidence')
console.log('  ' + '-'.repeat(92))
for (const r of rows) {
  const conf = r.note || (r.totalDays >= 30 ? 'high' : r.totalDays >= MIN_DAYS ? 'med' : r.totalDays > 0 ? 'low' : 'NONE')
  const title = (r.title ?? '(untitled)').slice(0, 38).padEnd(38)
  const raw = r.raw === null ? '   n/a' : r.raw.toFixed(4)
  const tuned = r.tuned === null ? '  (keep)' : r.tuned.toFixed(4)
  console.log(`  ${title} ${String(r.totalDays).padStart(4)} ${String(r.breachDays).padStart(6)}   ${raw}   -> ${tuned}    ${conf}`)
}
console.log('')

if (APPLY) {
  let updated = 0, skipped = 0
  for (const r of rows) {
    if (r.tuned === null || r.totalDays < MIN_DAYS) { skipped++; continue }
    const { error } = await db.from('coverage_tiers').update({ base_probability: r.tuned }).eq('contract_id', r.id)
    if (error) { console.error(`  FAIL ${r.title}: ${error.message}`); continue }
    updated++
    console.log(`  applied base_probability=${r.tuned.toFixed(4)} -> ${r.title}`)
  }
  console.log(`\n  Done. Updated ${updated}; skipped ${skipped} (no baseline / <${MIN_DAYS} days).`)
} else {
  console.log(`  (dry run — re-run with --apply; needs a corridor baseline + >=${MIN_DAYS} days of readings)\n`)
}
```

- [ ] **Step 2: Smoke-run the dry-run against staging**

Run: `node scripts/recalibrate-base-probability.mjs`
Expected: prints a table; with no baselines set yet, every row shows `no baseline` and nothing writes. Verification = output review.

- [ ] **Step 3: Commit**

```bash
git add scripts/recalibrate-base-probability.mjs
git commit -m "feat(scripts): recalibrate base_probability from rebaselined traffic index"
```

---

## Go-Live Runbook (DEFERRED — execute when ≥ ~2–4 weeks of in-window readings exist)

This is the part that actually fixes the premium-vs-payout symptom. Do NOT run with thin history.

- [ ] **1. Confirm data depth.** `node scripts/compute-corridor-baselines.mjs` — proceed only for corridors showing `confidence = ok`.
- [ ] **2. Set baselines.** `node scripts/compute-corridor-baselines.mjs --apply`
- [ ] **3. Recalibrate probabilities.** `node scripts/recalibrate-base-probability.mjs --apply` (depends on step 2 having written baselines).
- [ ] **4. Reprice tiers.** Trigger the existing reprice job (`lib/pricing/reprice.ts` via its cron/API route) so `coverage_tiers.premium_usd` refreshes from the new `base_probability`.
- [ ] **5. Verify the fix.** On a calibrated corridor, confirm Basic `premium_usd < payout_usd` and the 30-day quote shows premium as a sensible fraction of the cap. Spot-check that `traffic_index` on recent readings sits near 0 except during genuine disruptions.
- [ ] **6. Update memory.** Mark `project_trigger_calibration` and `project_recurring_pricing_rollout` as calibrated (record the date and which corridors).

**Future improvements (not in this plan):** condition the baseline on day-of-week / season (needs a baselines table or extra columns); raise `TRAFFIC_INDEX_MAX` once the multiplier behavior on extreme events is reviewed; optionally bootstrap baselines from Google's historical/typical duration to shorten the data-wait.

---

## Self-Review

**1. Spec coverage:**
- "Measure against typical rush hour, keep 50% threshold" → Tasks 1–4 (formula + fetcher + wiring), threshold untouched. ✓
- "Behavior-preserving until data ready" → free-flow fallback (Task 2), NULL column default (Task 3), Phase-1-is-no-op note. ✓
- "Take note that recalibration is deferred / data-thin" → already saved to memory `project_trigger_calibration`; Go-Live Runbook gates on data depth. ✓
- "Lower base_probability together with the baseline (don't underprice a near-certain payout)" → Phase 3 recomputes from history and is gated; runbook sequences baseline→probability→reprice. ✓
- "Per-corridor calibration" → both scripts iterate per corridor/contract. ✓
- "Day-of-week conditioning" → weekday filter in Task 7; fuller version listed as future improvement. ✓
- "Revisit clamp + description copy" → clamp noted as future; copy handled in Task 5. ✓

**2. Placeholder scan:** No TBD/TODO/"add error handling" — every code step has complete code. The only soft spot is Task 4 Step 1, which references the existing `poll.test.ts` db-stub helper rather than reproducing it; this is deliberate (reuse the suite's established in-window stub) and the assertion itself is concrete.

**3. Type/name consistency:** `trafficIndex(durationS, baselineS)` and `TRAFFIC_INDEX_MAX` are used identically in `trafficIndex.ts`, the fetcher, and (mirrored, with a sync comment) in the Phase 3 script. `baseline_duration_s` is the column name (migration), the `Corridor` field (types), the reading-value key (fetcher), and the script update target — consistent everywhere. `fetchGoogleMapsReading`'s new 6th param `baselineDurationS` is `number | null`, matching `corridor.baseline_duration_s`.
