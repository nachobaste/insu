# Credibility-Weighted Corridor Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blend Google Routes API future-departure traffic predictions (model prior) with harvested `oracle_readings` history (observed experience) to calibrate corridor `baseline_duration_s` and per-contract `base_probability`, so new corridors are priced sensibly from day one and weight shifts to real data as it accumulates.

**Architecture:** A new server-side endpoint `/api/calibrate` (CRON_SECRET-authed, needs the server-only `GOOGLE_MAPS_API_KEY`) samples Google's historical traffic model via future `departureTime` requests and returns raw predicted durations + a bad-day/good-day envelope per corridor. A new local CLI script `scripts/calibrate-corridors.mjs` combines those predictions with harvested reading statistics using credibility weighting (baselines) and a Beta-Binomial prior (probabilities), prints a dry-run report with validation gates, and writes to `corridors` / `coverage_tiers` only behind explicit `--apply-*` flags. Pure math lives in `scripts/lib/calibration-math.mjs` (vitest-tested); the Routes API sampler lives in `lib/calibration/predictedTraffic.ts` (vitest-tested, imported by the route).

**Tech Stack:** Next.js App Router (route handler), Google Routes API v2 `computeRoutes`, Supabase (service role), Node ESM scripts, Vitest.

---

## Domain context (read this first)

The executor is assumed to know nothing about this codebase. Key facts:

- **Product:** parametric traffic insurance. Each urban *corridor* (a road segment, e.g. `bicentenario-am`) has a commute window (`window_start`/`window_end`, local time). A *contract* triggers when a Google-measured trip duration exceeds the corridor's **typical rush-hour baseline** by more than `trigger_condition.threshold` percent (currently 50 for all urban contracts).
- **Two calibration knobs:**
  1. `corridors.baseline_duration_s` — typical weekday in-window trip duration (seconds). Currently the median of harvested readings; **3 Guatemala corridors have NULL** (`gt-cesa-zona10-pm`, `gt-roosevelt-sanlucas-pm`, `gt-roosevelt-zona11-am`) and since PR#23 a NULL baseline means **their triggers cannot fire at all**.
  2. `coverage_tiers.base_probability` — modeled probability (per day) that the trigger breaches; premium is linear in it (`lib/pricing/engine.ts:43`). Urban tiers sit at a conservative 0.12/day placeholder vs pooled measured ≈0.07.
- **The existing recalibration script** (`scripts/recalibrate-base-probability.mjs`) floors zero-breach corridors to `P_MIN = 0.0005`, which would produce near-free premiums off thin history — that's why applying it was deferred. The Beta-Binomial prior in this plan removes that failure mode.
- **Validated 2026-07-09 (PoC):** Routes API rejects past `departureTime` for DRIVE but accepts future ones; far-future durations come from Google's historical model. Across the 13 calibrated corridors, the median of 6 in-window future-slot predictions landed within mean |diff| 9.4% (worst ±21%) of harvested baselines. `trafficModel: PESSIMISTIC/OPTIMISTIC` (requires `routingPreference: TRAFFIC_AWARE_OPTIMAL`, pricier SKU) returns bad-day/good-day historical durations — the day-to-day spread we turn into a probability prior.
- **Key constraint:** the server `GOOGLE_MAPS_API_KEY` (Routes-API-enabled, no referrer restriction) exists **only in Vercel prod env** — it is *not* in `.env.local` and cannot be read from Vercel. Therefore all Routes API calls must happen server-side in prod; local scripts talk to the new endpoint using `CRON_SECRET` (which *is* in `.env.local`). Do NOT use `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` with a spoofed Referer header anywhere in committed code.
- **Time zones:** Mexico City and Guatemala City are both fixed UTC-6, no DST. Local window → UTC = +6h. This constant is already assumed elsewhere (`.github/workflows/oracle-poll-urban.yml`).
- **Deploys:** merging to main does NOT deploy. Prod deploy = `vercel --prod --yes` from a main checkout. DB migrations = `supabase db push --linked < /dev/null` (single Supabase project `eagmczieznsogsxldedk` = production; there is no staging).
- **Tests:** `npm run test:run` (vitest, jsdom, `@/` alias = repo root). Existing fetch-mocking convention: `vi.stubGlobal('fetch', mockFetch)` (see `tests/lib/oracle/fetcher.test.ts`).

### The math (canonical reference for every task below)

- **Credibility weight:** `w = n / (n + K)` where `n` = distinct harvested weekday-days, `K = 10` (at 10 weekday-days of history, harvested and predicted weigh 50/50).
- **Blended baseline:** `round(w · harvestedMedian + (1 − w) · predictedMedian)`. Source label: `harvested` (no prediction), `predicted` (no harvested data), else `blended`.
- **Lognormal day-to-day model:** treat trip duration on a given day as lognormal. `PESSIMISTIC` and `OPTIMISTIC` are symmetric quantiles at unknown standard-normal offset `z`: `sigma = ln(pess/opt) / (2z)`, `mu = ln(best)` (BEST_GUESS ≈ median). Model breach probability: `pModel = 1 − Φ((ln(baseline · (1 + threshold/100)) − mu) / sigma)`.
- **Global z fit:** `z` is a single global parameter (Google doesn't document which percentile "bad day" is). Grid-search `z ∈ [0.5, 2.5]` step 0.01 minimizing `|pooledModel(z) − pooledMeasured|`, where pooled = reading-day-weighted across corridors with enough history. Fitting z against our own 13 measured corridors also absorbs the peak-slot approximation error (we evaluate the envelope at the corridor's peak slot, not the whole window).
- **Beta-Binomial posterior:** `pPost = (M · pModel + breachDays) / (M + totalDays)` with prior strength `M = 20` pseudo-days; clamp to `[P_MIN=0.0005, P_MAX=0.95]`. New corridor (n=0) → pure model prior; mature corridor → dominated by measured frequency. This is exactly the requested "weight shifts from prediction to harvest" behavior and it replaces the dangerous P_MIN flooring.
- **Ordering matters:** breach statistics must be computed against the **proposed (blended) baseline**, not the current one — the baseline defines what counts as a breach.

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260709120000_add_baseline_source.sql` | Create: provenance column for baselines |
| `scripts/lib/calibration-math.mjs` | Create: pure math (median, credibility, lognormal, Beta-Binomial, z-fit) |
| `tests/scripts/calibration-math.test.ts` | Create: unit tests for the math |
| `lib/calibration/predictedTraffic.ts` | Create: departure grid + Routes API sampler (server-side) |
| `tests/lib/calibration/predictedTraffic.test.ts` | Create: grid + sampler tests (mocked fetch) |
| `app/api/calibrate/route.ts` | Create: CRON_SECRET-authed endpoint returning predictions per corridor |
| `tests/app/calibrate-route.test.ts` | Create: route auth/param/happy-path tests |
| `scripts/calibrate-corridors.mjs` | Create: CLI orchestrator (dry-run report, `--apply-baselines`, `--apply-probabilities`) |

Existing scripts `compute-corridor-baselines.mjs` / `recalibrate-base-probability.mjs` are left untouched (harvested-only fallbacks); the new CLI supersedes them for routine use.

---

### Task 1: Migration — `corridors.baseline_source`

**Files:**
- Create: `supabase/migrations/20260709120000_add_baseline_source.sql`

- [ ] **Step 1: Create a feature branch**

```bash
cd /Users/gerardobasterrechea/Documents/GitHub/insu
git checkout main && git pull && git checkout -b feat/credibility-calibration
```

- [ ] **Step 2: Write the migration**

```sql
-- Provenance for corridors.baseline_duration_s so calibration reviews know
-- which values are measured medians vs Google-model-derived vs a blend.
alter table public.corridors
  add column if not exists baseline_source text
    check (baseline_source in ('harvested', 'predicted', 'blended'));

