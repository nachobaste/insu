'use client'

import { AreaChart } from '@tremor/react'
import type { CoverageTier, PricingHistoryRow } from '@/lib/types'

interface ChartPoint {
  date: string
  Basic?: number
  Premium?: number
}

function buildChartData(history: PricingHistoryRow[], tiers: CoverageTier[]): ChartPoint[] {
  const byDate = new Map<string, ChartPoint>()

  history.forEach((row) => {
    const date = row.calculated_at.split('T')[0]
    const tier = tiers.find((t) => t.id === row.tier_id)
    if (!tier) return
    if (!byDate.has(date)) byDate.set(date, { date })
    const label = tier.name === 'basic' ? 'Basic' : 'Premium'
    byDate.get(date)![label] = row.premium_usd_after
  })

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
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
        Premium history
      </p>
      <AreaChart
        data={data}
        index="date"
        categories={['Basic', 'Premium']}
        colors={['amber', 'violet']}
        valueFormatter={(v) => `$${v}`}
        showLegend
        showGridLines={false}
        className="h-[160px]"
      />
    </div>
  )
}
