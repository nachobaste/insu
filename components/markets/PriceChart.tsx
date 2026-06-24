'use client'

import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import type { CoverageTier, PricingHistoryRow } from '@/lib/types'

interface ChartPoint {
  date: string
  Basic?: number
  Pro?: number
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('T')[0].split('-')
  const d = new Date(Number(year), Number(month) - 1, Number(day))
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function buildChartData(history: PricingHistoryRow[], tiers: CoverageTier[]): ChartPoint[] {
  // Sort ascending so the last overwrite per (date, tier) is the most recent price
  const sorted = [...history].sort((a, b) => a.calculated_at.localeCompare(b.calculated_at))

  const byDate = new Map<string, ChartPoint>()
  sorted.forEach((row) => {
    const dateKey = row.calculated_at.split('T')[0]
    const tier = tiers.find((t) => t.id === row.tier_id)
    if (!tier) return
    if (!byDate.has(dateKey)) byDate.set(dateKey, { date: formatDate(row.calculated_at) })
    const tierLabel = tier.name === 'basic' ? 'Basic' : 'Pro'
    byDate.get(dateKey)![tierLabel] = row.premium_usd_after
  })

  if (byDate.size === 0) return []

  const today = new Date()

  // Start from whichever is later: 30 days ago or the first date with actual data.
  // This means a new contract shows only its real history (e.g. 3 days), while a
  // mature contract is capped at the last 30 days — never padded with empty space.
  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setDate(today.getDate() - 29)
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0]
  const firstDataStr = [...byDate.keys()].sort()[0]
  const startStr = firstDataStr > thirtyDaysAgoStr ? firstDataStr : thirtyDaysAgoStr

  let carryBasic: number | undefined
  let carryPro: number | undefined
  const result: ChartPoint[] = []

  const cursor = new Date(startStr + 'T12:00:00Z')
  const end = new Date(today)
  end.setHours(23, 59, 59, 999)

  while (cursor <= end) {
    const dateKey = cursor.toISOString().split('T')[0]
    const dayData = byDate.get(dateKey)

    if (dayData) {
      if (dayData.Basic !== undefined) carryBasic = dayData.Basic
      if (dayData.Pro !== undefined) carryPro = dayData.Pro
      result.push(dayData)
    } else {
      const point: ChartPoint = { date: formatDate(dateKey + 'T00:00:00') }
      if (carryBasic !== undefined) point.Basic = carryBasic
      if (carryPro !== undefined) point.Pro = carryPro
      result.push(point)
    }

    cursor.setDate(cursor.getDate() + 1)
  }

  return result
}

const AXIS_STYLE = { fill: '#e8edf5', fontSize: 11 }

interface Props {
  history: PricingHistoryRow[]
  tiers: CoverageTier[]
}

export default function PriceChart({ history, tiers }: Props) {
  const data = buildChartData(history, tiers)

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
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="gradBasic" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#f5a623" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#f5a623" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradPro" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
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
            domain={[
              (dataMin: number) => Math.max(0, Math.floor(dataMin * 0.92)),
              (dataMax: number) => Math.ceil(dataMax * 1.05),
            ]}
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${v}`}
          />
          <Tooltip
            contentStyle={{ background: '#0e1420', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#e8edf5', marginBottom: 4 }}
            itemStyle={{ color: '#e8edf5' }}
            formatter={(v: number) => [`$${v}`, undefined]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, color: '#e8edf5', paddingTop: 8 }}
          />
          <Area
            type="monotone"
            dataKey="Pro"
            stroke="#22c55e"
            strokeWidth={2}
            fill="url(#gradPro)"
            dot={false}
            activeDot={{ r: 4, fill: '#22c55e' }}
          />
          <Area
            type="monotone"
            dataKey="Basic"
            stroke="#f5a623"
            strokeWidth={2}
            fill="url(#gradBasic)"
            dot={false}
            activeDot={{ r: 4, fill: '#f5a623' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