comment on column public.corridors.baseline_source is
  'How baseline_duration_s was produced: harvested (median of oracle_readings), predicted (Google future-departureTime model), blended (credibility-weighted mix).';
```

Note: no new tables, no uuid defaults (so the `gen_random_uuid()` vs `uuid_generate_v4()` deploy gotcha does not apply). Do NOT push to prod yet — that happens in Task 9 after review.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260709120000_add_baseline_source.sql
git commit -m "feat(calibration): add corridors.baseline_source provenance column"
```

---

### Task 2: Math module — median, credibility weight, baseline blending

**Files:**
- Create: `scripts/lib/calibration-math.mjs`
- Test: `tests/scripts/calibration-math.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/scripts/calibration-math.test.ts
import { describe, it, expect } from 'vitest'
import {
  median,
  credibilityWeight,
  blendBaseline,
} from '../../scripts/lib/calibration-math.mjs'

describe('median', () => {
  it('returns null for empty input', () => {
    expect(median([])).toBeNull()
  })
  it('returns the middle element for odd length', () => {
    expect(median([3, 1, 2])).toBe(2)
  })
  it('returns the rounded mean of the two middle elements for even length', () => {
    expect(median([1, 2, 3, 10])).toBe(3) // (2+3)/2 = 2.5 -> rounds to 3
  })
})

describe('credibilityWeight', () => {
  it('is 0 with no observations', () => {
    expect(credibilityWeight(0, 10)).toBe(0)
  })
  it('is 0.5 when n equals K', () => {
    expect(credibilityWeight(10, 10)).toBe(0.5)
  })
  it('approaches 1 as n grows', () => {
    expect(credibilityWeight(90, 10)).toBe(0.9)
  })
})

describe('blendBaseline', () => {
  it('returns pure prediction when there is no harvested data', () => {
    expect(
      blendBaseline({ harvestedMedianS: null, harvestedWeekdayDays: 0, predictedMedianS: 2856, k: 10 }),
    ).toEqual({ baselineS: 2856, source: 'predicted' })
  })
  it('returns pure harvested when there is no prediction', () => {
    expect(
      blendBaseline({ harvestedMedianS: 3110, harvestedWeekdayDays: 12, predictedMedianS: null, k: 10 }),
    ).toEqual({ baselineS: 3110, source: 'harvested' })
  })
  it('blends 50/50 at n = K', () => {
    expect(
      blendBaseline({ harvestedMedianS: 3110, harvestedWeekdayDays: 10, predictedMedianS: 2856, k: 10 }),
    ).toEqual({ baselineS: 2983, source: 'blended' }) // 0.5*3110 + 0.5*2856 = 2983
  })
  it('returns null baseline when neither input exists', () => {
    expect(
      blendBaseline({ harvestedMedianS: null, harvestedWeekdayDays: 0, predictedMedianS: null, k: 10 }),
    ).toEqual({ baselineS: null, source: null })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/scripts/calibration-math.test.ts`
Expected: FAIL — cannot resolve `scripts/lib/calibration-math.mjs`.

- [ ] **Step 3: Write the implementation**

```js
// scripts/lib/calibration-math.mjs
// Pure calibration math shared by scripts/calibrate-corridors.mjs.
// Formulas documented in docs/superpowers/plans/2026-07-09-credibility-weighted-calibration.md.

/** Median of a numeric array, rounded to an integer. Null for empty input. */
export function median(nums) {
  if (!nums || nums.length === 0) return null
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/** Classical credibility weight w = n / (n + k). */
export function credibilityWeight(n, k) {
  if (!Number.isFinite(n) || n <= 0) return 0
  return n / (n + k)
}

/**
 * Blend a harvested median with a model-predicted median.
 * Returns { baselineS, source } where source ∈ 'harvested'|'predicted'|'blended'|null.
 */
export function blendBaseline({ harvestedMedianS, harvestedWeekdayDays, predictedMedianS, k }) {
  const hasHarvested = Number.isFinite(harvestedMedianS) && harvestedMedianS > 0
  const hasPredicted = Number.isFinite(predictedMedianS) && predictedMedianS > 0
  if (!hasHarvested && !hasPredicted) return { baselineS: null, source: null }
  if (!hasPredicted) return { baselineS: harvestedMedianS, source: 'harvested' }
  if (!hasHarvested) return { baselineS: predictedMedianS, source: 'predicted' }
  const w = credibilityWeight(harvestedWeekdayDays, k)
  return { baselineS: Math.round(w * harvestedMedianS + (1 - w) * predictedMedianS), source: 'blended' }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scripts/calibration-math.test.ts`
