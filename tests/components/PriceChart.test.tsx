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
    expect(screen.getByText('Price history')).toBeInTheDocument()
  })
})
