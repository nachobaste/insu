# Price-Chart Oracle-Metric Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the phantom 1-day "Pro" line on the market-detail price-history chart with a historical view of the trigger metric (traffic index / AQI / rainfall / fuel) versus its threshold.

**Architecture:** A pure aggregator turns raw `oracle_readings` into one point per market-local day (the in-window max — the value that determines a trigger). The page loaders fetch ~30 days of readings, aggregate in JS (no new DB object), and pass the series to `PriceChart`, which drops the Pro area and adds a right-axis metric line plus a dashed threshold reference line. Both live markets sit at UTC-6, so bucketing reuses `lib/utils/marketDay.ts`.

**Tech Stack:** Next.js App Router (RSC loaders), TypeScript, Recharts, Vitest + Testing Library, Supabase JS client.

**Design doc:** `docs/superpowers/specs/2026-07-18-price-chart-oracle-overlay-design.md`

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `lib/oracle/dailySeries.ts` | Pure aggregator: readings → daily in-window max; metric-label helper | Create |
| `tests/lib/oracle/dailySeries.test.ts` | Unit tests for the aggregator + label helper | Create |
| `components/markets/PriceChart.tsx` | Render Basic price (left axis) + metric line (right axis) + threshold line; export `buildChartData` | Modify |
| `tests/components/PriceChart.test.tsx` | Unit-test `buildChartData` + render smoke test | Create |
| `lib/corridors.ts` | Add `metricSeries` to `PeriodBundle` | Modify |
| `app/markets/[slug]/page.tsx` | Fetch readings + aggregate; pass series into both render paths | Modify |
| `components/markets/CorridorMarketView.tsx` | Forward `bundle.metricSeries` to the detail client | Modify |
| `components/markets/ContractDetailClient.tsx` | Accept `metricSeries`; derive threshold + label from `trigger_condition`; pass to `PriceChart` | Modify |

---

## Task 1: Daily oracle-series aggregator

**Files:**
- Create: `lib/oracle/dailySeries.ts`
- Test: `tests/lib/oracle/dailySeries.test.ts`

Both live markets are UTC-6 (see `lib/utils/marketDay.ts`), so we bucket by `marketDay()` and read local wall-clock time via `America/Mexico_City` — the same zone `TrafficPulseBar` and `lib/oracle/poll.ts` already use.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/oracle/dailySeries.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { aggregateDailyOracleSeries, metricLabel } from '@/lib/oracle/dailySeries'

// Market tz is UTC-6, so local HH:00 == UTC (HH+6):00.
// Window 07:00–10:00 local == 13:00–16:00 UTC.
const WINDOW = { start: '07:00:00', end: '10:00:00' }

const reading = (readAtUtc: string, traffic_index: number) => ({
  read_at: readAtUtc,
  value: { traffic_index },
})

describe('aggregateDailyOracleSeries', () => {
  it('returns the in-window max per market-local day', () => {
    const readings = [
      reading('2026-07-10T13:00:00Z', 40), // 07:00 local — in window
      reading('2026-07-10T14:00:00Z', 57), // 08:00 local — in window (max)
      reading('2026-07-10T15:00:00Z', 48), // 09:00 local — in window
    ]
    expect(aggregateDailyOracleSeries(readings, 'traffic_index', WINDOW)).toEqual([
      { date: '2026-07-10', value: 57 },
    ])
  })

  it('excludes out-of-window readings', () => {
    const readings = [
      reading('2026-07-10T14:00:00Z', 30), // 08:00 local — in window
      reading('2026-07-10T20:00:00Z', 99), // 14:00 local — OUT of window
    ]
    expect(aggregateDailyOracleSeries(readings, 'traffic_index', WINDOW)).toEqual([
      { date: '2026-07-10', value: 30 },
    ])
  })

  it('with no window, takes the daily max across all readings', () => {
    const readings = [
      reading('2026-07-10T02:00:00Z', 12),
      reading('2026-07-10T20:00:00Z', 88),
    ]
    expect(aggregateDailyOracleSeries(readings, 'aqi', null)).toEqual([])
    const aqi = [
      { read_at: '2026-07-10T02:00:00Z', value: { aqi: 12 } },
      { read_at: '2026-07-10T20:00:00Z', value: { aqi: 88 } },
    ]
    expect(aggregateDailyOracleSeries(aqi, 'aqi', null)).toEqual([
      { date: '2026-07-10', value: 88 },
    ])
  })

  it('skips readings whose metric value is missing or non-numeric', () => {
    const readings = [
      { read_at: '2026-07-10T14:00:00Z', value: { traffic_index: 'n/a' } },
      { read_at: '2026-07-10T14:15:00Z', value: {} },
      reading('2026-07-10T14:30:00Z', 45),
    ]
    expect(aggregateDailyOracleSeries(readings, 'traffic_index', WINDOW)).toEqual([
      { date: '2026-07-10', value: 45 },
    ])
  })

  it('sorts multiple days ascending', () => {
    const readings = [
      reading('2026-07-11T14:00:00Z', 60),
      reading('2026-07-10T14:00:00Z', 50),
    ]
    expect(aggregateDailyOracleSeries(readings, 'traffic_index', WINDOW)).toEqual([
      { date: '2026-07-10', value: 50 },
      { date: '2026-07-11', value: 60 },
    ])
  })

  it('returns [] for empty input', () => {
    expect(aggregateDailyOracleSeries([], 'traffic_index', WINDOW)).toEqual([])
  })
})