Expected: PASS (all `median`, `credibilityWeight`, `blendBaseline` tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/calibration-math.mjs tests/scripts/calibration-math.test.ts
git commit -m "feat(calibration): median, credibility weight, baseline blending"
```

---

### Task 3: Math module — lognormal breach probability

**Files:**
- Modify: `scripts/lib/calibration-math.mjs` (append)
- Test: `tests/scripts/calibration-math.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

```ts
// append to tests/scripts/calibration-math.test.ts — extend the import line first:
// import { median, credibilityWeight, blendBaseline, normCdf, sigmaFromEnvelope, breachProbability }
//   from '../../scripts/lib/calibration-math.mjs'

describe('normCdf', () => {
  it('is 0.5 at 0', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6)
  })
  it('matches the 95th percentile', () => {
    expect(normCdf(1.645)).toBeCloseTo(0.95, 3)
  })
  it('is symmetric', () => {
    expect(normCdf(-1.645)).toBeCloseTo(0.05, 3)
  })
})

describe('sigmaFromEnvelope', () => {
  it('computes sigma = ln(pess/opt) / (2z)', () => {
    // ln(5959/1901) = ln(3.1347) = 1.1426; / (2*1.2816) = 0.4458
    expect(sigmaFromEnvelope(1901, 5959, 1.2816)).toBeCloseTo(0.4458, 3)
  })
  it('returns null for degenerate input', () => {
    expect(sigmaFromEnvelope(0, 5959, 1.2816)).toBeNull()
    expect(sigmaFromEnvelope(2000, 2000, 1.2816)).toBeNull() // zero spread
  })
})

describe('breachProbability', () => {
  it('computes P(X > baseline * (1 + threshold/100)) under lognormal(mu, sigma)', () => {
    // mu = ln(3000), sigma = 0.4, baseline = 3000, threshold = 50
    // x = ln(1.5)/0.4 = 1.0137 -> p = 1 - Phi(1.0137) ≈ 0.1554
    const p = breachProbability({ baselineS: 3000, thresholdPct: 50, muLog: Math.log(3000), sigma: 0.4 })
    expect(p).toBeCloseTo(0.1554, 2)
  })
  it('is higher when the typical duration already sits above the baseline', () => {
    const pAtBaseline = breachProbability({ baselineS: 3000, thresholdPct: 50, muLog: Math.log(3000), sigma: 0.4 })
    const pAboveBaseline = breachProbability({ baselineS: 2500, thresholdPct: 50, muLog: Math.log(3000), sigma: 0.4 })
    expect(pAboveBaseline).toBeGreaterThan(pAtBaseline)
  })
  it('returns null when sigma is invalid', () => {
    expect(breachProbability({ baselineS: 3000, thresholdPct: 50, muLog: Math.log(3000), sigma: null })).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/scripts/calibration-math.test.ts`
Expected: FAIL — `normCdf` is not exported.

- [ ] **Step 3: Append the implementation**

```js
// append to scripts/lib/calibration-math.mjs

/** Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation (|err| < 1.5e-7). */
export function normCdf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2)
  const y =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  const erf = 1 - y * Math.exp(-(x * x) / 2)
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf)
}

/**
 * Lognormal sigma implied by treating OPTIMISTIC/PESSIMISTIC as symmetric
 * quantiles at standard-normal offset z: sigma = ln(pess/opt) / (2z).
 */
export function sigmaFromEnvelope(optS, pessS, z) {
  if (!Number.isFinite(optS) || !Number.isFinite(pessS) || optS <= 0 || pessS <= optS) return null
  if (!Number.isFinite(z) || z <= 0) return null
  return Math.log(pessS / optS) / (2 * z)
}

/** P(duration > baseline * (1 + threshold/100)) under lognormal(muLog, sigma). */
export function breachProbability({ baselineS, thresholdPct, muLog, sigma }) {
  if (!Number.isFinite(baselineS) || baselineS <= 0) return null
  if (!Number.isFinite(muLog) || !Number.isFinite(sigma) || sigma == null || sigma <= 0) return null
  const cutoff = Math.log(baselineS * (1 + thresholdPct / 100))
  return 1 - normCdf((cutoff - muLog) / sigma)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scripts/calibration-math.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/calibration-math.mjs tests/scripts/calibration-math.test.ts
git commit -m "feat(calibration): lognormal breach probability from prediction envelope"
```

---

### Task 4: Math module — Beta-Binomial posterior and global z fit

**Files:**
- Modify: `scripts/lib/calibration-math.mjs` (append)
- Test: `tests/scripts/calibration-math.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

```ts
// append to tests/scripts/calibration-math.test.ts — extend the import with betaBlend, fitZ

describe('betaBlend', () => {
  it('returns the pure prior with no observed days', () => {
    expect(betaBlend({ pModel: 0.1, priorDays: 20, breachDays: 0, totalDays: 0 })).toBeCloseTo(0.1, 10)
  })
  it('shrinks toward zero with clean observed days (no P_MIN collapse)', () => {
    // (20*0.1 + 0) / (20 + 15) = 2/35 ≈ 0.0571 — NOT floored to 0.0005
    expect(betaBlend({ pModel: 0.1, priorDays: 20, breachDays: 0, totalDays: 15 })).toBeCloseTo(0.05714, 4)
  })
  it('moves above the prior when breaches exceed the model rate', () => {
    // (20*0.1 + 3) / (20 + 15) = 5/35 ≈ 0.1429
    expect(betaBlend({ pModel: 0.1, priorDays: 20, breachDays: 3, totalDays: 15 })).toBeCloseTo(0.14286, 4)
  })
  it('converges to the observed frequency as data accumulates', () => {
    const p = betaBlend({ pModel: 0.1, priorDays: 20, breachDays: 35, totalDays: 500 })
    expect(p).toBeCloseTo(35 / 500, 1)
  })
  it('falls back to the observed frequency when there is no model prior', () => {
    expect(betaBlend({ pModel: null, priorDays: 20, breachDays: 3, totalDays: 15 })).toBeCloseTo(0.2, 10)
    expect(betaBlend({ pModel: null, priorDays: 20, breachDays: 0, totalDays: 0 })).toBeNull()
  })
})

describe('fitZ', () => {
  it('recovers the z implied by a corridor whose measured rate matches the model exactly', () => {
    // Constructed so pModel(z) = 1 - Phi(z): opt=2000, pess=4500, best=3000, baseline=3000, t=50
    //   sigma = ln(2.25)/(2z) and ln(1.5)/sigma = z  (since ln(2.25) = 2 ln(1.5))
    // Measured rate 0.1 -> 1 - Phi(z) = 0.1 -> z ≈ 1.2816
    const corridors = [{
      optS: 2000, pessS: 4500, bestS: 3000,
      baselineS: 3000, thresholdPct: 50,
      breachDays: 2, totalDays: 20, // measured 0.1
    }]
    const { z, pooledMeasured, pooledModel } = fitZ(corridors)
    expect(pooledMeasured).toBeCloseTo(0.1, 10)
    expect(z).toBeGreaterThan(1.2)
    expect(z).toBeLessThan(1.36)
    expect(pooledModel).toBeCloseTo(0.1, 1)
  })
  it('ignores corridors without enough data or without an envelope', () => {
    const corridors = [
      { optS: 2000, pessS: 4500, bestS: 3000, baselineS: 3000, thresholdPct: 50, breachDays: 2, totalDays: 20 },
      { optS: null, pessS: null, bestS: null, baselineS: 2500, thresholdPct: 50, breachDays: 9, totalDays: 10 },
      { optS: 2000, pessS: 4500, bestS: 3000, baselineS: 3000, thresholdPct: 50, breachDays: 0, totalDays: 3 }, // < minDays
    ]
    const { z } = fitZ(corridors, { minDays: 7 })
    expect(z).toBeGreaterThan(1.2)
    expect(z).toBeLessThan(1.36)
  })
  it('returns null z when no corridor qualifies', () => {
    expect(fitZ([], {}).z).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/scripts/calibration-math.test.ts`
Expected: FAIL — `betaBlend` is not exported.

- [ ] **Step 3: Append the implementation**

```js
// append to scripts/lib/calibration-math.mjs

/**
 * Beta-Binomial credibility posterior:
 *   pPost = (priorDays * pModel + breachDays) / (priorDays + totalDays)
 * With no model prior, falls back to the raw observed frequency (null if no data).
 */
export function betaBlend({ pModel, priorDays, breachDays, totalDays }) {
  const hasModel = Number.isFinite(pModel)
  if (!hasModel) return totalDays > 0 ? breachDays / totalDays : null
  return (priorDays * pModel + breachDays) / (priorDays + totalDays)
}

/**
 * Grid-search the single global quantile offset z so that the reading-day-weighted
 * pooled model breach rate matches the pooled measured breach rate.
 * corridors: [{ optS, pessS, bestS, baselineS, thresholdPct, breachDays, totalDays }]
 * Only corridors with a valid envelope, a baseline, and totalDays >= minDays participate.
 */
export function fitZ(corridors, { zMin = 0.5, zMax = 2.5, zStep = 0.01, minDays = 7 } = {}) {
  const usable = (corridors ?? []).filter(
    (c) =>
      Number.isFinite(c.optS) && Number.isFinite(c.pessS) && Number.isFinite(c.bestS) &&
      c.optS > 0 && c.pessS > c.optS && c.bestS > 0 &&
      Number.isFinite(c.baselineS) && c.baselineS > 0 &&
      Number.isFinite(c.totalDays) && c.totalDays >= minDays,
  )
  if (usable.length === 0) return { z: null, pooledMeasured: null, pooledModel: null }

  const totalN = usable.reduce((a, c) => a + c.totalDays, 0)
  const pooledMeasured = usable.reduce((a, c) => a + c.breachDays, 0) / totalN

  const pooledModelAt = (z) =>
    usable.reduce((acc, c) => {
      const sigma = sigmaFromEnvelope(c.optS, c.pessS, z)
      const p = breachProbability({
        baselineS: c.baselineS, thresholdPct: c.thresholdPct, muLog: Math.log(c.bestS), sigma,
      })
      return acc + (p ?? 0) * c.totalDays
    }, 0) / totalN

  let best = { z: null, diff: Infinity, pooledModel: null }
  for (let z = zMin; z <= zMax + 1e-9; z += zStep) {
    const pm = pooledModelAt(z)
    const diff = Math.abs(pm - pooledMeasured)
    if (diff < best.diff) best = { z: Math.round(z * 100) / 100, diff, pooledModel: pm }
  }
  return { z: best.z, pooledMeasured, pooledModel: best.pooledModel }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/scripts/calibration-math.test.ts`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/calibration-math.mjs tests/scripts/calibration-math.test.ts
git commit -m "feat(calibration): beta-binomial posterior and global z fit"
```

---

### Task 5: `lib/calibration/predictedTraffic.ts` — departure grid

**Files:**
- Create: `lib/calibration/predictedTraffic.ts`
- Test: `tests/lib/calibration/predictedTraffic.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/calibration/predictedTraffic.test.ts
import { describe, it, expect } from 'vitest'
import { buildDepartureGrid } from '@/lib/calibration/predictedTraffic'

describe('buildDepartureGrid', () => {
  // 2026-07-09 is a Thursday -> next Monday is 2026-07-13
  const from = new Date('2026-07-09T15:00:00Z')

  it('covers Mon-Fri of the next full week at 30-min steps within the window', () => {
    const grid = buildDepartureGrid('07:00:00', '10:00:00', from)
    expect(grid).toHaveLength(30) // 6 slots x 5 weekdays
    expect(grid[0]).toEqual({
      departureTime: '2026-07-13T13:00:00Z', // 07:00 local = 13:00 UTC (fixed UTC-6)
      date: '2026-07-13',
      slot: '07:00',
    })
    expect(grid[5].slot).toBe('09:30') // last slot strictly before window_end
    expect(grid[29].date).toBe('2026-07-17') // Friday
  })

  it('handles UTC date rollover for evening windows', () => {
    const grid = buildDepartureGrid('17:00:00', '20:00:00', from)
    const slot1830 = grid.find((g) => g.date === '2026-07-13' && g.slot === '18:30')
    expect(slot1830?.departureTime).toBe('2026-07-14T00:30:00Z') // 18:30 local Monday = 00:30 UTC Tuesday
  })

  it('always starts strictly in the future even when called on a Monday', () => {
    const monday = new Date('2026-07-13T18:00:00Z')
    const grid = buildDepartureGrid('07:00:00', '10:00:00', monday)
    expect(grid[0].date).toBe('2026-07-20') // skips to the NEXT Monday
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/calibration/predictedTraffic.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// lib/calibration/predictedTraffic.ts
// Samples Google's historical traffic model by requesting routes at FUTURE
// departure times (past departureTime is transit-only). Server-side only:
// requires the Routes-API-enabled GOOGLE_MAPS_API_KEY.

const UTC_OFFSET_HOURS = 6 // CDMX and Guatemala City are both fixed UTC-6 (no DST)
const DAY_MS = 86_400_000

export interface DepartureSlot {
  departureTime: string // ISO UTC, e.g. 2026-07-13T13:00:00Z
  date: string // local calendar date of the slot, YYYY-MM-DD
  slot: string // local time label, e.g. 07:30
}

/**
 * Grid of departure times covering Mon-Fri of the next full week (strictly in
 * the future) at `intervalMin` steps across the corridor's local window.
 */
export function buildDepartureGrid(
  windowStart: string,
  windowEnd: string,
  from: Date,
  intervalMin = 30,
): DepartureSlot[] {
  const startOfDay = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const daysUntilMonday = (8 - startOfDay.getUTCDay()) % 7 || 7
  const monday = new Date(startOfDay.getTime() + daysUntilMonday * DAY_MS)

  const [sh, sm] = windowStart.split(':').map(Number)
  const [eh, em] = windowEnd.split(':').map(Number)
  const slots: DepartureSlot[] = []
  for (let d = 0; d < 5; d++) {
    const day = new Date(monday.getTime() + d * DAY_MS)
    for (let t = sh * 60 + sm; t < eh * 60 + em; t += intervalMin) {
      const utc = new Date(
        Date.UTC(
          day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(),
          Math.floor(t / 60) + UTC_OFFSET_HOURS, t % 60,
        ),
      )
      slots.push({
        departureTime: utc.toISOString().replace('.000Z', 'Z'),
        date: day.toISOString().slice(0, 10),
        slot: `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`,
      })
    }
  }
  return slots
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/calibration/predictedTraffic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/calibration/predictedTraffic.ts tests/lib/calibration/predictedTraffic.test.ts
git commit -m "feat(calibration): future departure-time grid builder"
```

---

### Task 6: `predictedTraffic.ts` — Routes API sampler

**Files:**
- Modify: `lib/calibration/predictedTraffic.ts` (append)
- Test: `tests/lib/calibration/predictedTraffic.test.ts` (append)

- [ ] **Step 1: Append the failing tests**

The mock fetch derives the returned duration from the request body, so peak detection and the envelope are deterministic: 08:00 slots are the peak (3400s), everything else 2800s; `PESSIMISTIC` returns 6000s, `OPTIMISTIC` 1900s.

```ts
// append to tests/lib/calibration/predictedTraffic.test.ts — extend the import:
// import { buildDepartureGrid, samplePredictedCorridor } from '@/lib/calibration/predictedTraffic'
import { vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const corridor = {
  slug: 'test-am',
  origin_lat: 19.4487, origin_lng: -99.1374,
  dest_lat: 19.3749, dest_lng: -99.1836,
  window_start: '07:00:00', window_end: '10:00:00',
}

function respond(body: string) {
  const req = JSON.parse(body)
  let dur = 2800
  if (req.departureTime?.includes('T14:00:00Z')) dur = 3400 // 08:00 local -> peak slot
  if (req.trafficModel === 'PESSIMISTIC') dur = 6000
  if (req.trafficModel === 'OPTIMISTIC') dur = 1900
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ routes: [{ duration: `${dur}s` }] }),
  })
}

describe('samplePredictedCorridor', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockImplementation((_url: string, init: RequestInit) => respond(init.body as string))
  })

  it('samples the grid, finds the peak slot, and returns the envelope per weekday', async () => {
    const result = await samplePredictedCorridor(corridor, 'test-key', new Date('2026-07-09T15:00:00Z'))
    // 30 BEST_GUESS grid calls + 5 weekdays x (PESSIMISTIC + OPTIMISTIC) at the peak slot
    expect(mockFetch).toHaveBeenCalledTimes(40)
    expect(result.peakSlot).toBe('08:00')
    expect(result.predictedMedianS).toBe(2800) // median of 25x2800 + 5x3400
    expect(result.envelope).toHaveLength(5)
    expect(result.envelope[0]).toMatchObject({ bestS: 3400, optS: 1900, pessS: 6000 })
  })

  it('sends departureTime and TRAFFIC_AWARE for grid calls, TRAFFIC_AWARE_OPTIMAL for envelope calls', async () => {
    await samplePredictedCorridor(corridor, 'test-key', new Date('2026-07-09T15:00:00Z'))
    const bodies = mockFetch.mock.calls.map((c) => JSON.parse(c[1].body as string))
    const grid = bodies.filter((b) => !b.trafficModel)
    const envelope = bodies.filter((b) => b.trafficModel)
    expect(grid).toHaveLength(30)
    expect(grid[0].routingPreference).toBe('TRAFFIC_AWARE')
    expect(grid[0].departureTime).toBe('2026-07-13T13:00:00Z')
    expect(envelope).toHaveLength(10)
    expect(envelope[0].routingPreference).toBe('TRAFFIC_AWARE_OPTIMAL')
  })

  it('throws with the Google error body on non-ok responses', async () => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve('REFERER_BLOCKED') })
    await expect(
      samplePredictedCorridor(corridor, 'bad-key', new Date('2026-07-09T15:00:00Z')),
    ).rejects.toThrow(/403.*REFERER_BLOCKED/)
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/lib/calibration/predictedTraffic.test.ts`
Expected: FAIL — `samplePredictedCorridor` is not exported.

- [ ] **Step 3: Append the implementation**

```ts
// append to lib/calibration/predictedTraffic.ts

export interface CorridorGeometry {
  slug: string
  origin_lat: number
  origin_lng: number
  dest_lat: number
  dest_lng: number
  window_start: string
  window_end: string
}

export interface EnvelopeDay {
  date: string
  bestS: number
  optS: number
  pessS: number
}

export interface PredictedSample {
  predictedMedianS: number
  peakSlot: string
  samples: Array<DepartureSlot & { bestS: number }>
  envelope: EnvelopeDay[]
}

async function fetchPredictedDuration(
  c: CorridorGeometry,
  departureTime: string,
  apiKey: string,
  trafficModel?: 'PESSIMISTIC' | 'OPTIMISTIC',
): Promise<number> {
  const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.duration',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: c.origin_lat, longitude: c.origin_lng } } },
      destination: { location: { latLng: { latitude: c.dest_lat, longitude: c.dest_lng } } },
      travelMode: 'DRIVE',
      departureTime,
      // trafficModel is only accepted under TRAFFIC_AWARE_OPTIMAL (pricier SKU) —
      // grid sampling stays on the cheaper TRAFFIC_AWARE.
      ...(trafficModel
        ? { routingPreference: 'TRAFFIC_AWARE_OPTIMAL', trafficModel }
        : { routingPreference: 'TRAFFIC_AWARE' }),
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Google Maps Routes API error: ${res.status} ${body}`.trim())
  }
  const data = await res.json()
  const duration = (data.routes as Array<{ duration: string }>)?.[0]?.duration
  if (!duration) throw new Error('Google Maps Routes API: no routes returned')
  return parseInt(duration.replace('s', ''), 10)
}

function medianOf(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

/**
 * Full prediction sample for one corridor: BEST_GUESS durations across the
 * Mon-Fri x window grid, plus a PESSIMISTIC/OPTIMISTIC envelope at the peak
 * slot of each weekday. ~40 sequential Routes API calls (~15s).
 */
export async function samplePredictedCorridor(
  c: CorridorGeometry,
  apiKey: string,
  now: Date = new Date(),
): Promise<PredictedSample> {
  const grid = buildDepartureGrid(c.window_start, c.window_end, now)
  const samples: Array<DepartureSlot & { bestS: number }> = []
  for (const entry of grid) {
    samples.push({ ...entry, bestS: await fetchPredictedDuration(c, entry.departureTime, apiKey) })
  }

  // Peak slot = slot label with the highest median across the 5 weekdays.
  const bySlot = new Map<string, number[]>()
  for (const s of samples) bySlot.set(s.slot, [...(bySlot.get(s.slot) ?? []), s.bestS])
  let peakSlot = grid[0].slot
  let peakMedian = -Infinity
  for (const [slot, durs] of bySlot) {
    const m = medianOf(durs)
    if (m > peakMedian) { peakMedian = m; peakSlot = slot }
  }

  const envelope: EnvelopeDay[] = []
  for (const s of samples.filter((x) => x.slot === peakSlot)) {
    const [pessS, optS] = [
      await fetchPredictedDuration(c, s.departureTime, apiKey, 'PESSIMISTIC'),
      await fetchPredictedDuration(c, s.departureTime, apiKey, 'OPTIMISTIC'),
    ]
    envelope.push({ date: s.date, bestS: s.bestS, optS, pessS })
  }

  return { predictedMedianS: medianOf(samples.map((s) => s.bestS)), peakSlot, samples, envelope }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/calibration/predictedTraffic.test.ts`
Expected: PASS (all `buildDepartureGrid` and `samplePredictedCorridor` tests).

- [ ] **Step 5: Commit**

```bash
git add lib/calibration/predictedTraffic.ts tests/lib/calibration/predictedTraffic.test.ts
git commit -m "feat(calibration): Routes API predicted-traffic sampler with envelope"
```

---

### Task 7: `/api/calibrate` route

**Files:**
- Create: `app/api/calibrate/route.ts`
- Test: `tests/app/calibrate-route.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/app/calibrate-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const sampleResult = { predictedMedianS: 2856, peakSlot: '08:00', samples: [], envelope: [] }
const mockSample = vi.fn()
const mockMaybeSingle = vi.fn()

vi.mock('@/lib/calibration/predictedTraffic', () => ({
  samplePredictedCorridor: (...args: unknown[]) => mockSample(...args),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
  }),
}))

import { GET } from '@/app/api/calibrate/route'

function request(url: string, auth?: string) {
  return new NextRequest(url, { headers: auth ? { authorization: auth } : {} })
}

describe('GET /api/calibrate', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'test-secret')
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'server-key')
    mockSample.mockReset().mockResolvedValue(sampleResult)
    mockMaybeSingle.mockReset().mockResolvedValue({
      data: {
        slug: 'gt-cesa-zona10-pm',
        origin_lat: 14.58, origin_lng: -90.49, dest_lat: 14.55, dest_lng: -90.45,
        window_start: '17:00:00', window_end: '20:00:00',
      },
      error: null,
    })
  })

  it('rejects requests without the cron secret', async () => {
    const res = await GET(request('http://x/api/calibrate?corridor=gt-cesa-zona10-pm'))
    expect(res.status).toBe(401)
  })

  it('requires a corridor param', async () => {
    const res = await GET(request('http://x/api/calibrate', 'Bearer test-secret'))
    expect(res.status).toBe(400)
  })

  it('404s on an unknown corridor', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    const res = await GET(request('http://x/api/calibrate?corridor=nope', 'Bearer test-secret'))
    expect(res.status).toBe(404)
  })

  it('returns the prediction sample for a known corridor', async () => {
    const res = await GET(request('http://x/api/calibrate?corridor=gt-cesa-zona10-pm', 'Bearer test-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(sampleResult)
    expect(mockSample).toHaveBeenCalledWith(expect.objectContaining({ slug: 'gt-cesa-zona10-pm' }), 'server-key')
  })

  it('returns 502 with the message when sampling fails', async () => {
    mockSample.mockRejectedValue(new Error('Google Maps Routes API error: 429'))
    const res = await GET(request('http://x/api/calibrate?corridor=gt-cesa-zona10-pm', 'Bearer test-secret'))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/429/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/app/calibrate-route.test.ts`
Expected: FAIL — `@/app/api/calibrate/route` does not exist.

- [ ] **Step 3: Write the route**

```ts
// app/api/calibrate/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { validateCronRequest } from '@/lib/auth/cronAuth'
import { createServiceClient } from '@/lib/supabase/server'
import { samplePredictedCorridor } from '@/lib/calibration/predictedTraffic'

// ~40 sequential Routes API calls per corridor; well under the 300s limit.
export const maxDuration = 300

/**
 * Returns Google predicted-traffic samples for ONE corridor (?corridor=<slug>).
 * Read-only: never writes to the database — blending and applying happen in
 * scripts/calibrate-corridors.mjs, which calls this endpoint because the
 * Routes-API server key exists only in the Vercel environment.
 */
export async function GET(req: NextRequest) {
  const authError = validateCronRequest(req)
  if (authError) return authError

  const slug = req.nextUrl.searchParams.get('corridor')
  if (!slug) return NextResponse.json({ error: 'corridor param required' }, { status: 400 })

  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? ''
  if (!apiKey) return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY not set' }, { status: 500 })

  const db = createServiceClient()
  const { data: corridor, error } = await db
    .from('corridors')
    .select('slug, origin_lat, origin_lng, dest_lat, dest_lng, window_start, window_end')
    .eq('slug', slug)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!corridor) return NextResponse.json({ error: `unknown corridor: ${slug}` }, { status: 404 })

  try {
    return NextResponse.json(await samplePredictedCorridor(corridor, apiKey))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/app/calibrate-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/calibrate/route.ts tests/app/calibrate-route.test.ts
git commit -m "feat(calibration): /api/calibrate endpoint for predicted-traffic samples"
```

---

### Task 8: `scripts/calibrate-corridors.mjs` — CLI orchestrator

**Files:**
- Create: `scripts/calibrate-corridors.mjs`

This is a thin I/O shell over the tested math — no unit tests; it is verified by dry-running against prod in Task 10. It deliberately mirrors the env-loading, paging, and reporting patterns of the two existing calibration scripts.

- [ ] **Step 1: Write the script**

```js
// scripts/calibrate-corridors.mjs
// Credibility-weighted corridor calibration:
//   baselines:      blend harvested weekday median with Google predicted median
//   probabilities:  Beta-Binomial blend of a lognormal model prior (from the
//                   Google PESSIMISTIC/OPTIMISTIC envelope, global z fitted to
//                   our measured corridors) with observed breach frequency.
// Dry-run by default. Writes only with --apply-baselines / --apply-probabilities.
// Predictions come from GET /api/calibrate (server-side Routes API key); skip
// them entirely with --no-predict (degrades to harvested-only behavior).
//
// Usage:
//   node scripts/calibrate-corridors.mjs
//   node scripts/calibrate-corridors.mjs --apply-baselines
//   node scripts/calibrate-corridors.mjs --apply-baselines --apply-probabilities
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  median, blendBaseline, sigmaFromEnvelope, breachProbability, betaBlend, fitZ,
} from './lib/calibration-math.mjs'

const env = { ...process.env }
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* rely on process.env */ }

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
const cronSecret = env.CRON_SECRET
const baseUrl = env.CALIBRATE_BASE_URL ?? 'https://insu-theta.vercel.app'
if (!url || !key) { console.error('Missing Supabase creds. Aborting.'); process.exit(2) }

const APPLY_BASELINES = process.argv.includes('--apply-baselines')
const APPLY_PROBABILITIES = process.argv.includes('--apply-probabilities')
const NO_PREDICT = process.argv.includes('--no-predict')

// Tuning constants — documented in docs/superpowers/plans/2026-07-09-credibility-weighted-calibration.md
const BASELINE_K = 10   // weekday-days at which harvested and predicted weigh 50/50
const M_PRIOR = 20      // pseudo-days of prior strength for base_probability
const MIN_DAYS = 7      // reading-days required to participate in the z fit
const P_MIN = 0.0005, P_MAX = 0.95
const TRAFFIC_INDEX_MAX = 100 // keep in sync with lib/oracle/trafficIndex.ts

const db = createClient(url, key, { auth: { persistSession: false } })

// Canonical traffic-index formula (mirror of lib/oracle/trafficIndex.ts).
function trafficIndex(durationS, baselineS) {
  if (!baselineS || baselineS <= 0) return 0
  const raw = ((durationS / baselineS) - 1) * 100
  return Math.min(TRAFFIC_INDEX_MAX, Math.max(0, Math.round(raw)))
}

const isWeekday = (d) => { const g = d.getUTCDay(); return g >= 1 && g <= 5 }
const PAGE = 1000

async function readingsFor(contractIds) {
  const out = [] // { durationS, day, weekday }
  for (const cid of contractIds) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('oracle_readings').select('read_at, value')
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

async function fetchPrediction(slug) {
  if (NO_PREDICT) return null
  if (!cronSecret) { console.error('  (no CRON_SECRET in env — skipping predictions)'); return null }
  try {
    const res = await fetch(`${baseUrl}/api/calibrate?corridor=${encodeURIComponent(slug)}`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
    })
    if (!res.ok) {
      console.error(`  predict ${slug}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`)
      return null
    }
    return await res.json()
  } catch (e) {
    console.error(`  predict ${slug}: ${e.message}`)
    return null
  }
}

// ---- load corridors, urban contracts, and their readings --------------------
const { data: corridors, error: corrErr } = await db
  .from('corridors').select('id, slug, name, baseline_duration_s')
if (corrErr) throw corrErr
const { data: contracts, error: ctErr } = await db
  .from('contracts')
  .select('id, title, corridor_id, trigger_condition')
  .eq('trigger_type', 'urban')
if (ctErr) throw ctErr

const contractsByCorridor = new Map()
for (const c of contracts ?? []) {
  if (!c.corridor_id) continue
  contractsByCorridor.set(c.corridor_id, [...(contractsByCorridor.get(c.corridor_id) ?? []), c])
}

// ---- per corridor: harvested stats + prediction + blended baseline ----------
const rows = []
for (const corr of corridors ?? []) {
  const corrContracts = contractsByCorridor.get(corr.id) ?? []
  if (corrContracts.length === 0) continue

  const readings = await readingsFor(corrContracts.map((c) => c.id))
  const weekday = readings.filter((r) => r.weekday)
  const harvestedWeekdayDays = new Set(weekday.map((r) => r.day)).size
  const harvestedMedianS = median(weekday.map((r) => r.durationS))

  process.stdout.write(`  sampling ${corr.slug} …\n`)
  const prediction = await fetchPrediction(corr.slug)
  const predictedMedianS = prediction?.predictedMedianS ?? null
  const envOpt = prediction ? median(prediction.envelope.map((e) => e.optS)) : null
  const envPess = prediction ? median(prediction.envelope.map((e) => e.pessS)) : null
  const envBest = prediction ? median(prediction.envelope.map((e) => e.bestS)) : null

  const { baselineS, source } = blendBaseline({
    harvestedMedianS, harvestedWeekdayDays, predictedMedianS, k: BASELINE_K,
  })

  // Breach stats against the PROPOSED baseline (the baseline defines a breach).
  const threshold = Number(corrContracts[0]?.trigger_condition?.threshold)
  const allDays = new Set(), breachDaysSet = new Set()
  if (baselineS && Number.isFinite(threshold)) {
    for (const r of readings) {
      allDays.add(r.day)
      if (trafficIndex(r.durationS, baselineS) > threshold) breachDaysSet.add(r.day)
    }
  }

  rows.push({
    corridor: corr, contracts: corrContracts,
    harvestedMedianS, harvestedWeekdayDays, predictedMedianS,
    baselineS, source, thresholdPct: threshold,
    optS: envOpt, pessS: envPess, bestS: envBest,
    totalDays: allDays.size, breachDays: breachDaysSet.size,
  })
}

// ---- global z fit ------------------------------------------------------------
const { z, pooledMeasured, pooledModel } = fitZ(rows, { minDays: MIN_DAYS })
console.log(`\n  z fit: z=${z ?? 'n/a'}  pooled measured=${pooledMeasured?.toFixed(4) ?? 'n/a'}  pooled model=${pooledModel?.toFixed(4) ?? 'n/a'}`)

// ---- report -------------------------------------------------------------------
console.log('\n  corridor                     harvested(n)  predicted  -> baseline (source)   days breach  pModel  pPost')
console.log('  ' + '-'.repeat(112))
for (const r of rows) {
  const sigma = z != null ? sigmaFromEnvelope(r.optS, r.pessS, z) : null
  r.pModel = sigma != null && r.bestS
    ? breachProbability({ baselineS: r.baselineS, thresholdPct: r.thresholdPct, muLog: Math.log(r.bestS), sigma })
    : null
  const rawPost = betaBlend({ pModel: r.pModel, priorDays: M_PRIOR, breachDays: r.breachDays, totalDays: r.totalDays })
  r.pPost = rawPost === null ? null : Math.min(P_MAX, Math.max(P_MIN, rawPost))

  const slug = r.corridor.slug.slice(0, 26).padEnd(26)
  const harv = r.harvestedMedianS ? `${r.harvestedMedianS}s(${r.harvestedWeekdayDays}d)` : 'none'
  const pred = r.predictedMedianS ? `${r.predictedMedianS}s` : 'none'
  const base = r.baselineS ? `${r.baselineS}s (${r.source})` : 'NULL'
  const pm = r.pModel != null ? r.pModel.toFixed(4) : '  n/a'
  const pp = r.pPost != null ? r.pPost.toFixed(4) : '  n/a'
  console.log(`  ${slug} ${harv.padStart(13)} ${pred.padStart(9)}  -> ${base.padEnd(20)} ${String(r.totalDays).padStart(4)} ${String(r.breachDays).padStart(6)}  ${pm}  ${pp}`)

  // Validation gate: flag corridors where model and measurement disagree badly.
  if (r.pModel != null && r.totalDays >= MIN_DAYS) {
    const measured = r.breachDays / r.totalDays
    if (measured > 0 && (r.pModel / measured > 3 || measured / r.pModel > 3)) {
      console.log(`    ⚠ model/measured disagree >3x (measured=${measured.toFixed(4)}) — inspect before applying`)
    }
  }
}

// ---- apply --------------------------------------------------------------------
if (APPLY_BASELINES) {
  console.log('')
  for (const r of rows) {
    if (!r.baselineS) { console.log(`  skip baseline ${r.corridor.slug}: no value`); continue }
    const { error } = await db.from('corridors')
      .update({ baseline_duration_s: r.baselineS, baseline_source: r.source })
      .eq('id', r.corridor.id)
    if (error) console.error(`  FAIL baseline ${r.corridor.slug}: ${error.message}`)
    else console.log(`  applied baseline ${r.baselineS}s (${r.source}) -> ${r.corridor.slug}`)
  }
}
if (APPLY_PROBABILITIES) {
  console.log('')
  for (const r of rows) {
    if (r.pPost == null) { console.log(`  skip probability ${r.corridor.slug}: no posterior`); continue }
    for (const c of r.contracts) {
      const { error } = await db.from('coverage_tiers')
        .update({ base_probability: r.pPost })
        .eq('contract_id', c.id)
      if (error) console.error(`  FAIL probability ${c.title}: ${error.message}`)
      else console.log(`  applied base_probability=${r.pPost.toFixed(4)} -> ${c.title}`)
    }
  }
}
if (!APPLY_BASELINES && !APPLY_PROBABILITIES) {
  console.log('\n  (dry run — nothing written; use --apply-baselines and/or --apply-probabilities)\n')
}
```

- [ ] **Step 2: Sanity-check the script parses**

Run: `node --check scripts/calibrate-corridors.mjs`
Expected: exit 0, no output (syntax OK). Do NOT execute the script yet — `.env.local` holds real prod credentials and the dry run happens in Task 10 after deploy.

- [ ] **Step 3: Run the full test suite and lint**

Run: `npm run test:run && npm run lint`
Expected: all tests pass, no lint errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/calibrate-corridors.mjs
git commit -m "feat(calibration): credibility-weighted calibrate-corridors CLI"
```

---

### Task 9: PR, deploy, and migration

- [ ] **Step 1: Full verification**

Run: `npm run test:run && npm run lint && npx tsc --noEmit`
Expected: everything green. Fix anything that isn't before proceeding.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/credibility-calibration
gh pr create --title "feat(calibration): credibility-weighted corridor calibration (Google predicted-traffic prior)" --body "$(cat <<'EOF'
## Summary
- New `/api/calibrate` endpoint (CRON_SECRET-authed) samples Google's historical traffic model via future departureTime requests — server-side, using the Routes-API server key
- New `scripts/calibrate-corridors.mjs` blends predictions with harvested history: credibility-weighted baselines (w = n/(n+10)) and Beta-Binomial base_probability posterior (prior strength 20 pseudo-days, lognormal model from the PESSIMISTIC/OPTIMISTIC envelope, global z fitted to our 13 measured corridors)
- Replaces the P_MIN-flooring failure mode of recalibrate-base-probability.mjs; enables baselines for the 3 NULL Guatemala corridors whose triggers currently cannot fire
- Migration: corridors.baseline_source provenance column
- Validated 2026-07-09: predicted medians within mean |diff| 9.4% of harvested baselines across 13 corridors

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Wait for CI, merge**

Run: `gh pr checks --watch` then `gh pr merge --merge` (or the user merges).
Expected: CI green before merge.

- [ ] **Step 4: Apply the migration to prod**

```bash
git checkout main && git pull
supabase db push --linked < /dev/null
```

Expected: `20260709120000_add_baseline_source.sql` applied. Verify:

```bash
node --input-type=module -e "
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
const env = Object.fromEntries(readFileSync('.env.local','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')), l.slice(l.indexOf('=')+1).trim()]))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const { error } = await db.from('corridors').select('baseline_source').limit(1)
console.log(error ? 'MISSING: ' + error.message : 'baseline_source column OK')
"
```

Expected: `baseline_source column OK`.

- [ ] **Step 5: Deploy prod (manual — merges do NOT auto-deploy)**

```bash
vercel --prod --yes
```

Expected: deployment succeeds; then smoke-test the endpoint auth:

```bash
curl -s -o /dev/null -w '%{http_code}\n' "https://insu-theta.vercel.app/api/calibrate?corridor=bicentenario-am"
```

Expected: `401` (unauthorized without the secret — proves the route is live and gated).

---

### Task 10: Validation run and gated apply

- [ ] **Step 1: Dry run against prod**

```bash
node scripts/calibrate-corridors.mjs
```

Expected: a table covering all 16 corridors (13 with harvested baselines, 3 GT with `none` harvested → `predicted` source), a fitted `z` (plausible range roughly 0.8–2.0), pooled model ≈ pooled measured by construction, and per-corridor `pModel`/`pPost` values. Runtime ~5–10 min (16 corridors × ~40 Routes calls server-side).

- [ ] **Step 2: Check the validation gates**

All of the following must hold before any apply:
1. Fitted `z` is not pinned at the grid edge (not 0.5 or 2.5) — a pinned z means the envelope model doesn't fit our data; stop and investigate.
2. For the 13 corridors with ≥7 reading-days: no more than 3 carry the `⚠ model/measured disagree >3x` flag.
3. Blended baselines for the 13 calibrated corridors move by less than ~15% vs their current `baseline_duration_s` (harvested data dominates at their n; a bigger move suggests a bug).
4. `pPost` for every corridor lands in a sane band (roughly 0.01–0.30/day) — nothing near P_MIN or P_MAX.

Record the dry-run table in the PR or as a comment for the 2026-07-22 review.

- [ ] **Step 3: Apply baselines (USER CHECKPOINT — ask before running)**

The 3 GT corridors gain their first baselines (triggers become able to fire — this changes product behavior). Present the dry-run table to the user, then:

```bash
node scripts/calibrate-corridors.mjs --apply-baselines
```

Expected: 16 `applied baseline … -> slug` lines; verify the 3 GT corridors now have non-NULL `baseline_duration_s` with `baseline_source='predicted'`.

- [ ] **Step 4: Probabilities — DEFERRED (USER DECISION, standing date 2026-07-22)**

Do NOT run `--apply-probabilities` without explicit user approval. The standing decision keeps `base_probability` at the conservative 0.12/day until the 2026-07-22 review. The Beta-Binomial posterior removes the P_MIN-flooring danger that motivated the deferral, so the user may choose to apply earlier — but that is their call, not the executor's. When applied, premiums change on the next reprice (daily cron at 00:00 UTC, or trigger immediately with `gh workflow run reprice.yml`).

- [ ] **Step 5: Post-apply verification**

After any apply: spot-check one GT market page (e.g. `/markets/gt-cesa-zona10-pm` on prod) — the trigger gauge should now show an index vs the new baseline, and the next oracle poll (cron-job.org, every 15 min in-window) should write `trigger_met` evaluated against it.

---

## Out of scope (deliberately)

- Retiring `compute-corridor-baselines.mjs` / `recalibrate-base-probability.mjs` — kept as harvested-only fallbacks.
- Per-weekday or seasonal baselines (single per-corridor scalar for now — YAGNI until the 07-22 review says otherwise).
- Scheduled/periodic recalibration — this stays a manually-run, human-reviewed tool.
- Any change to the trigger threshold (stays 50) or to `lib/oracle/` runtime code paths.
