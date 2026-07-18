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
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
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
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
