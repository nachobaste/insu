'use client'

import { AreaChart } from '@tremor/react'
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
  const byDate = new Map<string, ChartPoint>()

  history.forEach((row) => {
    const dateKey = row.calculated_at.split('T')[0]
    const label = formatDate(row.calculated_at)
    const tier = tiers.find((t) => t.id === row.tier_id)
    if (!tier) return
    if (!byDate.has(dateKey)) byDate.set(dateKey, { date: label })
    const tierLabel = tier.name === 'basic' ? 'Basic' : 'Pro'
    byDate.get(dateKey)![tierLabel] = row.premium_usd_after
  })

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, point]) => point)
}

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
    <div className="dark rounded-card border border-white/[0.07] bg-bg-card p-5">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-insu-muted">
        Price history
      </p>
      <AreaChart
        data={data}
        index="date"
        categories={['Basic', 'Pro']}
        colors={['amber', 'violet']}
        valueFormatter={(v) => `$${v}`}
        showLegend
        showGridLines={false}
        className="h-[160px] text-[11px]"
      />
    </div>
  )
}
