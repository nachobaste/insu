import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CorridorMarketView } from '@/components/markets/CorridorMarketView'
import type { PeriodBundle } from '@/lib/corridors'

// Mock the heavy children so the test isolates the wrapper's swap behaviour.
vi.mock('@/components/markets/ContractDetailClient', () => ({
  default: ({
    contract,
    periodToggle,
  }: {
    contract: { title: string }
    periodToggle?: React.ReactNode
  }) => (
    <div data-testid="detail">
      {contract.title}
      {periodToggle}
    </div>
  ),
}))
vi.mock('@/components/markets/CorridorEvidence', () => ({ CorridorEvidence: () => null }))

function makeBundle(period: 'morning' | 'evening', slug: string, title: string): PeriodBundle {
  return {
    period,
    slug,
    contract: { title, trigger_condition: {} } as unknown as PeriodBundle['contract'],
    corridor: {
      window_start: period === 'morning' ? '07:00:00' : '17:00:00',
      window_end: period === 'morning' ? '10:00:00' : '20:00:00',
      origin_lat: 0, origin_lng: 0, dest_lat: 0, dest_lng: 0, name: `${period} corridor`,
    } as unknown as PeriodBundle['corridor'],
    latestReading: null,
    sparklineReadings: [],
    metricSeries: [],
  }
}

const bundles = [
  makeBundle('morning', 'reforma-am', 'Reforma Morning'),
  makeBundle('evening', 'reforma-pm', 'Reforma Evening'),
]

describe('CorridorMarketView', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/markets/reforma-am')
  })

  it('renders the initial period and swaps instantly without navigation', async () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    render(<CorridorMarketView bundles={bundles} initialPeriod="morning" userId={null} />)

    expect(screen.getByTestId('detail')).toHaveTextContent('Reforma Morning')

    await userEvent.click(screen.getByRole('button', { name: /evening/i }))

    expect(screen.getByTestId('detail')).toHaveTextContent('Reforma Evening')
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/markets/reforma-pm')
  })
})