describe('metricLabel', () => {
  it('maps known metrics', () => {
    expect(metricLabel('traffic_index')).toBe('Traffic index')
    expect(metricLabel('aqi')).toBe('Air quality')
  })
  it('de-underscores unknown metrics', () => {
    expect(metricLabel('some_new_metric')).toBe('some new metric')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/oracle/dailySeries.test.ts`
Expected: FAIL — cannot resolve `@/lib/oracle/dailySeries` / functions not defined.

- [ ] **Step 3: Write the implementation**

Create `lib/oracle/dailySeries.ts`:

```ts
import { marketDay } from '@/lib/utils/marketDay'
import type { OracleReading } from '@/lib/types'

// Both live markets (CDMX, Guatemala City) sit permanently at UTC-6; the same
// zone TrafficPulseBar and lib/oracle/poll.ts anchor to. See lib/utils/marketDay.ts.
const MARKET_TIMEZONE = 'America/Mexico_City'

export interface DailyMetricPoint {
  /** YYYY-MM-DD in market-local time. */
  date: string
  value: number
}

/** Minutes since local midnight (market tz) for an instant. */
function localMinutes(iso: string): number {
  const hm = new Intl.DateTimeFormat('en-US', {
    timeZone: MARKET_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

/** 'HH:MM[:SS]' -> minutes since midnight. */
function windowMinutes(t: string): number {
  const [h, m] = t.substring(0, 5).split(':').map(Number)
  return h * 60 + m
}

/**
 * One point per market-local day = the max of the trigger metric.
 * When `window` is given (corridor contracts), only readings whose local time
 * falls within [start, end) count — the value that determines a trigger.
 * Windows spanning midnight are unsupported (all corridors are daytime),
 * matching TrafficPulseBar.
 */
export function aggregateDailyOracleSeries(
  readings: Pick<OracleReading, 'read_at' | 'value'>[],
  metric: string,
  window: { start: string; end: string } | null,
): DailyMetricPoint[] {
  const start = window ? windowMinutes(window.start) : 0
  const end = window ? windowMinutes(window.end) : 0
  const maxByDay = new Map<string, number>()

  for (const r of readings) {
    const raw = (r.value as Record<string, unknown>)[metric]
    const v = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(v)) continue
    if (window) {
      const mins = localMinutes(r.read_at)
      if (mins < start || mins >= end) continue
    }
    const day = marketDay(r.read_at)
    const prev = maxByDay.get(day)
    if (prev === undefined || v > prev) maxByDay.set(day, v)
  }

  return [...maxByDay.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

const METRIC_LABELS: Record<string, string> = {
  traffic_index: 'Traffic index',
  aqi: 'Air quality',
  imeca: 'Air quality',
  pm25: 'Air quality',
  rainfall: 'Rainfall',
  precipitation: 'Rainfall',
  fuel_price: 'Fuel price',
}

/** Human label for a trigger metric key; falls back to a de-underscored key. */
export function metricLabel(metric: string): string {
  return METRIC_LABELS[metric] ?? metric.replace(/_/g, ' ')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/oracle/dailySeries.test.ts`
Expected: PASS (13 assertions across 8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/oracle/dailySeries.ts tests/lib/oracle/dailySeries.test.ts
git commit -m "feat(chart): daily in-window-max oracle-series aggregator"
```

---

## Task 2: PriceChart — drop Pro, add metric overlay

**Files:**
- Modify: `components/markets/PriceChart.tsx`
- Test: `tests/components/PriceChart.test.tsx`

We export `buildChartData` (pure) for robust testing, switch `AreaChart` → `ComposedChart` to mix an Area (price) with a Line (metric), and add a right axis + threshold `ReferenceLine`.

- [ ] **Step 1: Write the failing test**

Create `tests/components/PriceChart.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PriceChart, { buildChartData } from '@/components/markets/PriceChart'
import type { CoverageTier, PricingHistoryRow } from '@/lib/types'

// ResponsiveContainer renders nothing without layout in jsdom; give it a size.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 800, height: 300 }}>{children}</div>
    ),
  }
})

const tier = (id: string, name: 'basic' | 'premium'): CoverageTier =>
  ({ id, name } as CoverageTier)

const row = (tier_id: string, premium: number, at: string): PricingHistoryRow =>
  ({ id: `${tier_id}-${at}`, tier_id, premium_usd_after: premium, calculated_at: at } as PricingHistoryRow)

describe('buildChartData', () => {
  const tiers = [tier('t-basic', 'basic'), tier('t-pro', 'premium')]

  it('plots Basic only and never emits a Pro key', () => {
    const history = [
      row('t-basic', 6, '2026-07-17T00:05:00Z'),
      row('t-pro', 7, '2026-07-17T00:05:00Z'),
    ]
    const data = buildChartData(history, tiers, [])
    const last = data[data.length - 1]
    expect(last.Basic).toBe(6)
    expect('Pro' in last).toBe(false)
  })

  it('merges metric values onto matching dates, leaving gaps where absent', () => {
    const history = [row('t-basic', 6, '2026-07-16T00:05:00Z')]
    const metric = [
      { date: '2026-07-16', value: 55 },
      // no 2026-07-17 point -> gap
    ]
    const data = buildChartData(history, tiers, metric)
    const jul16 = data.find((d) => d.date === 'Jul 16')
    expect(jul16?.Metric).toBe(55)
    const others = data.filter((d) => d.date !== 'Jul 16')
    expect(others.every((d) => d.Metric === undefined)).toBe(true)
  })
})

describe('PriceChart', () => {
  const tiers = [tier('t-basic', 'basic')]

  it('shows the empty state when there is no history', () => {
    render(<PriceChart history={[]} tiers={tiers} />)
    expect(screen.getByText('No pricing history yet')).toBeInTheDocument()
  })

  it('renders without throwing when given price + metric series', () => {
    const history = [row('t-basic', 6, '2026-07-17T00:05:00Z')]
    const { container } = render(
      <PriceChart
        history={history}
        tiers={tiers}
        metricSeries={[{ date: '2026-07-17', value: 57 }]}
        threshold={50}
        metricLabel="Traffic index"
      />,
    )
    expect(container).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/PriceChart.test.tsx`
Expected: FAIL — `buildChartData` is not exported / `metricSeries` prop absent / Pro key still present.

- [ ] **Step 3: Rewrite the component**

Replace the entire contents of `components/markets/PriceChart.tsx` with:

```tsx
'use client'

import {
  ComposedChart, Area, Line, ReferenceLine, XAxis, YAxis, Tooltip,
  Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import type { CoverageTier, PricingHistoryRow } from '@/lib/types'
import type { DailyMetricPoint } from '@/lib/oracle/dailySeries'

interface ChartPoint {
  date: string
  Basic?: number
  Metric?: number
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('T')[0].split('-')
  const d = new Date(Number(year), Number(month) - 1, Number(day))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Build the daily chart series. Price (Basic) carries forward across days with
 * no reprice; the metric does NOT carry forward — a day with no readings is a
 * genuine gap, not a repeat of yesterday's value.
 */
export function buildChartData(
  history: PricingHistoryRow[],
  tiers: CoverageTier[],
  metricSeries: DailyMetricPoint[],
): ChartPoint[] {
  const sorted = [...history].sort((a, b) => a.calculated_at.localeCompare(b.calculated_at))

  const byDate = new Map<string, ChartPoint>()
  sorted.forEach((row) => {
    const dateKey = row.calculated_at.split('T')[0]
    const tier = tiers.find((t) => t.id === row.tier_id)
    if (!tier || tier.name !== 'basic') return // Pro line dropped; only Basic tracks price
    if (!byDate.has(dateKey)) byDate.set(dateKey, { date: formatDate(row.calculated_at) })
    byDate.get(dateKey)!.Basic = row.premium_usd_after
  })

  const metricByDate = new Map<string, number>()
  metricSeries.forEach((p) => metricByDate.set(p.date, p.value))

  const allKeys = new Set<string>([...byDate.keys(), ...metricByDate.keys()])
  if (allKeys.size === 0) return []

  const today = new Date()
  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setDate(today.getDate() - 29)
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0]
  const firstDataStr = [...allKeys].sort()[0]
  const startStr = firstDataStr > thirtyDaysAgoStr ? firstDataStr : thirtyDaysAgoStr

  let carryBasic: number | undefined
  const result: ChartPoint[] = []

  const cursor = new Date(startStr + 'T12:00:00Z')
  const end = new Date(today)
  end.setHours(23, 59, 59, 999)

  while (cursor <= end) {
    const dateKey = cursor.toISOString().split('T')[0]
    const priceData = byDate.get(dateKey)
    if (priceData?.Basic !== undefined) carryBasic = priceData.Basic

    const point: ChartPoint = { date: formatDate(dateKey + 'T00:00:00') }
    if (carryBasic !== undefined) point.Basic = carryBasic
    const metric = metricByDate.get(dateKey)
    if (metric !== undefined) point.Metric = metric // no carry-forward
    result.push(point)

    cursor.setDate(cursor.getDate() + 1)
  }

  return result
}

const AXIS_STYLE = { fill: '#e8edf5', fontSize: 11 }

interface Props {
  history: PricingHistoryRow[]
  tiers: CoverageTier[]
  metricSeries?: DailyMetricPoint[]
  threshold?: number
  metricLabel?: string
}

export default function PriceChart({ history, tiers, metricSeries = [], threshold, metricLabel }: Props) {
  const data = buildChartData(history, tiers, metricSeries)
  const hasMetric = data.some((d) => d.Metric !== undefined)
  const metricName = metricLabel ?? 'Metric'

  if (data.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center rounded-card border border-white/[0.07] bg-bg-card text-[13px] text-insu-muted">
        No pricing history yet
      </div>
    )
  }

  return (
    <div className="rounded-card border border-white/[0.07] bg-bg-card p-5">
      <p className="mb-4 text-[12px] font-semibold uppercase tracking-wider text-insu-muted">
        Price history
      </p>
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={data} margin={{ top: 4, right: hasMetric ? 4 : 4, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="gradBasic" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#f5a623" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#f5a623" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="price"
            domain={[
              (dataMin: number) => Math.max(0, Math.floor(dataMin * 0.92)),
              (dataMax: number) => Math.ceil(dataMax * 1.05),
            ]}
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${v}`}
          />
          {hasMetric && (
            <YAxis
              yAxisId="metric"
              orientation="right"
              domain={[0, (dataMax: number) => Math.ceil(Math.max(dataMax, threshold ?? 0) * 1.1)]}
              tick={AXIS_STYLE}
              tickLine={false}
              axisLine={false}
            />
          )}
          <Tooltip
            contentStyle={{ background: '#0e1420', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#e8edf5', marginBottom: 4 }}
            itemStyle={{ color: '#e8edf5' }}
            formatter={(v: number, name: string) => [name === 'Price' ? `$${v}` : `${v}`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: '#e8edf5', paddingTop: 8 }} />
          {hasMetric && threshold !== undefined && (
            <ReferenceLine
              yAxisId="metric"
              y={threshold}
              stroke="#ef4444"
              strokeDasharray="4 4"
              strokeOpacity={0.6}
              label={{ value: 'Trigger', position: 'insideTopRight', fill: '#ef4444', fontSize: 10 }}
            />
          )}
          <Area
            yAxisId="price"
            type="monotone"
            dataKey="Basic"
            name="Price"
            stroke="#f5a623"
            strokeWidth={2}
            fill="url(#gradBasic)"
            dot={false}
            activeDot={{ r: 4, fill: '#f5a623' }}
            connectNulls
          />
          {hasMetric && (
            <Line
              yAxisId="metric"
              type="monotone"
              dataKey="Metric"
              name={metricName}
              stroke="#22c55e"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: '#22c55e' }}
              connectNulls
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/PriceChart.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add components/markets/PriceChart.tsx tests/components/PriceChart.test.tsx
git commit -m "feat(chart): drop phantom Pro line, add metric-vs-threshold overlay"
```

---

## Task 3: Plumb the metric series through the loaders and views

**Files:**
- Modify: `lib/corridors.ts` (add field to `PeriodBundle`)
- Modify: `app/markets/[slug]/page.tsx` (fetch + aggregate + pass)
- Modify: `components/markets/CorridorMarketView.tsx` (forward field)
- Modify: `components/markets/ContractDetailClient.tsx` (accept prop, derive threshold/label, pass to chart)

This task is wiring; it is verified by type-check, the full existing suite, and a manual page load (Recharts wiring can't be meaningfully unit-tested here).

- [ ] **Step 1: Add `metricSeries` to the bundle type**

In `lib/corridors.ts`, add the import and the field.

Add to the existing type import block (it already imports from `./types`):

```ts
import type { DailyMetricPoint } from './oracle/dailySeries'
```

Then in `interface PeriodBundle`, add the field after `sparklineReadings`:

```ts
  sparklineReadings: OracleReading[]
  metricSeries: DailyMetricPoint[]
```

- [ ] **Step 2: Fetch + aggregate in the page loaders**

In `app/markets/[slug]/page.tsx`:

Add imports near the top (after the existing type import on line 8):

```ts
import { aggregateDailyOracleSeries, type DailyMetricPoint } from '@/lib/oracle/dailySeries'
```

Add this helper above `loadBundle`:

```ts
/** Fetch ~30 days of readings and reduce to a daily in-window-max metric series. */
async function loadOracleSeries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  contract: ContractDetailData,
): Promise<DailyMetricPoint[]> {
  const tc = contract.trigger_condition as Record<string, unknown>
  const metric = typeof tc.metric === 'string' ? tc.metric : null
  if (!metric) return []

  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('oracle_readings')
    .select('read_at, value')
    .eq('contract_id', contract.id)
    .gte('read_at', cutoff)
    .order('read_at', { ascending: false })
    .limit(5000)

  if (error) {
    console.error('[MarketPage] series fetch failed:', error.message)
    return []
  }

  const corridor = contract.corridor as Corridor | null
  const window = corridor ? { start: corridor.window_start, end: corridor.window_end } : null
  return aggregateDailyOracleSeries(
    (data ?? []) as { read_at: string; value: Record<string, unknown> }[],
    metric,
    window,
  )
}
```

In `loadBundle`, add the fetch to the `Promise.all` and return it. Change the `Promise.all` array to include a third entry:

```ts
  const [latestReadingResult, sparklineResult, metricSeries] = await Promise.all([
    supabase
      .from('oracle_readings')
      .select('value, read_at, source, trigger_met')
      .eq('contract_id', contract.id)
      .order('read_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('oracle_readings')
      .select('*')
      .eq('contract_id', contract.id)
      .order('read_at', { ascending: false })
      .limit(6),
    loadOracleSeries(supabase, contract),
  ])
```

And add `metricSeries` to the returned object:

```ts
  return {
    period: getContractPeriod(corridor),
    slug: contract.slug,
    contract,
    corridor,
    latestReading: latestReadingResult.data as LatestOracleReading | null,
    sparklineReadings: (sparklineResult.data ?? []) as OracleReading[],
    metricSeries,
  }
```

For the single-contract path, add `loadOracleSeries` to its `Promise.all` (the one starting `const [latestReadingResult, sparklineResult, interestResult] = await Promise.all([`). Add a fourth entry and capture it:

```ts
  const [latestReadingResult, sparklineResult, interestResult, metricSeries] = await Promise.all([
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
    comingSoon && userId
      ? supabase
          .from('launch_interest')
          .select('contract_id')
          .eq('contract_id', contract.id)
          .eq('user_id', userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    loadOracleSeries(supabase, contract),
  ])
```

Then pass `metricSeries` to `ContractDetailClient` in the single-contract `return` block (add the prop alongside the existing ones):

```tsx
      <ContractDetailClient
        contract={contract}
        userId={userId}
        latestReading={latestReading}
        comingSoon={comingSoon}
        initiallyInterested={initiallyInterested}
        displayMode={displayMode}
        metricSeries={metricSeries}
        evidence={
```

- [ ] **Step 3: Forward the series in CorridorMarketView**

In `components/markets/CorridorMarketView.tsx`, add the prop to the `<ContractDetailClient>` call (it currently passes `key`, `contract`, `userId`, `latestReading`, `periodToggle`, `evidence`):

```tsx
    <ContractDetailClient
      key={active.slug}
      contract={contract}
      userId={userId}
      latestReading={active.latestReading}
      metricSeries={active.metricSeries}
      periodToggle={
```

- [ ] **Step 4: Accept the prop and wire it into the chart**

In `components/markets/ContractDetailClient.tsx`:

Add the import (next to the other `@/lib` imports near the top):

```ts
import { metricLabel as toMetricLabel, type DailyMetricPoint } from '@/lib/oracle/dailySeries'
```

Add the prop to the `Props` interface (after `displayMode?`):

```ts
  displayMode?: DisplayMode
  metricSeries?: DailyMetricPoint[]
```

Add it to the destructured params (after `displayMode = 'USD'`):

```ts
export default function ContractDetailClient({ contract, userId, latestReading, periodToggle, evidence, comingSoon, initiallyInterested, displayMode = 'USD', metricSeries }: Props) {
```

Derive the threshold and label just above the `return` (near the other derived values like `hasPoolCoverage`):

```ts
  const tc = contract.trigger_condition as Record<string, unknown>
  const metricKey = typeof tc.metric === 'string' ? tc.metric : ''
  const rawThreshold = typeof tc.threshold === 'number' ? tc.threshold : Number(tc.threshold)
  const chartThreshold = Number.isFinite(rawThreshold) ? rawThreshold : undefined
```

Replace the existing `<PriceChart .../>` line (currently `<PriceChart history={contract.pricing_history} tiers={contract.coverage_tiers} />`) with:

```tsx
          <PriceChart
            history={contract.pricing_history}
            tiers={contract.coverage_tiers}
            metricSeries={metricSeries}
            threshold={chartThreshold}
            metricLabel={metricKey ? toMetricLabel(metricKey) : undefined}
          />
```

- [ ] **Step 5: Type-check and run the full suite**

Run: `npx tsc --noEmit`
Expected: no new errors (a pre-existing error in `tests/lib/payout/processor.test.ts` may remain — see [[project_open_bugs]] #6; ignore only that one).

Run: `npx vitest run`
Expected: all tests pass, including the two new files.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open a corridor market (e.g. `/markets/gt-sanlucas-zona11-manana`) and a non-corridor market (e.g. `/markets/air-quality-contingencia-cdmx`).
Expected:
- Price-history chart shows a single **Price** area (no "Pro" legend entry).
- A **Traffic index** (or "Air quality", etc.) line appears on the right axis with a dashed **Trigger** threshold line.
- Non-corridor market shows the metric line using daily max (no window filter).

- [ ] **Step 7: Commit**

```bash
git add lib/corridors.ts app/markets/[slug]/page.tsx components/markets/CorridorMarketView.tsx components/markets/ContractDetailClient.tsx
git commit -m "feat(chart): plumb daily oracle series into the price chart"
```

---

## Self-Review Notes

- **Spec coverage:** data helper (Task 1) ✓; chart drop-Pro + dual-axis + threshold line (Task 2) ✓; in-window daily max + non-corridor fallback (Task 1) ✓; plumbing through corridor + non-corridor paths (Task 3) ✓; generic via `trigger_condition` (Tasks 1 & 3) ✓; regulatory "Price" label (Task 2, `name="Price"`) ✓; no-metric-carry-forward (Task 2 `buildChartData`) ✓; empty-history state preserved (Task 2) ✓.
- **Type consistency:** `DailyMetricPoint { date; value }`, `aggregateDailyOracleSeries`, `metricLabel` used identically across tasks; `PriceChart` props `metricSeries/threshold/metricLabel` match the call site in `ContractDetailClient`; `PeriodBundle.metricSeries` matches `CorridorMarketView` usage.
- **Accepted simplification:** the metric is bucketed by market-local day (`marketDay`) while price keeps its UTC `calculated_at` date key; on the continuous daily axis this can offset an evening (PM) corridor's metric point by at most one day relative to its price point. Since the price line is deliberately flat, this is cosmetic and does not mislead. Documented here rather than fixed (fixing would require re-bucketing the existing price history, out of scope).
